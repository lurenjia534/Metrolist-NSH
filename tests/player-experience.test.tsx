import { expect, open, test } from "nsh/test";
import type { App } from "nsh/test";

const alpha = { id: "experience-alpha", title: "Alpha experience song", artist: "Experience artist", album: "Experience album", artwork: "", duration: 180, source: "youtube" };
const beta = { ...alpha, id: "experience-beta", title: "Beta experience song" };
const gamma = { ...alpha, id: "experience-gamma", title: "Gamma experience song" };
const tracks = [alpha, beta, alpha, gamma];
const source = { url: "https://audio.test/experience.webm", mimeType: "audio/webm", bitrate: 128000, cacheKey: "experience:251", expiresAt: 4102444800000 };
const lyrics = { plainLyrics: "First experience lyric\nSecond experience lyric", syncedLyrics: "[00:00.00]First experience lyric\n[00:30.00]Second experience lyric", lines: [{ time: 0, text: "First experience lyric" }, { time: 30, text: "Second experience lyric" }], instrumental: false };
const storage = {
  "metrolist.settings": JSON.stringify({ autoRadio: false, apiBase: "https://gateway.test", lyricFontSize: "medium", lyricAlignment: "center", lyricsOffset: 500 }),
  "metrolist.player": JSON.stringify({ queue: tracks, index: 2, position: 43, title: "Experience queue" }),
};
const network = {
  "GET https://gateway.test/api/home": { body: { sections: [] } },
  "GET https://gateway.test/api/lyrics?*": { body: lyrics },
  "GET https://gateway.test/api/stream?id=*": { body: source },
};
const state = { requestId: 77, track: alpha, source, state: "playing", playing: true, playWhenReady: true, buffering: false, position: 43, duration: 180, bufferedPosition: 100 };
const handlers = {
  "app.audio.snapshot": state, "app.audio.open": null, "app.audio.play": null, "app.audio.pause": null,
  "app.audio.seek": null, "app.audio.stop": null, "app.audio.settings": null,
  "app.audio.preload": null, "app.audio.cancelPreload": null, "auth.available": { available: true, method: "webview" },
};
const calls = (app: App, name: string) => app.host.calls().filter(call => call.name === name);
const player = (app: App) => JSON.parse(app.storage()["metrolist.player"]);
const settings = (app: App) => JSON.parse(app.storage()["metrolist.settings"]);

test("340-point player changes sleep mode, updates its countdown and cancels without a later pause", async () => {
  const app = await open("../App.tsx", { width: 340, height: 740, platform: "android", clock: {}, storage, network, host: { handlers } });
  await app.waitFor("id:mini-player"); await app.press("id:mini-queue");
  await app.press("id:queue-actions"); await app.press("id:queue-sleep");
  await app.waitFor("id:app-dialog");
  expect(app.enabled("id:sleep-end-of-track")).toBe(true);
  await app.press("id:sleep-5"); await app.waitFor("id:app-dialog", { state: "gone" });
  await app.press("id:player-tab-cover");
  await app.waitFor("id:sleep-countdown");
  await app.clock!.fastForward(60000);
  await app.press("id:player-sleep"); await app.waitFor("id:sleep-status");
  expect(app.shows("id:sleep-status >> text:/^(4:00|3:5[0-9])$/")).toBe(true);
  await app.press("id:sleep-end-of-track"); await app.waitFor("id:app-dialog", { state: "gone" });
  expect(app.texts()).toContain("本首结束");
  const opened = calls(app, "app.audio.open").length;
  await app.host.send("audio.state", { ...state, state: "ended", playing: false, position: 180, bufferedPosition: 180 });
  expect(calls(app, "app.audio.pause")).toHaveLength(1);
  expect(calls(app, "app.audio.open")).toHaveLength(opened);
  expect(player(app).index).toBe(2);
  expect(app.shows("id:sleep-countdown")).toBe(false);
  await app.press("id:player-sleep"); await app.press("id:sleep-5");
  await app.waitFor("id:app-dialog", { state: "gone" });
  await app.press("id:player-sleep"); await app.press("id:sleep-cancel");
  await app.waitFor("id:app-dialog", { state: "gone" });
  expect(app.shows("id:sleep-countdown")).toBe(false);
  await app.clock!.fastForward(300500);
  expect(calls(app, "app.audio.pause")).toHaveLength(1);
});

test("desktop lyrics settings change rendered font size and persist alignment, reset and copy actions", async () => {
  const app = await open("../App.tsx", { width: 1440, height: 1000, platform: "linux", storage, network });
  await app.waitFor("id:mini-player"); await app.press("id:mini-play-pause");
  await app.press("id:open-player"); await app.waitFor("id:full-player");
  await app.press("id:player-tab-lyrics");
  await app.waitFor("text:Second experience lyric");
  await app.press("id:lyrics-options"); await app.press("id:lyrics-size-large");
  await app.waitUntil(() => settings(app).lyricFontSize === "large");
  await app.waitFor("id:lyrics-size-large", { state: "gone" });
  expect(settings(app).lyricFontSize).toBe("large");
  expect(app.spanStyle("text:Second experience lyric")).toMatchObject({ fontSize: 36 });
  await app.press("id:lyrics-options"); await app.press("左侧对齐");
  await app.waitUntil(() => settings(app).lyricAlignment === "left");
  await app.waitFor("左侧对齐", { state: "gone" });
  expect(settings(app).lyricAlignment).toBe("left");
  await app.press("id:lyrics-options");
  expect(app.enabled("id:lyrics-reset-offset")).toBe(true);
  await app.press("id:lyrics-reset-offset");
  await app.waitUntil(() => settings(app).lyricsOffset === 0);
  await app.waitFor("id:lyrics-reset-offset", { state: "gone" });
  expect(settings(app).lyricsOffset).toBe(0);
  await app.press("id:lyrics-options"); await app.press("id:lyrics-copy");
  await app.waitUntil(() => app.clipboard() === lyrics.plainLyrics);
  await app.waitFor("id:lyrics-copy", { state: "gone" });
  expect(app.clipboard()).toBe(lyrics.plainLyrics);
  await app.press("id:lyrics-options");
  expect(app.enabled("id:lyrics-reset-offset")).toBe(false);
});

test("340-point queue moves existing occurrences next while preserving the active audio and position", async () => {
  const app = await open("../App.tsx", { width: 340, height: 740, platform: "android", storage, network, host: { handlers } });
  await app.waitFor("id:mini-player"); await app.press("id:mini-queue"); await app.waitFor("id:queue-panel");
  const opened = calls(app, "app.audio.open").length;
  await app.press("id:queue-song-menu-1"); await app.waitFor("id:queue-next-1");
  await app.press("id:queue-next-1");
  await app.waitUntil(() => player(app).index === 1 && player(app).queue[2].id === beta.id);
  await app.waitFor("id:queue-next-1", { state: "gone" });
  expect(player(app).queue.map((track: { id: string }) => track.id)).toEqual([alpha.id, alpha.id, beta.id, gamma.id]);
  expect(player(app)).toMatchObject({ index: 1, position: 43 });
  await app.press("id:queue-song-menu-3"); await app.waitFor("id:queue-next-3");
  await app.press("id:queue-next-3");
  await app.waitUntil(() => player(app).queue[2].id === gamma.id);
  await app.waitFor("id:queue-next-3", { state: "gone" });
  expect(player(app).queue.map((track: { id: string }) => track.id)).toEqual([alpha.id, alpha.id, gamma.id, beta.id]);
  expect(player(app)).toMatchObject({ index: 1, position: 43 });
  expect(app.shows("id:queue-row-1 >> id:queue-current-status")).toBe(true);
  expect(calls(app, "app.audio.open")).toHaveLength(opened);
  expect(calls(app, "app.audio.stop")).toHaveLength(0);
  expect(calls(app, "app.audio.pause")).toHaveLength(0);
  await app.press("id:queue-song-menu-1");
  await app.waitFor("id:queue-next-1");
  expect(app.enabled("id:queue-next-1")).toBe(false);
});
