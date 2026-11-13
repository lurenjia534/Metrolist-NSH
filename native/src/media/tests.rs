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
    let registered = relay
        .insert(
            format!("{origin}/audio"),
            [("User-Agent".into(), "metrolist-native-fixture".into())].into(),
        )
        .unwrap();
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
    let forbidden = relay
        .insert(format!("{origin}/audio"), BTreeMap::new())
        .unwrap();
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
    let registered = relay
        .insert(format!("{origin}/streaming"), BTreeMap::new())
        .unwrap();
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

#[tokio::test]
async fn local_audio_streams_get_head_ranges_and_releases_without_removing_the_file() {
    let directory = std::env::temp_dir().join(format!(
        "metrolist-local-media-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
    ));
    tokio::fs::create_dir_all(&directory).await.unwrap();
    let path = directory.join("原音频 100%20 完成.wav");
    let pcm = payload(0, 128 * 1024);
    // A real PCM WAVE file, including a non-ASCII, percent-encoded filename.
    let audio = [
        b"RIFF".as_slice(),
        &(36 + pcm.len() as u32).to_le_bytes(),
        b"WAVEfmt ",
        &16u32.to_le_bytes(),
        &1u16.to_le_bytes(),
        &1u16.to_le_bytes(),
        &44100u32.to_le_bytes(),
        &88200u32.to_le_bytes(),
        &2u16.to_le_bytes(),
        &16u16.to_le_bytes(),
        b"data",
        &(pcm.len() as u32).to_le_bytes(),
        &pcm,
    ]
    .concat();
    tokio::fs::write(&path, &audio).await.unwrap();
    let file_url = url::Url::from_file_path(&path).unwrap();
    let relay = Relay::start().await.unwrap();
    let registered = relay.insert(file_url.into(), BTreeMap::new()).unwrap();
    let client = reqwest::Client::new();

    let head = client.head(&registered.url).send().await.unwrap();
    assert_eq!(head.status(), StatusCode::OK);
    assert_eq!(
        head.headers()[header::CONTENT_LENGTH],
        audio.len().to_string()
    );
    assert_eq!(head.headers()[header::ACCEPT_RANGES], "bytes");
    assert!(
        head.headers()[header::CONTENT_TYPE]
            .to_str()
            .unwrap()
            .starts_with("audio/")
    );
    assert!(head.bytes().await.unwrap().is_empty());

    // AVPlayer probes the first bytes, then requests later ranges when seeking.
    for (start, end) in [(0, 1), (1029, 9231)] {
        let response = client
            .get(&registered.url)
            .header(header::RANGE, format!("bytes={start}-{end}"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            response.headers()[header::CONTENT_RANGE],
            format!("bytes {start}-{end}/{}", audio.len())
        );
        assert_eq!(
            response.headers()[header::CONTENT_LENGTH],
            (end - start + 1).to_string()
        );
        assert_eq!(response.bytes().await.unwrap().as_ref(), &audio[start..=end]);
    }
    let response = client.get(&registered.url).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.bytes().await.unwrap().as_ref(), audio.as_slice());

    relay.release(&registered.id);
    assert_eq!(
        client.get(&registered.url).send().await.unwrap().status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(tokio::fs::read(&path).await.unwrap(), audio);
    tokio::fs::remove_dir_all(directory).await.unwrap();
}

#[tokio::test]
async fn relay_reads_remote_audio_once_in_bounded_ranges_and_answers_seeks_itself() {
    use crate::ranges::{
        CHUNK_BYTES,
        tests::{LENGTH, payload, ranged_server},
    };
    let (url, requests, server) = ranged_server().await;
    let relay = Relay::start().await.unwrap();
    let registered = relay.insert(url, BTreeMap::new()).unwrap();
    let client = reqwest::Client::new();
    let download = [
        format!("bytes=0-{}", CHUNK_BYTES - 1),
        format!("bytes={CHUNK_BYTES}-{}", 2 * CHUNK_BYTES - 1),
        format!("bytes={}-{}", 2 * CHUNK_BYTES, LENGTH - 1),
    ];

    // A player's first request carries no Range header.
    let whole = client.get(&registered.url).send().await.unwrap();
    assert_eq!(whole.status(), StatusCode::OK);
    assert_eq!(whole.headers()[header::CONTENT_LENGTH], LENGTH.to_string());
    assert_eq!(whole.headers()[header::ACCEPT_RANGES], "bytes");
    assert!(whole.headers().get(header::CONTENT_RANGE).is_none());
    assert!(whole.bytes().await.unwrap() == payload(0, LENGTH));
    assert_eq!(*requests.lock().unwrap(), download);

    // qtdemux through gvfs jumps between the end, the start and the middle.
    for (start, end) in [
        (LENGTH - 32, None),
        (0, None),
        (CHUNK_BYTES + 5, None),
        (1029, Some(9231)),
    ] {
        let range = end.map_or(format!("bytes={start}-"), |end| {
            format!("bytes={start}-{end}")
        });
        let seek = client
            .get(&registered.url)
            .header(header::RANGE, range)
            .send()
            .await
            .unwrap();
        let end = end.unwrap_or(LENGTH - 1);
        assert_eq!(seek.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            seek.headers()[header::CONTENT_RANGE],
            format!("bytes {start}-{end}/{LENGTH}")
        );
        assert_eq!(
            seek.headers()[header::CONTENT_LENGTH],
            (end + 1 - start).to_string()
        );
        assert!(seek.bytes().await.unwrap() == payload(start, end + 1));
    }
    // Answered from the download: the source was read once.
    assert_eq!(*requests.lock().unwrap(), download);

    let refused = client
        .get(&registered.url)
        .header(header::RANGE, format!("bytes={LENGTH}-"))
        .send()
        .await
        .unwrap();
    assert_eq!(refused.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    relay.release(&registered.id);
    server.abort();
}
