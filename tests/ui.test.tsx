import { expect, open, test } from "nsh/test";

const alpha = { id: "ui-alpha", title: "Alpha song", artist: "Test artist", album: "Test album", artwork: "", duration: 180, source: "youtube" };
const beta = { ...alpha, id: "ui-beta", title: "Beta song" };
const preferences = { "metrolist.settings": JSON.stringify({ autoRadio: false, apiBase: "http://127.0.0.1:8787" }) };
const network = {
  "GET http://127.0.0.1:8787/api/home": { body: { sections: [] } },
  "GET http://127.0.0.1:8787/api/download": { body: { downloads: [] } },
  "GET http://127.0.0.1:8787/api/suggestions?q=*": { body: { query: "Test", suggestions: [] } },
  "GET http://127.0.0.1:8787/api/search?q=Test&type=all": { body: { query: "Test", type: "all", items: [beta, alpha] } },
  "GET http://127.0.0.1:8787/api/stream?id=*": { body: { url: "https://audio.test/ui.m4a", mimeType: "audio/mp4", bitrate: 128000, sampleRate: 44100 } },
  "GET http://127.0.0.1:8787/api/lyrics?*": { body: { plainLyrics: "测试歌词", syncedLyrics: "[00:00.00]测试歌词", lines: [{ time: 0, text: "测试歌词" }, { time: 30, text: "下一句歌词" }], instrumental: false } },
};

for (const { width, platform } of [{ width: 340, platform: "android" }, { width: 390, platform: "ios" }, { width: 340, platform: "web" }, { width: 390, platform: "web" }] as const) test(`phone ${width} ${platform} keeps primary navigation and the full player reachable`, async () => {
  const app = await open("../App.tsx", { width, height: width === 340 ? 740 : 844, platform, network, storage: preferences, host: { handlers: {
    "app.start": null, "app.metadata": null, "app.playback": null,
    "app.audio.settings": null, "app.audio.snapshot": null, "app.audio.open": null, "app.audio.pause": null,
  } } });
  await app.waitFor("id:page-home");
  expect(app.shows("id:mobile-tabs")).toBe(true);
  expect(app.shows("id:desktop-sidebar")).toBe(false);
  await app.press("id:nav-mobile-library"); await app.waitFor("id:page-library");
  await app.press("id:library-playlists"); await app.press("id:page-library >> label:新建");
  expect(app.enabled("id:save-playlist")).toBe(false);
  await app.type("id:playlist-name", `Phone ${width}`); await app.press("id:save-playlist");
  await app.waitFor("id:page-playlist");
  expect(JSON.parse(app.storage()["metrolist.library"]).playlists[0].name).toBe(`Phone ${width}`);
  await app.press("id:nav-mobile-search");
  await app.type("id:search-input", "Test"); await app.submit("id:search-input");
  await app.waitFor("id:play-track-ui-alpha");
  await app.press("id:play-track-ui-alpha"); await app.waitFor("id:mini-player");
  if (platform === "android") {
    const opened = app.host.calls().find(call => call.name === "app.audio.open")!.data as { requestId: number };
    await app.host.send("audio.state", { requestId: opened.requestId, state: "playing", playing: true,
      playWhenReady: true, buffering: false, position: 0, duration: 180, bufferedPosition: 50 });
  }
  await app.press("id:open-player"); await app.waitFor("id:full-player");
  await app.press("id:player-play-pause");
  expect(platform === "android" ? app.host.calls().some(call => call.name === "app.audio.pause") : app.audio().some(call => call.command === "pause")).toBe(true);
  await app.press("id:full-player >> label:歌词"); await app.waitFor("id:lyrics-panel");
  await app.press("id:full-player >> label:播放队列");
  await app.waitFor("id:queue-panel");
  await app.press("id:close-player"); await app.waitFor("id:full-player", { state: "gone" });
  await app.press("id:header-settings"); await app.waitFor("id:page-settings");
  await app.press("id:theme-light");
  expect(JSON.parse(app.storage()["metrolist.settings"]).theme).toBe("light");
  await app.press("id:nav-mobile-home"); await app.waitFor("id:page-home");
});

test("returning from an album preserves search query, selected type and every loaded page", async () => {
  const album = { id: "album-b", browseId: "album-b", title: "Album B", subtitle: "Test artist", artwork: "", type: "album" };
  const second = { ...album, id: "album-c", browseId: "album-c", title: "Album C" };
  const third = { ...album, id: "album-d", browseId: "album-d", title: "Album D" };
  const app = await open("../App.tsx", { width: 1440, height: 940, platform: "linux", storage: preferences, network: {
    ...network,
    "GET http://127.0.0.1:8787/api/search?q=Pagination&type=albums": { body: { query: "Pagination", type: "albums", items: [album], continuation: "search-page-2" } },
    "GET http://127.0.0.1:8787/api/search?q=Pagination&type=albums&continuation=search-page-2": { body: { query: "Pagination", type: "albums", items: [second], continuation: "search-page-3" } },
    "GET http://127.0.0.1:8787/api/search?q=Pagination&type=albums&continuation=search-page-3": { body: { query: "Pagination", type: "albums", items: [third] } },
    "GET http://127.0.0.1:8787/api/browse?id=album-b": { body: { ...album, tracks: [beta], sections: [] } },
  } });
  await app.press("id:nav-search"); await app.press("id:page-search >> label:专辑");
  await app.type("id:search-input", "Pagination"); await app.submit("id:search-input");
  await app.waitFor("label:Album B"); await app.press("id:search-more"); await app.waitFor("label:Album C");
  await app.press("label:Album B"); await app.waitFor("id:play-track-ui-beta");
  await app.press("id:navigate-back"); await app.waitFor("id:page-search");
  expect(app.value("id:search-input")).toBe("Pagination");
  expect(app.shows("label:Album B")).toBe(true); expect(app.shows("label:Album C")).toBe(true);
  await app.press("id:search-more"); await app.waitFor("label:Album D");
  expect(app.requests().filter((request) => request.url === "http://127.0.0.1:8787/api/search?q=Pagination&type=albums")).toHaveLength(1);
  expect(app.shows("label:Album C")).toBe(true);
});

test("returning to a paginated album keeps its songs when a departed artist request finishes late", async () => {
  const album = { id: "album-a", browseId: "album-a", title: "Album A", subtitle: "Test artist", artwork: "", type: "album" };
  const artist = { id: "artist-b", browseId: "artist-b", title: "Artist B", subtitle: "Artist", artwork: "", type: "artist" };
  const gamma = { ...alpha, id: "ui-gamma", title: "Gamma song" };
  const app = await open("../App.tsx", { width: 1440, height: 940, platform: "linux", storage: preferences, clock: {}, network: {
    ...network,
    "GET http://127.0.0.1:8787/api/search?q=Test&type=all": { body: { query: "Test", type: "all", items: [album] } },
    "GET http://127.0.0.1:8787/api/browse?id=album-a": { body: { ...album, tracks: [alpha], sections: [{ title: "Featured artist", items: [artist] }], continuation: "album-page-2" } },
    "GET http://127.0.0.1:8787/api/browse?id=album-a&continuation=album-page-2": { body: { ...album, tracks: [beta], sections: [], continuation: "album-page-3" } },
    "GET http://127.0.0.1:8787/api/browse?id=album-a&continuation=album-page-3": { body: { ...album, tracks: [gamma], sections: [] } },
    "GET http://127.0.0.1:8787/api/browse?id=artist-b": { delay: 60000, body: { ...artist, tracks: [], sections: [{ title: "Albums", items: [album] }] } },
  } });
  await app.press("id:nav-search"); await app.type("id:search-input", "Test"); await app.submit("id:search-input");
  await app.press("label:Album A"); await app.waitFor("id:play-track-ui-alpha");
  await app.press("label:加载更多歌曲"); await app.waitFor("id:play-track-ui-beta");
  await app.press("label:Artist B"); await app.waitFor("正在加载…");
  await app.press("id:navigate-back"); await app.waitFor("id:play-track-ui-beta");
  await app.clock!.fastForward(60001);
  expect(app.shows("id:play-track-ui-alpha")).toBe(true); expect(app.shows("id:play-track-ui-beta")).toBe(true);
  await app.press("label:加载更多歌曲"); await app.waitFor("id:play-track-ui-gamma");
  expect(app.requests().filter((request) => request.url === "http://127.0.0.1:8787/api/browse?id=album-a")).toHaveLength(1);
  expect(app.texts().filter((text) => text === alpha.title)).toHaveLength(1);
  await app.press("label:Artist B"); await app.clock!.fastForward(60001); await app.waitFor("label:Album A");
  await app.press("label:Album A"); await app.waitFor("id:play-track-ui-alpha");
  expect(app.texts().filter((text) => text === alpha.title)).toHaveLength(1);
});

test("desktop library creates a playlist and song menus add, sort and reorder its tracks", async () => {
  const app = await open("../App.tsx", { width: 1440, height: 940, platform: "linux", network, storage: preferences });
  expect(app.shows("id:desktop-sidebar")).toBe(true);
  expect(app.shows("id:mobile-tabs")).toBe(false);
  await app.press("id:create-playlist"); await app.type("id:playlist-name", "Desktop list"); await app.press("id:save-playlist");
  await app.press("id:nav-search"); await app.type("id:search-input", "Test"); await app.submit("id:search-input");
  await app.waitFor("id:song-menu-ui-beta");
  for (const id of [beta.id, alpha.id]) {
    await app.press(`id:song-menu-${id}`); await app.press("加入歌单…");
    await app.waitFor("id:app-dialog >> label:Desktop list"); await app.press("id:app-dialog >> label:Desktop list");
  }
  expect(JSON.parse(app.storage()["metrolist.library"]).playlists[0].tracks.map((track: { id: string }) => track.id)).toEqual([beta.id, alpha.id]);
  await app.press("id:nav-library"); await app.press("id:library-playlists");
  await app.press("id:page-library >> label:Desktop list"); await app.waitFor("id:page-playlist");
  await app.press("label:歌曲排序"); await app.press("歌曲名称");
  await app.waitUntil(() => app.texts().filter(text => text === alpha.title || text === beta.title)[0] === alpha.title);
  const titles = app.texts().filter((text) => text === alpha.title || text === beta.title);
  expect(titles).toEqual([alpha.title, beta.title]);
  await app.press("label:歌单操作"); await app.press("调整歌曲顺序");
  await app.waitFor("id:track-ui-beta >> label:下移");
  await app.press("id:track-ui-beta >> label:下移");
  expect(JSON.parse(app.storage()["metrolist.library"]).playlists[0].tracks.map((track: { id: string }) => track.id)).toEqual([alpha.id, beta.id]);
  await app.press("id:track-ui-alpha >> label:从歌单移除");
  expect(JSON.parse(app.storage()["metrolist.library"]).playlists[0].tracks.map((track: { id: string }) => track.id)).toEqual([beta.id]);
});

test("desktop settings, offline downloads, statistics and together screens expose usable controls", async () => {
  const completed = { id: alpha.id, track: alpha, quality: "auto", status: "completed", bytes: 123456, totalBytes: 123456, progress: 1, destination: "/music/alpha.m4a", url: "http://127.0.0.1:8787/api/offline?id=ui-alpha", name: "Alpha.m4a", createdAt: 1, updatedAt: 2 };
  const app = await open("../App.tsx", { width: 1440, height: 940, platform: "linux", network: {
    ...network, "GET http://127.0.0.1:8787/api/download": { body: { downloads: [completed] } },
  }, storage: {
    ...preferences,
    "metrolist.library": JSON.stringify({ version: 2, exportedAt: "", tracks: [alpha], likedIds: [], history: [alpha], playlists: [], libraryIds: [alpha.id], savedCollections: [], searchHistory: [], listenEvents: [{ id: "ui-event", trackId: alpha.id, startedAt: Date.now(), seconds: 120 }] }),
  } });
  await app.press("id:nav-settings"); await app.press("label:播放"); await app.press("id:quality-high");
  expect(JSON.parse(app.storage()["metrolist.settings"]).audioQuality).toBe("high");
  await app.press("label:歌词"); await app.press("label:左对齐");
  expect(JSON.parse(app.storage()["metrolist.settings"]).lyricAlignment).toBe("left");
  await app.press("id:nav-downloads"); await app.waitFor("id:download-ui-alpha");
  await app.press("label:播放下载"); await app.waitFor("id:mini-player");
  expect(app.audio().filter((call) => call.command === "open")[0].src).toBe(completed.url);
  await app.press("id:nav-stats"); await app.waitFor("id:page-stats"); await app.press("label:全部时间");
  await app.waitFor("最常听的歌曲");
  await app.press("id:nav-together"); await app.waitFor("id:page-together");
  await app.clear("id:together-name"); await app.type("id:together-name", "测试听友");
  await app.type("id:together-code", "ABC123");
  expect(app.enabled("label:加入房间")).toBe(true);
  expect(app.value("id:together-code")).toBe("ABC123");
});
