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

test("relative seek uses the saved interval and custom sleep settings survive reopening", async () => {
  const app = await open("../App.tsx", { width: 390, height: 844, platform: "android", network, host: { handlers }, storage: {
    ...storage, "metrolist.settings": JSON.stringify({ ...JSON.parse(storage["metrolist.settings"]), seekSeconds: 25 }),
  } });
  await app.press("id:open-player");
  await app.press("id:player-seek-forward"); await app.press("id:player-seek-back");
  expect(calls(app, "app.audio.seek").map(call => call.data)).toEqual([{ position: 68 }, { position: 43 }]);
  await app.press("id:player-sleep");
  await app.clear("id:sleep-custom-minutes"); await app.type("id:sleep-custom-minutes", "17");
  await app.press("id:sleep-finish-song"); await app.press("id:sleep-custom-start");
  await app.waitFor("id:app-dialog", { state: "gone" });
  expect(settings(app)).toMatchObject({ sleepMinutes: 17, sleepFinishSong: true });
  await app.press("id:player-sleep"); await app.waitFor("id:sleep-status");
  expect(app.value("id:sleep-custom-minutes")).toBe("17");
});

test("lyric reading controls persist independently and the tap setting governs native seeking", async () => {
  const app = await open("../App.tsx", { width: 1440, height: 1500, platform: "android", network, host: { handlers }, storage });
  await app.waitFor("id:nav-settings"); await app.press("id:nav-settings"); await app.press("id:page-settings >> label:歌词");
  await app.press("id:lyric-tap-seek"); await app.press("id:lyric-auto-scroll");
  await app.press("id:active-lyric-align-left"); await app.press("id:lyric-spacing-2"); await app.press("label:右对齐");
  expect(settings(app)).toMatchObject({ lyricTapToSeek: false, lyricAutoScroll: false, activeLyricAlignment: "left", lyricLineSpacing: 2, lyricAlignment: "right" });
  await app.press("id:open-player"); await app.press("id:player-tab-lyrics"); await app.waitFor("id:lyric-line-0");
  expect(app.enabled("id:lyric-line-0")).toBe(false);
  expect(app.shows("text:逐行同步 · 点按歌词跳转")).toBe(false);
  await app.press("id:close-player"); await app.waitFor("id:full-player", { state: "gone" });
  await app.press("id:lyric-tap-seek"); await app.press("id:open-player"); await app.press("id:player-tab-lyrics");
  await app.waitFor("text:逐行同步 · 点按歌词跳转"); await app.press("id:lyric-line-0");
  expect(calls(app, "app.audio.seek").at(-1)?.data).toEqual({ position: 0.5 });
});

test("queue range selection saves repeated songs in order and removes only the selected occurrences", async () => {
  const app = await open("../App.tsx", { width: 420, height: 940, platform: "android", host: { handlers }, network, storage: {
    ...storage, "metrolist.library": JSON.stringify({ version: 2, tracks, history: [], likedIds: [], playlists: [{ id: "saved", name: "Queue picks", tracks: [], createdAt: 1, updatedAt: 1 }] }),
  } });
  await app.waitFor("id:mini-player"); await app.press("id:mini-queue"); await app.waitFor("id:queue-panel");
  await app.longPress("id:queue-row-0 >> id:play-track-experience-alpha");
  await app.longPress("id:queue-row-2 >> id:play-track-experience-alpha");
  await app.waitFor("text:已选择 3 首");
  await app.press("id:selection-playlist"); await app.press("id:app-dialog >> label:Queue picks");
  const saved = () => JSON.parse(app.storage()["metrolist.library"]);
  await app.waitUntil(() => saved().playlists[0].tracks.length === 3);
  expect(saved().playlists[0].tracks.map((track: { id: string }) => track.id)).toEqual([alpha.id, beta.id, alpha.id]);
  await app.press("id:queue-row-2 >> id:play-track-experience-alpha");
  await app.waitFor("text:已选择 2 首");
  const opens = calls(app, "app.audio.open").length;
  await app.press("id:selection-actions"); await app.press("id:selection-remove");
  await app.waitUntil(() => player(app).queue.length === 2);
  expect(player(app).queue.map((track: { id: string }) => track.id)).toEqual([alpha.id, gamma.id]);
  expect(player(app)).toMatchObject({ index: 0, position: 43 });
  expect(calls(app, "app.audio.open")).toHaveLength(opens);
});

test("removing a range containing the active song opens its surviving successor exactly once", async () => {
  const app = await open("../App.tsx", { width: 420, height: 940, platform: "android", host: { handlers }, network, storage });
  await app.waitFor("id:mini-player"); await app.press("id:mini-queue"); await app.waitFor("id:queue-panel");
  await app.press("id:queue-actions"); await app.waitFor("id:queue-select"); await app.press("id:queue-select");
  await app.press("id:queue-row-1 >> id:play-track-experience-beta");
  await app.press("id:queue-row-2 >> id:play-track-experience-alpha");
  const opens = calls(app, "app.audio.open").length;
  await app.press("id:selection-actions"); await app.press("id:selection-remove");
  await app.waitUntil(() => calls(app, "app.audio.open").length > opens);
  expect(calls(app, "app.audio.open")).toHaveLength(opens + 1);
  expect(player(app)).toMatchObject({ queue: [{ id: alpha.id }, { id: gamma.id }], index: 1, position: 0 });
});

test("queue select-all downloads and likes each distinct song once", async () => {
  const app = await open("../App.tsx", { width: 420, height: 940, platform: "android", storage, network, host: { handlers: {
    ...handlers, "files.download": { destination: "fixture", url: "file:///fixture", bytes: 300 },
  } } });
  await app.waitFor("id:mini-player"); await app.press("id:mini-queue"); await app.waitFor("id:queue-panel");
  await app.press("id:queue-actions"); await app.waitFor("id:queue-select"); await app.press("id:queue-select");
  await app.press("id:selection-all"); await app.waitFor("text:已选择 4 首");
  await app.press("id:selection-download");
  await app.waitUntil(() => calls(app, "files.download").length === 3);
  expect(calls(app, "files.download").map(call => (call.data as { id: string }).id).sort()).toEqual([alpha.id, beta.id, gamma.id].sort());
  await app.press("id:selection-actions"); await app.press("id:selection-like");
  await app.waitFor("text:已选择 0 首");
  expect(JSON.parse(app.storage()["metrolist.library"]).likedIds.sort()).toEqual([alpha.id, beta.id, gamma.id].sort());
});

test("queue edit lock persists, and unlocking allows the current occurrence to move without restarting", async () => {
  let app = await open("../App.tsx", { width: 420, height: 940, platform: "android", host: { handlers }, network, storage });
  await app.waitFor("id:mini-player"); await app.press("id:mini-queue"); await app.waitFor("id:queue-panel");
  expect(app.texts()).toContain("总时长 12:00");
  await app.press("id:queue-actions"); await app.press("id:queue-lock");
  await app.waitUntil(() => settings(app).queueLocked === true);
  await app.press("id:queue-song-menu-2"); await app.waitFor("id:queue-top-2");
  expect(app.enabled("id:queue-top-2")).toBe(false);
  app = await open("../App.tsx", { width: 420, height: 940, platform: "android", host: { handlers }, network, storage: app.storage() });
  await app.waitFor("id:mini-player"); await app.press("id:mini-queue"); await app.waitFor("id:queue-panel");
  await app.press("id:queue-actions"); await app.press("id:queue-lock");
  await app.waitUntil(() => !settings(app).queueLocked);
  const opened = calls(app, "app.audio.open").length;
  await app.press("id:queue-song-menu-2"); await app.press("id:queue-top-2");
  await app.waitUntil(() => player(app).index === 0);
  await app.press("id:queue-song-menu-0"); await app.press("id:queue-bottom-0");
  await app.waitUntil(() => player(app).index === 3);
  expect(player(app)).toMatchObject({ position: 43, queue: [alpha, beta, gamma, alpha] });
  expect(calls(app, "app.audio.open")).toHaveLength(opened);
});

test("queue block moves preserve display order and playback starts at the first selected occurrence in place", async () => {
  const app = await open("../App.tsx", { width: 420, height: 940, platform: "android", host: { handlers }, network, storage });
  await app.waitFor("id:mini-player"); await app.press("id:mini-queue"); await app.waitFor("id:queue-panel");
  const opened = calls(app, "app.audio.open").length;
  await app.longPress("id:queue-row-1 >> id:play-track-experience-beta");
  await app.press("id:queue-row-3 >> id:play-track-experience-gamma");
  await app.press("id:selection-actions"); await app.press("id:selection-move-start");
  await app.waitUntil(() => player(app).index === 3);
  expect(player(app)).toMatchObject({ position: 43, queue: [beta, gamma, alpha, alpha] });
  expect(calls(app, "app.audio.open")).toHaveLength(opened);
  await app.longPress("id:queue-row-2 >> id:play-track-experience-alpha");
  await app.press("id:queue-row-0 >> id:play-track-experience-beta");
  await app.press("id:selection-play");
  await app.waitUntil(() => player(app).index === 0);
  expect(player(app).queue).toHaveLength(4);
  expect(calls(app, "app.audio.open")).toHaveLength(opened + 1);
});
