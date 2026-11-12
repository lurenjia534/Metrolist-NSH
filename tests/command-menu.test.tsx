import { expect, open, test } from "nsh/test";

const track = { id: "menu-song", title: "Menu song", artist: "Menu artist", album: "", artwork: "", duration: 180, source: "youtube" };
const playlist = { id: "menu-playlist", name: "Menu playlist", tracks: [track], createdAt: 1, updatedAt: 1 };
const retained = { ...playlist, id: "retained-playlist", name: "Retained playlist" };
const storage = {
  "metrolist.settings": JSON.stringify({ apiBase: "https://gateway.test", autoRadio: false }),
  "metrolist.library": JSON.stringify({
    version: 2, exportedAt: "", tracks: [track], likedIds: [track.id], libraryIds: [track.id],
    history: [], playlists: [playlist, retained], savedCollections: [], searchHistory: [], listenEvents: [],
  }),
};
const network = { "GET https://gateway.test/api/home": { body: { chips: [], sections: [] } } };

for (const device of [
  { width: 340, height: 740, platform: "android", navigation: "nav-mobile" },
  { width: 1440, height: 940, platform: "linux", navigation: "nav" },
] as const) test(`${device.platform} menu commands open a rename dialog and delete their own playlist page`, async () => {
  const app = await open("../App.tsx", { width: device.width, height: device.height, platform: device.platform, storage, network, host: { handlers: {
    "app.audio.snapshot": null, "app.audio.settings": null, "auth.available": { available: true, method: "webview" },
  } } });
  await app.waitFor("id:page-home");
  await app.press(`id:${device.navigation}-library`); await app.waitFor("id:page-library");
  await app.press("id:library-playlists");
  await app.press(`id:page-library >> label:${playlist.name}`); await app.waitFor("id:page-playlist");

  await app.press("label:歌单操作"); await app.waitFor("重命名"); await app.press("重命名");
  await app.waitFor("id:app-dialog");
  expect(app.value("id:playlist-name")).toBe(playlist.name);
  await app.clear("id:playlist-name");
  await app.type("id:playlist-name", "Renamed playlist"); await app.press("id:save-playlist");
  await app.waitFor("id:app-dialog", { state: "gone" });
  await app.waitFor("id:page-playlist >> text:Renamed playlist");

  await app.press("label:歌单操作"); await app.waitFor("删除歌单"); await app.press("删除歌单");
  await app.waitFor("id:page-playlist", { state: "gone" }); await app.waitFor("id:page-library");
  await app.waitUntil(() => JSON.parse(app.storage()["metrolist.library"]).playlists.length === 1);
  const saved = JSON.parse(app.storage()["metrolist.library"]);
  expect(saved.playlists.map((item: { id: string }) => item.id)).toEqual([retained.id]);
  expect(saved.libraryIds).toEqual([track.id]);
  expect(saved.likedIds).toEqual([track.id]);
  expect(app.shows("id:page-library >> label:Renamed playlist")).toBe(false);
  await app.press(`id:page-library >> label:${retained.name}`); await app.waitFor("id:page-playlist");
  expect(app.shows(`id:play-track-${track.id}`)).toBe(true);
});
