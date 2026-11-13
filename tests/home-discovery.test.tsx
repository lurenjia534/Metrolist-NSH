import { expect, open, test } from "nsh/test";
import type { App } from "nsh/test";
import type { CatalogSection, Collection, HomeResponse, Track } from "../src/model";

const origin = "https://gateway.test";
const focusParams = "focus+/=";
const relaxParams = "relax+/=";
const focusUrl = `${origin}/api/home?id=FEmusic_home&params=${encodeURIComponent(focusParams)}`;
const relaxUrl = `${origin}/api/home?id=FEmusic_home&params=${encodeURIComponent(relaxParams)}`;
const alpha: Track = { id: "home-alpha", title: "Focus alpha", artist: "Home artist", album: "Home album", artwork: "", duration: 180, source: "youtube" };
const beta: Track = { ...alpha, id: "home-beta", title: "Focus beta" };
const gamma: Track = { ...alpha, id: "home-gamma", title: "Focus gamma" };
const recent: Track = { ...alpha, id: "home-history", title: "Previously listened song" };
const album: Collection = { id: "MPREb_home_album", browseId: "MPREb_home_album", title: "Home album", subtitle: "Home artist", artwork: "", type: "album" };
const secondAlbum: Collection = { ...album, id: "MPREb_home_second", browseId: "MPREb_home_second", title: "Second home album" };
const chips = [
  { title: "专注", endpoint: { browseId: "FEmusic_home", params: focusParams }, selected: false },
  { title: "放松", endpoint: { browseId: "FEmusic_home", params: relaxParams }, selected: false },
];
const defaultHome: HomeResponse = { chips, sections: [{ title: "今日推荐", label: "根据你的聆听", items: [album] }] };
const focusHome: HomeResponse = { chips: [], sections: [{ title: "专注精选", items: [alpha, beta], layout: "list", rows: 4 }] };
const storage = {
  "metrolist.settings": JSON.stringify({ apiBase: origin, autoRadio: false }),
  "metrolist.library": JSON.stringify({ version: 2, tracks: [recent], libraryIds: [], likedIds: [], history: [recent], playlists: [], searchHistory: ["Existing search"] }),
};
const handlers = {
  "app.audio.settings": null, "app.audio.snapshot": null, "app.audio.open": null,
  "app.audio.seek": null, "app.audio.pause": null, "app.audio.preload": null, "app.audio.cancelPreload": null,
  "auth.available": { available: true, method: "webview" },
};
const network = {
  [`GET ${origin}/api/home`]: { body: defaultHome },
  [`GET ${focusUrl}`]: { body: focusHome },
  [`GET ${relaxUrl}`]: { body: { sections: [{ title: "放松精选", items: [secondAlbum] }] } },
  [`GET ${origin}/api/lyrics?*`]: { body: { plainLyrics: "", syncedLyrics: "", lines: [], instrumental: true } },
  [`GET ${origin}/api/stream?id=*`]: (request: { url: string }) => ({ body: { url: `https://audio.test/${new URL(request.url).searchParams.get("id")}.m4a`, duration: 180 } }),
};
const requestsTo = (app: App, url: string) => app.requests().filter(request => request.url === url);
const selectedWeight = (app: App, index: number) => app.spanStyle(`id:home-chip-${index} >> text:${chips[index].title}`).fontWeight;
const player = (app: App) => JSON.parse(app.storage()["metrolist.player"]);

test("340-point home chips filter the feed in place and toggle, clear and native Back restore the same default feed", async () => {
  const app = await open("../App.tsx", { width: 340, height: 740, platform: "android", storage, network, host: { handlers } });
  await app.waitFor("id:home-chip-0");
  expect(app.shows("text:今日推荐")).toBe(true);
  expect(selectedWeight(app, 0)).toBe(400);
  await app.press("id:home-chip-0"); await app.waitFor("text:专注精选");
  expect(app.shows("id:page-home")).toBe(true);
  expect(app.shows("id:page-search")).toBe(false);
  expect(app.shows("text:今日推荐")).toBe(false);
  expect(app.shows("text:继续聆听")).toBe(false);
  expect(selectedWeight(app, 0)).toBe(600);
  expect(app.enabled("id:home-chip-1")).toBe(true);
  expect(requestsTo(app, focusUrl)).toHaveLength(1);
  expect(app.requests().some(request => request.url.includes("/api/search") || request.url.includes("/api/suggestions"))).toBe(false);
  expect(JSON.parse(app.storage()["metrolist.library"]).searchHistory).toEqual(["Existing search"]);
  await app.press("id:home-chip-0"); await app.waitFor("text:今日推荐");
  expect(selectedWeight(app, 0)).toBe(400);
  expect(app.shows("id:home-filter-clear")).toBe(false);
  await app.press("id:home-chip-0"); await app.waitFor("text:专注精选");
  await app.press("id:home-filter-clear"); await app.waitFor("text:今日推荐");
  await app.press("id:home-chip-0"); await app.waitFor("text:专注精选");
  await app.back(); await app.waitFor("text:今日推荐");
  expect(app.shows("id:page-home")).toBe(true);
  expect(app.shows("id:home-filter-clear")).toBe(false);
  expect(requestsTo(app, `${origin}/api/home`)).toHaveLength(1);
});

test("home pagination retains the selected category and displayed shelves while refresh reloads that category", async () => {
  let refreshes = 0;
  const app = await open("../App.tsx", { width: 1440, height: 1000, platform: "linux", clock: {}, storage, network: {
    ...network,
    [`GET ${focusUrl}`]: () => ({ body: { ...focusHome, sections: [{ ...focusHome.sections[0], title: ++refreshes === 1 ? "专注第一页" : "已刷新的专注推荐" }], continuation: "focus-page-2" } }),
    [`GET ${focusUrl}&continuation=focus-page-2`]: { delay: 1000, body: { sections: [{ title: "专注第二页", items: [gamma], layout: "list" }] } },
  } });
  await app.waitFor("id:home-chip-0"); await app.press("id:home-chip-0"); await app.waitFor("text:专注第一页");
  await app.press("id:home-more");
  await app.waitUntil(() => requestsTo(app, `${focusUrl}&continuation=focus-page-2`).length === 1);
  expect(app.shows("text:专注第一页")).toBe(true);
  expect(app.shows("id:home-loading")).toBe(false);
  expect(app.shows("id:home-more >> text:正在加载…")).toBe(true);
  expect(app.enabled("id:home-more")).toBe(false);
  await app.clock!.fastForward(1001); await app.waitFor("text:专注第二页");
  expect(app.shows("text:专注第一页")).toBe(true);
  expect(app.shows("id:home-more")).toBe(false);
  expect(selectedWeight(app, 0)).toBe(600);
  await app.press("id:home-refresh"); await app.waitFor("text:已刷新的专注推荐");
  expect(app.shows("text:专注第二页")).toBe(false);
  expect(app.shows("id:home-more")).toBe(true);
  expect(selectedWeight(app, 0)).toBe(600);
  expect(requestsTo(app, focusUrl)).toHaveLength(2);
  expect(requestsTo(app, `${origin}/api/home`)).toHaveLength(1);
});

test("a late category response cannot replace a newer selection or undo clearing the filter", async () => {
  const app = await open("../App.tsx", { width: 1440, height: 1000, platform: "linux", clock: {}, storage, network: {
    ...network, [`GET ${focusUrl}`]: { delay: 2000, body: focusHome },
  } });
  await app.waitFor("id:home-chip-0"); await app.press("id:home-chip-0");
  await app.waitUntil(() => requestsTo(app, focusUrl).length === 1);
  await app.press("id:home-chip-1"); await app.waitFor("text:放松精选");
  await app.clock!.fastForward(2001);
  expect(app.shows("text:放松精选")).toBe(true);
  expect(app.shows("text:专注精选")).toBe(false);
  expect(selectedWeight(app, 0)).toBe(400); expect(selectedWeight(app, 1)).toBe(600);
  await app.press("id:home-chip-0");
  await app.waitUntil(() => requestsTo(app, focusUrl).length === 2);
  await app.press("id:home-filter-clear"); await app.waitFor("text:今日推荐");
  await app.clock!.fastForward(2001);
  expect(app.shows("text:今日推荐")).toBe(true);
  expect(app.shows("text:专注精选")).toBe(false);
  expect(app.shows("id:home-filter-clear")).toBe(false);
  expect(app.shows("id:home-loading")).toBe(false);
});

test("a home shelf opens its exact browse endpoint and back preserves the feed filter and every loaded browse page", async () => {
  const endpoint = { browseId: "FEmusic_focus_shelves", params: "shelf+/=" };
  const gridAlbums = [album, ...Array.from({ length: 7 }, (_, index): Collection => ({ ...album,
    id: `MPREb_focus_grid_${index}`, browseId: `MPREb_focus_grid_${index}`, title: `Focused grid album ${index + 1}`,
  }))];
  const lastGridAlbum = gridAlbums[gridAlbums.length - 1];
  const browseUrl = `${origin}/api/browse?id=${endpoint.browseId}&params=${encodeURIComponent(endpoint.params)}`;
  const moreUrl = `${origin}/api/browse?id=${endpoint.browseId}&continuation=focus-albums-2&params=${encodeURIComponent(endpoint.params)}`;
  const section: CatalogSection = { title: "专注歌单与专辑", label: "按你的喜好精选", thumbnail: "", endpoint, items: [album] };
  const app = await open("../App.tsx", { width: 1440, height: 1000, platform: "linux", storage, network: {
    ...network,
    [`GET ${focusUrl}`]: { body: { sections: [section] } },
    [`GET ${browseUrl}`]: { body: { id: endpoint.browseId, title: section.title, subtitle: "", artwork: "", tracks: [], sections: [{ title: "精选专辑", items: gridAlbums, layout: "grid" }], continuation: "focus-albums-2" } },
    [`GET ${moreUrl}`]: { body: { id: endpoint.browseId, title: section.title, subtitle: "", artwork: "", tracks: [], sections: [{ title: "更多专辑", items: [secondAlbum], layout: "grid" }] } },
    [`GET ${origin}/api/browse?id=${lastGridAlbum.id}`]: { body: { ...lastGridAlbum, tracks: [alpha], sections: [] } },
  } });
  await app.waitFor("id:home-chip-0"); await app.press("id:home-chip-0"); await app.waitFor("id:home-section-0-more");
  expect(app.shows("text:按你的喜好精选")).toBe(true);
  await app.press("id:home-section-0-more"); await app.waitFor("id:page-browse"); await app.waitFor("label:Home album");
  expect(app.shows("id:page-collection")).toBe(false);
  expect(app.shows("text:专注歌单与专辑")).toBe(true);
  await app.press("id:explore-more"); await app.waitFor("label:Second home album");
  await app.press(`id:explore-section-0 >> label:${lastGridAlbum.title}`); await app.waitFor("id:page-collection"); await app.waitFor("id:play-track-home-alpha");
  expect(requestsTo(app, `${origin}/api/browse?id=${lastGridAlbum.id}`)).toHaveLength(1);
  await app.back(); await app.waitFor("id:page-browse");
  expect(app.shows("label:Home album")).toBe(true);
  expect(app.shows(`label:${lastGridAlbum.title}`)).toBe(true);
  expect(app.shows("label:Second home album")).toBe(true);
  expect(app.shows("text:专注歌单与专辑")).toBe(true);
  expect(requestsTo(app, browseUrl)).toHaveLength(1); expect(requestsTo(app, moreUrl)).toHaveLength(1);
  await app.back(); await app.waitFor("id:page-home");
  expect(selectedWeight(app, 0)).toBe(600);
  expect(app.shows("id:home-section-0-more")).toBe(true);
  expect(app.shows("id:home-filter-clear")).toBe(true);
  expect(requestsTo(app, focusUrl)).toHaveLength(1);
});

test("home shelf play-all uses its loaded songs or actual queue endpoint independently of its more button", async () => {
  const endpoint = { playlistId: "RDAMVMhome", params: "queue+/=", index: 2 };
  const queueUrl = `${origin}/api/next?playlistId=${endpoint.playlistId}&params=${encodeURIComponent(endpoint.params)}&index=2`;
  const app = await open("../App.tsx", { width: 340, height: 740, platform: "android", storage, host: { handlers }, network: {
    ...network,
    [`GET ${origin}/api/home`]: { body: { chips, sections: [
      { title: "歌曲推荐", items: [alpha, beta], layout: "list", rows: 4, endpoint: { browseId: "FEmusic_song_shelf", params: "more-songs" } },
      { title: "为你准备的电台", items: [alpha], playEndpoint: endpoint },
    ] } },
    [`GET ${queueUrl}`]: { body: { tracks: [beta, alpha, gamma], currentIndex: 2 } },
  } });
  await app.waitFor("id:home-section-0-play");
  expect(app.enabled("id:home-section-0-more")).toBe(true);
  await app.press("id:home-section-0-play");
  await app.waitUntil(() => app.host.calls().some(call => call.name === "app.audio.open"));
  expect(player(app).queue.map((track: Track) => track.id)).toEqual([alpha.id, beta.id]);
  expect(player(app).title).toBe("歌曲推荐");
  expect(app.requests().some(request => request.url.includes("/api/next") || request.url.includes("/api/browse"))).toBe(false);
  await app.press("id:home-section-1-play");
  await app.waitUntil(() => app.host.calls().filter(call => call.name === "app.audio.open").length === 2);
  expect(requestsTo(app, queueUrl)).toHaveLength(1);
  expect(player(app).queue.map((track: Track) => track.id)).toEqual([beta.id, alpha.id, gamma.id]);
  expect(player(app).index).toBe(2); expect(player(app).title).toBe("为你准备的电台");
  expect(app.host.calls().filter(call => call.name === "app.audio.open")[1].data).toMatchObject({ url: "https://audio.test/home-gamma.m4a", track: { id: gamma.id } });
});

test("home shelves retain their fifteenth card and grouped mood buttons open real category feeds", async () => {
  const albums = Array.from({ length: 16 }, (_, index): Collection => ({ ...album, id: `MPREb_home_${index}`, browseId: `MPREb_home_${index}`, title: `Album ${index + 1} with a long descriptive title` }));
  const mood = { title: "阅读与学习", browseId: "FEmusic_moods_and_genres_category", params: "reading+/=" };
  const moodUrl = `${origin}/api/browse?id=${mood.browseId}&params=${encodeURIComponent(mood.params)}`;
  const app = await open("../App.tsx", { width: 340, height: 740, platform: "android", storage, host: { handlers }, network: {
    ...network,
    [`GET ${origin}/api/home`]: { body: { chips, sections: [
      { title: "新专辑", items: albums, layout: "cards" },
      { title: "心情与活动", items: [], moods: [mood] },
      { title: "音乐流派", items: [], moods: [{ title: "爵士", browseId: mood.browseId, params: "jazz" }] },
    ] } },
    [`GET ${origin}/api/browse?id=${albums[15].id}`]: { body: { ...albums[15], tracks: [alpha], sections: [] } },
    [`GET ${moodUrl}`]: { body: { id: mood.browseId, title: mood.title, subtitle: "", artwork: "", tracks: [], sections: [{ title: "阅读时的音乐", items: [album] }] } },
  } });
  await app.waitFor("id:home-section-0");
  // The sixteenth card sits past the row's visible width: scroll the row to it, as a user does.
  await app.scroll("id:home-section-0-cards", 4000); await app.waitFor(`id:home-section-0 >> label:${albums[15].title}`);
  await app.press(`id:home-section-0 >> label:${albums[15].title}`); await app.waitFor("id:page-collection");
  expect(requestsTo(app, `${origin}/api/browse?id=${albums[15].id}`)).toHaveLength(1);
  await app.back(); await app.waitFor("id:page-home");
  expect(app.shows("text:心情与活动")).toBe(true); expect(app.shows("text:音乐流派")).toBe(true);
  await app.press("id:home-section-1-mood-0"); await app.waitFor("id:page-browse"); await app.waitFor("text:阅读时的音乐");
  expect(requestsTo(app, moodUrl)).toHaveLength(1);
  expect(app.shows("id:page-collection")).toBe(false);
  expect(app.shows("label:存到本机")).toBe(false);
});

test("an empty filtered home reports its state and keeps refresh and clear available without unrelated recommendations", async () => {
  const app = await open("../App.tsx", { width: 340, height: 740, platform: "android", storage, host: { handlers }, network: {
    ...network, [`GET ${focusUrl}`]: { body: { sections: [] } },
  } });
  await app.waitFor("id:home-chip-0"); await app.press("id:home-chip-0"); await app.waitFor("id:home-empty");
  expect(app.shows("text:今日推荐")).toBe(false);
  expect(app.shows("text:快速选歌")).toBe(false);
  expect(app.shows("text:继续聆听")).toBe(false);
  expect(app.shows("id:home-section-0")).toBe(false);
  expect(app.enabled("id:home-filter-clear")).toBe(true);
  expect(app.enabled("id:home-refresh")).toBe(true);
  await app.press("id:home-refresh"); await app.waitUntil(() => requestsTo(app, focusUrl).length === 2);
  await app.waitFor("id:home-empty");
  expect(selectedWeight(app, 0)).toBe(600);
  await app.press("id:home-filter-clear"); await app.waitFor("text:今日推荐");
  expect(app.shows("id:home-empty")).toBe(false);
});
