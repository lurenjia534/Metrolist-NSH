import { expect, open, test } from "nsh/test";
import type { App, StubRequest, StubResponse } from "nsh/test";

const handlers = { "app.audio.open": null, "app.audio.play": null, "app.audio.pause": null, "app.audio.seek": null,
  "app.audio.settings": null, "app.audio.preload": null, "app.audio.cancelPreload": null, "app.audio.stop": null,
  "app.metadata": null, "app.playback": null };
/** The gateway signs a new URL for every resolution of a song, as a refreshed resolution does. */
function gateway(extra: Record<string, StubResponse> = {}) {
  const versions: Record<string, number> = {};
  return {
    "GET https://gateway.test/api/stream?*": (request: StubRequest): StubResponse => {
      const id = new URL(request.url).searchParams.get("id")!;
      const version = versions[id] = (versions[id] ?? 0) + 1;
      return { body: { url: `https://audio.test/${id}.webm?v=${version}`, cacheKey: `${id}:251:1000000`, mimeType: "audio/webm",
        headers: { "User-Agent": "source-profile" }, expiresAt: 4102444800000, contentLength: 1000000, duration: 240 } };
    },
    ...extra,
  };
}
const android = () => open("./stream-recovery-fixture.tsx", { width: 390, height: 844, platform: "android", clock: {}, network: gateway(), host: { handlers } });

const read = (app: App) => JSON.parse(app.texts().find(text => text.startsWith("state:"))!.slice(6));
const opens = (app: App) => app.host.calls().filter(call => call.name === "app.audio.open")
  .map(call => call.data as { requestId: number; url: string; position: number; playWhenReady: boolean });
const streams = (app: App, id = "first") => app.requests().filter(request => request.url.includes(`/api/stream?id=${id}&`)).map(request => request.url);
const state = (app: App, fields: Record<string, unknown>) => app.host.send("audio.state", { requestId: opens(app).slice(-1)[0].requestId,
  state: "playing", position: 0, duration: 240, bufferedPosition: 60, playing: true, buffering: false, playWhenReady: true, ...fields });
/** MetrolistAudio.onPlayerError: the engine stops, then publishes its failed state on every event that follows. */
const reject = (app: App, position: number, errorCode = "http-403") => state(app, { state: "paused", position, playing: false, playWhenReady: false,
  error: errorCode === "rate-limited" ? "音频数据请求过于频繁（HTTP 429）。请稍后重试。" : `音频数据请求失败（HTTP ${errorCode.slice(5)}）。`, errorCode });
async function recovered(app: App, count: number) {
  await app.clock!.fastForward(1000);
  await app.waitUntil(() => opens(app).length === count);
}

test("a CDN rejection mid-song resolves the stream again and resumes where it stopped", async () => {
  const app = await android();
  await app.press("Start");
  await state(app, { position: 95.5 });
  expect(read(app)).toMatchObject({ playing: true, position: 95.5 });
  await reject(app, 96.25);
  await reject(app, 96.25);
  expect(read(app)).toMatchObject({ playing: false, buffering: true, phase: "buffering", error: "", errorCode: "" });
  await app.clock!.fastForward(999);
  expect(streams(app)).toHaveLength(1);
  await recovered(app, 2);
  expect(streams(app)).toHaveLength(2);
  expect(streams(app)[1]).toContain("refresh=1");
  expect(opens(app)[1]).toMatchObject({ url: "https://audio.test/first.webm?v=2", position: 96.25, playWhenReady: true });
  await state(app, { position: 96.25 });
  expect(read(app)).toMatchObject({ id: "first", playing: true, position: 96.25, phase: "playing", error: "" });
  await app.clock!.fastForward(5000);
  expect(opens(app)).toHaveLength(2);
});

test("a song gets three attempts until it plays again; the next rejection is reported", async () => {
  const app = await android();
  await app.press("Start");
  // Rejections that each end in playback never run out.
  for (let count = 2; count <= 4; count++) {
    await state(app, { position: 20 * count });
    await reject(app, 20 * count + 1);
    expect(read(app).error).toBe("");
    await recovered(app, count);
  }
  // Without playback in between, a song gets three attempts.
  await state(app, { position: 100 });
  for (let count = 5; count <= 7; count++) {
    await reject(app, 101, count === 6 ? "http-410" : "http-403");
    expect(read(app).error).toBe("");
    await recovered(app, count);
    expect(opens(app)[count - 1]).toMatchObject({ position: 101, url: `https://audio.test/first.webm?v=${count}`, playWhenReady: true });
  }
  await reject(app, 101);
  expect(read(app)).toMatchObject({ playing: false, buffering: false, phase: "error", position: 101,
    error: "音频数据请求失败（HTTP 403）。", errorCode: "http-403" });
  await app.clock!.fastForward(5000);
  expect(opens(app)).toHaveLength(7);
  expect(streams(app)).toHaveLength(7);
  expect(streams(app).slice(1).every(url => url.includes("refresh=1"))).toBe(true);
  // The error's retry starts the song's attempts again.
  await app.press("Retry");
  await app.waitUntil(() => opens(app).length === 8);
  await reject(app, 101);
  expect(read(app).error).toBe("");
  await recovered(app, 9);
});

test("an HTTP 429 from the CDN is still reported without resolving the stream again", async () => {
  const app = await android();
  await app.press("Start");
  await state(app, { position: 40 });
  await reject(app, 40, "rate-limited");
  expect(read(app)).toMatchObject({ playing: false, phase: "error", errorCode: "rate-limited", error: "音频数据请求过于频繁（HTTP 429）。请稍后重试。" });
  await app.clock!.fastForward(5000);
  expect(streams(app)).toHaveLength(1);
  expect(opens(app)).toHaveLength(1);
});

test("a source rejected while paused is resolved again without starting playback", async () => {
  const app = await android();
  await app.press("Start");
  await state(app, { position: 50 });
  await app.press("Pause");
  await state(app, { state: "paused", position: 50, playing: false, playWhenReady: false });
  await app.press("Seek 90");
  await reject(app, 90);
  expect(read(app)).toMatchObject({ playing: false, buffering: false, phase: "paused", error: "" });
  await recovered(app, 2);
  expect(opens(app)[1]).toMatchObject({ url: "https://audio.test/first.webm?v=2", position: 90, playWhenReady: false });
  expect(read(app)).toMatchObject({ playing: false, buffering: false, error: "" });
});

test("changing track while a rejected source waits drops its recovery", async () => {
  const app = await android();
  await app.press("Start");
  await state(app, { position: 10 });
  await reject(app, 12);
  await app.press("Next");
  await app.waitUntil(() => opens(app).length === 2);
  await app.clock!.fastForward(5000);
  expect(read(app)).toMatchObject({ id: "second", error: "" });
  expect(streams(app)).toHaveLength(1);
  expect(opens(app).map(item => item.url)).toEqual(["https://audio.test/first.webm?v=1", "https://audio.test/second.webm?v=1"]);
});

const player = (platform: "web" | "linux", url: string) => platform === "web" ? url : `http://127.0.0.1:49321/media/${encodeURIComponent(url)}`;
const playerOpens = (app: App) => app.audio().filter(call => call.command === "open").map(call => call.src);
const probes = (app: App) => app.requests().filter(request => request.url === "https://audio.test/first.webm?v=1");

for (const platform of ["web", "linux"] as const) {
  test(`${platform}: a player whose source the CDN now rejects is resolved again at the same position`, async () => {
    const app = await open("./stream-recovery-fixture.tsx", { width: 390, height: 844, platform, clock: {},
      network: gateway({ "GET https://audio.test/first.webm?v=1": { status: 403, body: "Forbidden" } }), host: { handlers } });
    await app.press("Start");
    await app.waitFor("playing");
    await app.press("Seek 90");
    const at = read(app).position;
    await app.press("Fail player");
    await app.waitUntil(() => probes(app).length === 1);
    // The source itself, with its headers: the relay would answer from what it already read.
    expect(probes(app)[0].headers).toMatchObject({ range: "bytes=0-0", "user-agent": "source-profile" });
    expect(read(app)).toMatchObject({ error: "", phase: "buffering" });
    await app.clock!.fastForward(1000);
    await app.waitUntil(() => playerOpens(app).length === 2);
    expect(playerOpens(app)).toEqual([player(platform, "https://audio.test/first.webm?v=1"), player(platform, "https://audio.test/first.webm?v=2")]);
    expect(app.audio().filter(call => call.command === "seek").slice(-1)[0]).toMatchObject({ src: playerOpens(app)[1], position: at });
    expect(streams(app)[1]).toContain("refresh=1");
    await app.waitFor("playing");
    expect(read(app)).toMatchObject({ id: "first", playing: true, error: "" });
  });

  test(`${platform}: a player failure the CDN does not reject (HTTP 429) is reported without resolving again`, async () => {
    const app = await open("./stream-recovery-fixture.tsx", { width: 390, height: 844, platform, clock: {},
      network: gateway({ "GET https://audio.test/first.webm?v=1": { status: 429, body: "Too many requests" } }), host: { handlers } });
    await app.press("Start");
    await app.waitFor("playing");
    await app.press("Fail player");
    await app.waitFor("error");
    expect(probes(app)).toHaveLength(1);
    expect(read(app)).toMatchObject({ playing: false, errorCode: "network", error: "The player lost its source" });
    await app.clock!.fastForward(5000);
    expect(streams(app)).toHaveLength(1);
    expect(playerOpens(app)).toHaveLength(1);
  });
}
