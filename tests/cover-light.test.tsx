import { expect, open, test } from "nsh/test";

const teal = { id: "light-teal", title: "Teal cover song", artist: "Light artist", album: "Light album", artwork: "https://img.test/teal.jpg", duration: 180, source: "youtube" };
const violet = { ...teal, id: "light-violet", title: "Violet cover song", artwork: "https://img.test/violet.jpg" };
const storage = {
  "metrolist.settings": JSON.stringify({ autoRadio: false, apiBase: "https://gateway.test" }),
  "metrolist.player": JSON.stringify({ queue: [teal, violet], index: 0, position: 0, title: "Light queue" }),
};
const network = {
  "GET https://gateway.test/api/home": { body: { sections: [] } },
  "GET https://gateway.test/api/lyrics?*": { status: 404, body: {} },
  "GET https://img.test/*": { status: 404, body: "" },
};
const palette: Record<string, string[]> = { [teal.artwork]: ["#6ec7cd", "#795c69"], [violet.artwork]: ["#629fbb", "#88598a"] };

test("the player's light asks the Rust palette once per cover, by artwork URL", async () => {
  const asked: string[] = [];
  const app = await open("../App.tsx", { width: 1440, height: 940, platform: "linux", storage, network,
    modules: { "metrolist/native": { "NativeArtwork.colors": (url: string) => { asked.push(url); return palette[url]; } } } });
  await app.waitFor("id:mini-player");
  await app.waitUntil(() => asked.includes(teal.artwork));
  await app.press("id:mini-player >> label:下一首");
  await app.waitUntil(() => asked.includes(violet.artwork));
  await app.press("id:mini-player >> label:上一首");
  await app.waitFor("id:mini-player >> text:Teal cover song");
  await app.press("id:open-player");
  await app.waitFor("id:close-player");
  expect(asked).toEqual([teal.artwork, violet.artwork]);
});

test("on the web the light reads the cover through the browser host", async () => {
  const asked: string[] = [];
  const app = await open("../App.tsx", { width: 1440, height: 940, platform: "web", storage, network,
    host: { handlers: { "app.start": null, "app.coverColors": (data: unknown) => { const url = (data as { imageUrl: string }).imageUrl; asked.push(url); return palette[url]; } } },
    modules: { "metrolist/native": { "NativeArtwork.colors": () => { throw new Error("the web has no Rust palette"); } } } });
  await app.waitFor("id:mini-player");
  await app.waitUntil(() => asked.includes(teal.artwork));
  expect(asked).toEqual([teal.artwork]);
});
