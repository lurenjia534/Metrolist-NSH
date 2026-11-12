import { expect, open, test } from "nsh/test";
import type { App, StubRequest } from "nsh/test";

const alpha = { id: "selection-alpha", title: "Alpha song", artist: "Selection artist", album: "Selection album", artwork: "", duration: 180, source: "youtube" };
const beta = { ...alpha, id: "selection-beta", title: "Beta song", duration: 120 };
const gamma = { ...alpha, id: "selection-gamma", title: "Gamma song", duration: 240 };
const playlist = { id: "selection-playlist", name: "Selection playlist", tracks: [alpha, beta, alpha, gamma], createdAt: 1, updatedAt: 1 };
const target = { ...playlist, id: "selection-target", name: "Saved selection", tracks: [] };
const snapshot = {
  version: 2, exportedAt: "", tracks: [alpha, beta, gamma], likedIds: [alpha.id, beta.id], history: [gamma, alpha, beta],
  playlists: [playlist, target], libraryIds: [alpha.id, beta.id, gamma.id], savedCollections: [], searchHistory: [],
  listenEvents: [{ id: "selection-listen", trackId: alpha.id, startedAt: 1, seconds: 75 }],
};
const storage = {
  "metrolist.settings": JSON.stringify({ autoRadio: false, apiBase: "https://gateway.test", libraryView: "list" }),
  "metrolist.library": JSON.stringify(snapshot),
  "metrolist.player": JSON.stringify({ queue: [gamma], index: 0, position: 32, title: "Existing queue" }),
};
const network = {
  "GET https://gateway.test/api/home": { body: { sections: [] } },
  "GET https://gateway.test/api/lyrics?*": { body: { plainLyrics: "", lines: [], instrumental: false } },
  "GET https://gateway.test/api/stream?id=*": { body: { url: "https://audio.test/selection.webm", mimeType: "audio/webm", bitrate: 128000 } },
};
const saved = (app: App) => JSON.parse(app.storage()["metrolist.library"]);
const queue = (app: App) => JSON.parse(app.storage()["metrolist.player"]);
const playlistIds = (app: App, id = playlist.id) => saved(app).playlists.find((item: { id: string }) => item.id === id).tracks.map((track: { id: string }) => track.id);

async function openPlaylist() {
  const app = await open("../App.tsx", { width: 1440, height: 1100, platform: "linux", storage, network });
  await app.press("id:nav-library"); await app.press("id:library-playlists");
  await app.press("id:page-library >> label:Selection playlist"); await app.waitFor("id:page-playlist");
  return app;
}

test("playlist selection survives filtering and sorting and removes only selected duplicate occurrences", async () => {
  const app = await openPlaylist();
  await app.press("id:collection-select");
  await app.press("id:collection-row-2 >> id:play-track-selection-alpha");
  await app.type("id:song-collection-filter", "Beta");
  expect(app.texts()).toContain("4 首歌曲 · 12 分钟");
  expect(app.texts()).toContain("3 分钟 · 筛选外 1 首");
  await app.press("id:selection-all");
  await app.press("id:collection-clear-filter");
  await app.press("id:collection-sort"); await app.press("歌曲名称");
  await app.waitFor("text:歌曲名称 ↑");
  expect(app.texts()).toContain("已选择 2 首");
  await app.press("id:selection-actions"); await app.press("id:selection-remove");
  await app.waitUntil(() => playlistIds(app).length === 2);
  expect(playlistIds(app)).toEqual([alpha.id, gamma.id]);
  expect(saved(app).libraryIds).toEqual(snapshot.libraryIds);
  expect(saved(app).likedIds).toEqual(snapshot.likedIds);
  expect(app.texts()).toContain("已选择 0 首");
});

test("batch play-next and add-to-playlist preserve displayed order and repeated songs", async () => {
  const app = await openPlaylist();
  await app.press("id:collection-sort"); await app.press("歌曲名称");
  await app.waitFor("text:歌曲名称 ↑");
  await app.press("id:collection-select"); await app.press("id:selection-all");
  await app.press("id:selection-next");
  expect(queue(app).queue.map((track: { id: string }) => track.id)).toEqual([gamma.id, alpha.id, alpha.id, beta.id, gamma.id]);
  expect(queue(app)).toMatchObject({ index: 0, position: 32 });
  await app.press("id:selection-playlist");
  await app.waitFor("id:app-dialog >> label:Saved selection");
  await app.press("id:app-dialog >> label:Saved selection");
  expect(playlistIds(app, target.id)).toEqual([alpha.id, alpha.id, beta.id, gamma.id]);
  await app.press("id:selection-actions"); await app.press("id:selection-clear");
  await app.waitFor("text:已选择 0 首");
  expect(app.enabled("id:selection-next")).toBe(false);
  await app.press("id:selection-done");
  await app.waitFor("id:song-selection", { state: "gone" });
  expect(app.shows("id:song-selection")).toBe(false);
});

test("history batch removal keeps listening statistics, likes and library membership", async () => {
  const app = await open("../App.tsx", { width: 1440, height: 1100, platform: "linux", storage, network });
  await app.press("id:nav-history"); await app.waitFor("id:page-history");
  await app.type("id:song-collection-filter", "Alpha");
  await app.press("id:collection-select"); await app.press("id:selection-all");
  await app.press("id:selection-actions"); await app.press("id:selection-remove");
  await app.waitUntil(() => saved(app).history.length === 2);
  expect(saved(app).history.map((track: { id: string }) => track.id)).toEqual([gamma.id, beta.id]);
  expect(saved(app).listenEvents).toEqual(snapshot.listenEvents);
  expect(saved(app).libraryIds).toEqual(snapshot.libraryIds);
  expect(saved(app).likedIds).toEqual(snapshot.likedIds);
  expect(app.texts()).toContain("没有匹配的歌曲");
  await app.press("id:collection-clear-filter");
  expect(app.shows(`id:collection-row-${gamma.id}`)).toBe(true);
  expect(app.shows(`id:collection-row-${beta.id}`)).toBe(true);
});

test("long press selects a contiguous displayed range without starting playback", async () => {
  const app = await openPlaylist();
  await app.longPress("id:collection-row-1 >> id:play-track-selection-beta");
  expect(app.texts()).toContain("已选择 1 首");
  await app.longPress("id:collection-row-3 >> id:play-track-selection-gamma");
  expect(app.texts()).toContain("已选择 3 首");
  expect(queue(app)).toMatchObject({ index: 0, position: 32 });
  expect(app.audio().filter(call => call.command === "open")).toHaveLength(0);
  await app.press("id:selection-actions"); await app.press("id:selection-remove");
  await app.waitUntil(() => playlistIds(app).length === 1);
  expect(playlistIds(app)).toEqual([alpha.id]);
});

test("cloud batch likes and unlikes complete sequentially without duplicate requests or resurrected songs", async () => {
  let liked: typeof alpha[] = [];
  const requests: string[] = [];
  const profile = { id: "0:selection-fixture", name: "Selection account", channelId: "selection-channel", verifiedAt: 1 };
  const cloud = { profile, credentials: { cookie: "SAPISID=fixture-selection", authUser: "0", dataSyncId: "selection-fixture" },
    library: { playlists: [], liked: [], songs: [], albums: [], artists: [] }, lastSynced: 0 };
  const app = await open("../App.tsx", { width: 1440, height: 1100, platform: "linux", storage: {
    ...storage, "metrolist.accounts": JSON.stringify({ accounts: [cloud], activeId: profile.id, syncEnabled: false, useAccountForBrowse: true }),
  }, network: {
    ...network,
    "GET https://gateway.test/api/account": { body: profile },
    "POST https://gateway.test/api/account/like": (request: StubRequest) => {
      const input = JSON.parse(request.body!);
      requests.push(`POST:${input.id}:${input.liked}`);
      const track = [alpha, beta, gamma].find(item => item.id === input.id)!;
      liked = input.liked ? [track, ...liked.filter(item => item.id !== input.id)] : liked.filter(item => item.id !== input.id);
      return { delay: 50, body: { ok: true } };
    },
    "GET https://gateway.test/api/account/library?type=liked*": () => {
      requests.push("GET:liked");
      return { delay: 50, body: { type: "liked", items: [...liked] } };
    },
  } });
  const savedCloud = () => JSON.parse(app.storage()["metrolist.accounts"]).accounts[0].library.liked;
  await app.press("id:nav-library"); await app.press("id:library-playlists");
  await app.press("id:page-library >> label:Selection playlist"); await app.waitFor("id:page-playlist");
  await app.press("id:collection-select"); await app.press("id:selection-all");
  await app.press("id:selection-actions"); await app.press("id:selection-like");
  await app.waitUntil(() => savedCloud().length === 3);
  await app.waitFor("已喜欢所选歌曲");
  expect(requests).toEqual([alpha.id, beta.id, gamma.id].flatMap(id => [`POST:${id}:true`, "GET:liked"]));
  expect(liked.map(track => track.id).sort()).toEqual([alpha.id, beta.id, gamma.id]);
  await app.press("id:nav-liked"); await app.waitFor("id:page-liked");
  await app.press("id:collection-select"); await app.press("id:selection-all");
  await app.press("id:selection-actions"); await app.press("id:selection-remove");
  await app.waitFor("已取消喜欢所选歌曲");
  expect(savedCloud()).toEqual([]);
  expect(liked).toEqual([]);
  expect(requests.slice(6)).toEqual([gamma.id, beta.id, alpha.id].flatMap(id => [`POST:${id}:false`, "GET:liked"]));
  expect(saved(app).libraryIds).toEqual(snapshot.libraryIds);
});
