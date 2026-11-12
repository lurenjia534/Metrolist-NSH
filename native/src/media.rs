// SPDX-License-Identifier: GPL-3.0-only
use std::{
    collections::{BTreeMap, HashMap},
    net::SocketAddr,
    sync::{
        Arc, RwLock,
        atomic::{AtomicU64, Ordering},
    },
};

use axum::{
    Router,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use tokio::sync::OnceCell;

use crate::MediaSource;

#[derive(Clone)]
struct Source {
    url: String,
    headers: BTreeMap<String, String>,
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

    fn insert(&self, url: String, headers: BTreeMap<String, String>) -> MediaSource {
        let id = self
            .sources
            .next
            .fetch_add(1, Ordering::Relaxed)
            .to_string();
        self.sources
            .entries
            .write()
            .unwrap()
            .insert(id.clone(), Source { url, headers });
        MediaSource {
            url: format!("http://{}/media/{id}", self.address),
            id,
        }
    }

    fn release(&self, id: &str) {
        self.sources.entries.write().unwrap().remove(id);
    }
}

pub(super) async fn prepare(
    url: String,
    headers: BTreeMap<String, String>,
) -> Result<MediaSource, String> {
    Ok(RELAY
        .get_or_try_init(Relay::start)
        .await?
        .insert(url, headers))
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
    let mut request = state.client.request(method.clone(), source.url);
    for (name, value) in source.headers {
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
