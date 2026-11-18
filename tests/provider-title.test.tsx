import { expect, open, test } from "nsh/test";

const storage = {
  "metrolist.settings": JSON.stringify({ autoRadio: false, apiBase: "https://gateway.test" }),
  "spotify:firstRun:done": "1",
};
const network = { "GET https://gateway.test/api/home": { body: { sections: [] } } };
const host = {
  params: { backend: "demo", premium: true },
  handlers: { "app.start": null, "app.metadata": null, "app.playback": null, "app.audio.settings": null, "app.audio.snapshot": null, "app.audio.pause": null, "auth.available": { available: false } },
};

for (const platform of ["android", "ios", "web"] as const) test(`${platform} phone heads its tabs with the service, which opens the services`, async () => {
  const app = await open("../App.tsx", { width: 390, height: 844, platform, safeArea: { top: 24, right: 0, bottom: 24, left: 0 }, storage, network, host });
  await app.waitFor("id:metrolist-app");
  // No bar of services over the pages: the header's title names the service.
  expect(app.shows("id:provider-status")).toBe(false);
  expect(app.shows("id:provider-spotify")).toBe(false);
  await app.waitFor("id:provider-switcher >> text:YouTube Music");

  // The other tabs keep it; a page opened over them has its own title.
  await app.press("id:nav-mobile-library"); await app.waitFor("id:library-toolbar");
  await app.waitFor("id:provider-switcher >> text:YouTube Music");
  await app.press("id:header-settings"); await app.waitFor("id:content-settings");
  expect(app.shows("id:provider-switcher")).toBe(false);
  await app.press("id:nav-mobile-home"); await app.waitFor("id:page-home");

  await app.press("id:provider-switcher");
  await app.waitFor("id:provider-youtube >> text:正在使用");
  await app.press("id:provider-spotify");
  await app.waitFor("id:spotify-workspace");
  await app.waitFor("Good evening, Ada");
  await app.waitFor("id:provider-switcher >> text:Spotify");
  expect(app.storage()["metrolist.provider"]).toBe("spotify");
  expect(app.shows("id:metrolist-app")).toBe(false);

  // A playlist opened from Spotify's home is no root: Back, not the service.
  await app.press("Morning Static");
  await app.waitFor("Soft starts for slow mornings.");
  expect(app.shows("id:page-spotify:playlist:morningstatic >> id:provider-switcher")).toBe(false);
  await app.back();
  await app.waitFor("id:provider-switcher >> text:Spotify");

  await app.press("id:provider-switcher");
  await app.press("id:provider-youtube");
  await app.waitFor("id:metrolist-app");
  await app.waitFor("id:provider-switcher >> text:YouTube Music");
  expect(app.storage()["metrolist.provider"]).toBe("youtube");
});

test("a desktop window keeps the services across its top", async () => {
  const app = await open("../App.tsx", { width: 1440, height: 940, platform: "web", storage, network, host });
  await app.waitFor("id:metrolist-app");
  expect(app.shows("id:provider-status")).toBe(true);
  expect(app.shows("id:provider-current")).toBe(false);
  await app.press("id:provider-spotify");
  await app.waitFor("id:spotify-workspace");
  expect(app.shows("id:provider-status")).toBe(true);
});
