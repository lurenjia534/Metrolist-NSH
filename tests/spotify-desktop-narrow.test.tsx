import { expect, open, test } from "nsh/test";
import { collection } from "../src/spotish/backend/fixtures";

function narrowDesktop(signedIn = true) {
  return open("../App.tsx", {
    platform: "linux",
    width: 340,
    height: 600,
    storage: {
      "metrolist.provider": "spotify",
      "metrolist.settings": JSON.stringify({ apiBase: "https://gateway.test" }),
      "spotify:firstRun:done": "1",
    },
    network: { "GET https://gateway.test/api/home": { body: { sections: [] } } },
    host: { params: { backend: "demo", premium: true, signedIn } },
  });
}

test("340px native desktop keeps search, next and the light menu independently clickable", async () => {
  const app = await narrowDesktop();
  await app.waitFor("Good evening, Ada");
  await app.press("role:button[Search]");
  await app.waitFor("id:page-search");
  await app.type("label:Search Spotify", "Morning Static");
  await app.waitFor("id:page-search >> role:button[Morning Static, Playlist · Demo]");
  expect(app.value("label:Search Spotify")).toBe("Morning Static");
  await app.press("id:page-search >> role:button[Morning Static, Playlist · Demo]");
  await app.waitFor("Soft starts for slow mornings.");
  await app.press("id:page-spotify:playlist:morningstatic >> role:button[Play]");
  const tracks = collection("spotify:playlist:morningstatic")!.tracks;
  await app.waitFor(`id:player >> text:${tracks[0].name}`);

  // These are pointer presses through the actual root shell, not calls
  // to the player store: each button must reach its own hit target.
  await app.press("id:player >> role:button[Next]");
  await app.waitFor(`id:player >> text:${tracks[1].name}`);
  expect(app.shows("role:menuitemradio[Random]")).toBe(false);
  await app.press("id:player >> role:button[Light: Dots]");
  await app.waitFor("role:menuitemradio[Random]");
  await app.press("role:menuitemradio[Random]");
  await app.waitFor(`id:player >> text:${tracks[1].name}`);
  expect(app.storage()["spotify:visual:effect"]).toBe("random");
  await app.press("id:player >> role:button[Next]");
  await app.waitFor(`id:player >> text:${tracks[2].name}`);
  expect(app.shows("role:menuitemradio[Random]")).toBe(false);
  await app.press("id:provider-youtube");
  await app.waitFor("id:metrolist-app");
});

test("340px native desktop retains login and navigation when its sidebar is folded", async () => {
  const app = await narrowDesktop(false);
  await app.waitFor("id:page-home >> role:toolbar[Header] >> role:button[Log in]");
  await app.press("role:button[Collapse sidebar]");
  await app.press("role:button[Search]");
  await app.waitFor("label:Search Spotify");
  await app.type("label:Search Spotify", "Kites");
  await app.waitFor("role:button[Kites, The Quiet Fields]");
  await app.press("id:page-search >> role:toolbar[Header] >> role:button[Log in]");
  await app.waitFor("role:button[User menu: Ada]");
  expect(app.shows("role:button[Go back]")).toBe(true);
  expect(app.shows("role:button[Go forward]")).toBe(true);
  expect(app.shows("role:button[Close window]")).toBe(true);
  await app.press("role:button[Expand sidebar]");
  expect(app.value("label:Search Spotify")).toBe("Kites");
});
