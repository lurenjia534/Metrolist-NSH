import { expect, open, test } from "nsh/test";
import type { App } from "nsh/test";
import { mediaFile } from "./local-media/files";

const handlers = {
  "app.metadata": null, "app.playback": null,
  "files.cancelDownload": null, "files.removeDownload": null,
  "files.download": (data: { id: string; name: string }) => ({ destination: data.name, url: `local:${data.id}`, bytes: 1024 }),
  "files.resolve": (data: { id: string }) => ({ url: `blob:https://music.test/${data.id}` }),
};
const fixture = () => open("./downloads-ui-fixture.tsx", { width: 1000, height: 1600, platform: "web", host: { handlers } });
const calls = (app: App, name: string) => app.host.calls().filter(call => call.name === name);

test("download search combines with status filters and plays only matching completed songs", async () => {
  const app = await fixture();
  await app.waitFor("id:download-search");
  expect(app.texts()).toContain("4.0 MB");
  expect(app.texts()).toContain("全部 8");
  expect(app.texts()).toContain("2 首正在下载");
  await app.type("id:download-search", "lUnA");
  expect(app.texts()).toContain("全部 4");
  expect(app.shows("id:download-sun")).toBe(false);
  await app.press("id:download-filter-completed");
  expect(app.shows("id:download-moon-failed")).toBe(false);
  expect(app.shows("id:download-moon-active")).toBe(false);
  await app.press("id:download-play-visible");
  await app.waitUntil(() => app.audio().some(call => call.command === "open"));
  expect(app.texts()).toContain('["moon-one","moon-two"]');
  expect(app.audio().find(call => call.command === "open")!.src).toBe("blob:https://music.test/moon-one");
  expect(calls(app, "files.resolve")[0].data).toEqual({ id: "moon-one" });
  await app.clear("id:download-search"); await app.type("id:download-search", "missing song");
  expect(app.texts()).toContain("没有匹配的下载");
  await app.press("id:download-show-all");
  expect(app.value("id:download-search")).toBe("");
  expect(app.shows("id:download-sun")).toBe(true);
});

test("bulk cancellation and clearing affect only downloads in the visible search and status", async () => {
  const app = await fixture();
  await app.type("id:download-search", "Luna"); await app.press("id:download-filter-active");
  await app.press("id:download-batch"); await app.press("id:download-cancel-visible");
  await app.waitUntil(() => calls(app, "files.cancelDownload").length === 1);
  expect(calls(app, "files.cancelDownload")[0].data).toMatchObject({ id: "moon-active" });
  await app.waitFor("id:download-moon-active", { state: "gone" });
  expect(app.shows("id:download-moon-active")).toBe(false);
  await app.press("id:download-filter-failed");
  await app.press("id:download-batch"); await app.press("id:download-clear-visible");
  await app.waitUntil(() => calls(app, "files.removeDownload").length === 1);
  expect(calls(app, "files.removeDownload")[0].data).toMatchObject({ id: "moon-failed" });
  await app.waitFor("id:download-moon-failed", { state: "gone" });
  await app.press("id:download-show-all");
  expect(app.shows("id:download-sun-failed")).toBe(true);
  expect(app.shows("id:download-sun-active")).toBe(true);
  expect(app.shows("id:download-moon-one")).toBe(true);
});

test("bulk retry starts the filtered failed song without touching other failed downloads", async () => {
  const app = await fixture();
  await app.type("id:download-search", "Luna"); await app.press("id:download-filter-failed");
  await app.press("id:download-batch"); await app.press("id:download-retry-visible");
  await app.waitUntil(() => calls(app, "files.download").length === 1);
  expect(calls(app, "files.download")[0].data).toMatchObject({ id: "moon-failed", url: "https://audio.test/moon-failed.m4a" });
  await app.waitFor("没有匹配的下载");
  await app.press("id:download-show-all");
  await app.press("id:download-filter-completed");
  expect(app.shows("id:download-moon-failed")).toBe(true);
  expect(app.shows("id:download-sun-failed")).toBe(false);
});

test("native connection settings save an optional service and restore device direct requests", async () => {
  const app = await open("./downloads-ui-fixture.tsx", { width: 390, height: 1300, platform: "linux", network: {
    "GET https://gateway.test/api/home": { body: { sections: [] } },
    "POST https://music.youtube.com/youtubei/v1/browse?prettyPrint=false": { body: {} },
  } });
  await app.press("Connections"); await app.waitFor("id:api-origin");
  expect(app.texts()).toContain("设备直连");
  expect(app.value("id:api-origin")).toBe("");
  await app.type("id:api-origin", "https://gateway.test/"); await app.press("id:connection-save");
  expect(JSON.parse(app.storage()["metrolist.settings"]).apiBase).toBe("https://gateway.test");
  expect(app.value("id:api-origin")).toBe("https://gateway.test");
  expect(app.texts()).toContain("自定义音乐服务");
  await app.press("id:connection-use-default");
  expect(JSON.parse(app.storage()["metrolist.settings"]).apiBase).toBe("");
  expect(app.value("id:api-origin")).toBe("");
  expect(app.texts()).toContain("设备直连");
  await app.waitUntil(() => app.requests().some(request => request.url === "https://music.youtube.com/youtubei/v1/browse?prettyPrint=false"));
  expect(app.requests().some(request => request.url.includes("127.0.0.1") || request.url.includes("localhost"))).toBe(false);
});

test("desktop downloads reveal the saved native file in the file manager", async () => {
  const app = await open("./downloads-ui-fixture.tsx", { width: 1000, height: 1600, platform: "linux", host: { handlers: { "app.test.files.reveal": null } } });
  await app.press("id:download-menu-moon-one");
  expect(app.shows("id:download-export-moon-one")).toBe(true);
  await app.press("id:download-reveal-moon-one");
  await app.waitUntil(() => calls(app, "app.test.files.reveal").length === 1);
  expect(calls(app, "app.test.files.reveal")[0].data).toEqual({ destination: mediaFile("moon-one.wav").destination });
});

test("iOS downloaded audio keeps playback and removal without offering desktop-only file actions", async () => {
  const app = await open("./downloads-ui-fixture.tsx", { width: 390, height: 1300, platform: "ios" });
  expect(app.enabled("id:download-play-moon-one")).toBe(true);
  await app.press("id:download-menu-moon-one");
  expect(app.shows("移除下载")).toBe(true);
  expect(app.shows("id:download-export-moon-one")).toBe(false);
  expect(app.shows("id:download-reveal-moon-one")).toBe(false);
});

async function applyFilters(app: App, ids: string[]) {
  await app.press("id:download-filters");
  for (const id of ids) await app.press(`id:${id}`);
  await app.press("id:download-apply-filters");
  await app.waitFor("id:app-dialog", { state: "gone" });
}

async function musicAction(app: App, id: string) {
  await app.press("id:download-music-actions");
  await app.waitFor(`id:download-${id}`);
  await app.press(`id:download-${id}`);
}

test("download playlist inclusion and exclusion combine with quality and job status", async () => {
  const app = await fixture();
  await applyFilters(app, ["download-scope-nights", "download-quality-filter-low"]);
  await app.press("id:download-filter-completed");
  expect(app.shows("id:download-sun")).toBe(true);
  expect(app.shows("id:download-moon-one")).toBe(false);
  await applyFilters(app, ["download-quality-filter-all", "download-exclude"]);
  expect(app.shows("id:download-moon-two")).toBe(true);
  expect(app.shows("id:download-sun")).toBe(false);
  expect(app.shows("id:download-moon-one")).toBe(false);
});

test("filling a playlist starts only unique missing files and leaves in-progress jobs alone", async () => {
  const app = await fixture();
  await applyFilters(app, ["download-scope-nights"]);
  expect(app.texts()).toContain("补齐整张歌单 · 1 首");
  await app.press("id:download-fill"); await app.waitFor("id:download-play-missing");
  expect(calls(app, "files.download").map(call => (call.data as { id: string }).id)).toEqual(["missing"]);
  expect(app.enabled("id:download-fill")).toBe(false);
});

test("artist space breakdown leads to the exact files and selection frees their measured bytes", async () => {
  const app = await fixture();
  await app.press("id:download-space");
  expect(app.texts()).toContain("2 首 · 3.0 MB");
  await app.press("id:app-dialog >> label:Luna"); await app.waitFor("id:app-dialog", { state: "gone" });
  expect(app.shows("id:download-sun")).toBe(false);
  await app.press("id:download-select"); await app.press("id:download-select-all");
  await app.press("id:download-select-moon-one");
  expect(app.texts()).toContain("已选 1 首 · 2.0 MB");
  await app.press("id:download-remove-selected"); await app.waitFor("id:download-moon-two", { state: "gone" });
  expect(calls(app, "files.removeDownload").map(call => (call.data as { id: string }).id)).toEqual(["moon-two"]);
  expect(app.texts()).toContain("2.0 MB");
  expect(app.shows("id:download-moon-one")).toBe(true);
});

test("sorted offline results shuffle, append and play next using the downloaded audio", async () => {
  const app = await fixture();
  await app.type("id:download-search", "Luna");
  await app.press("id:download-sort"); await app.press("id:download-sort-size");
  await musicAction(app, "append");
  expect(app.texts()).toContain('["moon-two","moon-one"]');
  await app.clear("id:download-search"); await app.type("id:download-search", "Sunrise");
  await musicAction(app, "next");
  expect(app.texts()).toContain('["moon-two","sun","moon-one"]');
  await app.clear("id:download-search"); await app.type("id:download-search", "Luna");
  await musicAction(app, "shuffle");
  await app.waitUntil(() => app.audio().some(call => call.command === "open"));
  const ids = JSON.parse(app.texts().find(text => text.startsWith('["'))!);
  expect(ids.sort()).toEqual(["moon-one", "moon-two"]);
  expect(calls(app, "files.resolve").length > 0).toBe(true);
  expect(JSON.parse(app.storage()["metrolist.settings"]).downloadSorting).toEqual({ sort: "size", descending: true });
});

test("saving sorted downloads to a playlist retains the catalog tracks after offline removal", async () => {
  const app = await fixture();
  await app.press("id:download-filter-completed");
  await app.press("id:download-sort"); await app.press("id:download-sort-plays");
  await musicAction(app, "save-playlist");
  await app.waitFor("id:app-dialog >> label:Saved set"); await app.press("id:app-dialog >> label:Saved set");
  await app.waitFor("id:app-dialog", { state: "gone" });
  await app.press("id:download-select"); await app.press("id:download-select-sun"); await app.press("id:download-remove-selected");
  await app.waitFor("id:download-sun", { state: "gone" });
  const list = JSON.parse(app.storage()["metrolist.library"]).playlists.find((item: { id: string }) => item.id === "saved");
  expect(list.tracks.map((track: { id: string }) => track.id)).toEqual(["sun", "moon-two", "moon-one"]);
  expect(list.tracks[0].source).toBe("youtube");
  expect(list.tracks[1].url).toBe("https://audio.test/moon-two.m4a");
});

test("changing a download's quality resolves the original song and persists its replacement", async () => {
  const app = await open("./downloads-ui-fixture.tsx", { width: 390, height: 900, platform: "web", host: { handlers }, network: {
    "GET https://gateway.test/api/stream?id=sun&quality=high*": { body: { url: "https://audio.test/high.m4a", mimeType: "audio/mp4" } },
    "GET https://gateway.test/api/home": { body: { sections: [] } },
  } });
  await app.press("Connections"); await app.type("id:api-origin", "https://gateway.test"); await app.press("id:connection-save");
  await app.press("Downloads"); await app.press("id:download-menu-sun"); await app.press("id:download-quality-sun");
  await app.waitFor("id:download-replace-high");
  expect(app.enabled("id:download-replace-low")).toBe(false);
  await app.press("id:download-replace-high");
  await app.waitUntil(() => calls(app, "files.download").length === 1);
  expect(calls(app, "files.download")[0].data).toMatchObject({ id: "sun", url: "https://audio.test/high.m4a" });
  await app.waitUntil(() => JSON.parse(app.storage()["metrolist.downloads"]).some((row: { id: string; quality: string; status: string }) =>
    row.id === "sun" && row.quality === "high" && row.status === "completed"));
});

test("Android opens the offline collection from Home and restores download sorting on relaunch", async () => {
  const launch = (storage: Record<string, string>) => open("../App.tsx", { width: 360, height: 800, platform: "android",
    storage, host: { handlers: { "app.start": null, "app.audio.snapshot": null, "app.audio.settings": null } },
    network: { "GET https://gateway.test/api/home": { body: { sections: [] } } },
  });
  const initial = await launch({ "metrolist.settings": JSON.stringify({ apiBase: "https://gateway.test", autoRadio: false }) });
  await initial.press("id:home-downloads"); await initial.press("id:download-sort");
  await initial.press("id:download-sort-lastPlayed"); await initial.waitFor("text:最近播放 ↓");
  await initial.press("id:download-sort"); await initial.press("id:download-sort-direction");
  await initial.waitFor("text:最近播放 ↑");
  const restarted = await launch(initial.storage());
  await restarted.press("id:home-downloads"); await restarted.waitFor("text:最近播放 ↑");
  await applyFilters(restarted, ["download-quality-filter-high"]);
  expect(restarted.shows("没有匹配的下载")).toBe(true);
  await restarted.press("id:download-show-all");
  expect(restarted.shows("没有下载任务")).toBe(true);
});
