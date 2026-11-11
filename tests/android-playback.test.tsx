import { expect, open, test } from "nsh/test";
import type { App } from "nsh/test";
import type { NativeAudioState } from "../src/playback";

const video = { id: "video", title: "Video song", artist: "Online artist", album: "Album", artwork: "", duration: 60, source: "youtube" as const };
const storage = { "metrolist.settings": JSON.stringify({ apiBase: "https://gateway.test", autoRadio: false }) };
const stream = { url: "https://audio.test/video.webm?signature=fixture", headers: { "User-Agent": "fixture-profile", Origin: "https://music.youtube.com" },
  mimeType: "audio/webm", formatId: "251", cacheKey: "video:251:1000", contentLength: 1000, expiresAt: 1800000000000, quality: "auto" };
const network = {
  "GET https://gateway.test/api/home": { body: { sections: [] } },
  "GET https://gateway.test/api/lyrics?*": { body: { plainLyrics: "Line", syncedLyrics: "", lines: [], instrumental: false } },
  "GET https://gateway.test/api/stream?id=video&quality=auto*": { body: stream },
};
const handlers = {
  "app.audio.snapshot": null, "app.audio.open": null, "app.audio.play": null, "app.audio.pause": null,
  "app.audio.seek": null, "app.audio.settings": null, "app.audio.stop": null,
  // Record these old bridge calls so the tests can prove that native events never echo them back.
  "app.metadata": null, "app.playback": null,
};
const fixture = () => open("./runtime-fixture.tsx", { width: 390, height: 844, platform: "android", storage, network, host: { handlers } });
const read = (app: App) => JSON.parse(app.texts().find(text => text.startsWith("queue:"))!.slice(6));
const calls = (app: App, name: string) => app.host.calls().filter(call => call.name === name);
const opened = (app: App) => calls(app, "app.audio.open").map(call => call.data as { requestId: number; url: string });
const state = (requestId: number, patch: Partial<NativeAudioState> = {}): NativeAudioState => ({
  requestId, state: "playing", position: 0, duration: 60, bufferedPosition: 50,
  playing: true, buffering: false, playWhenReady: true, ...patch,
});

test("Android starts the service engine with source headers and format cache identity; open is not proof of playback", async () => {
  const app = await fixture();
  await app.press("Start video");
  expect(app.audio()).toHaveLength(0);
  expect(opened(app)).toHaveLength(1);
  expect(calls(app, "app.audio.open")[0].data).toMatchObject({
    track: video, url: stream.url, headers: stream.headers, cacheKey: stream.cacheKey,
    mimeType: "audio/webm", formatId: "251", expiresAt: stream.expiresAt,
    position: 0, volume: 0.7, rate: 1, playWhenReady: true,
  });
  expect(app.requests().find(request => request.url.includes("/api/stream"))!.url).toBe("https://gateway.test/api/stream?id=video&quality=auto");
  expect(read(app)).toMatchObject({ playing: false, buffering: true });
  await app.host.send("audio.state", state(opened(app)[0].requestId));
  expect(read(app)).toMatchObject({ playing: true, buffering: false, buffered: 50 });
  for (const position of [0.25, 0.5, 0.75, 1]) await app.host.send("audio.state", state(opened(app)[0].requestId, { position }));
  expect(read(app).position).toBe(1);
  expect(calls(app, "app.playback")).toHaveLength(0);
  expect(calls(app, "app.metadata")).toHaveLength(0);
  expect(calls(app, "app.audio.seek")).toHaveLength(0);
});

test("pausing a buffering Android source preserves its prepared media and resumes without resolving or opening again", async () => {
  const app = await fixture();
  await app.press("Start video");
  const id = opened(app)[0].requestId;
  await app.host.send("audio.state", state(id, { state: "loading", playing: false, buffering: true, bufferedPosition: 1 }));
  await app.press("Pause");
  expect(calls(app, "app.audio.pause")).toHaveLength(1);
  expect(calls(app, "app.audio.stop")).toHaveLength(0);
  expect(read(app)).toMatchObject({ playing: false, buffering: false });
  await app.host.send("audio.state", state(id, { state: "paused", playing: false, playWhenReady: false, bufferedPosition: 35 }));
  await app.press("Play");
  expect(calls(app, "app.audio.play")).toHaveLength(1);
  expect(opened(app)).toHaveLength(1);
  expect(app.requests().filter(request => request.url.includes("/api/stream"))).toHaveLength(1);
  expect(read(app).playing).toBe(false);
  await app.host.send("audio.state", state(id, { position: 2, bufferedPosition: 52 }));
  expect(read(app)).toMatchObject({ playing: true, position: 2, buffered: 52 });
});

test("native system pause and seek update the UI without command feedback, and explicit seek sends only its requested position", async () => {
  const app = await fixture();
  await app.press("Start video");
  const id = opened(app)[0].requestId;
  await app.host.send("audio.state", state(id));
  await app.host.send("audio.state", state(id, { position: 31 }));
  await app.host.send("audio.state", state(id, { position: 45, discontinuity: true }));
  await app.host.send("audio.state", state(id, { position: 45, state: "paused", playing: false, playWhenReady: false }));
  expect(read(app)).toMatchObject({ playing: false, position: 45 });
  expect(JSON.parse(app.storage()["metrolist.library"]).listenEvents[0].seconds).toBe(31);
  expect(calls(app, "app.audio.pause")).toHaveLength(0);
  expect(calls(app, "app.audio.seek")).toHaveLength(0);
  await app.press("Seek 21");
  expect(calls(app, "app.audio.seek").map(call => call.data)).toEqual([{ position: 21 }]);
});

test("Android advances through the existing service, ignores the old source's late events and stops only when the queue is cleared", async () => {
  const app = await fixture();
  await app.press("Start local");
  const first = opened(app)[0].requestId;
  await app.host.send("audio.state", state(first));
  await app.host.send("audio.state", state(first, { state: "ended", playing: false, position: 60 }));
  expect(opened(app)).toHaveLength(2);
  expect(calls(app, "app.audio.stop")).toHaveLength(0);
  expect(read(app)).toMatchObject({ index: 1, position: 0 });
  const second = opened(app)[1].requestId;
  await app.host.send("audio.state", state(second, { position: 3 }));
  await app.host.send("audio.state", state(first, { position: 59, error: "Obsolete source failure", errorCode: "network" }));
  expect(read(app)).toMatchObject({ index: 1, position: 3, playing: true, error: "" });
  await app.press("Clear queue");
  expect(calls(app, "app.audio.stop")).toHaveLength(1);
  expect(read(app)).toMatchObject({ ids: [], playing: false, position: 0, buffered: 0 });
});

test("Android recreates its UI around the service's actual track and position without restarting or seeking the audio", async () => {
  const app = await open("./runtime-fixture.tsx", { width: 390, height: 844, platform: "android", network,
    storage: { ...storage, "metrolist.player": JSON.stringify({ queue: [video], index: 0, position: 7, title: "Saved queue" }) },
    host: { handlers: { ...handlers, "app.audio.snapshot": state(77, { track: video, source: stream, position: 43, bufferedPosition: 60, volume: 0.6, rate: 1.25 }) } },
  });
  expect(read(app)).toMatchObject({ ids: ["video"], index: 0, playing: true, position: 43, buffered: 60 });
  expect(opened(app)).toHaveLength(0);
  expect(calls(app, "app.audio.seek")).toHaveLength(0);
  expect(calls(app, "app.audio.stop")).toHaveLength(0);
  expect(app.audio()).toHaveLength(0);
  expect(app.requests().filter(request => request.url.includes("/api/stream"))).toHaveLength(0);
  await app.host.send("audio.state", state(77, { position: 44 }));
  expect(read(app).position).toBe(44);
  await app.press("Pause");
  expect(calls(app, "app.audio.pause")).toHaveLength(1);
});

test("native playback errors are surfaced and the retry replaces only the failed source", async () => {
  const app = await fixture();
  await app.press("Start video");
  await app.host.send("audio.state", state(opened(app)[0].requestId, { state: "idle", playing: false, playWhenReady: false, error: "Source HTTP 403", errorCode: "network" }));
  expect(read(app)).toMatchObject({ playing: false, buffering: false, error: "Source HTTP 403", errorCode: "network" });
  await app.press("Retry playback");
  expect(opened(app)).toHaveLength(2);
  expect(calls(app, "app.audio.stop")).toHaveLength(0);
  await app.host.send("audio.state", state(opened(app)[1].requestId));
  expect(read(app)).toMatchObject({ playing: true, error: "", errorCode: "" });
});

test("a system stop detaches the released native source so the saved queue can play again", async () => {
  const app = await fixture();
  await app.press("Start video");
  const id = opened(app)[0].requestId;
  await app.host.send("audio.state", state(id, { position: 12 }));
  await app.host.send("audio.state", state(id, { state: "idle", playing: false, playWhenReady: false, position: 0, bufferedPosition: 0 }));
  expect(read(app)).toMatchObject({ ids: ["video"], position: 0, playing: false, buffered: 0 });
  expect(calls(app, "app.audio.pause")).toHaveLength(0);
  await app.press("Play");
  expect(opened(app)).toHaveLength(2);
  expect(calls(app, "app.audio.play")).toHaveLength(0);
  await app.host.send("audio.state", state(opened(app)[1].requestId));
  expect(read(app).playing).toBe(true);
});
