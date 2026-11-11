import { expect, open, test } from "nsh/test";
import type { App } from "nsh/test";

const alpha = { id: "controls-alpha", title: "Alpha song with a long title", artist: "An artist with a long name", album: "Controls", artwork: "", duration: 180, source: "youtube" };
const beta = { ...alpha, id: "controls-beta", title: "Beta song" };
const gamma = { ...alpha, id: "controls-gamma", title: "Gamma song" };
const queue = [alpha, beta, alpha, gamma];
const source = { url: "https://audio.test/controls.webm", mimeType: "audio/webm", bitrate: 128000, cacheKey: "controls:251", expiresAt: 4102444800000 };
const storage = {
  "metrolist.settings": JSON.stringify({ autoRadio: false, apiBase: "https://gateway.test" }),
  "metrolist.player": JSON.stringify({ queue, index: 2, position: 43, title: "Saved duplicate queue" }),
};
const network = {
  "GET https://gateway.test/api/home": { body: { sections: [] } },
  "GET https://gateway.test/api/lyrics?*": { body: { plainLyrics: "Lyrics", lines: [], instrumental: false } },
  "GET https://gateway.test/api/stream?id=*": { body: source },
};
const state = { requestId: 77, track: alpha, source, state: "playing", playing: true, playWhenReady: true, buffering: false, position: 43, duration: 180, bufferedPosition: 100 };
const handlers = {
  "app.audio.snapshot": null, "app.audio.open": null, "app.audio.play": null, "app.audio.pause": null,
  "app.audio.seek": null, "app.audio.stop": null, "app.audio.settings": null,
  "app.audio.preload": null, "app.audio.cancelPreload": null, "auth.available": { available: true, method: "webview" },
};
const calls = (app: App, name: string) => app.host.calls().filter(call => call.name === name);
const savedPlayer = (app: App) => JSON.parse(app.storage()["metrolist.player"]);

test("340-point mini player can pause a preparing source and opens the queue directly", async () => {
  const app = await open("../App.tsx", { width: 340, height: 640, platform: "android", storage, network, host: { handlers } });
  await app.waitFor("id:mini-player");
  await app.press("id:mini-play-pause");
  await app.waitFor("正在缓冲…");
  expect(app.shows("label:暂停")).toBe(true);
  const opened = calls(app, "app.audio.open").length;
  await app.press("id:mini-play-pause");
  expect(calls(app, "app.audio.pause")).toHaveLength(1);
  expect(calls(app, "app.audio.stop")).toHaveLength(0);
  await app.press("id:mini-queue"); await app.waitFor("id:queue-panel");
  expect(app.texts()).toContain("已暂停");
  expect(calls(app, "app.audio.open")).toHaveLength(opened);
  await app.setViewport(740, 360);
  await app.press("id:player-tab-lyrics"); await app.waitFor("id:lyrics-panel");
  await app.press("id:player-tab-queue"); await app.press("id:queue-current");
  await app.press("id:close-player"); await app.waitFor("id:full-player", { state: "gone" });
  await app.press("id:nav-mobile-search"); await app.waitFor("id:search-input");
});

test("duplicate queue rows keep one current entry and clearing upcoming keeps the active source and position", async () => {
  const app = await open("../App.tsx", { width: 340, height: 740, platform: "android", storage, network, host: { handlers: { ...handlers, "app.audio.snapshot": state } } });
  await app.waitFor("id:mini-player"); await app.press("id:mini-queue"); await app.waitFor("id:queue-panel");
  expect(app.count("id:queue-current-status")).toBe(1);
  expect(app.shows("id:queue-row-2 >> id:queue-current-status")).toBe(true);
  expect(app.shows("id:queue-row-0 >> id:queue-current-status")).toBe(false);
  const opened = calls(app, "app.audio.open").length;
  const streams = app.requests().filter(request => request.url.includes("/api/stream")).length;
  await app.press("id:queue-row-2 >> id:play-track-controls-alpha");
  expect(calls(app, "app.audio.pause")).toHaveLength(1);
  await app.host.send("audio.state", { ...state, state: "paused", playing: false, playWhenReady: false });
  await app.press("id:queue-row-2 >> id:play-track-controls-alpha");
  expect(calls(app, "app.audio.play")).toHaveLength(1);
  expect(calls(app, "app.audio.open")).toHaveLength(opened);
  expect(app.requests().filter(request => request.url.includes("/api/stream"))).toHaveLength(streams);
  await app.host.send("audio.state", state);
  await app.press("id:queue-actions"); await app.press("id:queue-clear-upcoming");
  await app.waitFor("已移除当前之后的歌曲，保留当前歌曲");
  expect(savedPlayer(app).queue.map((track: { id: string }) => track.id)).toEqual([alpha.id, beta.id, alpha.id]);
  expect(savedPlayer(app)).toMatchObject({ index: 2, position: 43 });
  expect(calls(app, "app.audio.stop")).toHaveLength(0);
  await app.press("id:queue-song-menu-1"); await app.press("上移");
  await app.waitFor("id:queue-row-0 >> id:play-track-controls-beta");
  expect(savedPlayer(app).queue.map((track: { id: string }) => track.id)).toEqual([beta.id, alpha.id, alpha.id]);
  await app.press("id:queue-song-menu-0"); await app.press("从队列移除");
  await app.waitFor("第 2 / 2 首 · 后续 0 首");
  expect(savedPlayer(app)).toMatchObject({ index: 1, position: 43 });
  expect(calls(app, "app.audio.open")).toHaveLength(opened);
  expect(calls(app, "app.audio.stop")).toHaveLength(0);
  await app.press("id:queue-actions"); await app.press("清空队列");
  await app.waitFor("队列已清空");
  expect(calls(app, "app.audio.stop")).toHaveLength(1);
  await app.press("label:搜索音乐"); await app.waitFor("id:search-input");
});

test("phone home shortcuts open likes, downloads, history and the listening room without an overflow menu", async () => {
  const app = await open("../App.tsx", { width: 340, height: 640, platform: "android", network, host: { handlers }, storage: {
    "metrolist.settings": storage["metrolist.settings"],
  } });
  for (const page of ["liked", "downloads", "history", "together"]) {
    await app.waitFor("id:home-shortcuts");
    await app.press(`id:home-${page}`); await app.waitFor(`id:page-${page}`);
    await app.press("id:nav-mobile-home"); await app.waitFor("id:page-home");
  }
});
