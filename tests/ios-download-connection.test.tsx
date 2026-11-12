import { expect, open, test } from "nsh/test";

test("fresh iOS starts directly and its download center does not require a music gateway", async () => {
  const app = await open("../App.tsx", { width: 390, height: 844, platform: "ios", storage: {
    "metrolist.settings": JSON.stringify({ autoRadio: false }),
  }, network: {
    "POST https://music.youtube.com/youtubei/v1/browse?prettyPrint=false": { body: {
      musicCarouselShelfRenderer: { title: { simpleText: "iOS 直连推荐" }, contents: [{ musicTwoRowItemRenderer: {
        title: { simpleText: "Direct song" }, subtitle: { simpleText: "Fixture artist" },
        navigationEndpoint: { watchEndpoint: { videoId: "ios-startup-song" } },
      } }] },
    } },
  } });
  await app.waitFor("id:song-menu-ios-startup-song");
  expect(app.shows("id:app-error")).toBe(false);
  expect(app.shows("id:toast")).toBe(false);
  expect(app.requests().map(request => request.url)).toEqual(["https://music.youtube.com/youtubei/v1/browse?prettyPrint=false"]);
  await app.press("id:home-downloads"); await app.waitFor("id:page-downloads");
  expect(app.texts()).toContain("没有下载任务");
  expect(app.shows("id:download-connection-needed")).toBe(false);
  expect(app.requests().some(request => request.url.includes("/api/download"))).toBe(false);
});

test("iOS direct audio downloads through its Rust writer without contacting a download gateway", async () => {
  const saved = { name: "Alpha.mp3", destination: "/device/downloads/alpha.mp3", url: "file:///device/downloads/alpha.mp3", bytes: 9437307 };
  const app = await open("./runtime-fixture.tsx", { width: 390, height: 844, platform: "ios", storage: {
    "metrolist.settings": JSON.stringify({ autoRadio: false }),
  }, network: {
    "POST https://music.youtube.com/youtubei/v1/browse?prettyPrint=false": { body: {} },
  }, host: { handlers: { "app.test.files.download": saved } } });
  await app.waitUntil(() => app.requests().length > 0);
  await app.press("Download direct");
  await app.waitUntil(() => app.storage()["metrolist.downloads"]?.includes('"completed"'));
  expect(JSON.parse(app.storage()["metrolist.downloads"])[0]).toMatchObject({ id: "alpha", status: "completed", destination: saved.destination, url: saved.url, bytes: saved.bytes });
  expect(app.host.calls().find(call => call.name === "app.test.files.download")!.data).toMatchObject({
    id: "alpha", url: "https://audio.test/alpha.mp3", headers: {},
  });
  expect(app.requests().some(request => request.url.includes("/api/download") || request.url.includes("127.0.0.1"))).toBe(false);
});
