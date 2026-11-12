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

use crate::MediaSource;

#[derive(Clone)]
enum Source {
    Remote {
        url: String,
        headers: BTreeMap<String, String>,
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
            Source::Remote { url, headers }
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
        self.sources.entries.write().unwrap().remove(id);
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
    let (url, source_headers) = match source {
        Source::Remote { url, headers } => (url, headers),
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
    let mut request = state.client.request(method.clone(), url);
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
    let mut outgoing = response.headers().clone();
    // Hop-by-hop transport headers describe the upstream connection, not this response.
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
