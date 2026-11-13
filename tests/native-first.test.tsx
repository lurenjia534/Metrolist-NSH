import { expect, open, test } from "nsh/test";
import type { App } from "nsh/test";
import { mediaFile } from "./local-media/files";

const directNetwork = {
  // The session's visitor, bootstrapped once as InnertubeX does, then the home page.
  "GET https://www.youtube.com/sw.js_data": { body: ")]}'\n" + JSON.stringify([["yt.sw.adr", null, [[[...Array(13).fill(null), "fixture-session-visitor"]]]]]) },
  "POST https://music.youtube.com/youtubei/v1/browse?prettyPrint=false": { body: {} },
};
const read = (app: App) => JSON.parse(app.texts().find(text => text.startsWith("downloads:"))!.slice(10));

for (const platform of ["linux", "windows", "macos"] as const) {
  test(`${platform} starts with the native dispatcher and no localhost music service`, async () => {
    const app = await open("./runtime-fixture.tsx", { platform, network: directNetwork,
      storage: { "metrolist.settings": JSON.stringify({ autoRadio: false }) } });
    await app.waitUntil(() => app.requests().length > 1);
    expect(app.requests().map(request => request.url)).toEqual(["https://www.youtube.com/sw.js_data", "https://music.youtube.com/youtubei/v1/browse?prettyPrint=false"]);
    expect(JSON.parse(app.storage()["metrolist.settings"])).toMatchObject({ apiBase: "", nativeFirst: true });
  });
}

test("desktop migration replaces the old bundled gateway and copies completed downloads to device-owned files", async () => {
  const song = { id: "video", title: "Video song", artist: "Online artist", album: "Album", artwork: "", duration: 60, source: "youtube" };
  const legacy = { id: "video", track: song, quality: "auto", status: "completed", progress: 1, bytes: 9437307,
    destination: "/legacy/Music/Metrolist/video.m4a", url: "http://127.0.0.1:8787/api/offline?id=video",
    name: "Video song.m4a", createdAt: 1, updatedAt: 2 };
  const saved = { name: legacy.name, ...mediaFile("video.wav"), bytes: legacy.bytes };
  const app = await open("../.nsh/local-media/runtime.tsx", { platform: "linux", width: 1440, height: 940, network: directNetwork, storage: {
    "metrolist.settings": JSON.stringify({ apiBase: "http://127.0.0.1:8787/", autoRadio: false }),
    "metrolist.downloads": JSON.stringify([legacy]),
  }, host: { handlers: { "app.test.files.copyInto": saved } } });
  await app.waitUntil(() => read(app)[0]?.url === saved.url);
  expect(app.host.calls().find(call => call.name === "app.test.files.copyInto")!.data).toMatchObject({ source: legacy.destination, name: legacy.name });
  expect(JSON.parse(app.storage()["metrolist.settings"])).toMatchObject({ apiBase: "", nativeFirst: true });
  await app.press("Start video"); await app.waitFor("Playing");
  expect(app.audio().find(call => call.command === "open")!.src).toBe(saved.url);
  expect(app.requests().some(request => request.url.includes("127.0.0.1") || request.url.includes("/api/download"))).toBe(false);
  expect(JSON.parse(app.storage()["metrolist.downloads"])[0]).toMatchObject({ status: "completed", ...saved });
});

test("a deliberately selected custom service is retained, including a localhost service chosen after migration", async () => {
  for (const apiBase of ["https://gateway.test", "http://127.0.0.1:8787"]) {
    const app = await open("./runtime-fixture.tsx", { platform: "linux", storage: {
      "metrolist.settings": JSON.stringify({ apiBase, nativeFirst: true, autoRadio: false }),
    }, network: { [`GET ${apiBase}/api/home`]: { body: { sections: [] } } } });
    await app.waitUntil(() => app.requests().length > 0);
    expect(app.requests().map(request => request.url)).toEqual([`${apiBase}/api/home`]);
    expect(JSON.parse(app.storage()["metrolist.settings"]).apiBase).toBe(apiBase);
  }
});

test("unfinished device downloads restore as cancelled without a polling gateway", async () => {
  const song = { id: "video", title: "Video song", artist: "Fixture", album: "", artwork: "", duration: 60, source: "youtube" };
  const app = await open("./runtime-fixture.tsx", { platform: "linux", network: directNetwork, storage: {
    "metrolist.settings": JSON.stringify({ autoRadio: false }),
    "metrolist.downloads": JSON.stringify([{ id: song.id, track: song, quality: "auto", status: "downloading", progress: 0.4, bytes: 20, totalBytes: 50, name: "Video.m4a", createdAt: 1, updatedAt: 2 }]),
  } });
  await app.waitUntil(() => read(app)[0]?.status === "cancelled");
  expect(app.requests().some(request => request.url.includes("/api/download"))).toBe(false);
});
