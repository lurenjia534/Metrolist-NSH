# Native system services

`nsh.json` links this Rust crate into the application and exports
`NativeFiles` and `NativeMedia` from `metrolist/native`. The crate uses the
same NSH revision as `scripts/nsh-toolchain.json`.

## Files

`NativeFiles.download` receives the URL and headers resolved by the shared
JavaScript music service. It streams the response to a file on Tokio's
runtime, reports byte counts through `progress(id)`, and renames the completed
file into place. Audio data never crosses QuickJS. `cancel(id)` stops the
network read; the download promise rejects after closing and removing the
partial file. Transfers are registered during the JavaScript call, so cancelling
before the asynchronous worker starts also works. Retrying a track owns a
separate file and transfer handle. Physical filenames use a short unique token
and the audio extension; full Unicode display names and long URL track IDs stay
in metadata instead of exceeding filesystem filename limits.

The caller supplies its app-private music directory. The existing application
store persists track metadata and the returned file URL, so offline playback
does not require an HTTP server. `copyInto` migrates files from older download
locations with a native file copy.

Desktop imports use NSH's native path picker and file copies, including music
files larger than the JavaScript file API's 8 MiB write limit. Export opens the
system save dialog. `reveal` selects a file in the system file manager. These
three dialog/file-manager operations are desktop APIs; Android, iOS and web
keep their platform import/export flows.

## Playback transport

NSH's generic `AudioPlayer` takes a URL but no HTTP headers. `NativeMedia.prepare`
registers a resolved source and returns a loopback URL that preserves its
headers. The Rust HTTP transport runs inside the same application process and
streams bytes as they arrive. It forwards If-Range, HEAD and upstream
status/response headers, so native players can seek. Dispose the player before
calling `release(id)`.

Every remote source plays through this transport on desktop and iOS, headers
or not. googlevideo sends a request for at most 10 MiB at full speed and holds
one without a Range header, or for more, to about 30 KB/s — roughly twice the
real-time rate of the audio. Players open position 0 without a Range header
(GStreamer, Media3) or ask for open-ended ranges (AVPlayer). The transport
answers a whole-file or `bytes=start-[end]` request as one response, reading
the source as consecutive ranges of at most 10 MiB (`ranges.rs`), as yt-dlp's
`http_chunk_size` does. Downloads read the same way. Other Range forms and
sources that ignore ranges are passed through as they answer.

Players read the same file more than once. GTK opens an `http` URL through
gvfs as a seekable stream, so qtdemux jumps between the start, the end and the
middle of the file while it prepares, and again every few seconds while it
plays; AVPlayer asks for many small ranges. Each jump sent to googlevideo costs
a round trip. A registered remote source is therefore downloaded once, from
its start and in those bounded ranges, into memory, and reads are answered
from that download as it arrives, as Media3's cache does on Android. Only a
read more than 2 MiB past the download goes to the source itself. `release(id)`
stops the download and frees it.

Catalog, authentication, playlists and stream resolution remain in the shared
QuickJS application code. This transport handles audio bytes only; it does not
run another application service or launch a process.

## Build and checks

Use Rust 1.97 or later. NSH generates the runners for each requested target:

```sh
nsh check
nsh package --target linux
cargo test --manifest-path native/Cargo.toml --locked
```

The Rust tests run local HTTP fixtures. They cover a 9 MiB + 123 byte download,
exact file contents, required source headers, cancellation of a stalled
response, immediate retry, native file copying, upstream HTTP errors, Range
and HEAD responses, source release, forwarding the first audio bytes
before the upstream response finishes, and reading whole files, seeks and
downloads of a 20 MiB + 4097 byte source as bounded 10 MiB ranges, with
later jumps to its end, start and middle answered without asking the source
again.

Browser builds retain the module declarations but use the browser host for
files and the deployed music gateway for streaming. Native HTTP and filesystem
dependencies are excluded from WebAssembly.
