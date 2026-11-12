// SPDX-License-Identifier: GPL-3.0-only
use std::{convert::Infallible, time::Duration};

use axum::{
    Router,
    body::{Body, Bytes},
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::get,
};
use futures_util::stream;

use super::*;

const SIZE: usize = 9 * 1024 * 1024 + 123;

fn payload(size: usize) -> Vec<u8> {
    (0..size).map(|i| (i % 251) as u8).collect()
}

async fn source(headers: HeaderMap) -> Response<Body> {
    if headers
        .get("x-metrolist-fixture")
        .and_then(|v| v.to_str().ok())
        != Some("native")
    {
        return Response::builder()
            .status(StatusCode::UNAUTHORIZED)
            .body(Body::empty())
            .unwrap();
    }
    let chunks = stream::iter((0..SIZE).step_by(65536).map(|start| {
        let bytes: Vec<u8> = (start..(start + 65536).min(SIZE))
            .map(|i| (i % 251) as u8)
            .collect();
        Ok::<_, Infallible>(Bytes::from(bytes))
    }));
    Response::builder()
        .header("Content-Type", "audio/mp4")
        .header("Content-Length", SIZE)
        .body(Body::from_stream(chunks))
        .unwrap()
}

async fn stalled() -> Response<Body> {
    let chunks = stream::unfold(false, |sent| async move {
        if sent {
            std::future::pending::<()>().await;
        }
        Some((
            Ok::<_, Infallible>(Bytes::from_static(b"first audio bytes")),
            true,
        ))
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
        .route("/audio", get(source))
        .route("/stalled", get(stalled));
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (origin, task)
}

fn input(origin: &str, directory: &Path, id: &str, endpoint: &str) -> DownloadInput {
    DownloadInput {
        id: id.into(),
        url: format!("{origin}/{endpoint}"),
        name: "初音ミク - 本地音频.m4a".into(),
        directory: directory.to_string_lossy().into_owned(),
        headers: [("x-metrolist-fixture".into(), "native".into())].into(),
    }
}

async fn wait_for_bytes(id: &str) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while progress(id).is_none_or(|p| p.bytes == 0) {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("download receives its first chunk");
}

#[tokio::test]
async fn streams_more_than_eight_mib_and_copies_the_saved_file() {
    let (origin, server) = server().await;
    let directory = std::env::temp_dir().join(format!("metrolist-download-{}", unique()));
    let id = format!(
        "url:https://audio.test/music?signature={}",
        "a".repeat(1024)
    );
    let name = format!("{}.m4a", "初音ミクの長い曲名".repeat(50));
    let mut request = input(&origin, &directory, &id, "audio");
    request.name = name.clone();
    let result = download(request).await.unwrap();
    assert_eq!(result.name, name);
    assert!(Path::new(&result.destination).file_name().unwrap().len() < 255);
    assert_eq!(result.bytes, SIZE as u64);
    assert_eq!(
        tokio::fs::read(&result.destination).await.unwrap(),
        payload(SIZE)
    );
    assert_eq!(
        url::Url::parse(&result.url)
            .unwrap()
            .to_file_path()
            .unwrap(),
        PathBuf::from(&result.destination)
    );
    assert!(progress(&id).is_none());
    let exported = copy_into(
        Path::new(&result.destination),
        directory.join("imported").to_str().unwrap(),
        &name,
    )
    .unwrap();
    assert_eq!(exported.bytes, SIZE as u64);
    assert_eq!(exported.name, name);
    assert_eq!(
        tokio::fs::read(exported.destination).await.unwrap(),
        payload(SIZE)
    );
    assert!(
        !std::fs::read_dir(&directory).unwrap().any(|f| f
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".part"))
    );
    tokio::fs::remove_dir_all(directory).await.unwrap();
    server.abort();
}

#[test]
fn copies_file_urls_and_literal_paths_with_unicode_spaces_and_percent_signs() {
    let directory = std::env::temp_dir().join(format!("metrolist-copy-{}", unique()));
    std::fs::create_dir_all(&directory).unwrap();
    let name = "原音频 100%20 完成.m4a";
    let source = directory.join(name);
    let bytes = payload(65539);
    std::fs::write(&source, &bytes).unwrap();
    let file_url = url::Url::from_file_path(&source).unwrap();
    assert!(file_url.as_str().contains("%20"));
    assert!(file_url.as_str().contains("%2520"));
    let copies = directory.join("copies");
    for input in [&source, Path::new(file_url.as_str())] {
        let copied = copy_into(input, copies.to_str().unwrap(), name).unwrap();
        assert_eq!(copied.name, name);
        assert_eq!(copied.bytes, bytes.len() as u64);
        assert_eq!(std::fs::read(copied.destination).unwrap(), bytes);
    }
    assert_eq!(std::fs::read(source).unwrap(), bytes);
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn cancellation_interrupts_a_stalled_response_and_removes_partial_file() {
    let (origin, server) = server().await;
    let directory = std::env::temp_dir().join(format!("metrolist-cancel-{}", unique()));
    let id = unique();
    let task = tokio::spawn(download(input(&origin, &directory, &id, "stalled")));
    wait_for_bytes(&id).await;
    assert_eq!(progress(&id).unwrap().bytes, 17);
    cancel(&id);
    let error = tokio::time::timeout(Duration::from_secs(2), task)
        .await
        .unwrap()
        .unwrap()
        .unwrap_err();
    assert_eq!(error, "Download cancelled");
    assert!(progress(&id).is_none());
    assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 0);
    tokio::fs::remove_dir_all(directory).await.unwrap();
    server.abort();
}

#[tokio::test]
async fn cancellation_before_the_worker_is_polled_stops_the_transfer() {
    let (origin, server) = server().await;
    let directory = std::env::temp_dir().join(format!("metrolist-early-cancel-{}", unique()));
    let id = unique();
    let transfer = download(input(&origin, &directory, &id, "stalled"));
    cancel(&id);
    let result = tokio::time::timeout(Duration::from_secs(2), transfer)
        .await
        .unwrap();
    assert_eq!(result.unwrap_err(), "Download cancelled");
    assert!(progress(&id).is_none());
    assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 0);
    tokio::fs::remove_dir_all(directory).await.unwrap();
    server.abort();
}

#[tokio::test]
async fn immediate_retry_keeps_the_new_transfer_registered() {
    let (origin, server) = server().await;
    let directory = std::env::temp_dir().join(format!("metrolist-retry-{}", unique()));
    let id = unique();
    let first = tokio::spawn(download(input(&origin, &directory, &id, "stalled")));
    wait_for_bytes(&id).await;
    let second = tokio::spawn(download(input(&origin, &directory, &id, "stalled")));
    assert_eq!(first.await.unwrap().unwrap_err(), "Download cancelled");
    wait_for_bytes(&id).await;
    assert_eq!(progress(&id).unwrap().bytes, 17);
    cancel(&id);
    assert_eq!(second.await.unwrap().unwrap_err(), "Download cancelled");
    assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 0);
    tokio::fs::remove_dir_all(directory).await.unwrap();
    server.abort();
}

#[tokio::test]
async fn http_failure_is_not_saved_as_audio() {
    let (origin, server) = server().await;
    let directory = std::env::temp_dir().join(format!("metrolist-http-{}", unique()));
    let mut request = input(&origin, &directory, &unique(), "audio");
    request.headers.clear();
    assert!(download(request).await.unwrap_err().contains("401"));
    assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 0);
    tokio::fs::remove_dir_all(directory).await.unwrap();
    server.abort();
}
