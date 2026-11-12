import { expect, open, test } from "nsh/test";

const alpha = { id: "layout-alpha", title: "Alpha layout song with a long title", artist: "An artist name long enough to exercise the narrow row", album: "Layout album", artwork: "", duration: 180, source: "youtube" };
const beta = { ...alpha, id: "layout-beta", title: "Beta layout song" };
const gamma = { ...alpha, id: "layout-gamma", title: "Gamma layout song" };
const playlist = { id: "layout-playlist", name: "Layout playlist", tracks: [alpha, beta, gamma], createdAt: 1, updatedAt: 1 };
const storage = {
  "metrolist.settings": JSON.stringify({ autoRadio: false, apiBase: "https://gateway.test", libraryView: "grid" }),
  "metrolist.library": JSON.stringify({ version: 2, exportedAt: "", tracks: [alpha, beta, gamma], likedIds: [], history: [], playlists: [playlist], libraryIds: [alpha.id, beta.id, gamma.id], savedCollections: [], searchHistory: [], listenEvents: [] }),
};
const network = {
  "GET https://gateway.test/api/home": { body: { sections: [] } },
  "GET https://gateway.test/api/suggestions?q=*": { body: { query: "Layout", suggestions: [] } },
  "GET https://gateway.test/api/search?q=Layout&type=all": { body: { query: "Layout", type: "all", items: [alpha, beta] } },
};

for (const { width, height } of [{ width: 340, height: 640 }, { width: 800, height: 360 }, { width: 800, height: 1100 }]) test(`Android ${width}x${height} keeps search, library, dialogs, playlist editing and lyric settings usable`, async () => {
  const app = await open("../App.tsx", { width, height, platform: "android", safeArea: { top: 24, bottom: 24, left: 0, right: 0 }, storage, network, host: { handlers: { "app.audio.settings": null, "app.audio.snapshot": null, "auth.available": { available: true, method: "webview" } } } });
  const nav = width < 760 || height < 600 ? "nav-mobile" : "nav";
  await app.waitFor("id:page-home");

  await app.press(`id:${nav}-search`);
  await app.type("id:search-input", "Layout"); await app.press("id:search-submit");
  await app.waitFor("id:track-layout-alpha");
  expect(app.value("id:search-input")).toBe("Layout");
  await app.press("label:清空输入");
  expect(app.value("id:search-input")).toBe("");

  await app.press(`id:${nav}-library`); await app.waitFor("id:library-toolbar");
  await app.press("id:library-songs");
  await app.type("id:library-filter", "Alpha");
  if (height < 600) await app.scroll("id:content-library", 240);
  await app.waitFor("id:track-layout-alpha");
  expect(app.shows("id:track-layout-beta")).toBe(false);
  if (height < 600) await app.scroll("id:content-library", -240);
  await app.clear("id:library-filter");
  await app.press("id:library-toolbar >> label:排序"); await app.press("名称");
  await app.press("id:library-toolbar >> label:切换列表");
  expect(JSON.parse(app.storage()["metrolist.settings"]).libraryView).toBe("list");

  await app.press("id:library-playlists");
  await app.press("id:library-toolbar >> label:音乐库操作"); await app.press("新建歌单");
  await app.waitFor("id:app-dialog"); await app.type("id:playlist-name", "Discarded draft");
  await app.press("id:app-dialog >> label:关闭"); await app.waitFor("id:app-dialog", { state: "gone" });
  await app.press("id:library-toolbar >> label:音乐库操作"); await app.press("新建歌单");
  await app.waitFor("id:playlist-name");
  expect(app.value("id:playlist-name")).toBe("");
  expect(app.enabled("id:save-playlist")).toBe(false);
  await app.type("id:playlist-name", `Created ${width}x${height}`); await app.press("id:save-playlist");
  await app.waitFor("id:page-playlist");
  expect(JSON.parse(app.storage()["metrolist.library"]).playlists.some((item: { name: string }) => item.name === `Created ${width}x${height}`)).toBe(true);

  await app.press(`id:${nav}-library`); await app.waitFor("id:page-library");
  await app.press("id:page-library >> label:Layout playlist"); await app.waitFor("id:page-playlist");
  if (height < 900) await app.scroll("id:content-playlist", 240);
  await app.press("label:歌单操作"); await app.press("id:playlist-edit");
  await app.waitFor("id:playlist-down-0");
  if (height < 900) await app.scroll("id:content-playlist", 260);
  const savedTracks = () => JSON.parse(app.storage()["metrolist.library"]).playlists.find((item: { id: string }) => item.id === playlist.id).tracks.map((item: { id: string }) => item.id);
  await app.press("id:playlist-down-0"); expect(savedTracks()).toEqual([beta.id, alpha.id, gamma.id]);
  await app.press("id:playlist-up-1"); expect(savedTracks()).toEqual([alpha.id, beta.id, gamma.id]);
  await app.press("id:playlist-remove-1"); expect(savedTracks()).toEqual([alpha.id, gamma.id]);

  await app.press("id:header-settings"); await app.waitFor("id:page-settings");
  await app.press("id:settings-tab-lyrics");
  if (height < 900) await app.scroll("id:content-settings", 420);
  await app.press("id:lyrics-later"); expect(JSON.parse(app.storage()["metrolist.settings"]).lyricsOffset).toBe(100);
  await app.press("id:lyrics-earlier"); expect(JSON.parse(app.storage()["metrolist.settings"]).lyricsOffset).toBe(0);
  await app.press("id:lyrics-earlier"); expect(JSON.parse(app.storage()["metrolist.settings"]).lyricsOffset).toBe(-100);
  await app.press("id:lyrics-reset"); expect(JSON.parse(app.storage()["metrolist.settings"]).lyricsOffset).toBe(0);
});
