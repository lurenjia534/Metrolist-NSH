# Metrolist NSH music gateway

The catalog uses YouTube Music's `WEB_REMIX` profile. Pure audio uses the
visitor-backed `VISIONOS_0_1` path found in Metrolist / InnertubeX. Both run as
ordinary Web API JavaScript in a Cloudflare Worker, Node.js 24, or NSH's native
JavaScript runtime. Google account requests use the original Cookie / SAPISIDHASH
authentication and the selected YouTube channel. The gateway
returns audio-only AAC or Opus streams; it does not use an iframe player.

## Run locally

Build the NSH web app, then start its gateway from the project directory:

```sh
npm run dev
# Equivalent:
node --max-http-header-size=65536 --use-env-proxy server/dev.mjs
```

The default address is `http://localhost:8787`, with static files from
`dist/client`. `PORT`, `HOST` and `STATIC_DIR` override these defaults. The
64 KiB HTTP header option accommodates YouTube's watch-page response headers.
The default resolver needs Node.js 24 only, without Python or an NSH runtime.

Native apps can dispatch the shared API directly and use NSH's native fetch to
reach YouTube Music, without a phone-local Node service. To use a Node gateway
on another device, enter the computer's LAN address in the app's
music-service setting, for example `http://192.168.1.20:8787`. The server listens
on all interfaces by default; returned audio and offline URLs retain the LAN
host. Set `PUBLIC_ORIGIN=https://your-gateway.example` when a reverse proxy
provides the public address. A hosted HTTPS browser app should use an HTTPS
gateway address.

### Optional yt-dlp resolver

`STREAM_RESOLVER=yt-dlp` selects the separately maintained extractor instead of
the built-in JavaScript resolver:

```sh
python3 -m pip install -U -r server/requirements.txt
STREAM_RESOLVER=yt-dlp npm run dev
```

`YT_DLP_PATH` can name an installed yt-dlp executable; otherwise the gateway uses
`python3 -m yt_dlp`. `PYTHON` selects a different Python executable. On PowerShell,
set `$env:STREAM_RESOLVER="yt-dlp"` before starting the server. The optional
extractor uses Node as its JavaScript runtime. It is not part of the Worker bundle.

## Cloudflare Worker

`index.mjs` exports `api(request, env)` and a Worker `default.fetch` handler. The
default handler can serve static content through `env.ASSETS`; the project build
also embeds the generated index page. Its shared modules are bundled in this
order:

```text
auth.mjs → catalog.mjs → streaming.mjs → account.mjs → index.mjs
```

The hosted Worker resolves and relays audio itself. Users of the hosted web app
do not need to run a separate Node gateway. Desktop downloads to the computer's
music directory use the Node-only `downloads.mjs` module. Android's Java host
streams downloads into its app-private music directory; the browser's host
stores offline audio in the browser. Those host paths do not call the shared
dispatcher's Node-only `/api/download` endpoint.

For native dispatch, call `api(request, {directStreams: true})`. It returns the
resolved signed CDN URL directly to the platform's AudioPlayer. The same
Request / Response dispatcher handles the native account APIs; there is no
separate native implementation of the YouTube protocol.

For anonymous playback, `streaming.mjs` obtains visitor data from the real watch-page configuration,
requests the `VISIONOS` 0.1 player, selects an audio format, and proxies its signed
URL. Cached player records expire with the upstream URLs. Audio requests forward
`Range`; `HEAD`, partial-response status, content length, and CORS headers are
preserved so the player can seek. No script deciphering service or iframe is
required by this implemented path.

## API

The endpoints below return JSON unless their response is marked as audio.
Errors use a non-2xx status and `{ "error": "..." }`. Missing lyrics or empty
queries remain empty; the gateway does not substitute other music.

| Endpoint | Parameters or JSON body | Response |
| --- | --- | --- |
| `GET /api/health` | — | `ok`, `clientVersion`, `nativeStreams`, `audioEngine` |
| `GET /api/home` | `id?`, `continuation?`, `hl?`, `gl?` | `sections: [{title, items}]`, `continuation?` |
| `GET /api/explore` | `tab=all/new/charts/moods`, `continuation?` | `tab`, `sections`, `moods: [{title,browseId,params?,color?}]`, `continuation?` |
| `GET /api/suggestions` | `q` | `query`, `suggestions: string[]` |
| `GET /api/search` | `q`, `type=all/songs/albums/artists/playlists`, `continuation?` | `query`, `type`, `items`, `continuation?` |
| `GET /api/browse` | `id`, `params?`, `continuation?` | `id`, `title`, `subtitle`, `artwork`, `description`, `subscriberCount`, `year?`, `playlistId?`, `editable`, `tracks`, `sections`, `continuation?` |
| `GET /api/next` | `id`, `playlistId?`, `continuation?` | `tracks`, `lyricsId?`, `continuation?` |
| `GET /api/lyrics` | `title`, `artist`, `duration?` in seconds | `plainLyrics`, `syncedLyrics`, `lines: [{time,text}]`, `instrumental` |
| `GET /api/stream` | `id`, `quality=auto/high/medium/low`, `container=mp4/webm` optional | Same-origin `url`, actual format and track metadata |
| `GET/HEAD /api/audio` | Issued playback reference: `source`, `mime`, `id?`; or `/api/stream` parameters | Audio bytes, including Range responses; Worker and Node |
| `POST /api/account/login` | `{cookie,visitorData?,dataSyncId?,authUser?}` | `{account,session:{visitorData,dataSyncId,authUser}}` |
| `GET /api/account` | Account header | Profile `{id,name,email,channelHandle,avatar,channelId?}` |
| `GET /api/account/channels` | Account header | `{accounts:[{name,byline,avatar,channelHandle,email?,pageId?,dataSyncId?,signinUrl?,authUser,selected}]}` |
| `GET /api/account/library` | `type=playlists/liked/songs/albums/artists`, `continuation?` | `{type,items,continuation?}` |
| `POST /api/account/like` | `{id,liked,kind:"song"/"playlist"}` | `{ok,id,liked}` |
| `POST /api/account/subscribe` | `{id,subscribed,params?}` | `{ok,id,subscribed}` |
| `POST /api/account/song` | `{id,saved}` | `{ok,id,saved}`; refreshes the song's library feedback token |
| `POST /api/account/playlist` | `{action,playlistId?,title?,description?,privacy?,videoIds?,videoId?,setVideoId?,successorSetVideoId?}` | `{ok,playlistId,browseId?,title?}` |
| `POST /api/download` | `{id,quality?,container?,track?,url?,name?}` | Download job; Node only |
| `GET /api/download` | `id?` | One job, or `{downloads: [...]}` without an id; Node only |
| `DELETE /api/download` | `id` | Cancel task, remove its file and manifest entry; Node only |
| `GET/HEAD /api/offline` | `id`, `attachment?` | Saved audio bytes with Range support; Node only |

A track contains `id`, `title`, `artist`, `album`, `artwork`, `duration` in seconds,
`source: "youtube"`, and optional `artistId`, `albumId`, `setVideoId`, `saved`,
`libraryAddToken`, and `libraryRemoveToken`. A collection contains
`id`, `browseId`, `title`, `subtitle`, `artwork`,
`type: "album" | "artist" | "playlist"`, and optional browse `params`, `playlistId`,
and `editable`. Album details obtain their true playlist ID from the canonical
playlist URL, matching the original app. An `MPRE...` album browse ID is not a
playlist ID for cloud saving.

YouTube Music playlist browse ids start with `VL`, followed by the playlist id.
Pass continuation strings back unchanged: they carry the visitor context needed
for the next page. Catalog language defaults to `zh-CN` and region to `US`.

### Audio metadata and quality

`/api/stream` returns `url`, `mimeType`, `codecs`, `bitrate` in bits per second,
`formatId`, `sampleRate`, `contentLength`, `duration`, `expiresAt` in Unix
milliseconds, `quality`, `title`, `artist`, `artwork`, `client`, and the available
`loudnessDb` / `perceptualLoudnessDb`, plus `authenticated`. The browser URL points
to the gateway with the already-resolved signed CDN URL in its `source` query.
It contains no Google Cookie. `/api/audio` relays that source without resolving
the song again, so an AudioPlayer that cannot send account headers can still use
the account-specific result. Native `directStreams` responses contain the CDN
URL itself. Upstream request headers are not returned in stream metadata.

The original audio track is preferred over dubbed tracks. `low` selects the
lowest AAC bitrate, `medium` the highest AAC bitrate, `high` the highest audio
bitrate, and `auto` follows the original Opus preference. `container=mp4`
constrains selection to AAC in MP4. The app requests this container for playback
and downloads on every platform, including the web, because NSH uses the
platform's decoder and older Safari / Windows cannot assume WebM Opus support.
Clients that omit `container` retain the unconstrained selection described above.

### Google / YouTube Music accounts

Authentication uses the selected Google session rather than a separate Metrolist
username or password. The client keeps the session locally, as the original app
does. Each authenticated request sends:

```js
{
  'X-Metrolist-Account': encodeURIComponent(JSON.stringify({
    cookie, visitorData, dataSyncId, authUser
  }))
}
```

`auth.mjs` derives SAPISIDHASH from that request's SAPISID cookie, timestamp, and
YouTube Music origin. `authUser` selects the Google account and `dataSyncId`
selects its channel through `context.user.onBehalfOfUser`. No global Cookie or
server-wide selected account exists. Login verifies the session through
`account/account_menu`; a cookie-only import first reads the page configuration
for visitor and channel data. The response returns profile and session metadata,
without echoing the Cookie. Logout removes the client-side session.

Playlist actions are `create`, `rename`, `description`, `delete`, `add`, `remove`,
and `move`. `remove` uses both `videoId` and `setVideoId`; `move` uses `setVideoId`
and an optional `successorSetVideoId` (`null` places it last). Keeping occurrence
IDs means repeated copies of the same song can be edited independently. Creating
a playlist with a description sets it through the original edit action after
the create endpoint returns the new playlist ID.

An account audio request first uses authenticated `WEB_REMIX`. If it returns a
direct audio URL, metadata identifies `client: "WEB_REMIX"` and
`authenticated: true`. A public song with cipher-only WEB_REMIX formats can use
the existing anonymous VISIONOS path. InnertubeX marks VISIONOS as not supporting
login; it never receives Google credentials here. A private song requiring
player-script deciphering or a missing token returns its actual failure. No
successful private-song playback has been claimed or verified with a real
account in this workspace.

### Node-managed downloads

Downloads stream directly to `~/Music/Metrolist`, or the directory supplied by
`DOWNLOAD_DIR`. The gateway writes a `.part` file, then renames it after completion
and persists metadata in `library.json`. This path does not use NSH's single-call
`fs.writeFile` and therefore does not inherit its 8 MiB limit.

Jobs contain `id`, `status`, `bytes`, `totalBytes`, `progress` from 0 to 1, `quality`,
`name`, `track?`, `createdAt`, `updatedAt`, `destination?`, `url?`, and `error?`.
Timestamps are Unix milliseconds. Status is `queued`, `resolving`, `downloading`,
`completed`, `failed`, or `cancelled`. Completed URLs point to `/api/offline` on
the requesting gateway origin. The manifest restores saved downloads after a
gateway restart. Deleting a running task aborts its transfer and removes the
partial file.

If a download request carries an account header, its credentials are passed to
the resolver while that task runs. Job responses and the disk manifest exclude
them. Account downloads use the shared authenticated resolver even when the
anonymous Node resolver is configured as `yt-dlp`.

## Verification

Run parser, transport, format selection, and disk-download checks with:

```sh
node --test server/*.test.mjs
nsh test tests/gateway-native.test.tsx
```

The 2026-11-11 run passed 36 tests, including a 9 MiB + 123-byte HTTP download,
cancellation, restart recovery without the source server, exact range bytes,
HEAD, LAN URLs, CORS, and preservation of the requested download quality and
container. Live player metadata resolved three real tracks through
the pure JavaScript path, including a request through the default Node gateway.
Account checks use artificial credentials and fixture responses only. They
verify SAPISIDHASH, concurrent account isolation, channel identity, library
paging, the upstream mutation request shapes, repeated playlist occurrences,
authenticated audio-cache separation, issued-source playback references, Node
POST bodies, and download credential lifetime. No Google account was logged in
or modified by those tests. A live anonymous album query also verified its real
canonical playlist ID and eight tracks.

The native gateway suite passed five NSH headless tests. It imports the shared
dispatcher through the actual native client API, computes the expected SHA-1
SAPISIDHASH in NSH, preserves per-account identity, returns distinct signed AAC
URLs with random playback nonces, and executes the already-resolved browser
source reference with Range. Network fixtures handle every request; these tests
do not verify a real Google account or Android device playback.

**Actual googlevideo audio delivery was not verified in this environment.** Its
CDN request returned a 195-byte HTML `Site Unavailable` response, which the audio
proxy rejects. Successful metadata resolution and synthetic local transport
tests are not evidence of audible YouTube playback. See
[the verification report](../docs/VERIFICATION.md) for the tested formats and the
precise boundary of validation.

## Upstream references

- [Metrolist](https://github.com/MetrolistGroup/Metrolist)
- [InnertubeX](https://github.com/MetrolistGroup/innertubex)
- [LRCLIB API](https://lrclib.net/docs)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)

This implementation is GPL-3.0-only.
