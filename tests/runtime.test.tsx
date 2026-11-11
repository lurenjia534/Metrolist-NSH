import { expect, open, test } from "nsh/test";
import type { App } from "nsh/test";

const online = { id: "video", title: "Video song", artist: "Online artist", album: "Album", artwork: "", duration: 60, source: "youtube" };
const catalog = { ...online, id: "catalog", title: "Catalog song" };
const storage = { "metrolist.settings": JSON.stringify({ apiBase: "http://127.0.0.1:8787", autoRadio: false }) };
const network = {
  "GET http://127.0.0.1:8787/api/home": { body: { sections: [] } },
  "GET http://127.0.0.1:8787/api/download": { body: { downloads: [] } },
  "GET http://127.0.0.1:8787/api/lyrics?*": { body: { plainLyrics: "Line", syncedLyrics: "", lines: [], instrumental: false } },
  "GET http://127.0.0.1:8787/api/stream?id=video&quality=auto*": { body: { url: "https://audio.test/auto.m4a", quality: "auto", mimeType: "audio/mp4", bitrate: 128000 } },
  "GET http://127.0.0.1:8787/api/stream?id=video&quality=high*": { body: { url: "https://audio.test/high.m4a", quality: "high", mimeType: "audio/mp4", bitrate: 256000 } },
};
const read = (app: App, name: string) => JSON.parse(app.texts().find((text) => text.startsWith(`${name}:`))!.slice(name.length + 1));
const settings = (extra: object) => ({ "metrolist.settings": JSON.stringify({ apiBase: "http://127.0.0.1:8787", autoRadio: false, ...extra }) });

test("pure audio quality changes preserve paused position and resolve the selected quality", async () => {
  const app = await open("./runtime-fixture.tsx", { width: 1440, height: 940, platform: "linux", network, storage });
  await app.press("Start video"); await app.waitFor("Playing");
  await app.press("Seek 21"); await app.press("Pause"); await app.press("High quality");
  expect(app.audio().filter((call) => call.command === "open")).toHaveLength(1);
  expect(app.audio().filter((call) => call.command === "close")).toHaveLength(1);
  expect(read(app, "queue").playing).toBe(false);
  await app.press("Play"); await app.waitFor("Playing");
  expect(app.audio().filter((call) => call.command === "open").map((call) => call.src)).toEqual(["https://audio.test/auto.m4a", "https://audio.test/high.m4a"]);
  expect(app.audio().some((call) => call.command === "seek" && call.position === 21)).toBe(true);
  expect(app.requests().some((request) => request.url.includes("quality=high&container=mp4"))).toBe(true);
});

test("pausing an unresolved source prevents later autoplay and the next play uses new quality", async () => {
  const app = await open("./runtime-fixture.tsx", { width: 1440, height: 940, platform: "linux", clock: {}, storage, network: {
    ...network,
    "GET http://127.0.0.1:8787/api/stream?id=video&quality=auto*": { delay: 60000, body: { url: "https://audio.test/old.m4a" } },
  } });
  await app.press("Start video"); await app.waitFor("Loading");
  await app.press("Pause"); await app.press("High quality");
  await app.clock!.fastForward(60001);
  expect(app.audio()).toHaveLength(0);
  expect(read(app, "queue").playing).toBe(false);
  await app.press("Play"); await app.waitFor("Playing");
  expect(app.audio().filter((call) => call.command === "open").map((call) => call.src)).toEqual(["https://audio.test/high.m4a"]);
});

test("duplicate queue rows move independently and paused removal plus repeat keep correct audio", async () => {
  const app = await open("./runtime-fixture.tsx", { width: 1440, height: 940, platform: "linux", network, storage });
  await app.press("Start local"); await app.waitFor("Playing");
  await app.press("Move third first");
  expect(read(app, "queue").ids).toEqual(["alpha", "alpha", "beta"]);
  expect(read(app, "queue").index).toBe(1);
  expect(app.audio().filter((call) => call.command === "open")).toHaveLength(1);
  await app.press("Pause"); await app.press("Remove current");
  expect(read(app, "queue")).toMatchObject({ ids: ["alpha", "beta"], index: 1, position: 0, playing: false });
  expect(app.audio().filter((call) => call.command === "open")).toHaveLength(1);
  await app.press("Play"); await app.press("Repeat one"); await app.endAudio();
  expect(read(app, "queue")).toMatchObject({ index: 1, playing: true });
  expect(app.audio().filter((call) => call.command === "open")).toHaveLength(2);
  expect(app.audio().some((call) => call.command === "seek" && call.position === 0)).toBe(true);
  await app.press("Clear queue");
  expect(read(app, "queue").ids).toHaveLength(0);
  expect(app.audio().filter((call) => call.command === "close")).toHaveLength(2);
});

test("changing quality during resolution keeps play intent and disposes the obsolete request", async () => {
  const app = await open("./runtime-fixture.tsx", { width: 1440, height: 940, platform: "linux", clock: {}, storage, network: {
    ...network,
    "GET http://127.0.0.1:8787/api/stream?id=video&quality=auto*": { delay: 60000, body: { url: "https://audio.test/obsolete.m4a" } },
  } });
  await app.press("Start video"); await app.waitFor("Loading");
  await app.press("High quality"); await app.waitFor("Playing");
  await app.clock!.fastForward(60001);
  expect(app.audio().filter((call) => call.command === "open").map((call) => call.src)).toEqual(["https://audio.test/high.m4a"]);
  expect(read(app, "queue").playing).toBe(true);
});

test("catalog results remain outside the library until saved and unlike preserves a saved song", async () => {
  const app = await open("./runtime-fixture.tsx", { width: 1440, height: 940, platform: "linux", storage, network: {
    ...network, "GET http://127.0.0.1:8787/api/search?q=Catalog&type=all": { body: { query: "Catalog", type: "all", items: [catalog] } },
  } });
  await app.press("Search catalog");
  expect(read(app, "library").ids).toEqual([]);
  expect(read(app, "library").search).toEqual(["Catalog"]);
  await app.press("Save catalog result"); await app.press("Like alpha"); await app.press("Like alpha");
  expect(read(app, "library").ids).toEqual(["alpha", "catalog"]);
  expect(read(app, "library").liked).toEqual([]);
  await app.press("Remove alpha"); await app.press("Save collections");
  const saved = JSON.parse(app.storage()["metrolist.library"]);
  expect(saved.libraryIds).toEqual(["catalog"]);
  expect(saved.savedCollections.map((item: { id: string }) => item.id).sort()).toEqual(["album", "artist"]);
  expect(saved.savedCollections.find((item: { id: string }) => item.id === "album").params).toBe("album-params");
});

test("playlist search keeps original row indices for duplicate deletion and custom ordering", async () => {
  const app = await open("./runtime-fixture.tsx", { width: 1440, height: 940, platform: "linux", network, storage });
  await app.press("Create playlist"); await app.press("Find beta");
  expect(read(app, "rows")).toEqual([{ id: "beta", index: 0 }, { id: "beta", index: 2 }]);
  await app.press("Remove last visible");
  expect(JSON.parse(app.storage()["metrolist.library"]).playlists[0].tracks.map((track: { id: string }) => track.id)).toEqual(["beta", "alpha"]);
  await app.press("Sort playlist");
  expect(read(app, "rows")).toEqual([{ id: "beta", index: 1 }]);
  await app.press("Move playlist");
  expect(read(app, "rows")).toEqual([{ id: "beta", index: 0 }]);
});

test("listening statistics accumulate played time and do not count the seeked portion", async () => {
  const app = await open("./runtime-fixture.tsx", { width: 1440, height: 940, platform: "linux", network, storage });
  await app.press("Start local"); await app.press("Seek 50"); await app.endAudio();
  expect(read(app, "stats").plays).toBe(0);
  await app.endAudio();
  expect(read(app, "stats")).toMatchObject({ plays: 1, totalSeconds: 60, uniqueTracks: 1 });
  await app.endAudio();
  expect(read(app, "stats")).toMatchObject({ plays: 2, totalSeconds: 120, uniqueTracks: 2 });
  const saved = JSON.parse(app.storage()["metrolist.library"]);
  expect(saved.listenEvents).toHaveLength(2);
  expect(saved.history.map((track: { id: string }) => track.id)).toEqual(["alpha", "beta"]);
});

test("automatic radio appends distinct recommendations and guests wait for the room host", async () => {
  const radioSong = { ...online, id: "radio", title: "Radio song" };
  const app = await open("./runtime-fixture.tsx", { width: 1440, height: 940, platform: "linux", storage: settings({ autoRadio: true }), network: {
    ...network,
    "GET http://127.0.0.1:8787/api/next?id=video": { body: { tracks: [online, radioSong, radioSong] } },
    "GET http://127.0.0.1:8787/api/next?id=radio": { body: { tracks: [online, radioSong] } },
    "GET http://127.0.0.1:8787/api/stream?id=radio*": { body: { url: "https://audio.test/radio.m4a" } },
  } });
  await app.press("Start video");
  await app.waitUntil(() => read(app, "queue").ids.length === 2);
  expect(read(app, "queue").ids).toEqual(["video", "radio"]);
  await app.endAudio();
  expect(read(app, "queue").index).toBe(1);
  await app.press("Remote guest"); await app.endAudio();
  expect(read(app, "queue")).toMatchObject({ ids: ["alpha", "beta"], index: 0, playing: false });
});

test("download failure can retry into managed offline audio and then remove its data", async () => {
  let attempts = 0;
  const complete = { id: "video", track: online, quality: "auto", status: "completed", progress: 1, bytes: 9437307, totalBytes: 9437307, destination: "/music/video.m4a", url: "http://127.0.0.1:8787/api/offline?id=video", name: "Video song.m4a", createdAt: 1, updatedAt: 2 };
  const app = await open("./runtime-fixture.tsx", { width: 1440, height: 940, platform: "linux", storage, network: {
    ...network,
    "POST http://127.0.0.1:8787/api/download": () => ({ body: ++attempts === 1 ? { ...complete, status: "failed", error: "Fixture stream failure" } : complete }),
    "GET http://127.0.0.1:8787/api/download?id=video": { body: { ...complete, status: "failed", error: "Fixture stream failure" } },
    "DELETE http://127.0.0.1:8787/api/download?id=video": { body: { id: "video", status: "cancelled" } },
  } });
  await app.press("Download");
  await app.waitUntil(() => read(app, "downloads")[0]?.status === "failed");
  await app.press("Retry download");
  await app.waitUntil(() => read(app, "downloads")[0]?.status === "completed");
  expect(read(app, "downloads")[0].bytes).toBe(9437307);
  await app.press("Start video"); await app.waitFor("Playing");
  expect(app.audio().filter((call) => call.command === "open")[0].src).toBe(complete.url);
  expect(app.requests().some((request) => request.url.includes("/api/stream"))).toBe(false);
  await app.press("Remove download");
  expect(read(app, "downloads")).toEqual([]);
  expect(JSON.parse(app.storage()["metrolist.downloads"])).toEqual([]);
});

test("web managed downloads use the local audio bridge and ignore late progress after completion", async () => {
  const app = await open("./runtime-fixture.tsx", { width: 1440, height: 940, platform: "web", storage, network, host: { handlers: {
    "app.metadata": null, "app.playback": null,
    "files.download": { destination: "Video song.m4a", url: "local:video", bytes: 200 },
    "files.resolve": { url: "blob:https://music.test/downloaded-video" },
    "files.removeDownload": null,
  } } });
  await app.press("Download");
  await app.waitUntil(() => read(app, "downloads")[0].status === "completed");
  await app.host.send("files.download.progress", { id: "video", bytes: 100, totalBytes: 200, progress: 0.5 });
  expect(read(app, "downloads")[0]).toMatchObject({ status: "completed", progress: 1, bytes: 200 });
  await app.press("Start video"); await app.waitFor("Playing");
  expect(app.audio().filter((call) => call.command === "open")[0].src).toBe("blob:https://music.test/downloaded-video");
  expect(app.host.calls().some((call) => call.name === "files.resolve")).toBe(true);
  await app.press("Remove download");
  expect(app.host.calls().some((call) => call.name === "files.removeDownload")).toBe(true);
  expect(read(app, "downloads")).toEqual([]);
  await app.press("Remote guest");
  await app.host.send("media.command", { action: "pause" });
  await app.host.send("media.command", { action: "next" });
  await app.host.send("media.command", { action: "seek", value: 35 });
  expect(read(app, "queue")).toMatchObject({ index: 0, position: 0, playing: true });
});

test("blocked autoplay resumes the retained AudioPlayer and initializes lyrics and media metadata on the explicit play", async () => {
  const app = await open("./runtime-fixture.tsx", { width: 1440, height: 940, platform: "web", storage, network, host: { handlers: { "app.metadata": null, "app.playback": null } } });
  await app.press("Block next autoplay"); await app.press("Start video");
  await app.waitUntil(() => read(app, "queue").errorCode === "not-allowed");
  expect(read(app, "queue")).toMatchObject({ playing: false, error: "点按播放以开始音频" });
  expect(app.host.calls().filter((call) => call.name === "app.metadata")).toHaveLength(0);
  expect(app.requests().filter((request) => request.url.includes("/api/lyrics"))).toHaveLength(0);
  await app.press("Retry playback"); await app.waitFor("Playing");
  expect(read(app, "queue")).toMatchObject({ playing: true, error: "", errorCode: "" });
  expect(app.requests().filter((request) => request.url.includes("/api/stream"))).toHaveLength(1);
  expect(app.audio().filter((call) => call.command === "open")).toHaveLength(1);
  expect(app.host.calls().filter((call) => call.name === "app.metadata")).toHaveLength(1);
  expect(app.requests().filter((request) => request.url.includes("/api/lyrics"))).toHaveLength(1);
});
