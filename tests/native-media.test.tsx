import { expect, open, test } from "nsh/test";
import type { App } from "nsh/test";
import { mediaFile } from "./local-media/files";

const headers = { "User-Agent": "native-source-profile", Origin: "https://music.youtube.com", Referer: "https://music.youtube.com/" };
const relay = (id: string) => ({ id, url: `http://127.0.0.1:49321/audio/${id}` });
const prepareCalls = (app: App) => app.host.calls().filter(call => call.name === "app.test.media.prepare").map(call => call.data);
const releaseCalls = (app: App) => app.host.calls().filter(call => call.name === "app.test.media.release").map(call => call.data);

test("desktop native media forwards signed source headers and releases the relay on replacement and stop", async () => {
  let prepared = 0;
  const app = await open("./native-media-fixture.tsx", { platform: "linux", host: { handlers: {
    "app.test.media.prepare": () => relay(`media-${++prepared}`),
    "app.test.media.release": null,
  } } });
  await app.press("Play signed"); await app.waitFor("playing");
  expect(prepareCalls(app)).toEqual([{ url: "https://audio.test/signed.m4a?signature=fixture", headers }]);
  expect(app.audio().filter(call => call.command === "open").map(call => call.src)).toEqual([relay("media-1").url]);
  await app.press("Play replacement"); await app.waitFor("playing");
  await app.waitUntil(() => releaseCalls(app).length === 1);
  expect(releaseCalls(app)).toEqual([{ id: "media-1" }]);
  expect(prepareCalls(app)[1]).toEqual({ url: "https://audio.test/replacement.m4a?signature=fixture", headers });
  expect(app.audio().filter(call => call.command === "close").map(call => call.src)).toEqual([relay("media-1").url]);
  await app.press("Clear");
  await app.waitUntil(() => releaseCalls(app).length === 2);
  expect(releaseCalls(app)).toEqual([{ id: "media-1" }, { id: "media-2" }]);
  expect(app.audio().filter(call => call.command === "close").map(call => call.src)).toEqual([relay("media-1").url, relay("media-2").url]);
});

test("a native relay resolved after switching tracks is released without starting stale audio", async () => {
  let prepared = 0;
  const app = await open("./native-media-fixture.tsx", { platform: "macos", host: { handlers: {
    "app.test.media.prepare": () => relay(++prepared === 1 ? "stale" : "current"),
    "app.test.media.release": null,
  } } });
  await app.press("Delay preparation"); await app.press("Play signed"); await app.waitFor("Waiting for relay");
  expect(prepareCalls(app)).toHaveLength(1);
  expect(app.audio()).toHaveLength(0);
  await app.press("Play replacement"); await app.waitFor("playing");
  await app.press("Complete preparation");
  await app.waitUntil(() => releaseCalls(app).length === 1);
  expect(releaseCalls(app)).toEqual([{ id: "stale" }]);
  expect(app.audio().filter(call => call.command === "open").map(call => call.src)).toEqual([relay("current").url]);
  await app.press("Clear"); await app.waitUntil(() => releaseCalls(app).length === 2);
  expect(releaseCalls(app)).toEqual([{ id: "stale" }, { id: "current" }]);
});

test("local files play directly; headerless HTTP sources also stream through the range relay", async () => {
  const app = await open("../.nsh/local-media/native-media.tsx", { platform: "windows", host: { handlers: {
    "app.test.media.prepare": relay("direct"),
    "app.test.media.release": null,
  } } });
  await app.press("Play local"); await app.waitFor("playing");
  await app.press("Play direct"); await app.waitFor("playing");
  await app.press("Clear");
  expect(prepareCalls(app)).toEqual([{ url: "https://audio.test/direct.mp3", headers: {} }]);
  expect(releaseCalls(app)).toEqual([{ id: "direct" }]);
  expect(app.audio().filter(call => call.command === "open").map(call => call.src)).toEqual([mediaFile("offline.wav").url, relay("direct").url]);
});
