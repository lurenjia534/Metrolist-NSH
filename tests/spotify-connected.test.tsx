// The normal Web/Android/iOS backend and production API mappings, driven by an
// explicit host-protocol fixture and recorded HTTP shapes. No DemoBackend.
import { expect, open, test, type StubRequest } from "nsh/test";

const artist = { type: "artist", uri: "spotify:artist:protocolartist", name: "Protocol Artist", images: [] };
const album = { type: "album", uri: "spotify:album:protocolalbum", name: "Protocol Album", artists: [artist], images: [], release_date: "2026-11-01" };
const track = (id = "protocol1") => ({ type: "track", uri: `spotify:track:${id}`, name: id === "protocol2" ? "Protocol Song Two" : "Protocol Song One", artists: [artist], album, duration_ms: 180000, explicit: false, is_playable: true });
const playlist = { type: "playlist", uri: "spotify:playlist:protocolplaylist", name: "Owned Protocol Playlist", description: "From the connected account's API response.", owner: { id: "protocol-account", display_name: "Protocol Account" }, images: [] };
const page = (items: unknown[]) => ({ items, total: items.length, next: null });

const network = {
  "GET https://gateway.test/api/home": { body: { sections: [] } },
  "GET https://api.spotify.com/v1/me": { body: { id: "protocol-user-name", account_id: "protocol-stable-account", display_name: "Protocol Account", images: [] } },
  "GET https://api.spotify.com/v1/me/playlists?*": { body: page([playlist]) },
  "GET https://api.spotify.com/v1/me/albums?*": { body: page([]) },
  "GET https://api.spotify.com/v1/me/following?*": { body: { artists: page([]) } },
  "GET https://api.spotify.com/v1/me/tracks?*": { body: page([{ track: track(), added_at: "2026-11-01" }]) },
  "GET https://api.spotify.com/v1/me/player/recently-played?*": { body: page([{ track: track() }]) },
  "GET https://api.spotify.com/v1/me/library/contains?*": { body: [false] },
  "PUT https://api.spotify.com/v1/me/library?*": { status: 200, body: "" },
  "DELETE https://api.spotify.com/v1/me/library?*": { status: 200, body: "" },
  "GET https://api.spotify.com/v1/playlists/protocolplaylist": { body: { ...playlist, items: page([
    { item: null }, { item: { type: "episode", uri: "spotify:episode:protocolepisode" } },
    { item: track(), added_at: "2026-11-01" }, { item: track("protocol2"), added_at: "2026-11-02" },
  ]) } },
  "GET https://api.spotify.com/v1/search?*": { body: { tracks: page([track("protocol2")]), albums: page([album]), artists: page([artist]), playlists: page([playlist]) } },
  "GET https://api.spotify.com/v1/tracks/*": (request: StubRequest) => ({ body: track(request.url.endsWith("protocol2") ? "protocol2" : "protocol1") }),
  "GET https://lrclib.net/api/get?*": { body: { syncedLyrics: "[00:00.00]First protocol line\n[00:20.00]Second protocol line", plainLyrics: "First protocol line\nSecond protocol line", instrumental: false } },
};

for (const platform of ["web", "android", "ios"] as const) {
  test(`${platform} connects the normal backend, loads the account and keeps subscriptions after switching`, async () => {
    const app = await open("./spotify-connected/app.tsx", {
      platform, width: platform === "web" ? 1280 : 390, height: 1060,
      storage: {
        "metrolist.provider": "spotify",
        "metrolist.settings": JSON.stringify({ autoRadio: false, apiBase: "https://gateway.test" }),
      },
      network,
      host: { handlers: {
        "app.start": null, "app.metadata": null, "app.playback": null,
        "app.audio.settings": null, "app.audio.snapshot": null, "auth.available": { available: false },
      } },
    });
    await app.waitFor("id:spotify-connect");
    await app.waitFor("id:spotify-client-id");
    expect(app.shows("id:spotify-demo-banner")).toBe(false);
    expect(app.texts()).not.toContain("Good evening, Ada");
    expect(app.requests().some(request => request.url.startsWith("https://api.spotify.com/"))).toBe(false);

    await app.type("id:spotify-client-id", "protocol-public-client-id");
    await app.press("role:button[保存并登录 Spotify]");
    await app.waitFor("role:button[Owned Protocol Playlist]");
    await app.waitUntil(() => app.storage()["spotify:session:account"] === "protocol-stable-account");
    expect(app.storage()["metrolist.provider"]).toBe("spotify");
    const profileRequest = app.requests().find(request => request.url === "https://api.spotify.com/v1/me")!;
    expect(profileRequest.headers.authorization ?? profileRequest.headers.Authorization).toBe("Bearer protocol-account-token");

    await app.press("role:button[Owned Protocol Playlist]");
    await app.waitFor("role:button[Protocol Song One, Protocol Artist]");
    await app.press("role:button[Protocol Song One, Protocol Artist]");
    const bar = platform === "web" ? "id:player" : "id:mini-player";
    await app.waitFor(`${bar} >> role:button[Pause]`);
    expect(app.audio().filter(command => command.command === "open")).toHaveLength(0);

    if (platform === "web") {
      await app.press("id:player >> role:button[Save to Liked Songs]");
      await app.waitUntil(() => app.requests().some(request => request.method === "PUT" && request.url.includes("/me/library?")));
      await app.waitFor("id:player >> role:button[Remove from Liked Songs]");
    }

    await app.press("id:provider-youtube");
    await app.waitFor("id:metrolist-app");
    expect(app.shows("id:spotify-workspace")).toBe(false);
    await app.press("id:provider-spotify");
    await app.waitFor(`${bar} >> role:button[Play]`);
    expect(app.texts()).toContain("Protocol Song One");
    if (platform !== "web") {
      await app.press("id:mini-player >> role:button[Open Now Playing: Protocol Song One]");
      await app.waitFor("id:now-playing-content >> role:button[Next]");
    }
    await app.press(platform === "web" ? "id:player >> role:button[Next]" : "id:now-playing-content >> role:button[Next]");
    // Next has no optimistic song metadata: this proves the remounted UI
    // still receives its backend's event subscription.
    await app.waitFor(platform === "web" ? "id:player >> text:Protocol Song Two" : "id:now-playing-content >> text:Protocol Song Two");
    if (platform === "web") {
      await app.press("role:button[Search]");
      await app.waitFor("label:Search Spotify");
      await app.type("label:Search Spotify", "Protocol");
      await app.submit("label:Search Spotify");
      await app.waitFor("role:button[Protocol Song Two, Protocol Artist]");
      expect(app.requests().some(request => request.url.includes("/search?") && request.url.includes("limit=10"))).toBe(true);
      await app.press("id:player >> role:button[Lyrics]");
      await app.waitFor("First protocol line");
      expect(app.requests().some(request => request.url.startsWith("https://lrclib.net/api/get?"))).toBe(true);
    }
  });
}
