import { expect, open, test } from "nsh/test";
import type { App } from "nsh/test";

const handlers = {
  "app.metadata": null, "app.playback": null,
  "files.cancelDownload": null, "files.removeDownload": null,
  "files.download": { destination: "/music/retried.m4a", url: "file:///music/retried.m4a", bytes: 1024 },
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
  expect(app.audio().find(call => call.command === "open")!.src).toBe("file:///music/moon-one.m4a");
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
  expect(calls(app, "app.test.files.reveal")[0].data).toEqual({ destination: "/music/moon-one.m4a" });
});

test("iOS downloaded audio keeps playback and removal without offering desktop-only file actions", async () => {
  const app = await open("./downloads-ui-fixture.tsx", { width: 390, height: 1300, platform: "ios" });
  expect(app.enabled("id:download-play-moon-one")).toBe(true);
  await app.press("id:download-menu-moon-one");
  expect(app.shows("移除下载")).toBe(true);
  expect(app.shows("id:download-export-moon-one")).toBe(false);
  expect(app.shows("id:download-reveal-moon-one")).toBe(false);
});
