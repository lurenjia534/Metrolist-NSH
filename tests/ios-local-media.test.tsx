import { expect, open, test } from "nsh/test";

test("iOS streams imported and downloaded files through the native relay without replacing their stored URLs", async () => {
  let prepared = 0;
  const downloadedURL = "file:///app-data/downloads/saved-song.mp3";
  const relay = (id: number) => `http://127.0.0.1:49321/media/local-${id}`;
  const app = await open("./ios-local-media-fixture.tsx", {
    platform: "ios",
    width: 390,
    height: 844,
    storage: {
      "metrolist.settings": JSON.stringify({ autoRadio: false, apiBase: "https://gateway.test" }),
    },
    network: {
      "GET https://gateway.test/api/home": { body: { sections: [] } },
      "GET https://gateway.test/api/lyrics?*": { body: { plainLyrics: "", syncedLyrics: "", lines: [], instrumental: true } },
    },
    host: { handlers: {
      "app.test.media.prepare": () => ({ id: `local-${++prepared}`, url: relay(prepared) }),
      "app.test.media.release": null,
      "app.test.files.download": (input: unknown) => {
        const { name } = input as { name: string };
        const destination = "/app-data/downloads/saved-song.mp3";
        return { name, destination, url: downloadedURL, bytes: 9437307 };
      },
    } },
  });
  const prepares = () => app.host.calls().filter(call => call.name === "app.test.media.prepare").map(call => call.data as { url: string; headers: Record<string, string> });
  const releases = () => app.host.calls().filter(call => call.name === "app.test.media.release").map(call => call.data);
  const audio = (command: string) => app.audio().filter(call => call.command === command).map(call => call.src);
  await app.waitFor("Ready");
  await app.press("Play imported");
  await app.waitFor("playing");
  expect(prepares()).toHaveLength(1);
  expect(prepares()[0].url).toBe("file:///app-data/music/Imported%20song.m4a");
  expect(prepares()[0].headers).toEqual({});
  expect(audio("open")).toEqual([relay(1)]);
  expect(JSON.parse(app.storage()["metrolist.player"]).queue[0].url).toBe(prepares()[0].url);

  await app.press("Pause");
  await app.waitFor("paused");
  expect(releases()).toEqual([]);
  await app.press("Resume");
  await app.waitFor("playing");
  expect(prepares()).toHaveLength(1);
  expect(audio("open")).toEqual([relay(1)]);
  expect(audio("resume")).toContain(relay(1));

  await app.press("Download song");
  await app.waitFor("text:download:completed");
  await app.press("Play downloaded");
  await app.waitFor("playing");
  await app.waitUntil(() => releases().length === 1);
  expect(prepares()[1]).toEqual({ url: downloadedURL, headers: {} });
  expect(audio("open")).toEqual([relay(1), relay(2)]);
  expect(audio("close")).toEqual([relay(1)]);
  expect(releases()).toEqual([{ id: "local-1" }]);
  expect(JSON.parse(app.storage()["metrolist.downloads"])[0].url).toBe(downloadedURL);

  await app.press("Clear");
  await app.waitUntil(() => releases().length === 2);
  expect(audio("close")).toEqual([relay(1), relay(2)]);
  expect(releases()).toEqual([{ id: "local-1" }, { id: "local-2" }]);
  expect(JSON.parse(app.storage()["metrolist.downloads"])[0].url).toBe(downloadedURL);
});
