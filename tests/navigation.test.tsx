import { expect, open, test } from "nsh/test";

const song = { id: "routing-song", title: "Routing song", artist: "Routing artist", album: "Routing album", artwork: "", duration: 180, source: "youtube" };
const album = { id: "MPRE_routing", browseId: "MPRE_routing", title: "Routing album", subtitle: "Routing artist", artwork: "", type: "album" };
const secondAlbum = { ...album, id: "MPRE_routing_2", browseId: "MPRE_routing_2", title: "Second routing album" };
const storage = { "metrolist.settings": JSON.stringify({ apiBase: "https://gateway.test", autoRadio: false }) };
const network = {
  "GET https://gateway.test/api/home": { body: { sections: [] } },
  "GET https://gateway.test/api/suggestions?q=*": { body: { suggestions: [] } },
  "GET https://gateway.test/api/search?q=Routing&type=all": { body: { query: "Routing", type: "all", items: [album], continuation: "routing-2" } },
  "GET https://gateway.test/api/search?q=Routing&type=all&continuation=routing-2": { body: { query: "Routing", type: "all", items: [secondAlbum] } },
  [`GET https://gateway.test/api/browse?id=${album.id}`]: { body: { ...album, tracks: [song], sections: [] } },
};
const host = { handlers: { "app.start": null, "app.audio.settings": null, "app.audio.snapshot": null, "auth.available": { available: true, method: "webview" } } };

for (const { width, platform, prefix } of [
  { width: 340, platform: "android", prefix: "nav-mobile" },
  { width: 1440, platform: "linux", prefix: "nav" },
] as const) test(`${platform} contextual search selects Search through its album and Back restores Home`, async () => {
  const app = await open("../App.tsx", { width, height: 900, platform, storage, network, host });
  await app.waitFor("id:page-home");
  expect(app.spanStyle(`id:${prefix}-home >> text:首页`).fontWeight).toBe(600);
  await app.press("id:header-search"); await app.waitFor("id:page-search");
  expect(app.spanStyle(`id:${prefix}-search >> text:搜索`).fontWeight).toBe(600);
  expect(app.spanStyle(`id:${prefix}-home >> text:首页`).fontWeight).toBe(400);
  await app.type("id:search-input", "Routing"); await app.submit("id:search-input");
  await app.waitFor("label:Routing album"); await app.press("label:Routing album");
  await app.waitFor("id:page-collection"); await app.waitFor("id:play-track-routing-song");
  expect(app.spanStyle(`id:${prefix}-search >> text:搜索`).fontWeight).toBe(600);
  expect(app.spanStyle(`id:${prefix}-home >> text:首页`).fontWeight).toBe(400);
  await app.back(); await app.waitFor("id:page-search");
  expect(app.value("id:search-input")).toBe("Routing");
  expect(app.shows("label:Routing album")).toBe(true);
  await app.back(); await app.waitFor("id:page-home");
  expect(app.spanStyle(`id:${prefix}-home >> text:首页`).fontWeight).toBe(600);
  expect(app.spanStyle(`id:${prefix}-search >> text:搜索`).fontWeight).toBe(400);
  expect(app.requests().filter(request => request.url === "https://gateway.test/api/search?q=Routing&type=all")).toHaveLength(1);
});

test("choosing the active Search tab removes the Library context and root Back returns Home", async () => {
  const app = await open("../App.tsx", { width: 340, height: 900, platform: "android", storage, network, host });
  await app.press("id:nav-mobile-library"); await app.waitFor("id:page-library");
  await app.press("id:header-search"); await app.waitFor("id:page-search");
  await app.back(); await app.waitFor("id:page-library");
  expect(app.spanStyle("id:nav-mobile-library >> text:音乐库").fontWeight).toBe(600);
  await app.press("id:header-search"); await app.waitFor("id:page-search");
  await app.type("id:search-input", "Routing"); await app.submit("id:search-input");
  await app.waitFor("label:Routing album");
  await app.press("id:nav-mobile-search");
  expect(app.value("id:search-input")).toBe("Routing");
  await app.back(); await app.waitFor("id:page-home");
  expect(app.shows("id:page-library")).toBe(false);
  expect(app.spanStyle("id:nav-mobile-home >> text:首页").fontWeight).toBe(600);
});

test("selecting Search from a nested album restores its loaded results and makes it the root", async () => {
  const app = await open("../App.tsx", { width: 1440, height: 1000, platform: "linux", storage, network, host });
  await app.press("id:nav-library"); await app.waitFor("id:page-library");
  await app.press("id:header-search"); await app.type("id:search-input", "Routing"); await app.submit("id:search-input");
  await app.waitFor("label:Routing album"); await app.press("id:search-more"); await app.waitFor("label:Second routing album");
  await app.press("label:Routing album"); await app.waitFor("id:play-track-routing-song");
  await app.press("id:nav-search"); await app.waitFor("id:page-search");
  expect(app.value("id:search-input")).toBe("Routing");
  expect(app.shows("label:Routing album")).toBe(true);
  expect(app.shows("label:Second routing album")).toBe(true);
  expect(app.requests().filter(request => request.url === "https://gateway.test/api/search?q=Routing&type=all")).toHaveLength(1);
  await app.back(); await app.waitFor("id:page-home");
  expect(app.shows("id:page-library")).toBe(false);
});

test("Explore tab changes update their title and Back restores all loaded charts without another request", async () => {
  const app = await open("../App.tsx", { width: 1440, height: 1100, platform: "linux", storage, host, network: {
    ...network,
    "GET https://gateway.test/api/explore?tab=new": { body: { sections: [{ title: "New releases", items: [secondAlbum] }], moods: [] } },
    "GET https://gateway.test/api/explore?tab=charts": { body: { sections: [{ title: "Current chart", items: [album] }], moods: [], continuation: "charts-2" } },
    "GET https://gateway.test/api/explore?tab=charts&continuation=charts-2": { body: { sections: [{ title: "More chart albums", items: [secondAlbum] }], moods: [] } },
  } });
  await app.press("id:header-search"); await app.press("id:search-discover-new");
  await app.waitFor("label:Second routing album");
  expect(app.shows("id:page-header >> text:新发行")).toBe(true);
  await app.press("id:page-browse >> label:排行榜"); await app.waitFor("label:Routing album");
  expect(app.shows("id:page-header >> text:排行榜")).toBe(true);
  expect(app.spanStyle("id:nav-search >> text:搜索").fontWeight).toBe(600);
  await app.press("id:explore-more"); await app.waitFor("label:Second routing album");
  await app.press("label:Routing album"); await app.waitFor("id:play-track-routing-song");
  await app.back(); await app.waitFor("id:page-browse");
  expect(app.shows("id:page-header >> text:排行榜")).toBe(true);
  expect(app.shows("label:Routing album")).toBe(true);
  expect(app.shows("label:Second routing album")).toBe(true);
  expect(app.requests().filter(request => request.url === "https://gateway.test/api/explore?tab=charts")).toHaveLength(1);
  await app.back(); await app.waitFor("id:page-search");
  expect(app.shows("id:page-browse")).toBe(false);
});
