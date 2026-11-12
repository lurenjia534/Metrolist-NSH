import test from "node:test";
import assert from "node:assert/strict";
import { createSpotifyApi } from "./spotify-api.js";

// Recorded shapes, deliberately invented account/catalog values. No credentials
// or live account are used; every request must match the injected transport.
const artist = { type: "artist", uri: "spotify:artist:artist1", name: "Fixture Artist", images: [{ url: "https://images.test/artist" }] };
const album = { type: "album", uri: "spotify:album:album1", name: "Fixture Album", artists: [artist], images: [{ url: "https://images.test/album" }], release_date: "2026-08-01", total_tracks: 2 };
const track = (id = "track1") => ({ type: "track", uri: `spotify:track:${id}`, name: id, artists: [artist], album, duration_ms: 183450, explicit: false, is_playable: true });
const playlist = { type: "playlist", uri: "spotify:playlist:playlist1", name: "Fixture Playlist", owner: { id: "fixture-user", display_name: "Fixture User" }, images: [], description: "A test transport playlist" };
const page = (items, next = null, total = items.length) => ({ items, next, total });
const forbiddenNetwork = () => { throw new Error("No unrecorded lyrics request is allowed"); };
const apiWith = request => createSpotifyApi(request, { lyricsFetch: forbiddenNetwork });

test("2026 search uses ten results per type and retains actual catalog metadata", async () => {
  const api = apiWith(async path => {
    const url = new URL(path, "https://api.spotify.com/v1");
    assert.equal(url.pathname, "/search");
    assert.equal(url.searchParams.get("q"), "雪 & sound");
    assert.equal(url.searchParams.get("limit"), "10");
    assert.equal(url.searchParams.get("type"), "track,artist,album,playlist");
    return { tracks: page([track()]), artists: page([artist]), albums: page([album]), playlists: page([null, playlist]) };
  });
  const result = await api.search("雪 & sound");
  assert.deepEqual(result.tracks[0], {
    uri: "spotify:track:track1", uid: "spotify:track:track1", name: "track1", artists: "Fixture Artist",
    album: "Fixture Album", albumUri: "spotify:album:album1", image: "https://images.test/album",
    durationMs: 183450, explicit: false, playable: true, releaseDate: "2026-08-01",
  });
  assert.equal(result.playlists[0].subtitle, "Fixture User");
  assert.equal(result.artists[0].image, "https://images.test/artist");
});

test("playlist items pagination preserves duplicate songs and added dates using 2026 item fields", async () => {
  const calls = [];
  const api = apiWith(async path => {
    calls.push(path);
    if (path === "/playlists/playlist1") return { ...playlist, items: page([{ item: track(), added_at: "2026-10-01" }], "https://api.spotify.com/v1/playlists/playlist1/items?offset=1&limit=1", 2) };
    assert.equal(path, "/playlists/playlist1/items?offset=1&limit=1");
    return page([{ item: track(), added_at: "2026-10-02" }]);
  });
  const result = await api.playlist(playlist.uri);
  assert.equal(result.total, 2);
  assert.equal(result.tracks.length, 2);
  assert.notEqual(result.tracks[0].uid, result.tracks[1].uid);
  assert.equal(result.tracks[1].addedAt, "2026-10-02");
  assert.equal(result.tracks[1].contextIndex, 1);
  assert.equal(result.header.description, playlist.description);
  assert.equal(calls.length, 2);
});

test("native context indices retain removed items and episodes in a playlist's original order", async () => {
  const api = apiWith(async () => ({ ...playlist, items: page([
    { item: null }, { item: { type: "episode", uri: "spotify:episode:episode1" } }, { item: track() },
  ]) }));
  const value = await api.playlist(playlist.uri);
  assert.equal(value.tracks.length, 1);
  assert.equal(value.tracks[0].contextIndex, 2);
});

test("restricted playlist contents are reported instead of pretending it is an empty playlist", async () => {
  await assert.rejects(apiWith(async () => playlist).playlist(playlist.uri), /E_PLAYLIST_ACCESS/);
  const serviceError = new Error("E_ACCESS: The user is not in this application's allowlist");
  await assert.rejects(apiWith(async () => { throw serviceError; }).home(), error => error === serviceError);
});

test("album pagination restores album fields on simplified tracks; artist uses available releases", async () => {
  const simple = { ...track(), album: undefined };
  const api = apiWith(async path => {
    if (path === "/albums/album1") return { ...album, tracks: page([simple], "https://api.spotify.com/v1/albums/album1/tracks?offset=1", 2) };
    if (path === "/albums/album1/tracks?offset=1") return page([{ ...simple, uri: "spotify:track:track2", is_playable: false }]);
    if (path === "/artists/artist1") return artist;
    assert.equal(path, "/artists/artist1/albums?include_groups=album,single&limit=50");
    return page([album]);
  });
  const result = await api.album(album.uri);
  assert.equal(result.tracks[1].albumUri, album.uri);
  assert.equal(result.tracks[1].image, album.images[0].url);
  assert.equal(result.tracks[1].playable, false);
  const resultArtist = await api.artist(artist.uri);
  assert.equal(resultArtist.releases[0].uri, album.uri);
  assert.deepEqual(resultArtist.tracks, []);
});

test("home and the complete library use the account's actual recent, saved and followed items", async () => {
  const api = apiWith(async path => {
    if (path.startsWith("/me/playlists?")) return page([playlist]);
    if (path.startsWith("/me/albums?")) return page([{ album }]);
    if (path === "/me/player/recently-played?limit=30") return page([{ track: track() }, { track: track() }]);
    if (path === "/me/following?type=artist&limit=50") return { artists: page([artist], "https://api.spotify.com/v1/me/following?type=artist&after=artist1") };
    if (path === "/me/following?type=artist&after=artist1") return { artists: page([{ ...artist, uri: "spotify:artist:artist2", name: "Another Fixture Artist" }]) };
    if (path === "/me/tracks?limit=50") return page([{ track: track(), added_at: "2026-10-15" }]);
    if (path === "/me") return { id: "fixture-user", account_id: "fixture-stable-account", display_name: "Fixture User", images: [] };
    assert.fail(`Unexpected request ${path}`);
  });
  const home = await api.home();
  assert.equal(home.sections[0].title, "Recently played");
  assert.deepEqual(home.sections[0].items.map(value => value.uri), ["spotify:track:track1"]);
  const library = await api.library();
  assert.deepEqual(library.items.map(value => value.uri), ["spotify:collection:tracks", playlist.uri, album.uri, artist.uri, "spotify:artist:artist2"]);
  assert.equal((await api.likedSongs()).tracks[0].addedAt, "2026-10-15");
  assert.deepEqual(await api.me(), { id: "fixture-stable-account", name: "Fixture User", image: "" });
});

test("library likes use URI queries and split at the documented forty-item limit", async () => {
  const calls = [];
  const api = apiWith(async (path, options) => {
    calls.push({ path, options });
    if (path.startsWith("/me/library/contains?")) {
      return new URL(path, "https://api.spotify.com").searchParams.get("uris").split(",").map(uri => uri.endsWith("1"));
    }
    return null;
  });
  const values = Array.from({ length: 41 }, (_, index) => `spotify:track:track${index}`);
  const liked = await api.likes(values);
  assert.equal(liked.length, 41);
  assert.equal(liked[1], true);
  assert.equal(liked[2], false);
  assert.equal(calls.length, 2);
  await api.setLiked(values[0], true);
  await api.setLiked(values[0], false);
  assert.equal(calls[2].options.method, "PUT");
  assert.equal(calls[3].options.method, "DELETE");
  assert.equal(new URL(calls[2].path, "https://api.spotify.com").searchParams.get("uris"), values[0]);
  assert.equal(calls[2].options.body, undefined);
});

test("LRCLIB receives actual Spotify song identity and supplies parsed synchronized lyrics", async () => {
  const api = createSpotifyApi(async path => {
    assert.equal(path, "/tracks/track1");
    return track();
  }, { lyricsFetch: async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, "https://lrclib.net/api/get");
    assert.equal(parsed.searchParams.get("track_name"), "track1");
    assert.equal(parsed.searchParams.get("artist_name"), "Fixture Artist");
    assert.equal(parsed.searchParams.get("album_name"), "Fixture Album");
    assert.equal(parsed.searchParams.get("duration"), "183");
    assert.match(options.headers["Lrclib-Client"], /Metrolist/);
    return Response.json({ syncedLyrics: "[offset:50]\n[00:01.20][00:02.20]First line\n[00:03.000]Second line", plainLyrics: "First line\nSecond line" });
  } });
  assert.deepEqual(await api.lyrics("spotify:track:track1"), {
    synced: true, provider: "LRCLIB", lines: [{ startMs: 1250, words: "First line" }, { startMs: 2250, words: "First line" }, { startMs: 3050, words: "Second line" }],
  });
});

test("lyrics distinguish a real missing result from a service failure", async () => {
  const api = status => createSpotifyApi(async () => track(), { lyricsFetch: async () => new Response(null, { status }) });
  assert.deepEqual(await api(404).lyrics("spotify:track:track1"), { synced: false, lines: [], provider: "LRCLIB" });
  await assert.rejects(api(429).lyrics("spotify:track:track1"), /E_LYRICS: LRCLIB returned HTTP 429/);
});
