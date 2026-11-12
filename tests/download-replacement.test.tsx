import { expect, open, test } from "nsh/test";
import type { App } from "nsh/test";
import { mediaFile } from "./local-media/files";

const remote = { id: "remote", title: "Remote song", artist: "Fixture", album: "", artwork: "", duration: 60, source: "audio", url: "https://audio.test/remote.mp3" };
const local = { ...remote, id: "local", title: "Local song", url: "file:///external/%E5%90%8D%20Song.mp3" };
const network = {
  "GET https://gateway.test/api/home": { body: { sections: [] } },
  "GET https://gateway.test/api/lyrics?*": { body: { plainLyrics: "", syncedLyrics: "", lines: [], instrumental: false } },
};
const settings = { apiBase: "https://gateway.test", nativeFirst: true, audioQuality: "high", autoRadio: false };
const read = (app: App, name: string) => JSON.parse(app.texts().find(text => text.startsWith(`${name}:`))!.slice(name.length + 1));
const calls = (app: App, name: string) => app.host.calls().filter(call => call.name === name).map(call => call.data);

test("cancelling a pending native replacement keeps the completed file playable and persisted", async () => {
  const previous = { id: remote.id, track: remote, quality: "high", status: "completed", progress: 1, bytes: 100, totalBytes: 100,
    ...mediaFile("original.wav"), name: "Fixture - Remote song.mp3", createdAt: 1, updatedAt: 2 };
  const app = await open("../.nsh/local-media/download-replacement.tsx", { platform: "linux", network, storage: {
    "metrolist.settings": JSON.stringify(settings),
    "metrolist.downloads": JSON.stringify([previous]),
  }, host: { handlers: {
    "app.test.files.download": null,
    "app.test.files.cancel": null,
    "app.test.files.remove": null,
  } } });
  await app.waitFor("Ready");
  await app.press("Download remote"); await app.waitFor("Waiting for download");
  expect(read(app, "downloads")[0].status).toBe("downloading");
  expect(calls(app, "app.test.files.download")).toHaveLength(1);
  await app.press("Cancel replacement");
  await app.waitUntil(() => read(app, "downloads")[0]?.status === "completed");
  const retained = { status: "completed", quality: previous.quality, progress: 1, bytes: previous.bytes,
    destination: previous.destination, url: previous.url, name: previous.name };
  expect(read(app, "downloads")[0]).toMatchObject(retained);
  expect(JSON.parse(app.storage()["metrolist.downloads"])[0]).toMatchObject(retained);
  expect(calls(app, "app.test.files.cancel")).toEqual([{ id: remote.id }]);
  expect(calls(app, "app.test.files.remove")).toEqual([]);
  await app.press("Play remote"); await app.waitFor("Playing");
  expect(app.audio().filter(call => call.command === "open").map(call => call.src)).toEqual([previous.url]);
});

test("restored local audio uses the current saved file despite a different quality preference and copies file URLs natively", async () => {
  const current = { id: local.id, track: local, quality: "low", status: "completed", progress: 1, bytes: 100,
    ...mediaFile("current.wav"), name: "Fixture - Local song.mp3", createdAt: 1, updatedAt: 2 };
  const staleTrack = { ...local, url: mediaFile("deleted-before-replacement.wav").url };
  const copied = { name: current.name, ...mediaFile("copied.wav"), bytes: 9437307 };
  const app = await open("../.nsh/local-media/download-replacement.tsx", { platform: "linux", network, storage: {
    "metrolist.settings": JSON.stringify(settings),
    "metrolist.downloads": JSON.stringify([current]),
    "metrolist.player": JSON.stringify({ queue: [staleTrack], index: 0, position: 17 }),
  }, host: { handlers: {
    "app.test.files.copyInto": copied,
    "app.test.files.remove": null,
  } } });
  await app.waitFor("Ready");
  expect(read(app, "queue")[0].url).toBe(staleTrack.url);
  await app.press("Play restored queue"); await app.waitFor("Playing");
  expect(app.audio().filter(call => call.command === "open").map(call => call.src)).toEqual([current.url]);
  expect(app.audio().some(call => call.command === "seek" && call.position === 17)).toBe(true);
  await app.press("Copy local audio");
  await app.waitUntil(() => read(app, "downloads")[0]?.url === copied.url);
  expect(calls(app, "app.test.files.copyInto")).toHaveLength(1);
  expect(calls(app, "app.test.files.copyInto")[0]).toMatchObject({ source: local.url, name: copied.name });
  expect(calls(app, "app.test.files.download")).toEqual([]);
  expect(calls(app, "app.test.files.remove")).toEqual([{ destination: current.destination }]);
  expect(JSON.parse(app.storage()["metrolist.downloads"])[0]).toMatchObject({ status: "completed", quality: "high", ...copied });
});
