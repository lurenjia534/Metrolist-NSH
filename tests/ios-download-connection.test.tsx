import { expect, open, test } from "nsh/test";

test("fresh iOS direct startup has no download error and connects a download service only when requested", async () => {
  const app = await open("../App.tsx", { width: 390, height: 844, platform: "ios", storage: {
    "metrolist.settings": JSON.stringify({ autoRadio: false }),
  }, network: {
    "POST https://music.youtube.com/youtubei/v1/browse?prettyPrint=false": { body: {
      musicCarouselShelfRenderer: { title: { simpleText: "iOS 直连推荐" }, contents: [{ musicTwoRowItemRenderer: {
        title: { simpleText: "Direct song" }, subtitle: { simpleText: "Fixture artist" },
        navigationEndpoint: { watchEndpoint: { videoId: "ios-startup-song" } },
      } }] },
    } },
    "GET https://downloads.test/api/home": { body: { sections: [] } },
    "GET https://downloads.test/api/download": { body: { downloads: [] } },
  } });
  await app.waitFor("id:song-menu-ios-startup-song");
  expect(app.shows("id:app-error")).toBe(false);
  expect(app.shows("id:toast")).toBe(false);
  expect(app.requests().map(request => request.url)).toEqual(["https://music.youtube.com/youtubei/v1/browse?prettyPrint=false"]);
  expect(app.requests().some(request => request.url.includes("/api/download"))).toBe(false);

  await app.press("id:song-menu-ios-startup-song"); await app.press("下载");
  await app.waitFor("id:toast");
  expect(app.texts().some(text => text.includes("设置 → 连接 → 音乐服务"))).toBe(true);
  expect(app.texts()).not.toContain("已加入下载");
  expect(app.shows("id:app-error")).toBe(false);
  expect(app.storage()["metrolist.downloads"]).toBe(undefined);
  expect(app.requests().some(request => request.url.includes("/api/download"))).toBe(false);
  await app.drag("id:toast", { x: 100 }); await app.waitFor("id:toast", { state: "gone" });

  await app.press("id:home-downloads"); await app.waitFor("id:download-connection-needed");
  await app.press("id:download-open-settings"); await app.waitFor("id:api-origin");
  expect(app.value("id:api-origin")).toBe("");
  await app.type("id:api-origin", "https://downloads.test"); await app.press("保存并连接");
  await app.waitUntil(() => app.requests().some(request => request.url === "https://downloads.test/api/download"));
  await app.waitFor("id:toast"); await app.drag("id:toast", { x: 100 }); await app.waitFor("id:toast", { state: "gone" });
  await app.back(); await app.waitFor("id:page-downloads");
  expect(app.shows("id:download-connection-needed")).toBe(false);
  expect(app.shows("id:app-error")).toBe(false);
  expect(JSON.parse(app.storage()["metrolist.settings"]).apiBase).toBe("https://downloads.test");
  expect(app.requests().filter(request => request.url.endsWith("/api/download"))).toHaveLength(1);
});
