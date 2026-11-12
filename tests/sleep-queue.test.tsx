import { expect, open, test } from "nsh/test";
import type { App } from "nsh/test";
import type { NativeAudioState } from "../src/playback";

const fixture = "./sleep-queue-fixture.tsx";
const read = (app: App) => JSON.parse(app.texts().find(text => text.startsWith("state:"))!.slice(6));
const nativeState = (requestId: number, patch: Partial<NativeAudioState> = {}): NativeAudioState => ({
  requestId, state: "playing", position: 0, duration: 300, bufferedPosition: 300,
  playing: true, buffering: false, playWhenReady: true, ...patch,
});

test("sleep timer counts down, pauses once at its deadline and retains the current queue", async () => {
  const app = await open(fixture, { platform: "linux", clock: {} });
  await app.press("Start"); await app.waitFor("playing");
  await app.press("Sleep one minute");
  expect(read(app)).toMatchObject({ sleepActive: true, sleepRemaining: 60, sleepAfterTrack: false });
  await app.clock!.fastForward(30000);
  expect(read(app)).toMatchObject({ playing: true, sleepRemaining: 30 });
  await app.clock!.fastForward(30001);
  expect(read(app)).toMatchObject({ playing: false, ids: ["alpha", "beta", "alpha"], index: 0, sleepActive: false, sleepRemaining: 0, sleepUntil: null });
  expect(app.audio().filter(call => call.command === "pause")).toHaveLength(1);
  await app.clock!.fastForward(60000);
  expect(app.audio().filter(call => call.command === "pause")).toHaveLength(1);
});

test("end-of-song sleep replaces elapsed time and stops before repeat-one", async () => {
  const app = await open(fixture, { platform: "linux", clock: {} });
  await app.press("Start"); await app.press("Repeat one");
  await app.press("Sleep one minute"); await app.clock!.fastForward(10000);
  await app.press("Sleep after song"); await app.clock!.fastForward(60001);
  expect(read(app)).toMatchObject({ playing: true, sleepAfterTrack: true, sleepUntil: null, sleepRemaining: 0 });
  await app.endAudio();
  expect(read(app)).toMatchObject({ playing: false, index: 0, sleepActive: false });
  expect(app.audio().filter(call => call.command === "open")).toHaveLength(1);
  await app.press("Resume");
  expect(read(app)).toMatchObject({ playing: true, index: 0, position: 0 });
  expect(app.audio().some(call => call.command === "seek" && call.position === 0)).toBe(true);
});

test("sleep after song stops before automatic radio and remains armed when manually skipping", async () => {
  const app = await open(fixture, { platform: "linux" });
  await app.press("Start"); await app.press("Sleep after song");
  await app.press("Auto radio"); await app.press("Next");
  expect(read(app)).toMatchObject({ playing: true, index: 1, sleepAfterTrack: true, radioCalls: 0 });
  await app.endAudio();
  expect(read(app)).toMatchObject({ playing: false, index: 1, sleepActive: false, radioCalls: 0 });
});

test("switching to elapsed sleep, canceling and clearing the queue remove old timer callbacks", async () => {
  const app = await open(fixture, { platform: "linux", clock: {} });
  await app.press("Start"); await app.press("Sleep after song"); await app.press("Sleep one minute");
  expect(read(app)).toMatchObject({ sleepAfterTrack: false, sleepRemaining: 60 });
  await app.press("Cancel sleep"); await app.clock!.fastForward(60001);
  expect(read(app)).toMatchObject({ playing: true, sleepActive: false });
  await app.press("Sleep one minute"); await app.press("Cancel with zero"); await app.clock!.fastForward(60001);
  expect(read(app)).toMatchObject({ playing: true, sleepActive: false });
  await app.press("Sleep one minute"); await app.press("Clear queue");
  expect(read(app)).toMatchObject({ sleepActive: false, sleepUntil: null, sleepRemaining: 0 });
  await app.press("Start"); await app.clock!.fastForward(60001);
  expect(read(app).playing).toBe(true);
});

test("Android end-of-song sleep pauses the native engine before repeat and can resume from the beginning", async () => {
  const app = await open(fixture, { platform: "android", host: { handlers: {
    "app.audio.settings": null, "app.audio.open": null, "app.audio.play": null,
    "app.audio.pause": null, "app.audio.seek": null, "app.audio.cancelPreload": null, "app.audio.preload": null,
  } } });
  await app.press("Start");
  const opened = app.host.calls().find(call => call.name === "app.audio.open")!.data as { requestId: number };
  await app.host.send("audio.state", nativeState(opened.requestId));
  await app.press("Repeat one"); await app.press("Sleep after song");
  await app.host.send("audio.state", nativeState(opened.requestId, { state: "ended", playing: false, position: 300 }));
  expect(read(app)).toMatchObject({ playing: false, index: 0, sleepActive: false });
  expect(app.host.calls().filter(call => call.name === "app.audio.open")).toHaveLength(1);
  expect(app.host.calls().filter(call => call.name === "app.audio.pause")).toHaveLength(1);
  await app.press("Resume");
  expect(app.host.calls().filter(call => call.name === "app.audio.seek").map(call => call.data)).toEqual([{ position: 0 }]);
  expect(app.host.calls().filter(call => call.name === "app.audio.play")).toHaveLength(1);
});

test("batch append preserves song occurrences and the active audio with one queue update", async () => {
  const app = await open(fixture, { platform: "linux" });
  await app.press("Start"); await app.press("Next"); await app.press("Reset changes");
  const opened = app.audio().filter(call => call.command === "open").length;
  await app.press("Append batch");
  expect(read(app)).toMatchObject({ ids: ["alpha", "beta", "alpha", "gamma", "delta", "gamma"], index: 1, playing: true, changes: 1 });
  expect(app.audio().filter(call => call.command === "open")).toHaveLength(opened);
});

test("play-next batch preserves order and duplicate occurrences with shuffle and backward navigation", async () => {
  const app = await open(fixture, { platform: "linux" });
  await app.press("Start"); await app.press("Shuffle"); await app.press("Reset changes");
  await app.press("Play batch next");
  expect(read(app)).toMatchObject({ ids: ["alpha", "gamma", "delta", "gamma", "beta", "alpha"], index: 0, next: "gamma", changes: 1 });
  await app.press("Next"); expect(read(app).index).toBe(1);
  await app.press("Next"); expect(read(app).index).toBe(2);
  await app.press("Previous"); expect(read(app).index).toBe(1);
  await app.press("Next"); expect(read(app).index).toBe(2);
  await app.press("Next"); expect(read(app).index).toBe(3);
  await app.press("Next");
  const remaining = read(app).index;
  expect([4, 5].includes(remaining)).toBe(true);
  await app.press("Next");
  expect(read(app).index).toBe(remaining === 4 ? 5 : 4);
});

test("a play-next batch initializes an empty queue and plays its selected order even with shuffle", async () => {
  const app = await open(fixture, { platform: "linux" });
  await app.press("Shuffle"); await app.press("Play batch next");
  expect(read(app)).toMatchObject({ ids: ["gamma", "delta", "gamma"], index: 0, playing: false, changes: 1 });
  expect(app.audio()).toHaveLength(0);
  await app.press("Resume"); await app.press("Next"); expect(read(app).index).toBe(1);
  await app.press("Next"); expect(read(app).index).toBe(2);
});

test("moving a duplicate to next keeps the current source and remaps a preceding row correctly", async () => {
  const app = await open(fixture, { platform: "linux" });
  await app.press("Start"); await app.press("Shuffle"); await app.press("Seek 42"); await app.press("Reset changes");
  await app.press("Move third next");
  expect(read(app)).toMatchObject({ ids: ["alpha", "alpha", "beta"], index: 0, position: 42, next: "alpha", changes: 1 });
  expect(app.audio().filter(call => call.command === "open")).toHaveLength(1);
  await app.press("Next"); expect(read(app).index).toBe(1);
  await app.press("Seek 42"); await app.press("Reset changes"); await app.press("Move first next");
  expect(read(app)).toMatchObject({ ids: ["alpha", "alpha", "beta"], index: 0, position: 42, next: "alpha", changes: 1 });
  expect(app.audio().filter(call => call.command === "open")).toHaveLength(2);
  await app.press("Next"); expect(read(app).index).toBe(1);
});

test("moving an already adjacent row to next promotes it ahead of the shuffled choice", async () => {
  const app = await open(fixture, { platform: "linux" });
  await app.press("Start"); await app.press("Shuffle"); await app.press("Move third next"); await app.press("Move second last");
  expect(read(app)).toMatchObject({ ids: ["alpha", "beta", "alpha"], index: 0, next: "alpha" });
  await app.press("Reset changes"); await app.press("Move second next");
  expect(read(app)).toMatchObject({ ids: ["alpha", "beta", "alpha"], index: 0, next: "beta", changes: 1 });
  expect(app.audio().filter(call => call.command === "open")).toHaveLength(1);
  await app.press("Next"); expect(read(app).index).toBe(1);
});
