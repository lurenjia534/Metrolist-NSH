// SPDX-License-Identifier: GPL-3.0-only
use std::{convert::Infallible, time::Duration};

use axum::body::Bytes;
use futures_util::stream;

use super::*;

const LENGTH: usize = 512 * 1024 + 13;

fn payload(start: usize, end: usize) -> Vec<u8> {
    (start..end).map(|i| (i % 251) as u8).collect()
}

async fn source(method: Method, headers: HeaderMap) -> Response {
    if headers
        .get("User-Agent")
        .and_then(|value| value.to_str().ok())
        != Some("metrolist-native-fixture")
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    let (start, end, status) = if let Some(range) = headers.get(header::RANGE) {
        let (start, end) = range
            .to_str()
            .unwrap()
            .strip_prefix("bytes=")
            .unwrap()
            .split_once('-')
            .unwrap();
        (
            start.parse::<usize>().unwrap(),
            end.parse::<usize>().unwrap() + 1,
            StatusCode::PARTIAL_CONTENT,
        )
    } else {
        (0, LENGTH, StatusCode::OK)
    };
    let mut response = Response::builder()
        .status(status)
        .header("Content-Type", "audio/mp4")
        .header("Content-Length", end - start)
        .header("Accept-Ranges", "bytes");
    if status == StatusCode::PARTIAL_CONTENT {
        response = response.header(
            "Content-Range",
            format!("bytes {start}-{}/{LENGTH}", end - 1),
        );
    }
    response
        .body(if method == Method::HEAD {
            Body::empty()
        } else {
            Body::from(payload(start, end))
        })
        .unwrap()
}

async fn streaming_source() -> Response {
    let chunks = stream::unfold(false, |sent| async move {
        if sent {
            std::future::pending::<()>().await;
        }
        Some((Ok::<_, Infallible>(Bytes::from_static(b"first")), true))
    });
    Response::builder()
        .header("Content-Type", "audio/mp4")
        .body(Body::from_stream(chunks))
        .unwrap()
}

async fn server() -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let app = Router::new()
        .route("/audio", get(source).head(source))
        .route("/streaming", get(streaming_source));
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (origin, task)
}

#[tokio::test]
async fn relay_preserves_source_headers_range_head_and_status() {
    let (origin, server) = server().await;
    let relay = Relay::start().await.unwrap();
    let registered = relay.insert(
        format!("{origin}/audio"),
        [("User-Agent".into(), "metrolist-native-fixture".into())].into(),
    );
    let client = reqwest::Client::new();
    let response = client
        .get(&registered.url)
        .header("Range", "bytes=1029-9231")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(
        response.headers()[header::CONTENT_RANGE],
        format!("bytes 1029-9231/{LENGTH}")
    );
    assert_eq!(response.headers()[header::ACCEPT_RANGES], "bytes");
    assert_eq!(response.headers()[header::CONTENT_LENGTH], "8203");
    assert_eq!(
        response.bytes().await.unwrap().as_ref(),
        payload(1029, 9232)
    );
    let head = client.head(&registered.url).send().await.unwrap();
    assert_eq!(head.status(), StatusCode::OK);
    assert_eq!(head.headers()[header::CONTENT_LENGTH], LENGTH.to_string());
    assert!(head.bytes().await.unwrap().is_empty());
    let forbidden = relay.insert(format!("{origin}/audio"), BTreeMap::new());
    assert_eq!(
        client.get(&forbidden.url).send().await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    relay.release(&registered.id);
    assert_eq!(
        client.get(&registered.url).send().await.unwrap().status(),
        StatusCode::NOT_FOUND
    );
    server.abort();
}

#[tokio::test]
async fn relay_delivers_first_bytes_before_the_upstream_finishes() {
    let (origin, server) = server().await;
    let relay = Relay::start().await.unwrap();
    let registered = relay.insert(format!("{origin}/streaming"), BTreeMap::new());
    let mut response = reqwest::get(registered.url).await.unwrap();
    let first = tokio::time::timeout(Duration::from_secs(2), response.chunk())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(&first[..], b"first");
    drop(response);
    server.abort();
}
