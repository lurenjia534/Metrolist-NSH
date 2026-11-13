// SPDX-License-Identifier: GPL-3.0-only
//! Remote audio read as consecutive bounded byte ranges.
//!
//! googlevideo sends a request for at most 10 MiB at full speed. A request
//! without a Range header, or for more than that, is held to about twice the
//! audio's real-time rate (~30 KB/s), so playback stalls on any network hiccup
//! and a download takes as long as the song. yt-dlp's `http_chunk_size` and
//! InnerTubeX's bounded media ranges read YouTube media the same way.
//!
//! A player reads more than once: GTK reads through gvfs, whose seekable stream
//! lets qtdemux jump between the start, the end and the middle of the file, and
//! AVPlayer asks for many small ranges. Sent to the source, every jump costs a
//! round trip (0.3–1 s); a [`Download`] reads the file once, in order, and
//! answers those reads itself, as Media3's cache does on Android.

use std::{
    collections::BTreeMap,
    io,
    sync::{Arc, OnceLock, RwLock},
};

use axum::{
    body::Bytes,
    http::{HeaderMap, StatusCode, header},
};
use futures_util::{Stream, stream};
use tokio::{sync::watch, task::AbortHandle};

/// The most bytes asked for in one request.
pub(crate) const CHUNK_BYTES: u64 = 10 << 20;

/// How far past a download a read waits for it rather than asking the source:
/// about the bytes it brings in one round trip.
pub(crate) const AHEAD_BYTES: u64 = 2 << 20;

/// The most bytes handed to a player at once from a download.
const READ_BYTES: u64 = 256 << 10;

/// Bytes `start..=end` of a resource of `total` bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Span {
    pub start: u64,
    pub end: u64,
    pub total: u64,
}

/// A source's response, its body read one bounded range after another.
pub(crate) struct Ranged {
    client: reqwest::Client,
    url: String,
    headers: BTreeMap<String, String>,
    status: StatusCode,
    first: HeaderMap,
    response: reqwest::Response,
    /// The first byte not yet requested.
    next: u64,
    /// What is delivered, when the source answered with a range.
    span: Option<Span>,
}

/// `bytes=start-` or `bytes=start-end`; other forms are not a single range from a known start.
pub(crate) fn byte_range(value: &str) -> Option<(u64, Option<u64>)> {
    let (start, end) = value.trim().strip_prefix("bytes=")?.split_once('-')?;
    let end = end.trim();
    Some((
        start.trim().parse().ok()?,
        if end.is_empty() {
            None
        } else {
            Some(end.parse().ok()?)
        },
    ))
}

/// `bytes first-last/total` as (last, total).
fn content_range(headers: &HeaderMap) -> Option<(u64, u64)> {
    let (range, total) = headers
        .get(header::CONTENT_RANGE)?
        .to_str()
        .ok()?
        .strip_prefix("bytes ")?
        .split_once('/')?;
    Some((range.split_once('-')?.1.parse().ok()?, total.parse().ok()?))
}

fn request(
    client: &reqwest::Client,
    url: &str,
    headers: &BTreeMap<String, String>,
    start: u64,
    end: Option<u64>,
) -> reqwest::RequestBuilder {
    let last = start + CHUNK_BYTES - 1;
    let last = end.map_or(last, |end| end.min(last));
    let mut request = client.get(url);
    for (name, value) in headers {
        request = request.header(name, value);
    }
    request
        .header(header::RANGE, format!("bytes={start}-{last}"))
        .header(header::ACCEPT_ENCODING, "identity")
}

impl Ranged {
    /// Opens bytes `start..=end`, or `start` to the end of the resource. `first`
    /// goes with the first request only. A source that ignores the range, or
    /// refuses it, is passed through as it answered.
    pub(crate) async fn open(
        client: &reqwest::Client,
        url: &str,
        headers: &BTreeMap<String, String>,
        first: HeaderMap,
        start: u64,
        end: Option<u64>,
    ) -> Result<Self, reqwest::Error> {
        let response = request(client, url, headers, start, end)
            .headers(first)
            .send()
            .await?;
        let range = (response.status() == StatusCode::PARTIAL_CONTENT)
            .then(|| content_range(response.headers()))
            .flatten();
        Ok(Self {
            client: client.clone(),
            url: url.into(),
            headers: headers.clone(),
            status: response.status(),
            first: response.headers().clone(),
            next: range.map_or(0, |(last, _)| last + 1),
            span: range.map(|(_, total)| Span {
                start,
                end: end.map_or(total - 1, |end| end.min(total - 1)),
                total,
            }),
            response,
        })
    }

    /// The first response's status.
    pub(crate) fn status(&self) -> StatusCode {
        self.status
    }

    /// The first response's headers.
    pub(crate) fn headers(&self) -> &HeaderMap {
        &self.first
    }

    /// The bytes delivered, when the source answered with a range.
    pub(crate) fn span(&self) -> Option<Span> {
        self.span
    }

    /// The next bytes of the body; a range ends where the next one is requested.
    pub(crate) async fn chunk(&mut self) -> io::Result<Option<Bytes>> {
        loop {
            if let Some(bytes) = self.response.chunk().await.map_err(io::Error::other)? {
                return Ok(Some(bytes));
            }
            let Some(span) = self.span.filter(|span| self.next <= span.end) else {
                return Ok(None);
            };
            let response = request(
                &self.client,
                &self.url,
                &self.headers,
                self.next,
                Some(span.end),
            )
            .send()
            .await
            .map_err(io::Error::other)?;
            let Some((last, _)) = (response.status() == StatusCode::PARTIAL_CONTENT)
                .then(|| content_range(response.headers()))
                .flatten()
            else {
                return Err(io::Error::other(format!(
                    "The audio source answered bytes {}- with HTTP {}",
                    self.next,
                    response.status().as_u16()
                )));
            };
            self.response = response;
            self.next = last + 1;
        }
    }

    /// The whole body as a stream.
    pub(crate) fn into_stream(self) -> impl Stream<Item = io::Result<Bytes>> + Send {
        stream::try_unfold(self, |mut ranged| async move {
            Ok(ranged.chunk().await?.map(|bytes| (bytes, ranged)))
        })
    }
}

/// What a download has so far.
#[derive(Default)]
struct Progress {
    /// The source's length and first headers, once it answered with a range.
    head: Option<(u64, HeaderMap)>,
    /// Bytes downloaded from the start.
    len: u64,
    /// The download ended early: the source refused or ignored the range, or failed.
    stopped: bool,
}

/// A remote resource read once from its start, in bounded ranges, and kept in
/// memory while its player plays it.
pub(crate) struct Download {
    bytes: RwLock<Vec<u8>>,
    progress: watch::Sender<Progress>,
    task: OnceLock<AbortHandle>,
}

impl Download {
    /// Starts downloading `url`; on a Tokio runtime.
    pub(crate) fn start(
        client: reqwest::Client,
        url: String,
        headers: BTreeMap<String, String>,
    ) -> Arc<Self> {
        let download = Arc::new(Self {
            bytes: RwLock::default(),
            progress: watch::Sender::new(Progress::default()),
            task: OnceLock::new(),
        });
        let task = tokio::spawn(Arc::clone(&download).run(client, url, headers));
        let _ = download.task.set(task.abort_handle());
        download
    }

    async fn run(
        self: Arc<Self>,
        client: reqwest::Client,
        url: String,
        headers: BTreeMap<String, String>,
    ) {
        let ranged = Ranged::open(&client, &url, &headers, HeaderMap::new(), 0, None).await;
        let Some((mut ranged, span)) = ranged
            .ok()
            .and_then(|ranged| ranged.span().map(|span| (ranged, span)))
        else {
            self.progress
                .send_modify(|progress| progress.stopped = true);
            return;
        };
        self.bytes
            .write()
            .unwrap()
            .reserve_exact(span.total as usize);
        self.progress
            .send_modify(|progress| progress.head = Some((span.total, ranged.headers().clone())));
        loop {
            match ranged.chunk().await {
                Ok(Some(bytes)) => {
                    self.bytes.write().unwrap().extend_from_slice(&bytes);
                    self.progress
                        .send_modify(|progress| progress.len += bytes.len() as u64);
                }
                Ok(None) => return,
                Err(_) => {
                    self.progress
                        .send_modify(|progress| progress.stopped = true);
                    return;
                }
            }
        }
    }

    /// Stops downloading.
    pub(crate) fn stop(&self) {
        if let Some(task) = self.task.get() {
            task.abort();
        }
    }

    /// The source's length and first headers, once it answered; `None` when
    /// it did not answer with a range.
    pub(crate) async fn head(&self) -> Option<(u64, HeaderMap)> {
        let mut progress = self.progress.subscribe();
        let progress = progress
            .wait_for(|progress| progress.head.is_some() || progress.stopped)
            .await
            .ok()?;
        progress.head.clone()
    }

    /// Whether a read from `start` is answered here: the download has the
    /// byte, or brings it about as soon as the source could.
    pub(crate) fn reads(&self, start: u64) -> bool {
        let progress = self.progress.borrow();
        progress
            .head
            .as_ref()
            .is_some_and(|(total, _)| start < *total)
            && (start < progress.len || (!progress.stopped && start <= progress.len + AHEAD_BYTES))
    }

    /// Bytes `start..=end`, as the download brings them.
    pub(crate) fn read(
        self: Arc<Self>,
        start: u64,
        end: u64,
    ) -> impl Stream<Item = io::Result<Bytes>> + Send {
        let progress = self.progress.subscribe();
        stream::try_unfold(
            (self, progress, start),
            move |(download, mut progress, position)| async move {
                if position > end {
                    return Ok(None);
                }
                let len = progress
                    .wait_for(|progress| progress.len > position || progress.stopped)
                    .await
                    .map_err(io::Error::other)?
                    .len;
                if len <= position {
                    return Err(io::Error::other("The audio download stopped"));
                }
                let last = len.min(end + 1).min(position + READ_BYTES);
                let bytes = Bytes::copy_from_slice(
                    &download.bytes.read().unwrap()[position as usize..last as usize],
                );
                Ok(Some((bytes, (download, progress, last))))
            },
        )
    }
}

#[cfg(test)]
pub(crate) mod tests;
