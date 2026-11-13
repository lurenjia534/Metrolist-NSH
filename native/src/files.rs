// SPDX-License-Identifier: GPL-3.0-only
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

use axum::http::{HeaderMap, header};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

use crate::{DownloadInput, DownloadProgress, SavedFile, ranges::Ranged};

struct Transfer {
    bytes: AtomicU64,
    total: AtomicU64,
    cancel: CancellationToken,
}

static TRANSFERS: OnceLock<Mutex<HashMap<String, Arc<Transfer>>>> = OnceLock::new();
static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
static SEQUENCE: AtomicU64 = AtomicU64::new(1);

fn transfers() -> &'static Mutex<HashMap<String, Arc<Transfer>>> {
    TRANSFERS.get_or_init(Mutex::default)
}

fn unique() -> String {
    format!(
        "{:x}-{:x}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

fn filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_control() || "/\\:*?\"<>|".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect()
}

fn saved(path: &Path, name: String, bytes: u64) -> Result<SavedFile, String> {
    let url = url::Url::from_file_path(path)
        .map_err(|_| "The music directory must be an absolute path".to_string())?;
    Ok(SavedFile {
        name,
        destination: path.to_string_lossy().into_owned(),
        url: url.into(),
        bytes,
    })
}

pub(super) fn progress(id: &str) -> Option<DownloadProgress> {
    let active = transfers().lock().unwrap();
    let task = active.get(id)?;
    let bytes = task.bytes.load(Ordering::Relaxed);
    let total_bytes = task.total.load(Ordering::Relaxed);
    Some(DownloadProgress {
        bytes,
        total_bytes,
        progress: if total_bytes == 0 {
            0.0
        } else {
            bytes as f64 / total_bytes as f64
        },
    })
}

pub(super) fn cancel(id: &str) {
    if let Some(task) = transfers().lock().unwrap().get(id) {
        task.cancel.cancel();
    }
}

pub(super) fn download(
    input: DownloadInput,
) -> impl Future<Output = Result<SavedFile, String>> + Send {
    let task = Arc::new(Transfer {
        bytes: AtomicU64::new(0),
        total: AtomicU64::new(0),
        cancel: CancellationToken::new(),
    });
    if let Some(previous) = transfers()
        .lock()
        .unwrap()
        .insert(input.id.clone(), Arc::clone(&task))
    {
        previous.cancel.cancel();
    }
    // Register in the JS call, before the async worker can be cancelled or polled.
    async move {
        let directory = PathBuf::from(&input.directory);
        let name = filename(&input.name);
        // Each attempt owns its path, including when a cancelled track is immediately retried.
        // Display names and URL track IDs can be longer than a filesystem component.
        let destination = directory
            .join(unique())
            .with_extension(Path::new(&name).extension().unwrap_or_default());
        let partial = destination.with_extension(format!(
            "{}.part",
            destination
                .extension()
                .unwrap_or_default()
                .to_string_lossy()
        ));
        let result = transfer(&input, &directory, &partial, &destination, &task).await;
        if result.is_err() {
            let _ = tokio::fs::remove_file(&partial).await;
        }
        let mut active = transfers().lock().unwrap();
        if active
            .get(&input.id)
            .is_some_and(|current| Arc::ptr_eq(current, &task))
        {
            active.remove(&input.id);
        }
        result.and_then(|bytes| saved(&destination, name, bytes))
    }
}

async fn transfer(
    input: &DownloadInput,
    directory: &Path,
    partial: &Path,
    destination: &Path,
    task: &Transfer,
) -> Result<u64, String> {
    tokio::fs::create_dir_all(directory)
        .await
        .map_err(|e| e.to_string())?;
    let client = CLIENT.get_or_init(reqwest::Client::new);
    let mut response = tokio::select! {
        biased;
        _ = task.cancel.cancelled() => return Err("Download cancelled".into()),
        response = Ranged::open(client, &input.url, &input.headers, HeaderMap::new(), 0, None) => response.map_err(|e| e.to_string())?,
    };
    if !response.status().is_success() {
        return Err(format!(
            "The audio source returned HTTP {}",
            response.status().as_u16()
        ));
    }
    task.total.store(
        response.span().map_or_else(
            || {
                response
                    .headers()
                    .get(header::CONTENT_LENGTH)
                    .and_then(|value| value.to_str().ok()?.parse().ok())
                    .unwrap_or(0)
            },
            |span| span.total,
        ),
        Ordering::Relaxed,
    );
    let mut file = tokio::fs::File::create(partial)
        .await
        .map_err(|e| e.to_string())?;
    let result = async {
        loop {
            let chunk = tokio::select! {
                biased;
                _ = task.cancel.cancelled() => return Err("Download cancelled".to_string()),
                chunk = response.chunk() => chunk.map_err(|e| e.to_string())?,
            };
            let Some(chunk) = chunk else {
                break;
            };
            file.write_all(&chunk).await.map_err(|e| e.to_string())?;
            task.bytes.fetch_add(chunk.len() as u64, Ordering::Relaxed);
        }
        Ok(())
    }
    .await;
    // Finish the pending disk write before closing/removing a cancelled partial file on Windows too.
    let flushed = file.flush().await.map_err(|e| e.to_string());
    drop(file);
    result?;
    flushed?;
    if task.cancel.is_cancelled() {
        return Err("Download cancelled".into());
    }
    tokio::fs::rename(partial, destination)
        .await
        .map_err(|e| e.to_string())?;
    Ok(task.bytes.load(Ordering::Relaxed))
}

pub(super) fn copy_into(source: &Path, directory: &str, name: &str) -> Result<SavedFile, String> {
    let input = source.to_string_lossy();
    let source = if input.starts_with("file:") {
        url::Url::parse(&input)
            .map_err(|e| e.to_string())?
            .to_file_path()
            .map_err(|_| "The file URL must reference a local path".to_string())?
    } else {
        source.to_path_buf()
    };
    std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let name = filename(name);
    let destination = Path::new(directory)
        .join(unique())
        .with_extension(Path::new(&name).extension().unwrap_or_default());
    let bytes = std::fs::copy(source, &destination).map_err(|e| e.to_string())?;
    saved(&destination, name, bytes)
}

#[cfg(test)]
mod tests;
