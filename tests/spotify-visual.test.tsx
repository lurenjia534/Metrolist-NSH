// Native rendering evidence, run explicitly or by the Linux packaging job.
// METROLIST_SPOTIFY_VISUAL=1 python3 scripts/run-nsh.py test --target linux tests/spotify-visual.test.tsx
import { resolve } from "path";
import process from "process";
import { expect, open, test as plainTest } from "nsh/test";

const test = process.env.METROLIST_SPOTIFY_VISUAL === "1" ? plainTest : plainTest.skip;

test("native Spotify home, collection and layered Now Playing render", async () => {
  const output = resolve("dist/smoke");
  const app = await open("../App.tsx", {
    platform: "linux",
    width: 1440,
    height: 940,
    storage: {
      "metrolist.provider": "spotify",
      "metrolist.settings": JSON.stringify({ apiBase: "https://gateway.test", autoRadio: false }),
      "spotify:firstRun:done": "1",
    },
    network: { "GET https://gateway.test/api/home": { body: { sections: [] } } },
    host: { params: { backend: "demo", demo: "rich", premium: true } },
  });
  await app.waitFor("id:spotify-demo-banner");
  await app.waitFor("id:provider-youtube");
  await app.waitFor("Good evening, Ada");
  await app.wait(800);
  await app.screenshot(resolve(output, "spotify-home.png"));

  await app.press("role:button[Morning Static]");
  await app.waitFor("Soft starts for slow mornings.");
  await app.press("role:button[Slow River, The Quiet Fields]");
  await app.waitFor("id:player >> role:button[Pause]");
  await app.wait(800);
  await app.screenshot(resolve(output, "spotify-collection.png"));

  await app.press("id:player >> id:open-now-playing");
  await app.waitFor("role:button[Close Now Playing]");
  await app.wait(1000);
  await app.screenshot(resolve(output, "spotify-now-playing.png"));
  expect(app.texts()).toContain("Slow River");

  await app.setViewport(600, 840);
  await app.wait(500);
  await app.screenshot(resolve(output, "spotify-now-playing-narrow.png"));
  await app.press("role:button[Close Now Playing]");
  await app.waitFor("id:player >> role:button[Pause]");
}, 60000);
