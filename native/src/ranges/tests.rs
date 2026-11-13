// SPDX-License-Identifier: GPL-3.0-only
use std::sync::{Arc, Mutex};

use axum::{
    Router,
    body::Body,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};

use super::*;

/// Two full ranges and part of a third.
pub(crate) const LENGTH: u64 = 2 * CHUNK_BYTES + 4097;

pub(crate) fn payload(start: u64, end: u64) -> Vec<u8> {
    (start..end).map(|i| (i % 251) as u8).collect()
}

/// The Range header of each request the source received ("" without one).
pub(crate) type Requests = Arc<Mutex<Vec<String>>>;

/// A source that serves ranges as googlevideo does; no Range header gets the whole body.
async fn source(State(requests): State<Requests>, headers: HeaderMap) -> Response {
    let range = headers
        .get(header::RANGE)
        .map(|value| value.to_str().unwrap().to_string());
    requests
        .lock()
        .unwrap()
        .push(range.clone().unwrap_or_default());
    let Some((start, end)) = range.as_deref().and_then(byte_range) else {
        return Response::builder()
            .header(header::CONTENT_TYPE, "audio/mp4")
            .header(header::CONTENT_LENGTH, LENGTH)
            .body(Body::from(payload(0, LENGTH)))
            .unwrap();
    };
    if start >= LENGTH {
        return StatusCode::RANGE_NOT_SATISFIABLE.into_response();
    }
    let end = end.map_or(LENGTH - 1, |end| end.min(LENGTH - 1));
    Response::builder()
        .status(StatusCode::PARTIAL_CONTENT)
        .header(header::CONTENT_TYPE, "audio/mp4")
        .header(header::CONTENT_LENGTH, end + 1 - start)
        .header(
            header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{LENGTH}"),
        )
        .body(Body::from(payload(start, end + 1)))
        .unwrap()
}

pub(crate) async fn ranged_server() -> (String, Requests, tokio::task::JoinHandle<()>) {
    let requests = Requests::default();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let app = Router::new()
        .route("/audio", get(source))
        .with_state(Arc::clone(&requests));
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (format!("{origin}/audio"), requests, task)
}

async fn read(mut ranged: Ranged) -> Vec<u8> {
    let mut body = Vec::new();
    while let Some(bytes) = ranged.chunk().await.unwrap() {
        body.extend_from_slice(&bytes);
    }
    body
}

#[test]
fn single_ranges_from_a_known_start_are_read() {
    assert_eq!(byte_range("bytes=0-"), Some((0, None)));
    assert_eq!(byte_range("bytes=1029-9231"), Some((1029, Some(9231))));
    assert_eq!(byte_range("bytes=-500"), None);
    assert_eq!(byte_range("bytes=0-1,5-9"), None);
    assert_eq!(byte_range("items=0-1"), None);
}

#[tokio::test]
async fn a_whole_resource_is_requested_as_bounded_ranges() {
    let (url, requests, server) = ranged_server().await;
    let ranged = Ranged::open(
        &reqwest::Client::new(),
        &url,
        &BTreeMap::new(),
        HeaderMap::new(),
        0,
        None,
    )
    .await
    .unwrap();
    assert_eq!(ranged.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(
        ranged.span(),
        Some(Span {
            start: 0,
            end: LENGTH - 1,
            total: LENGTH
        })
    );
    assert!(read(ranged).await == payload(0, LENGTH));
    assert_eq!(
        *requests.lock().unwrap(),
        [
            format!("bytes=0-{}", CHUNK_BYTES - 1),
            format!("bytes={CHUNK_BYTES}-{}", 2 * CHUNK_BYTES - 1),
            format!("bytes={}-{}", 2 * CHUNK_BYTES, LENGTH - 1),
        ]
    );
    server.abort();
}

#[tokio::test]
async fn a_requested_range_ends_where_asked() {
    let (url, requests, server) = ranged_server().await;
    let client = reqwest::Client::new();
    let (start, end) = (CHUNK_BYTES - 10, CHUNK_BYTES + 20);
    let ranged = Ranged::open(
        &client,
        &url,
        &BTreeMap::new(),
        HeaderMap::new(),
        start,
        Some(end),
    )
    .await
    .unwrap();
    assert!(read(ranged).await == payload(start, end + 1));
    assert_eq!(*requests.lock().unwrap(), [format!("bytes={start}-{end}")]);
    let refused = Ranged::open(
        &client,
        &url,
        &BTreeMap::new(),
        HeaderMap::new(),
        LENGTH,
        None,
    )
    .await
    .unwrap();
    assert_eq!(refused.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    assert_eq!(refused.span(), None);
    server.abort();
}
