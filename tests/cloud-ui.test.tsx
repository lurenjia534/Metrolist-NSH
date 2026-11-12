import { expect, open, test } from "nsh/test";
import type { App, StubRequest } from "nsh/test";

const profile = { id: "0:cloud-fixture", name: "Cloud Fixture Listener", email: "listener@example.test", channelHandle: "@cloud-fixture", avatar: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%23c7c3f5'/%3E%3C/svg%3E", verifiedAt: 1 };
const credentials = { cookie: "SAPISID=cloud-ui-fixture", authUser: "0", visitorData: "fixture-visitor", dataSyncId: "cloud-fixture" };
const alpha = { id: "cloud-alpha", title: "Cloud Alpha", artist: "Fixture artist", album: "Fixture album", artwork: "", duration: 180, source: "youtube" };
const beta = { ...alpha, id: "cloud-beta", title: "Cloud Beta" };
const owned = { id: "VLfixture-owned", browseId: "VLfixture-owned", playlistId: "fixture-owned", title: "Duplicate Cloud Playlist", subtitle: profile.name, artwork: "", type: "playlist", editable: true };
const storage = {
  "metrolist.settings": JSON.stringify({ apiBase: "https://gateway.test", autoRadio: false }),
  "metrolist.accounts": JSON.stringify({ accounts: [{ profile, credentials, library: { playlists: [owned], liked: [], songs: [], albums: [], artists: [] }, lastSynced: 0 }], activeId: profile.id, syncEnabled: false, useAccountForBrowse: true }),
};
const mutations = (app: App) => app.requests().filter(request => request.method === "POST" && request.url === "https://gateway.test/api/account/playlist").map(request => JSON.parse(request.body!));
function fixture() {
  let playlists = [owned];
  let rows = [{ ...alpha, setVideoId: "set-alpha-first" }, { ...alpha, setVideoId: "set-alpha-second" }, { ...beta, setVideoId: "set-beta" }];
  const network = {
    "GET https://gateway.test/api/account": { body: profile },
    "GET https://gateway.test/api/home": { body: { sections: [] } },
    "GET https://gateway.test/api/suggestions?q=*": { body: { query: "Cloud", suggestions: [] } },
    "GET https://gateway.test/api/search?q=Cloud&type=all": { body: { query: "Cloud", type: "all", items: [alpha] } },
    "GET https://gateway.test/api/account/library?type=playlists": () => ({ body: { type: "playlists", items: playlists } }),
    "GET https://gateway.test/api/browse?id=VLfixture-owned": () => ({ body: { ...owned, tracks: rows, sections: [] } }),
    "POST https://gateway.test/api/account/playlist": (request: StubRequest) => {
      const input = JSON.parse(request.body!);
      if (input.action === "create") {
        playlists = [...playlists, { ...owned, id: "VLfixture-created", browseId: "VLfixture-created", playlistId: "fixture-created", title: input.title }];
        return { body: { ok: true, playlistId: "fixture-created", browseId: "VLfixture-created", title: input.title } };
      }
      if (input.action === "move") {
        const moving = rows.find(row => row.setVideoId === input.setVideoId)!;
        rows = rows.filter(row => row.setVideoId !== input.setVideoId);
        const before = input.successorSetVideoId ? rows.findIndex(row => row.setVideoId === input.successorSetVideoId) : rows.length;
        rows.splice(before, 0, moving);
      }
      if (input.action === "remove") rows = rows.filter(row => row.setVideoId !== input.setVideoId);
      return { body: { ok: true, playlistId: input.playlistId, browseId: `VL${input.playlistId}` } };
    },
  };
  return { network, rows: () => rows };
}

for (const device of [
  { width: 340, height: 740, platform: "android", nav: "nav-mobile", privacy: "UNLISTED", privacyLabel: "不公开列出" },
  { width: 1440, height: 940, platform: "linux", nav: "nav", privacy: "PUBLIC", privacyLabel: "公开" },
] as const) test(`${device.platform} ${device.width} account library creates and adds cloud playlists and edits duplicate occurrences by setVideoId`, async () => {
  const data = fixture();
  const app = await open("../App.tsx", { width: device.width, height: device.height, platform: device.platform, storage, network: data.network, host: { handlers: {
    "auth.available": { available: true, method: "webview" }, "app.metadata": null, "app.playback": null,
    "app.audio.settings": null, "app.audio.snapshot": null,
  } } });
  await app.waitFor("id:page-home"); await app.press("id:header-account"); await app.waitFor("id:page-account");
  expect(app.shows("id:account-name")).toBe(true);
  expect(app.texts().includes(profile.name)).toBe(true);
  expect(app.requests().some(request => request.url === "https://gateway.test/api/account")).toBe(true);
  await app.press(`id:${device.nav}-library`); await app.press("id:library-cloud"); await app.waitFor("id:cloud-library");
  expect(app.enabled("id:cloud-sync")).toBe(true);
  await app.press("id:cloud-create");
  expect(app.enabled("id:cloud-save-playlist")).toBe(false);
  const newTitle = `Created Cloud ${device.width}`;
  await app.type("id:cloud-playlist-name", newTitle); await app.type("text:简介（可选）", "Fixture description");
  await app.press(`label:${device.privacyLabel}`); await app.press("id:cloud-save-playlist");
  await app.waitFor("id:app-dialog", { state: "gone" });
  expect(mutations(app)[0]).toEqual({ action: "create", title: newTitle, privacy: device.privacy, description: "Fixture description" });
  expect(app.shows(`label:${newTitle}`)).toBe(true);

  await app.press(`id:${device.nav}-search`); await app.type("id:search-input", "Cloud"); await app.submit("id:search-input");
  await app.waitFor("id:song-menu-cloud-alpha"); await app.press("id:song-menu-cloud-alpha");
  await app.press("加入 YouTube Music 歌单…"); await app.waitFor("id:app-dialog");
  await app.waitFor("正在读取歌单…", { state: "gone" });
  await app.press(`id:app-dialog >> label:${newTitle}`); await app.waitFor("id:app-dialog", { state: "gone" });
  expect(mutations(app).find(input => input.action === "add")).toEqual({ action: "add", playlistId: "fixture-created", videoIds: [alpha.id] });

  await app.press(`id:${device.nav}-library`); await app.press("id:library-cloud");
  await app.press(`id:cloud-library >> label:${owned.title}`); await app.waitFor("id:page-collection");
  await app.press("label:编辑云端歌曲");
  expect(app.count("id:track-cloud-alpha")).toBe(2);
  await app.press("id:track-cloud-alpha >> label:云端歌曲操作 >> nth=0"); await app.press("下移");
  await app.waitUntil(() => app.requests().filter(request => request.url === "https://gateway.test/api/browse?id=VLfixture-owned").length === 2
    && app.count("id:track-cloud-alpha") === 2 && !app.shows("正在加载…"));
  expect(mutations(app).find(input => input.action === "move")).toEqual({ action: "move", playlistId: "fixture-owned", setVideoId: "set-alpha-first", successorSetVideoId: "set-beta" });
  expect(data.rows().map(row => row.setVideoId)).toEqual(["set-alpha-second", "set-alpha-first", "set-beta"]);
  expect(app.count("id:track-cloud-alpha")).toBe(2);
  await app.press("id:track-cloud-alpha >> label:云端歌曲操作 >> nth=0"); await app.press("从云端歌单移除");
  await app.waitUntil(() => app.count("id:track-cloud-alpha") === 1);
  expect(mutations(app).find(input => input.action === "remove")).toEqual({ action: "remove", playlistId: "fixture-owned", videoId: alpha.id, setVideoId: "set-alpha-second" });
  expect(data.rows().map(row => row.setVideoId)).toEqual(["set-alpha-first", "set-beta"]);
  expect(app.count("id:track-cloud-alpha")).toBe(1);
  expect(app.requests().filter(request => request.url.includes("/api/account/")).every(request => Object.entries(request.headers).some(([key, value]) => key.toLowerCase() === "x-metrolist-account" && JSON.parse(decodeURIComponent(value)).dataSyncId === "cloud-fixture"))).toBe(true);
});
