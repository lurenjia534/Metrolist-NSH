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
streams bytes as they arrive. It forwards Range, If-Range, HEAD and upstream
status/response headers, so native players can seek. Dispose the player before
calling `release(id)`.

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
and HEAD responses, source release, and forwarding the first audio bytes
before the upstream response finishes.

Browser builds retain the module declarations but use the browser host for
files and the deployed music gateway for streaming. Native HTTP and filesystem
dependencies are excluded from WebAssembly.
