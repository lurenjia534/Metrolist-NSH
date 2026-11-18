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
  await app.waitFor("id:mini-player"); await app.press("id:nav-library");
  await app.waitFor("id:library-playlists"); await app.press("id:library-playlists");
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
  await app.waitUntil(() => playlistIds(app, target.id).length === 4);
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
  await app.waitFor("id:nav-history"); await app.press("id:nav-history"); await app.waitFor("id:page-history");
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
  await app.waitFor("id:mini-player"); await app.press("id:nav-library");
  await app.waitFor("id:library-playlists"); await app.press("id:library-playlists");
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

test("each playlist remembers its album sort across restarts and manual edits", async () => {
  const tracks = [
    { ...alpha, album: "B" }, { ...beta, album: "" },
    { ...gamma, album: "A" }, { ...alpha, id: "guest", title: "Guest song", album: "B" },
  ];
  const device = { "metrolist.settings": storage["metrolist.settings"], "metrolist.library": JSON.stringify({ ...snapshot, tracks, playlists: [{ ...playlist, tracks }, target] }) };
  const launch = (savedStorage: Record<string, string>) => open("../App.tsx", { width: 1440, height: 1100, platform: "linux", storage: savedStorage, network });
  const visit = async (app: App, name: string) => {
    const row = `id:desktop-sidebar >> label:${name}`;
    await app.waitFor(row);
    await app.press(row);
    await app.waitFor("id:page-playlist");
  };
  const choose = async (app: App, id: string) => {
    await app.press("id:collection-sort");
    await app.waitFor(`id:collection-sort-${id}`);
    await app.press(`id:collection-sort-${id}`);
    await app.waitFor(`id:collection-sort-${id}`, { state: "gone" });
  };
  const titles = (app: App) => app.texts().filter(text => tracks.some(track => track.title === text));
  const app = await launch(device);
  await visit(app, playlist.name);
  await choose(app, "album");
  await app.waitFor("text:专辑名称 ↑");
  expect(titles(app)).toEqual([gamma.title, alpha.title, "Guest song", beta.title]);
  await choose(app, "direction");
  await app.waitFor("text:专辑名称 ↓");
  expect(titles(app)).toEqual([alpha.title, "Guest song", gamma.title, beta.title]);
  expect(playlistIds(app)).toEqual(tracks.map(track => track.id));

  await visit(app, target.name);
  await app.waitFor("text:自定义顺序");
  await choose(app, "duration");
  await app.waitFor("text:歌曲时长 ↑");
  const restarted = await launch(app.storage());
  await visit(restarted, playlist.name);
  await restarted.waitFor("text:专辑名称 ↓");
  await restarted.press("label:歌单操作");
  await restarted.waitFor("id:playlist-edit");
  await restarted.press("id:playlist-edit");
  await restarted.waitFor("id:playlist-down-0");
  await restarted.press("id:playlist-down-0");
  await restarted.waitUntil(() => playlistIds(restarted)[0] === beta.id);
  await restarted.press("label:歌单操作");
  await restarted.waitFor("id:playlist-edit");
  await restarted.press("id:playlist-edit");
  await restarted.waitFor("text:专辑名称 ↓");
  expect(titles(restarted)).toEqual([alpha.title, "Guest song", gamma.title, beta.title]);
  await visit(restarted, target.name);
  await restarted.waitFor("text:歌曲时长 ↑");
});

test("liked songs and history restore independent album sort directions", async () => {
  const songs = [{ ...alpha, album: "A" }, { ...beta, album: "Z" }, { ...gamma, album: "" }];
  const app = await open("../App.tsx", { width: 1440, height: 1100, platform: "linux", network, storage: {
    "metrolist.settings": JSON.stringify({ ...JSON.parse(storage["metrolist.settings"]), playlistSorting: {
      liked: { sort: "album", descending: true }, history: { sort: "album", descending: false },
    } }),
    "metrolist.library": JSON.stringify({ ...snapshot, tracks: songs, likedIds: songs.map(track => track.id), history: songs }),
  } });
  const titles = () => app.texts().filter(text => songs.some(track => track.title === text));
  await app.press("id:nav-liked");
  await app.waitFor("text:专辑名称 ↓");
  expect(titles()).toEqual([beta.title, alpha.title, gamma.title]);
  await app.press("id:nav-history");
  await app.waitFor("text:专辑名称 ↑");
  expect(titles()).toEqual([alpha.title, beta.title, gamma.title]);
});

test("playlist chooser filters destinations, keeps selections across searches and skips duplicates per destination", async () => {
  const app = await openPlaylist();
  await app.press("id:collection-select"); await app.press("id:selection-all"); await app.press("id:selection-playlist");
  await app.waitFor("id:playlist-multiple"); await app.press("id:playlist-multiple"); await app.press("id:playlist-skip-duplicates");
  expect(app.shows("text:4 首 · 已有 3/3 首所选歌曲")).toBe(true);
  await app.press("id:app-dialog >> label:Selection playlist");
  await app.type("id:playlist-destination-search", "SAVED");
  expect(app.shows("id:app-dialog >> label:Selection playlist")).toBe(false);
  await app.press("id:app-dialog >> label:Saved selection"); await app.press("id:playlist-save-targets");
  await app.waitFor("id:app-dialog", { state: "gone" });
  expect(playlistIds(app)).toEqual([alpha.id, beta.id, alpha.id, gamma.id]);
  expect(playlistIds(app, target.id)).toEqual([alpha.id, beta.id, gamma.id]);
  await app.press("id:selection-playlist"); await app.waitFor("id:playlist-destination-search");
  expect(app.value("id:playlist-destination-search")).toBe("");
  expect(app.shows("id:playlist-save-targets")).toBe(false);
});
