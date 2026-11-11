import { expect, open, test } from "nsh/test";

const track = { id: "motion-track", title: "A long song title that must leave the playback controls reachable", artist: "An artist with a long display name", album: "Motion album", artwork: "", duration: 180, source: "youtube" };
const storage = { "metrolist.settings": JSON.stringify({ autoRadio: false, apiBase: "http://127.0.0.1:8787" }) };
const network = {
  "GET http://127.0.0.1:8787/api/home": { body: { sections: [] } },
  "GET http://127.0.0.1:8787/api/download": { body: { downloads: [] } },
  "GET http://127.0.0.1:8787/api/suggestions?q=*": { body: { query: "Motion", suggestions: [] } },
  "GET http://127.0.0.1:8787/api/search?q=Motion&type=all": { body: { query: "Motion", type: "all", items: [track] } },
  "GET http://127.0.0.1:8787/api/stream?id=*": { body: { url: "https://audio.test/motion.m4a", mimeType: "audio/mp4", bitrate: 128000 } },
  "GET http://127.0.0.1:8787/api/lyrics?*": { body: { plainLyrics: "A lyric line", syncedLyrics: "[00:00.00]A lyric line", lines: [{ time: 0, text: "A lyric line" }, { time: 30, text: "Another lyric line" }], instrumental: false } },
};

for (const reducedMotion of [false, true]) test(`360-point player commits one seek when the finger lifts, reduced motion ${reducedMotion}`, async () => {
  const app = await open("../App.tsx", { width: 360, height: 740, platform: "web", reducedMotion, safeArea: { top: 24, bottom: 24, left: 0, right: 0 }, storage, network, host: { handlers: { "app.start": null, "app.metadata": null, "app.playback": null } } });
  await app.press("id:nav-mobile-search");
  await app.type("id:search-input", "Motion"); await app.submit("id:search-input");
  await app.press("id:play-track-motion-track"); await app.waitFor("id:mini-player");
  await app.press("id:open-player"); await app.waitFor("id:player-seek");

  const seeks = app.audio().filter(call => call.command === "seek").length;
  await app.dragAndHold("id:player-seek >> label:播放进度", { x: 70 });
  expect(app.audio().filter(call => call.command === "seek")).toHaveLength(seeks);
  await app.drop();
  expect(app.audio().filter(call => call.command === "seek")).toHaveLength(seeks + 1);
  expect(app.audio().filter(call => call.command === "seek").at(-1)!.position! > 0).toBe(true);

  const opened = app.audio().filter(call => call.command === "open").length;
  await app.press("id:player-tab-lyrics"); await app.waitFor("id:lyrics-panel");
  await app.press("id:player-tab-queue"); await app.waitFor("id:queue-panel");
  await app.press("id:close-player"); await app.waitFor("id:full-player", { state: "gone" });
  await app.press("id:open-player"); await app.waitFor("id:player-play-pause");
  expect(app.audio().filter(call => call.command === "open")).toHaveLength(opened);

  await app.setViewport(740, 360);
  await app.waitFor("id:player-tabs");
  await app.press("id:player-tab-lyrics"); await app.waitFor("id:lyrics-panel");
  await app.press("id:player-tab-queue"); await app.waitFor("id:queue-panel");
  await app.press("id:player-tab-cover"); await app.waitFor("id:player-cover-scroll");
  await app.scroll("id:player-cover-scroll", 140);
  await app.press("id:player-play-pause");
  expect(app.audio().some(call => call.command === "pause")).toBe(true);
  await app.press("id:close-player"); await app.waitFor("id:full-player", { state: "gone" });
});
