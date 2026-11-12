import { expect, open, test } from "nsh/test";

const track = {
  id: "workspace-youtube",
  title: "YouTube workspace song",
  artist: "YouTube artist",
  album: "Independent queue",
  artwork: "",
  duration: 180,
  source: "youtube",
};
const storage = {
  "metrolist.settings": JSON.stringify({ autoRadio: false, apiBase: "https://gateway.test" }),
  "spotify:firstRun:done": "1",
};
const network = {
  "GET https://gateway.test/api/home": { body: { sections: [] } },
  "GET https://gateway.test/api/suggestions?q=*": { body: { query: "Workspace", suggestions: [] } },
  "GET https://gateway.test/api/search?q=Workspace&type=all": { body: { query: "Workspace", type: "all", items: [track] } },
  "GET https://gateway.test/api/stream?id=*": { body: { url: "https://audio.test/workspace.m4a", mimeType: "audio/mp4", bitrate: 128000 } },
  "GET https://gateway.test/api/lyrics?*": { body: { plainLyrics: "", syncedLyrics: "", lines: [], instrumental: true } },
};
const host = {
  params: { backend: "demo", premium: true },
  handlers: { "app.start": null, "app.metadata": null, "app.playback": null },
};
const unconfiguredSpotify = {
  player: {}, signedIn: false, authRevision: 0, deviceId: "",
  health: { status: "failed", error: { code: "E_CONFIG", message: "Configure Spotify to connect." } },
  configuration: { clientId: "", redirectUri: "app.miku.metrolist://spotify-callback", configured: false },
  capabilities: { volume: false, lyrics: true },
};

test("switching keeps each service's page and queue and pauses the previous player", async () => {
  const app = await open("../App.tsx", { width: 1440, height: 940, platform: "web", storage, network, host });
  await app.waitFor("id:metrolist-app");
  await app.press("id:nav-search");
  await app.type("id:search-input", "Workspace");
  await app.submit("id:search-input");
  await app.press("id:play-track-workspace-youtube");
  await app.waitFor("id:mini-player");
  await app.waitUntil(() => app.host.calls().some((call) => call.name === "app.playback" && (call.data as { playing?: boolean }).playing === true));
  const opened = app.audio().filter((call) => call.command === "open").length;
  const pauses = app.audio().filter((call) => call.command === "pause").length;

  await app.press("id:provider-spotify");
  await app.waitFor("id:spotify-workspace");
  await app.waitFor("Good evening, Ada");
  expect(app.shows("id:metrolist-app")).toBe(false);
  expect(app.audio().filter((call) => call.command === "pause").length).toBeGreaterThan(pauses);
  expect(app.storage()["metrolist.provider"]).toBe("spotify");
  const youtubeCommands = app.audio().length;
  await app.host.send("media.command", { action: "play" });
  await app.host.send("media.command", { action: "seek", value: 35 });
  expect(app.audio()).toHaveLength(youtubeCommands);
  await app.press("role:button[Morning Static]");
  await app.waitFor("role:button[Slow River, The Quiet Fields]");
  await app.press("role:button[Slow River, The Quiet Fields]");
  await app.waitFor("id:player >> role:button[Pause]");

  await app.press("id:provider-youtube");
  await app.waitFor("id:metrolist-app");
  await app.waitFor("id:search-input");
  expect(app.value("id:search-input")).toBe("Workspace");
  expect(app.shows("id:spotify-workspace")).toBe(false);
  expect(app.texts()).toContain(track.title);
  expect(app.storage()["metrolist.provider"]).toBe("youtube");
  expect(app.audio().filter((call) => call.command === "open")).toHaveLength(opened);
  const resumes = app.audio().filter((call) => call.command === "resume").length;
  await app.host.send("media.command", { action: "play" });
  await app.waitUntil(() => app.audio().filter((call) => call.command === "resume").length > resumes);
  expect(app.audio().filter((call) => call.command === "resume").length).toBeGreaterThan(resumes);

  await app.press("id:provider-spotify");
  await app.waitFor("Soft starts for slow mornings.");
  await app.waitFor("id:player >> role:button[Play]");
  expect(app.texts()).toContain("Slow River");
  expect(app.audio().filter((call) => call.command === "open")).toHaveLength(opened);
});

test("Spotify preferences stay separate when switching back to YouTube Music", async () => {
  const originalSettings = storage["metrolist.settings"];
  const app = await open("../App.tsx", {
    width: 1280,
    height: 900,
    platform: "web",
    storage: { ...storage, "metrolist.provider": "spotify" },
    network,
    host,
  });
  await app.waitFor("id:spotify-workspace");
  await app.waitFor("Good evening, Ada");
  await app.press("role:button[Morning Static]");
  await app.press("role:button[Slow River, The Quiet Fields]");
  await app.waitFor("id:player >> role:button[Pause]");
  await app.press("id:player >> role:button[Light: Dots]");
  await app.press("role:menuitemradio[Random]");
  expect(app.storage()["spotify:visual:effect"]).toBe("random");
  await app.press("id:provider-youtube");
  await app.waitFor("id:metrolist-app");
  expect(JSON.parse(app.storage()["metrolist.settings"]).apiBase).toBe(JSON.parse(originalSettings).apiBase);
  expect(app.storage()["spotify:visual:effect"]).toBe("random");
  expect(app.storage()["visual:effect"]).toBeUndefined();
});

for (const platform of ["web", "android", "ios"] as const) {
  test(`${platform} restores the real Spotify connection and can return to YouTube Music`, async () => {
    const app = await open("../SpotifyConnectedTest.tsx", {
      width: 390,
      height: 844,
      platform,
      safeArea: { top: 24, right: 0, bottom: 24, left: 0 },
      storage: { ...storage, "metrolist.provider": "spotify" },
      network,
    });
    await app.waitFor("id:spotify-connect");
    await app.waitFor("id:spotify-client-id");
    expect(app.shows("id:spotify-demo-banner")).toBe(false);
    expect(app.texts()).not.toContain("Good evening, Ada");
    await app.press("id:provider-youtube");
    await app.waitFor("id:metrolist-app");
    await app.waitFor("id:nav-mobile-home");
    await app.press("id:provider-spotify");
    await app.waitFor("id:spotify-connect");
    expect(app.storage()["metrolist.provider"]).toBe("spotify");
  });
}

test("Android hands notification and headset controls to the selected workspace", async () => {
  const app = await open("../SpotifyConnectedTest.tsx", {
    width: 390,
    height: 844,
    platform: "android",
    storage,
    network,
    host: {
      handlers: {
        ...host.handlers,
        "app.spotify.snapshot": unconfiguredSpotify,
        "app.spotify.setActive": unconfiguredSpotify,
        "app.spotify.pause": null,
        "app.audio.settings": null,
        "app.audio.pause": null,
        "app.audio.play": null,
        "app.audio.snapshot": {
          requestId: 73, state: "playing", position: 12, duration: 180,
          bufferedPosition: 100, playing: true, buffering: false, playWhenReady: true, track,
        },
        "auth.available": { available: false },
      },
    },
  });
  const controlSettings = () => app.host.calls().filter(call => call.name === "app.audio.settings").map(call => call.data);
  const plays = () => app.host.calls().filter(call => call.name === "app.audio.play").length;
  await app.waitFor("id:metrolist-app");
  expect(controlSettings().at(-1)).toMatchObject({ remoteControlled: false });

  await app.press("id:provider-spotify");
  await app.waitFor("id:spotify-connect");
  // Android's media service handles play/pause directly, so the native
  // command gate must change as well as the JS host-event handler.
  expect(controlSettings().at(-1)).toMatchObject({ remoteControlled: true });
  expect(app.host.calls().some(call => call.name === "app.audio.pause")).toBe(true);
  const before = plays();
  await app.host.send("media.command", { action: "play" });
  expect(plays()).toBe(before);

  await app.press("id:provider-youtube");
  await app.waitFor("id:metrolist-app");
  expect(controlSettings().at(-1)).toMatchObject({ remoteControlled: false });
  await app.host.send("media.command", { action: "play" });
  expect(plays()).toBeGreaterThan(before);
});
