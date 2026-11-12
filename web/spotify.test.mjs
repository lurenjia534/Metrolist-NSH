import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { createSpotifyHost, SPOTIFY_STORAGE } from "./spotify.js";

// Protocol tests use artificial tokens and a transport/SDK fixture. They test
// the real host lifecycle without claiming a real Spotify account played audio.
class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
class DocumentEvents {
  listeners = new Map();
  visibilityState = "visible";
  addEventListener(name, callback) {
    const callbacks = this.listeners.get(name) || new Set();
    callbacks.add(callback); this.listeners.set(name, callbacks);
  }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  dispatch(name, event = { isTrusted: true }) { for (const callback of this.listeners.get(name) || []) callback({ type: name, ...event }); }
}
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const turn = () => new Promise(resolve => setImmediate(resolve));
const CLIENT = "fixture-spotify-client";
const playerState = (overrides = {}) => ({
  paused: false, position: 12500, duration: 183450, shuffle: true, repeat_mode: 1,
  context: { uri: "spotify:playlist:fixturelist" }, disallows: { skipping_next: false, skipping_prev: true },
  track_window: { current_track: { type: "track", uri: "spotify:track:fixturetrack", name: "Fixture Song", artists: [{ name: "Fixture Artist" }], album: { name: "Fixture Album", images: [{ url: "https://images.test/cover" }] } } },
  ...overrides,
});

function setup({ configured = true, authenticated = false, expiresAt = 3700000, storage = new MemoryStorage(), sessionStorage = new MemoryStorage(), href = "https://metrolist.test/", fetch: transport, loadSdk, ios = false, crypto = webcrypto } = {}) {
  if (configured && !storage.getItem(SPOTIFY_STORAGE.configuration)) storage.setItem(SPOTIFY_STORAGE.configuration, JSON.stringify({ clientId: CLIENT, redirectUri: "https://metrolist.test/" }));
  if (authenticated) storage.setItem(SPOTIFY_STORAGE.tokens, JSON.stringify({ clientId: CLIENT, accessToken: "fixture-access", refreshToken: "fixture-refresh", expiresAt }));
  const document = new DocumentEvents();
  const requests = [];
  const events = [];
  const instances = [];
  let clock = 100000;
  const location = new URL(href);
  location.assign = url => { location.assigned = url; };
  const history = { state: null, replaceState(_state, _title, url) { location.href = url; } };
  class Player {
    events = new Map();
    calls = [];
    state = null;
    constructor(options) { this.options = options; instances.push(this); }
    addListener(name, callback) { this.events.set(name, callback); }
    emit(name, value) { this.events.get(name)?.(value); }
    async connect() {
      this.token = await new Promise(resolve => this.options.getOAuthToken(resolve));
      this.emit("ready", { device_id: "fixture-browser-device" });
      return true;
    }
    disconnect() { this.calls.push(["disconnect"]); }
    async getCurrentState() { return this.state; }
    async activateElement() { this.calls.push(["activateElement"]); }
    async resume() { this.calls.push(["resume"]); }
    async pause() { this.calls.push(["pause"]); }
    async nextTrack() { this.calls.push(["next"]); }
    async previousTrack() { this.calls.push(["previous"]); }
    async seek(ms) { this.calls.push(["seek", ms]); }
    async setVolume(volume) { this.calls.push(["volume", volume]); }
  }
  const fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (transport) return transport(String(url), options);
    if (String(url).includes("/me/library/contains?")) return Response.json([true]);
    if (String(url).startsWith("https://api.spotify.com/v1/me/player")) return new Response(null, { status: 204 });
    if (String(url).startsWith("https://api.spotify.com/v1/me/library?")) return new Response(null, { status: 200 });
    if (String(url) === "https://api.spotify.com/v1/me") return Response.json({ id: "fixture-user", account_id: "fixture-stable-account", display_name: "Fixture User", images: [] });
    throw new Error(`Unexpected network request: ${url}`);
  };
  const host = createSpotifyHost({ hostEvent(name, value) { events.push({ name, value }); } }, {
    document, location, history, storage, sessionStorage, crypto, fetch,
    navigator: { userAgent: ios ? "iPhone" : "Fixture Browser", platform: ios ? "iPhone" : "Linux", maxTouchPoints: ios ? 5 : 0 },
    now: () => clock, loadSdk: loadSdk || (async () => ({ Player })),
  });
  return {
    host, document, location, storage, sessionStorage, requests, events, instances, Player,
    call: (method, args) => host.call(`app.spotify.${method}`, args),
    snapshot: () => host.call("app.spotify.snapshot"),
    advance(ms) { clock += ms; },
  };
}

test("imports, construction and unconfigured activation do not start a player or substitute demo data", async () => {
  const fixture = setup({ configured: false });
  assert.equal(fixture.snapshot().configuration.configured, false);
  assert.equal(fixture.snapshot().health.error.code, "E_CONFIG");
  assert.equal(fixture.snapshot().player.title, "");
  await fixture.call("activate");
  assert.equal(fixture.instances.length, 0);
  assert.equal(fixture.requests.length, 0);
  await assert.rejects(fixture.call("home"), /E_CONFIG/);
  await fixture.call("configure", { clientId: CLIENT });
  assert.equal(fixture.snapshot().configuration.redirectUri, "https://metrolist.test/");
  assert.equal(fixture.snapshot().health.status, "ready");
  await fixture.call("activate");
  assert.equal(fixture.snapshot().signedIn, false);
  assert.equal(fixture.instances.length, 0);
  fixture.host.dispose();
});

test("PKCE redirects with a verified S256 challenge and exchanges only the matching callback", async () => {
  const first = setup();
  await first.call("signIn");
  const authorize = new URL(first.location.assigned);
  const pending = JSON.parse(first.sessionStorage.getItem(SPOTIFY_STORAGE.authorization));
  assert.equal(authorize.origin + authorize.pathname, "https://accounts.spotify.com/authorize");
  assert.equal(authorize.searchParams.get("client_id"), CLIENT);
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorize.searchParams.get("show_dialog"), "true");
  assert.equal(authorize.searchParams.get("code_challenge"), createHash("sha256").update(pending.verifier).digest("base64url"));
  assert.match(authorize.searchParams.get("scope"), /streaming/);
  assert.match(authorize.searchParams.get("scope"), /app-remote-control/);
  assert.equal(authorize.searchParams.get("state"), pending.state);
  assert.equal(first.requests.length, 0);
  first.host.dispose();
  const returned = setup({ storage: first.storage, sessionStorage: first.sessionStorage, href: `https://metrolist.test/?code=fixture-code&state=${pending.state}`, fetch: async (url, options) => {
    assert.equal(url, "https://accounts.spotify.com/api/token");
    const form = options.body;
    assert.equal(form.get("code_verifier"), pending.verifier);
    assert.equal(form.get("code"), "fixture-code");
    assert.equal(form.get("redirect_uri"), "https://metrolist.test/");
    assert.equal(form.get("client_id"), CLIENT);
    assert.equal(options.headers.Authorization, undefined);
    return Response.json({ access_token: "fixture-issued", refresh_token: "fixture-refresh-issued", expires_in: 3600 });
  } });
  await returned.call("activate");
  assert.equal(returned.location.search, "");
  assert.equal(returned.sessionStorage.getItem(SPOTIFY_STORAGE.authorization), null);
  assert.equal(returned.instances[0].token, "fixture-issued");
  assert.equal(returned.snapshot().signedIn, true);
  assert.equal(returned.snapshot().health.status, "ready");
  assert.equal(returned.snapshot().authRevision, 1);
  assert.equal(returned.snapshot().deviceId, "fixture-browser-device");
  assert.equal(JSON.stringify(returned.events).includes("fixture-issued"), false);
  returned.host.dispose();
});

test("a mismatched OAuth callback is rejected before any token exchange", async () => {
  const fixture = setup({ href: "https://metrolist.test/?code=fixture-code&state=wrong-state" });
  fixture.sessionStorage.setItem(SPOTIFY_STORAGE.authorization, JSON.stringify({ clientId: CLIENT, state: "right-state", verifier: "fixture-verifier", redirectUri: "https://metrolist.test/" }));
  await fixture.call("activate");
  assert.equal(fixture.snapshot().health.error.code, "E_AUTH_STATE");
  assert.equal(fixture.requests.length, 0);
  assert.equal(fixture.instances.length, 0);
  fixture.host.dispose();
});

test("switching away while PKCE is being prepared does not redirect the new workspace", async () => {
  const gate = deferred();
  const fixture = setup({ crypto: {
    getRandomValues: bytes => webcrypto.getRandomValues(bytes),
    subtle: { digest: async (...args) => { await gate.promise; return webcrypto.subtle.digest(...args); } },
  } });
  await fixture.call("activate");
  const login = fixture.call("signIn");
  const cancelled = assert.rejects(login, /E_CANCELLED/);
  assert.equal(fixture.snapshot().health.status, "signingIn");
  await fixture.call("setActive", { active: false });
  gate.resolve();
  await cancelled;
  assert.equal(fixture.location.assigned, undefined);
  assert.equal(fixture.sessionStorage.getItem(SPOTIFY_STORAGE.authorization), null);
  fixture.host.dispose();
});

test("concurrent token consumers refresh once and retain a non-rotated refresh token", async () => {
  const gate = deferred();
  let refreshCount = 0;
  const fixture = setup({ authenticated: true, expiresAt: 100001, fetch: async (url, options) => {
    assert.equal(url, "https://accounts.spotify.com/api/token");
    assert.equal(options.body.get("grant_type"), "refresh_token");
    assert.equal(options.body.get("client_id"), CLIENT);
    assert.equal(options.body.get("refresh_token"), refreshCount ? "fixture-rotated" : "fixture-refresh");
    refreshCount++;
    if (refreshCount === 1) { await gate.promise; return Response.json({ access_token: "fixture-renewed", refresh_token: "fixture-rotated", expires_in: 3600 }); }
    return Response.json({ access_token: "fixture-renewed-again", expires_in: 3600 });
  } });
  const first = fixture.call("token");
  const second = fixture.call("token");
  await turn();
  assert.equal(refreshCount, 1);
  gate.resolve();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b);
  assert.equal(a.accessToken, "fixture-renewed");
  fixture.advance(3600000);
  assert.equal((await fixture.call("token")).accessToken, "fixture-renewed-again");
  assert.equal(JSON.parse(fixture.storage.getItem(SPOTIFY_STORAGE.tokens)).refreshToken, "fixture-rotated");
  fixture.host.dispose();
});

test("revoked refresh credentials require login without retrying or keeping a false account", async () => {
  const fixture = setup({ authenticated: true, expiresAt: 100001, fetch: async () => Response.json({ error: "invalid_grant", error_description: "Fixture revoked" }, { status: 400 }) });
  await fixture.call("activate");
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.snapshot().signedIn, false);
  assert.equal(fixture.snapshot().health.error.code, "E_AUTH");
  assert.equal(fixture.storage.getItem(SPOTIFY_STORAGE.tokens), null);
  assert.equal(fixture.instances.length, 0);
  fixture.host.dispose();
});

test("cancelling an OAuth exchange prevents its late token from signing the account back in", async () => {
  const gate = deferred();
  const fixture = setup({ href: "https://metrolist.test/?code=fixture-code&state=fixture-state", fetch: async () => {
    await gate.promise;
    return Response.json({ access_token: "late-fixture-access", refresh_token: "late-fixture-refresh", expires_in: 3600 });
  } });
  fixture.sessionStorage.setItem(SPOTIFY_STORAGE.authorization, JSON.stringify({ clientId: CLIENT, state: "fixture-state", verifier: "fixture-verifier", redirectUri: "https://metrolist.test/" }));
  const activation = fixture.call("activate");
  await turn();
  await fixture.call("cancelSignIn");
  gate.resolve();
  await activation;
  assert.equal(fixture.snapshot().signedIn, false);
  assert.equal(fixture.storage.getItem(SPOTIFY_STORAGE.tokens), null);
  assert.equal(fixture.instances.length, 0);
  fixture.host.dispose();
});

test("SDK events populate real player fields and controls target the local Spotify device", async () => {
  const fixture = setup({ authenticated: true });
  assert.equal(fixture.instances.length, 0);
  await fixture.call("activate");
  const instance = fixture.instances[0];
  assert.equal(instance.options.enableMediaSession, false);
  instance.state = playerState();
  instance.emit("player_state_changed", instance.state);
  await turn();
  assert.deepEqual(fixture.snapshot().player, {
    title: "Fixture Song", artist: "Fixture Artist", album: "Fixture Album", artwork: "https://images.test/cover",
    trackUri: "spotify:track:fixturetrack", contextUri: "spotify:playlist:fixturelist", playing: true,
    positionMs: 12500, durationMs: 183450, at: 100000, shuffle: true, shuffleAvailable: true,
    repeat: "context", volume: 1, muted: false, liked: true, canNext: true, canPrevious: false, ad: false, premium: true,
  });
  await fixture.call("seek", { ms: 24000 });
  await fixture.call("next");
  await fixture.call("previous");
  await fixture.call("setVolume", { volume: 0.4 });
  await fixture.call("setMuted", { on: true });
  assert.equal(fixture.snapshot().player.volume, 0.4);
  await fixture.call("setMuted", { on: false });
  await fixture.call("playContext", { uri: "spotify:album:fixturealbum", trackUri: "spotify:track:fixturetrack" });
  await fixture.call("setShuffle", { on: false });
  await fixture.call("setRepeat", { mode: "track" });
  await fixture.call("setLiked", { on: false });
  assert.deepEqual(instance.calls, [["seek", 24000], ["next"], ["previous"], ["volume", 0.4], ["volume", 0], ["volume", 0.4]]);
  const play = fixture.requests.find(value => value.url.includes("/me/player/play?"));
  assert.equal(new URL(play.url).searchParams.get("device_id"), "fixture-browser-device");
  assert.deepEqual(JSON.parse(play.options.body), { context_uri: "spotify:album:fixturealbum", offset: { uri: "spotify:track:fixturetrack" } });
  assert.equal(fixture.requests.some(value => value.url.includes("shuffle?state=false&device_id=")), true);
  assert.equal(fixture.requests.some(value => value.url.includes("repeat?state=track&device_id=")), true);
  assert.equal(fixture.snapshot().player.liked, false);
  fixture.host.dispose();
});

test("first play transfers to the browser instead of accidentally controlling a remote device", async () => {
  const fixture = setup({ authenticated: true });
  await fixture.call("activate");
  await fixture.call("play");
  const transfer = fixture.requests.find(value => value.url === "https://api.spotify.com/v1/me/player");
  assert.deepEqual(JSON.parse(transfer.options.body), { device_ids: ["fixture-browser-device"], play: true });
  fixture.host.dispose();
});

test("switching workspaces waits for an accepted playback request and then pauses the local player", async () => {
  const gate = deferred();
  const fixture = setup({ authenticated: true, fetch: async url => {
    assert.match(url, /\/me\/player\/play\?device_id=fixture-browser-device/);
    await gate.promise;
    return new Response(null, { status: 204 });
  } });
  await fixture.call("activate");
  const play = fixture.call("playTrack", { uri: "spotify:track:fixturetrack" });
  await turn();
  let switched = false;
  const deactivate = fixture.call("setActive", { active: false }).then(() => { switched = true; });
  await turn();
  assert.equal(switched, false);
  gate.resolve();
  await Promise.all([play, deactivate]);
  assert.equal(switched, true);
  assert.deepEqual(fixture.instances[0].calls.at(-1), ["pause"]);
  await assert.rejects(fixture.call("playTrack", { uri: "spotify:track:fixturetrack" }), /E_INACTIVE/);
  fixture.instances[0].emit("player_state_changed", playerState({ track_window: { current_track: { ...playerState().track_window.current_track, uri: "" } } }));
  assert.deepEqual(fixture.instances[0].calls.at(-1), ["pause"]);
  fixture.host.dispose();
});

test("a playback command waiting for token renewal is cancelled before HTTP after a provider switch", async () => {
  const gate = deferred();
  const fixture = setup({ authenticated: true, fetch: async url => {
    assert.equal(url, "https://accounts.spotify.com/api/token");
    await gate.promise;
    return Response.json({ access_token: "fixture-renewed", expires_in: 3600 });
  } });
  await fixture.call("activate");
  fixture.advance(3600000);
  const play = fixture.call("playTrack", { uri: "spotify:track:fixturetrack" });
  const rejection = assert.rejects(play, /E_INACTIVE/);
  await turn();
  const deactivate = fixture.call("setActive", { active: false });
  gate.resolve();
  await Promise.all([rejection, deactivate]);
  assert.equal(fixture.requests.length, 1);
  assert.deepEqual(fixture.instances[0].calls, [["pause"]]);
  fixture.host.dispose();
});

test("trusted top-level gestures activate the SDK synchronously and iOS uses hardware volume", async () => {
  const fixture = setup({ authenticated: true, ios: true });
  await fixture.call("activate");
  const instance = fixture.instances[0];
  fixture.document.dispatch("pointerdown", { isTrusted: true, pointerType: "touch" });
  assert.deepEqual(instance.calls, []);
  fixture.document.dispatch("click");
  assert.deepEqual(instance.calls, [["activateElement"]]);
  assert.equal(fixture.snapshot().capabilities.volume, false);
  await assert.rejects(fixture.call("setVolume", { volume: 0.2 }), /E_VOLUME/);
  instance.emit("autoplay_failed");
  assert.equal(fixture.snapshot().health.status, "ready");
  assert.equal(fixture.events.at(-1).value.code, "E_AUTOPLAY");
  await fixture.call("setActive", { active: false });
  const count = instance.calls.length;
  fixture.document.dispatch("keydown");
  assert.equal(instance.calls.length, count);
  fixture.host.dispose();
  assert.equal(fixture.document.listeners.get("pointerdown").size, 0);
});

test("logout detaches SDK callbacks and prevents a late SDK load from recreating the old player", async () => {
  const gate = deferred();
  const fixture = setup({ authenticated: true, loadSdk: () => gate.promise });
  const activation = fixture.call("activate");
  await turn();
  await fixture.call("signOut");
  gate.resolve({ Player: fixture.Player });
  await activation;
  assert.equal(fixture.instances.length, 0);
  assert.equal(fixture.snapshot().signedIn, false);
  assert.equal(fixture.snapshot().player.title, "");
  fixture.host.dispose();
  const connected = setup({ authenticated: true });
  await connected.call("activate");
  const old = connected.instances[0];
  const volumeReply = deferred();
  old.setVolume = () => volumeReply.promise;
  const oldVolume = connected.call("setVolume", { volume: 0.2 });
  await turn();
  await connected.call("signOut");
  volumeReply.resolve();
  await oldVolume;
  old.emit("player_state_changed", playerState());
  assert.equal(connected.snapshot().player.title, "");
  assert.equal(connected.snapshot().player.volume, 1);
  assert.deepEqual(old.calls, [["disconnect"]]);
  connected.host.dispose();
});

test("switching away during SDK loading allows a later visit to connect normally", async () => {
  const gate = deferred();
  const fixture = setup({ authenticated: true, loadSdk: () => gate.promise });
  const firstVisit = fixture.call("activate");
  await turn();
  await fixture.call("setActive", { active: false });
  gate.resolve({ Player: fixture.Player });
  await firstVisit;
  assert.equal(fixture.instances.length, 0);
  await fixture.call("activate");
  assert.equal(fixture.instances.length, 1);
  assert.equal(fixture.snapshot().deviceId, "fixture-browser-device");
  fixture.host.dispose();
});

test("Premium and DRM failures remain real SDK failures without changing the backend", async () => {
  const fixture = setup({ authenticated: true });
  await fixture.call("activate");
  fixture.instances[0].emit("account_error", { message: "Fixture Premium requirement" });
  assert.equal(fixture.snapshot().player.premium, false);
  assert.equal(fixture.snapshot().health.error.code, "E_PREMIUM");
  assert.equal(fixture.snapshot().player.title, "");
  fixture.instances[0].emit("initialization_error", { message: "Fixture EME unavailable" });
  assert.equal(fixture.snapshot().health.error.code, "E_DRM");
  fixture.host.dispose();
});
