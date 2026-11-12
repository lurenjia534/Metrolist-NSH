import { expect, open, test } from "nsh/test";
import { parseMusicLink } from "../src/musicLinks";

const videoId = "dQw4w9WgXcQ";
const song = { id: videoId, title: "Linked song", artist: "Linked artist", album: "Linked album", artwork: "", duration: 180, source: "youtube" };
const album = { id: "MPREb_album", browseId: "MPREb_album", title: "Linked album", subtitle: "Linked artist", artwork: "", type: "album" };
const artist = { id: "UClinked_artist", browseId: "UClinked_artist", title: "Linked artist", subtitle: "Artist", artwork: "", type: "artist" };
const playlist = { id: "VLPLlinked_list", browseId: "VLPLlinked_list", title: "Linked playlist", subtitle: "A listener", artwork: "", type: "playlist" };
const storage = { "metrolist.settings": JSON.stringify({ apiBase: "https://gateway.test", autoRadio: false }) };
const network = {
  "GET https://gateway.test/api/home": { body: { sections: [] } },
  "GET https://gateway.test/api/lyrics?*": { body: { plainLyrics: "", syncedLyrics: "", lines: [], instrumental: true } },
  "GET https://gateway.test/api/suggestions?q=*": { body: { suggestions: [] } },
  [`GET https://gateway.test/api/stream?id=${videoId}*`]: { body: { url: "https://audio.test/linked.m4a", title: song.title, artist: song.artist, duration: song.duration } },
};

test("music links identify the actual playback or browse endpoint and preserve a video timestamp", async () => {
  for (const url of [
    `https://music.youtube.com/watch?v=${videoId}&list=PLlinked_list`,
    `https://www.youtube.com/watch?feature=share&v=${videoId}`,
    `youtu.be/${videoId}`,
    `https://m.youtube.com/shorts/${videoId}`,
    `https://www.youtube.com/embed/${videoId}`,
    `https://www.youtube.com/live/${videoId}`,
  ]) expect(parseMusicLink(url)).toEqual({ type: "song", id: videoId, startAt: 0 });
  expect(parseMusicLink(`https://youtu.be/${videoId}?t=1m2s`)).toEqual({ type: "song", id: videoId, startAt: 62 });
  expect(parseMusicLink(`https://music.youtube.com/watch?v=${videoId}#t=1h2m3s`)).toEqual({ type: "song", id: videoId, startAt: 3723 });
  expect(parseMusicLink(`https://www.youtube.com/embed/${videoId}?start=42`)).toEqual({ type: "song", id: videoId, startAt: 42 });
  expect(parseMusicLink("https://music.youtube.com/playlist?list=PLlinked_list")).toEqual({ type: "playlist", id: playlist.id, browseId: playlist.id });
  expect(parseMusicLink("https://music.youtube.com/playlist?list=OLAK5uy_album")).toEqual({ type: "playlist", id: "VLOLAK5uy_album", browseId: "VLOLAK5uy_album" });
  expect(parseMusicLink(`https://music.youtube.com/browse/${album.id}`)).toEqual({ type: "album", id: album.id, browseId: album.id });
  expect(parseMusicLink(`https://music.youtube.com/channel/${artist.id}`)).toEqual({ type: "artist", id: artist.id, browseId: artist.id });
  expect(parseMusicLink(`https://music.youtube.com/browse/${artist.id}`)).toEqual({ type: "artist", id: artist.id, browseId: artist.id });
  expect(parseMusicLink(`https://music.youtube.com/browse/${playlist.id}`)).toEqual({ type: "playlist", id: playlist.id, browseId: playlist.id });
  expect(parseMusicLink("Hatsune Miku live")).toBe(null);
  expect(parseMusicLink(`https://example.com/watch?v=${videoId}`)).toBe(null);
});

test("pasting a song link plays the real source and timestamp without searching or importing it", async () => {
  const app = await open("../App.tsx", { width: 1440, height: 940, platform: "linux", storage, network });
  await app.press("id:nav-search");
  const url = `https://youtu.be/${videoId}?t=1m2s`;
  await app.type("id:search-input", url); await app.waitFor("id:search-open-link");
  await app.press("id:search-open-link"); await app.waitFor("id:mini-player");
  await app.waitUntil(() => app.audio().some(call => call.command === "seek" && call.position === 62));
  expect(app.audio().filter(call => call.command === "open").map(call => call.src)).toEqual(["https://audio.test/linked.m4a"]);
  expect(app.requests().some(request => request.url.includes("/api/search") || request.url.includes("/api/suggestions"))).toBe(false);
  expect(JSON.parse(app.storage()["metrolist.library"]).libraryIds).toEqual([]);
  expect(JSON.parse(app.storage()["metrolist.library"]).searchHistory[0]).toBe(url);
  expect(JSON.parse(app.storage()["metrolist.player"]).queue[0].id).toBe(videoId);
});

test("album, artist and playlist links open their exact browse IDs and back retains the pasted link", async () => {
  const app = await open("../App.tsx", { width: 1440, height: 940, platform: "linux", storage, network: {
    ...network,
    [`GET https://gateway.test/api/browse?id=${album.id}`]: { body: { ...album, tracks: [song], sections: [] } },
    [`GET https://gateway.test/api/browse?id=${artist.id}`]: { body: { ...artist, tracks: [song], sections: [] } },
    [`GET https://gateway.test/api/browse?id=${playlist.id}`]: { body: { ...playlist, tracks: [song], sections: [] } },
  } });
  await app.press("id:nav-search");
  for (const url of [`https://music.youtube.com/browse/${album.id}`, `https://music.youtube.com/channel/${artist.id}`, "https://music.youtube.com/playlist?list=PLlinked_list"]) {
    await app.clear("id:search-input"); await app.type("id:search-input", url); await app.submit("id:search-input");
    await app.waitFor("id:page-collection"); await app.waitFor(`id:play-track-${videoId}`);
    await app.press("id:navigate-back"); await app.waitFor("id:page-search");
    expect(app.value("id:search-input")).toBe(url);
  }
  expect(app.requests().filter(request => request.url.includes("/api/browse")).map(request => request.url)).toEqual([album, artist, playlist].map(item => `https://gateway.test/api/browse?id=${item.id}`));
  expect(app.requests().some(request => request.url.includes("/api/search"))).toBe(false);
});

test("history and suggestion fill actions edit the query, then grouped results drill into the selected type", async () => {
  const app = await open("../App.tsx", { width: 1440, height: 1800, platform: "linux", clock: {}, storage: {
    ...storage,
    "metrolist.library": JSON.stringify({ version: 2, tracks: [], likedIds: [], history: [], playlists: [], searchHistory: ["Miku archive", "Miku live", "Other"] }),
  }, network: {
    ...network,
    "GET https://gateway.test/api/suggestions?q=Miku": { body: { suggestions: ["Miku live", "Miku concert"] } },
    "GET https://gateway.test/api/search?q=Miku%20concert&type=all": { body: { query: "Miku concert", type: "all", items: [song, album, artist, playlist] } },
    "GET https://gateway.test/api/search?q=Miku%20concert&type=albums": { body: { query: "Miku concert", type: "albums", items: [album] } },
  } });
  await app.press("id:nav-search"); await app.type("id:search-input", "Miku");
  await app.clock!.fastForward(200); await app.waitFor("id:search-suggestion-fill-0");
  expect(app.shows("id:search-history >> label:Other")).toBe(false);
  expect(app.count("label:填入搜索词 Miku live")).toBe(1);
  await app.press("id:search-history-fill-0");
  expect(app.value("id:search-input")).toBe("Miku archive");
  expect(app.requests().some(request => request.url.includes("/api/search"))).toBe(false);
  await app.clear("id:search-input"); await app.type("id:search-input", "Miku");
  await app.clock!.fastForward(200); await app.waitFor("id:search-suggestion-fill-0");
  await app.press("id:search-suggestion-fill-0");
  expect(app.value("id:search-input")).toBe("Miku concert");
  expect(app.requests().some(request => request.url.includes("/api/search"))).toBe(false);
  await app.submit("id:search-input"); await app.waitFor("id:search-group-playlists");
  for (const type of ["songs", "artists", "albums", "playlists"]) expect(app.shows(`id:search-group-${type}`)).toBe(true);
  await app.press("label:更多专辑"); await app.waitFor("id:search-group-albums");
  expect(app.shows("id:search-group-songs")).toBe(false);
  expect(app.requests().some(request => request.url.endsWith("q=Miku%20concert&type=albums"))).toBe(true);
});

test("phone search discovery opens a real mood catalog", async () => {
  const app = await open("../App.tsx", { width: 340, height: 820, platform: "android", storage, network: {
    ...network,
    "GET https://gateway.test/api/explore?tab=moods": { body: { sections: [], moods: [{ title: "Focus", browseId: "FEmusic_moods_and_genres_category", params: "focus" }] } },
  }, host: { handlers: { "app.audio.settings": null, "app.audio.snapshot": null, "auth.available": { available: true, method: "webview" } } } });
  await app.press("id:nav-mobile-search"); await app.press("id:search-discover-moods");
  await app.waitFor("id:page-browse"); await app.waitFor("label:Focus");
  expect(app.requests().some(request => request.url.endsWith("/api/explore?tab=moods"))).toBe(true);
});
