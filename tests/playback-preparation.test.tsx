import { expect, open, test } from "nsh/test";
import type { App } from "nsh/test";

const source = (id: string, quality = "auto") => ({ url: `https://audio.test/${id}-${quality}.webm`, cacheKey: `${id}:251:1000000`,
  mimeType: "audio/webm", headers: { "User-Agent": "source-profile" }, expiresAt: 4102444800000, contentLength: 1000000, duration: 60 });
const network = Object.fromEntries(["first", "second", "third"].flatMap(id => ["auto", "high"].map(quality =>
  [`GET https://gateway.test/api/stream?id=${id}&quality=${quality}*`, { body: source(id, quality) }])));
const handlers = { "app.audio.open": null, "app.audio.play": null, "app.audio.pause": null, "app.audio.seek": null,
  "app.audio.settings": null, "app.audio.preload": null, "app.audio.cancelPreload": null, "app.audio.stop": null };
const fixture = (extraNetwork = {}) => open("./preparation-fixture.tsx", { width: 390, height: 844, platform: "android", clock: {},
  network: { ...network, ...extraNetwork }, host: { handlers } });
const read = (app: App) => JSON.parse(app.texts().find(text => text.startsWith("state:"))!.slice(6));
const calls = (app: App, name: string) => app.host.calls().filter(call => call.name === name);
const requestId = (app: App) => (calls(app, "app.audio.open").slice(-1)[0].data as { requestId: number }).requestId;
const streamRequests = (app: App, id: string) => app.requests().filter(request => request.url.includes(`/api/stream?id=${id}&`));
const play = (app: App, bufferedPosition = 50) => app.host.send("audio.state", { requestId: requestId(app), state: "playing", position: 0,
  duration: 60, bufferedPosition, playing: true, buffering: false, playWhenReady: true });

test("next-track preparation starts after real playback and warms bytes only with twelve seconds already buffered", async () => {
  const app = await fixture();
  await app.press("Start");
  expect(read(app).phase).toBe("buffering");
  expect(streamRequests(app, "second")).toHaveLength(0);
  await play(app, 10);
  await app.waitFor("Next ready");
  expect(streamRequests(app, "second")).toHaveLength(1);
  expect(calls(app, "app.audio.preload")).toHaveLength(0);
  await play(app, 15);
  expect(calls(app, "app.audio.preload")).toHaveLength(1);
  expect(calls(app, "app.audio.preload")[0].data).toMatchObject({ trackId: "second", ...source("second") });
  await app.host.send("audio.preload", { trackId: "second", cacheKey: source("second").cacheKey, cached: true });
  expect(read(app).preparation.state).toBe("cached");
  await play(app, 50);
  expect(calls(app, "app.audio.preload")).toHaveLength(1);
  await app.press("Next");
  expect(streamRequests(app, "second")).toHaveLength(1);
  expect(calls(app, "app.audio.open")).toHaveLength(2);
  expect(read(app).timing).toBe(null);
  await play(app);
  expect(read(app).timing.prepared).toBe(true);
});

test("pressing next during preparation shares its in-flight stream request", async () => {
  const app = await fixture({ "GET https://gateway.test/api/stream?id=second&quality=auto*": { delay: 2000, body: source("second") } });
  await app.press("Start"); await play(app);
  expect(read(app).preparation.state).toBe("resolving");
  await app.press("Next");
  expect(read(app).phase).toBe("resolving");
  await app.clock!.fastForward(2001);
  expect(streamRequests(app, "second")).toHaveLength(1);
  expect(calls(app, "app.audio.open")).toHaveLength(2);
  expect(read(app).index).toBe(1);
});

test("reordering the queue discards stale preparation and clearing upcoming preserves the active source", async () => {
  const app = await fixture({ "GET https://gateway.test/api/stream?id=second&quality=auto*": { delay: 2000, body: source("second") } });
  await app.press("Start"); await play(app);
  await app.press("Reorder next");
  await app.waitFor("Next caching");
  expect(read(app).next).toBe("third");
  await app.clock!.fastForward(2001);
  expect(read(app).preparation.trackId).toBe("third");
  expect(calls(app, "app.audio.preload").map(call => (call.data as { trackId: string }).trackId)).toEqual(["third"]);
  await app.press("Clear upcoming");
  expect(read(app).ids).toEqual(["first"]);
  expect(read(app).playing).toBe(true);
  expect(read(app).preparation).toBe(null);
  expect(calls(app, "app.audio.open")).toHaveLength(1);
  expect(calls(app, "app.audio.stop")).toHaveLength(0);
  expect(calls(app, "app.audio.cancelPreload")).toHaveLength(1);
});

test("an unavailable next song never replaces current playback with an error", async () => {
  const app = await fixture({ "GET https://gateway.test/api/stream?id=second&quality=auto*": { status: 429,
    body: { error: "Rate limited", code: "rate-limited", stage: "player", retryAfterMs: 60000 } } });
  await app.press("Start"); await play(app);
  await app.waitFor("No preparation");
  expect(read(app).playing).toBe(true);
  expect(read(app).error).toBe("");
  await app.press("Next");
  await app.waitFor("error");
  expect(read(app).errorCode).toBe("rate-limited");
});

test("changing quality replaces prepared URLs and retry explicitly refreshes a failed current URL", async () => {
  const app = await fixture();
  await app.press("Start"); await play(app); await app.waitFor("Next caching");
  await app.press("Quality high");
  await play(app); await app.waitFor("Next caching");
  const preloads = calls(app, "app.audio.preload").map(call => (call.data as { url: string }).url);
  expect(preloads).toEqual([source("second").url, source("second", "high").url]);
  await app.press("Next");
  expect(calls(app, "app.audio.open").slice(-1)[0].data).toMatchObject({ url: source("second", "high").url });
  expect(streamRequests(app, "second")).toHaveLength(2);
  await app.host.send("audio.state", { requestId: requestId(app), state: "idle", position: 0, duration: 60, bufferedPosition: 0,
    playing: false, buffering: false, playWhenReady: false, error: "Source failed", errorCode: "network" });
  await app.press("Retry");
  expect(streamRequests(app, "second")).toHaveLength(3);
  expect(streamRequests(app, "second").slice(-1)[0].url.includes("refresh=1")).toBe(true);
  await app.host.send("audio.state", { requestId: requestId(app), state: "idle", position: 0, duration: 60, bufferedPosition: 0,
    playing: false, buffering: false, playWhenReady: false, error: "Source failed again", errorCode: "network" });
  await app.press("Resume");
  expect(streamRequests(app, "second")).toHaveLength(4);
  expect(streamRequests(app, "second").slice(-1)[0].url.includes("refresh=1")).toBe(true);
});

test("startup timing ends on the real native playing event, not on audio.open completion", async () => {
  const app = await fixture({ "GET https://gateway.test/api/stream?id=first&quality=auto*": { delay: 120, body: source("first") } });
  await app.press("Start");
  expect(read(app).phase).toBe("resolving");
  await app.clock!.fastForward(120);
  expect(calls(app, "app.audio.open")).toHaveLength(1);
  expect(read(app).timing).toBe(null);
  await app.clock!.fastForward(750);
  await play(app);
  expect(read(app).timing).toMatchObject({ resolveMs: 120, readyMs: 750, totalMs: 870, prepared: false });
});

test("resuming after a paused queue edit prepares the new next track immediately", async () => {
  const app = await fixture();
  await app.press("Start"); await play(app); await app.waitFor("Next caching");
  await app.press("Pause");
  await app.host.send("audio.state", { requestId: requestId(app), state: "paused", position: 0, duration: 60, bufferedPosition: 50,
    playing: false, buffering: false, playWhenReady: false });
  await app.press("Reorder next");
  expect(read(app).next).toBe("third");
  expect(streamRequests(app, "third")).toHaveLength(0);
  await app.press("Resume"); await play(app); await app.waitFor("Next caching");
  expect(streamRequests(app, "third")).toHaveLength(1);
  expect(read(app).preparation.trackId).toBe("third");
  expect(calls(app, "app.audio.open")).toHaveLength(1);
});
