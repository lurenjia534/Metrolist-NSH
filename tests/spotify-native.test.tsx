// Runs the real Rust Spotify/watch/Callback path on recorded data, without
// Chromium or a Spotify account:
// SPOTISH_DEMO=1 python3 scripts/run-nsh.py test tests/spotify-native.test.tsx --web-host tests/native-login/host.js
import process from "process";
import { expect, open, test as plainTest } from "nsh/test";

const test = process.env.SPOTISH_DEMO === "1" ? plainTest : plainTest.skip;

test("native player listeners survive cached-account resource reruns and workspace remounts", async () => {
  const app = await open("./spotify-native-fixture.tsx", {
    width: 800,
    height: 700,
    platform: "linux",
    storage: {
      "spotify:session:account": "demo",
      "spotify:cache:v1:demo:home": JSON.stringify({
        savedAt: 1,
        v: { greeting: "Cached native home", sections: [] },
      }),
    },
    host: { params: { backend: "engine" } },
  });
  await app.waitFor("Cached native account ready");
  expect(app.texts()).toContain("backend:engine");
  expect(app.texts()).toContain("health:starting");

  await app.press("id:native-mount");
  await app.waitFor("text:health:ready");
  await app.press("id:native-refetch");
  await app.press("id:native-volume-31");
  await app.waitFor("text:raw-volume:0.31");
  await app.waitFor("text:native-volume:0.31");

  await app.press("id:native-unmount");
  expect(app.shows("id:cached-spotify-mounted")).toBe(false);
  await app.press("id:native-volume-47");
  await app.waitFor("text:raw-volume:0.47");
  await app.waitFor("text:native-volume:0.47");

  await app.press("id:native-mount");
  await app.waitFor("id:cached-spotify-mounted");
  await app.press("id:native-refetch");
  await app.press("id:native-volume-73");
  await app.waitFor("text:raw-volume:0.73");
  await app.waitFor("text:native-volume:0.73");
});
