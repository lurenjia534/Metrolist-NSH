// SPDX-License-Identifier: GPL-3.0-only
use std::{
    collections::{BTreeMap, HashMap},
    net::SocketAddr,
    path::PathBuf,
    sync::{
        Arc, RwLock,
        atomic::{AtomicU64, Ordering},
    },
};

use axum::{
    Router,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, Method, Request, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use tokio::sync::OnceCell;
use tower_http::services::ServeFile;

use crate::{
    MediaSource,
    ranges::{Download, Ranged, byte_range},
};

#[derive(Clone)]
enum Source {
    Remote {
        url: String,
        headers: BTreeMap<String, String>,
        download: Arc<Download>,
    },
    File(PathBuf),
}

struct Sources {
    client: reqwest::Client,
    entries: RwLock<HashMap<String, Source>>,
    next: AtomicU64,
}

struct Relay {
    address: SocketAddr,
    sources: Arc<Sources>,
}

static RELAY: OnceCell<Relay> = OnceCell::const_new();

impl Relay {
    async fn start() -> Result<Self, String> {
        let sources = Arc::new(Sources {
            client: reqwest::Client::new(),
            entries: RwLock::new(HashMap::new()),
            next: AtomicU64::new(1),
        });
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|e| e.to_string())?;
        let address = listener.local_addr().map_err(|e| e.to_string())?;
        let app = Router::new()
            .route("/media/{id}", get(relay).head(relay))
            .with_state(Arc::clone(&sources));
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        Ok(Self { address, sources })
    }

    fn insert(&self, url: String, headers: BTreeMap<String, String>) -> Result<MediaSource, String> {
        let source = if url.starts_with("file:") {
            Source::File(
                url::Url::parse(&url)
                    .map_err(|e| e.to_string())?
                    .to_file_path()
                    .map_err(|_| "The file URL must reference a local path".to_string())?,
            )
        } else {
            Source::Remote {
                download: Download::start(
                    self.sources.client.clone(),
                    url.clone(),
                    headers.clone(),
                ),
                url,
                headers,
            }
        };
        let id = self
            .sources
            .next
            .fetch_add(1, Ordering::Relaxed)
            .to_string();
        self.sources
            .entries
            .write()
            .unwrap()
            .insert(id.clone(), source);
        Ok(MediaSource {
            url: format!("http://{}/media/{id}", self.address),
            id,
        })
    }

    fn release(&self, id: &str) {
        if let Some(Source::Remote { download, .. }) =
            self.sources.entries.write().unwrap().remove(id)
        {
            download.stop();
        }
    }
}

pub(super) async fn prepare(
    url: String,
    headers: BTreeMap<String, String>,
) -> Result<MediaSource, String> {
    RELAY
        .get_or_try_init(Relay::start)
        .await?
        .insert(url, headers)
}

pub(super) fn release(id: &str) {
    if let Some(relay) = RELAY.get() {
        relay.release(id);
    }
}

async fn relay(
    State(state): State<Arc<Sources>>,
    Path(id): Path<String>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    let source = state.entries.read().unwrap().get(&id).cloned();
    let Some(source) = source else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let (url, source_headers, download) = match source {
        Source::Remote {
            url,
            headers,
            download,
        } => (url, headers, download),
        Source::File(path) => {
            let mut request = Request::new(Body::empty());
            *request.method_mut() = method;
            *request.headers_mut() = headers;
            return match ServeFile::new(path).try_call(request).await {
                Ok(response) => response.map(Body::new),
                Err(error) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
            };
        }
    };
    let range = headers.get(header::RANGE);
    let bounds = match range {
        None => Some((0, None)),
        Some(value) => value.to_str().ok().and_then(byte_range),
    };
    let Some((start, end)) = bounds.filter(|_| method == Method::GET) else {
        return forward(&state.client, method, url, source_headers, &headers).await;
    };
    if let Some((total, first)) = download.head().await
        && download.reads(start)
    {
        let end = end.map_or(total - 1, |end| end.min(total - 1));
        let mut outgoing = without_hop_headers(&first);
        outgoing.insert(header::CONTENT_LENGTH, (end + 1 - start).into());
        let status = if range.is_some() {
            outgoing.insert(
                header::CONTENT_RANGE,
                format!("bytes {start}-{end}/{total}").parse().unwrap(),
            );
            StatusCode::PARTIAL_CONTENT
        } else {
            outgoing.remove(header::CONTENT_RANGE);
            StatusCode::OK
        };
        outgoing.insert(header::ACCEPT_RANGES, "bytes".parse().unwrap());
        let mut response = Response::new(Body::from_stream(download.read(start, end)));
        *response.status_mut() = status;
        *response.headers_mut() = outgoing;
        return response;
    }
    // Reads far past the download, and sources it cannot keep, go to the source itself.
    let mut first = HeaderMap::new();
    if let Some(value) = headers.get(header::IF_RANGE) {
        first.insert(header::IF_RANGE, value.clone());
    }
    let ranged = match Ranged::open(&state.client, &url, &source_headers, first, start, end).await {
        Ok(ranged) => ranged,
        Err(error) => return (StatusCode::BAD_GATEWAY, error.to_string()).into_response(),
    };
    let mut outgoing = without_hop_headers(ranged.headers());
    let status = match ranged.span() {
        Some(span) => {
            outgoing.insert(header::CONTENT_LENGTH, (span.end + 1 - span.start).into());
            if range.is_some() {
                outgoing.insert(
                    header::CONTENT_RANGE,
                    format!("bytes {}-{}/{}", span.start, span.end, span.total)
                        .parse()
                        .unwrap(),
                );
                StatusCode::PARTIAL_CONTENT
            } else {
                outgoing.remove(header::CONTENT_RANGE);
                StatusCode::OK
            }
        }
        None => ranged.status(),
    };
    let mut response = Response::new(Body::from_stream(ranged.into_stream()));
    *response.status_mut() = status;
    *response.headers_mut() = outgoing;
    response
}

/// Hop-by-hop transport headers describe the upstream connection, not this response.
fn without_hop_headers(headers: &HeaderMap) -> HeaderMap {
    let mut outgoing = headers.clone();
    for name in [
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    ] {
        outgoing.remove(name);
    }
    outgoing
}

/// A request the range reader does not serve (HEAD, multiple or suffix ranges), sent as it came.
async fn forward(
    client: &reqwest::Client,
    method: Method,
    url: String,
    source_headers: BTreeMap<String, String>,
    headers: &HeaderMap,
) -> Response {
    let mut request = client.request(method.clone(), url);
    for (name, value) in source_headers {
        request = request.header(name, value);
    }
    for name in [header::RANGE, header::IF_RANGE] {
        if let Some(value) = headers.get(&name) {
            request = request.header(name, value);
        }
    }
    let response = match request
        .header(header::ACCEPT_ENCODING, "identity")
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => return (StatusCode::BAD_GATEWAY, error.to_string()).into_response(),
    };
    let status = response.status();
    let outgoing = without_hop_headers(response.headers());
    let body = if method == Method::HEAD {
        Body::empty()
    } else {
        Body::from_stream(response.bytes_stream())
    };
    let mut response = Response::new(body);
    *response.status_mut() = status;
    *response.headers_mut() = outgoing;
    response
}

#[cfg(test)]
mod tests;
