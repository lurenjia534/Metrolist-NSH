import { createSpotifyApi, SPOTIFY_SCOPES } from "./spotify-api.js";

// This module runs in the top-level Web host, where Spotify's DRM audio element
// can receive the original browser gesture. TSX uses app.spotify.* host calls.
export const SPOTIFY_STORAGE = {
  configuration: "metrolist.spotify.configuration.v1",
  tokens: "metrolist.spotify.tokens.v1",
  authorization: "metrolist.spotify.authorization.v1",
};

const emptyPlayer = () => ({
  title: "", artist: "", album: "", artwork: "", trackUri: "", contextUri: "",
  playing: false, positionMs: 0, durationMs: 0, at: 0,
  shuffle: false, shuffleAvailable: false, repeat: "off", volume: 1, muted: false,
  liked: false, canNext: false, canPrevious: false, ad: false, premium: null,
});
const failure = (code, message) => new Error(`${code}: ${message}`);
const errorOf = error => {
  const match = /^(E_[A-Z0-9_]+):\s*([\s\S]*)$/.exec(error instanceof Error ? error.message : String(error));
  return match ? { code: match[1], message: match[2] } : { code: "E_UNKNOWN", message: String(error) };
};
const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

export function createSpotifyHost(shell, options = {}) {
  const browser = options.window || globalThis;
  const document = options.document || browser.document;
  const location = options.location || browser.location;
  const history = options.history || browser.history;
  const storage = options.storage || browser.localStorage;
  const sessionStorage = options.sessionStorage || browser.sessionStorage;
  const crypto = options.crypto || browser.crypto;
  const fetch = options.fetch || browser.fetch.bind(browser);
  const now = options.now || Date.now;
  const read = (store, key) => JSON.parse(store.getItem(key) || "null");
  const savedConfiguration = read(storage, SPOTIFY_STORAGE.configuration);
  let configuration = {
    clientId: options.clientId || savedConfiguration?.clientId || "",
    redirectUri: options.redirectUri || savedConfiguration?.redirectUri || `${location.origin}${location.pathname}`,
  };
  let tokens = read(storage, SPOTIFY_STORAGE.tokens);
  if (tokens?.clientId !== configuration.clientId) tokens = null;
  const navigator = options.navigator || browser.navigator;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let player = emptyPlayer();
  let health = configuration.clientId ? { status: "starting", error: null } : {
    status: "failed", error: { code: "E_CONFIG", message: "Add your Spotify application Client ID and register the displayed redirect URI." },
  };
  let signedIn = tokens ? null : false;
  let authRevision = 0;
  let deviceId = "";
  let active = false;
  let disposed = false;
  let session = 0;
  let ownership = 0;
  let restorePromise;
  let refreshPromise;
  let connectPromise;
  let sdkLoad;
  let sdk;
  let elementActivated = false;
  const commandsInFlight = new Set();

  function snapshot() {
    return {
      player: { ...player }, health: { ...health }, signedIn, authRevision,
      configuration: { ...configuration, configured: Boolean(configuration.clientId) },
      capabilities: { volume: !ios, lyrics: true }, deviceId,
    };
  }
  function emit() { if (!disposed) shell.hostEvent("app.spotify.state", snapshot()); }
  function failed(error) { health = { status: "failed", error: errorOf(error) }; emit(); }
  function asynchronousError(error) { if (!disposed) shell.hostEvent("app.spotify.error", errorOf(error)); }
  function current(expected) {
    if (disposed || expected !== session) throw failure("E_CANCELLED", "This Spotify session has ended.");
  }
  function ownsPlayback(expected) {
    if (!active || expected !== ownership) throw failure("E_INACTIVE", "Switch to the Spotify workspace before starting playback.");
  }
  function requireConfiguration() {
    if (!configuration.clientId) throw failure("E_CONFIG", "Add your Spotify application Client ID and register the displayed redirect URI.");
  }
  function saveTokens(value, previousRefreshToken, expected) {
    current(expected);
    tokens = {
      clientId: configuration.clientId,
      accessToken: value.access_token,
      refreshToken: value.refresh_token || previousRefreshToken,
      expiresAt: now() + value.expires_in * 1000,
    };
    storage.setItem(SPOTIFY_STORAGE.tokens, JSON.stringify(tokens));
    signedIn = true;
    authRevision++;
    emit();
    return tokens.accessToken;
  }
  function disconnectPlayer() {
    const previous = sdk;
    sdk = undefined;
    deviceId = "";
    elementActivated = false;
    connectPromise = undefined;
    previous?.disconnect();
  }
  function clearSession() {
    session++;
    ownership++;
    tokens = null;
    refreshPromise = undefined;
    restorePromise = undefined;
    storage.removeItem(SPOTIFY_STORAGE.tokens);
    sessionStorage.removeItem(SPOTIFY_STORAGE.authorization);
    disconnectPlayer();
    player = emptyPlayer();
    signedIn = false;
  }
  async function tokenRequest(body, expected) {
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
    const result = await response.json();
    current(expected);
    if (!response.ok) {
      const error = failure("E_AUTH", result.error_description || result.error || `Spotify token HTTP ${response.status}`);
      if (result.error === "invalid_grant") clearSession();
      failed(error);
      throw error;
    }
    return result;
  }
  async function restoreAuthorization() {
    requireConfiguration();
    const expected = session;
    const url = new URL(location.href);
    const pending = read(sessionStorage, SPOTIFY_STORAGE.authorization);
    if (url.searchParams.has("code") || url.searchParams.has("error")) {
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      for (const name of ["code", "state", "error", "error_description"]) url.searchParams.delete(name);
      history.replaceState(history.state, "", url.href);
      sessionStorage.removeItem(SPOTIFY_STORAGE.authorization);
      if (!pending || state !== pending.state || pending.clientId !== configuration.clientId) {
        throw failure("E_AUTH_STATE", "The Spotify login does not belong to this browser session. Start login again.");
      }
      if (error) throw failure("E_AUTH", `Spotify authorization: ${error}`);
      health = { status: "signingIn", error: null };
      emit();
      const result = await tokenRequest({
        grant_type: "authorization_code", code, client_id: pending.clientId,
        redirect_uri: pending.redirectUri, code_verifier: pending.verifier,
      }, expected);
      saveTokens(result, undefined, expected);
    }
    current(expected);
    signedIn = Boolean(tokens);
    emit();
  }
  function restore() { return restorePromise ||= restoreAuthorization(); }
  async function accessToken() {
    await restore();
    requireConfiguration();
    if (!tokens) throw failure("E_AUTH", "Sign in to Spotify to load your account and play music.");
    if (tokens.expiresAt > now() + 30000) return tokens.accessToken;
    if (!refreshPromise) {
      const expected = session;
      const refreshToken = tokens.refreshToken;
      const operation = tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: configuration.clientId }, expected)
        .then(value => saveTokens(value, refreshToken, expected));
      refreshPromise = operation;
      const finished = () => { if (refreshPromise === operation) refreshPromise = undefined; };
      operation.then(finished, finished);
    }
    return refreshPromise;
  }
  async function request(path, { method = "GET", body } = {}, playbackOwner) {
    const expected = session;
    const token = await accessToken();
    current(expected);
    if (playbackOwner !== undefined) ownsPlayback(playbackOwner);
    const response = await fetch(`https://api.spotify.com/v1${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    current(expected);
    if (response.status === 204) return null;
    const text = await response.text();
    current(expected);
    const result = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const code = response.status === 401 ? "E_AUTH" : response.status === 403 ? "E_ACCESS" : response.status === 429 ? "E_RATE_LIMIT" : "E_SPOTIFY";
      const error = failure(code, result?.error?.message || `Spotify HTTP ${response.status}`);
      if (response.status === 401) { clearSession(); failed(error); }
      throw error;
    }
    return result;
  }
  const api = createSpotifyApi(request, { lyricsFetch: fetch });

  function loadSdk() {
    if (options.loadSdk) return options.loadSdk();
    if (browser.Spotify?.Player) return Promise.resolve(browser.Spotify);
    return sdkLoad ||= new Promise((resolve, reject) => {
      const previous = browser.onSpotifyWebPlaybackSDKReady;
      browser.onSpotifyWebPlaybackSDKReady = () => { previous?.(); resolve(browser.Spotify); };
      const script = document.createElement("script");
      script.src = "https://sdk.scdn.co/spotify-player.js";
      script.async = true;
      script.onerror = () => { sdkLoad = undefined; reject(failure("E_SDK", "The Spotify Web Playback SDK could not be loaded.")); };
      document.head.append(script);
    });
  }
  function updatePlayer(state) {
    const before = player.trackUri;
    if (!state) {
      player = { ...emptyPlayer(), volume: player.volume, muted: player.muted, premium: player.premium, at: now() };
      emit();
      return;
    }
    const track = state.track_window.current_track;
    const ad = track.type === "ad";
    player = {
      ...player,
      title: track.name, artist: track.artists.map(artist => artist.name).join(", "),
      album: track.album.name, artwork: track.album.images[0]?.url || "",
      trackUri: track.uri || "", contextUri: state.context.uri || "",
      playing: !state.paused, positionMs: state.position, durationMs: state.duration, at: now(),
      shuffle: state.shuffle, shuffleAvailable: !ad && !state.disallows.toggling_shuffle,
      repeat: ["off", "context", "track"][state.repeat_mode],
      canNext: !state.disallows.skipping_next, canPrevious: !state.disallows.skipping_prev,
      ad, liked: before === track.uri && player.liked,
    };
    emit();
    if (!active && !state.paused) void sdk.pause().catch(asynchronousError);
    if (before !== track.uri && track.uri?.startsWith("spotify:track:")) {
      const expected = session;
      void api.likes([track.uri]).then(([liked]) => {
        if (expected === session && player.trackUri === track.uri) { player = { ...player, liked }; emit(); }
      }, error => { if (expected === session) asynchronousError(error); });
    }
  }
  async function connect() {
    const expected = session;
    const Spotify = await loadSdk();
    current(expected);
    if (!active) return;
    const instance = new Spotify.Player({
      name: "Metrolist NSH", volume: player.volume, enableMediaSession: false,
      getOAuthToken: callback => { void accessToken().then(token => { if (sdk === instance && expected === session) callback(token); }, error => { if (expected === session) failed(error); }); },
    });
    sdk = instance;
    const on = (name, handler) => instance.addListener(name, value => {
      if (sdk === instance && expected === session && !disposed) handler(value);
    });
    on("ready", ({ device_id }) => {
      deviceId = device_id;
      player = { ...player, premium: true };
      health = { status: "ready", error: null };
      emit();
    });
    on("not_ready", ({ device_id }) => {
      if (deviceId === device_id) {
        deviceId = "";
        player = { ...player, playing: false, at: now() };
        failed(failure("E_DEVICE", "The browser Spotify device is offline. Reconnect to continue."));
      }
    });
    on("player_state_changed", updatePlayer);
    on("initialization_error", ({ message }) => failed(failure("E_DRM", message)));
    on("authentication_error", ({ message }) => { clearSession(); failed(failure("E_AUTH", message)); });
    on("account_error", ({ message }) => { player = { ...player, premium: false }; failed(failure("E_PREMIUM", message)); });
    on("playback_error", ({ message }) => asynchronousError(failure("E_PLAYBACK", message)));
    on("autoplay_failed", () => {
      elementActivated = false;
      asynchronousError(failure("E_AUTOPLAY", "Tap the Spotify play control to allow audio in this browser."));
    });
    const connected = await instance.connect();
    current(expected);
    if (!connected && health.status !== "failed") throw failure("E_DEVICE", "Spotify could not connect this browser as a playback device.");
  }
  async function activate() {
    if (!active) { active = true; ownership++; }
    try {
      await restore();
      if (!tokens) { health = { status: "ready", error: null }; emit(); return snapshot(); }
      await accessToken();
      if (active && !sdk) {
        health = { status: "starting", error: null }; emit();
        if (!connectPromise) {
          const operation = connect();
          connectPromise = operation;
          const finished = () => { if (connectPromise === operation) connectPromise = undefined; };
          operation.then(finished, finished);
        }
        await connectPromise;
      }
    } catch (error) {
      if (errorOf(error).code !== "E_CANCELLED") failed(error);
    }
    return snapshot();
  }

  // Browser activation must run here, before an asynchronous host.call crosses
  // the NSH realm. It authorizes the audio element, without starting a song.
  function gesture(event) {
    if (!event.isTrusted || !active || !sdk || elementActivated) return;
    // Touch activation is delivered with click/touchend, not pointerdown.
    if (event.type === "pointerdown" && event.pointerType !== "mouse") return;
    const instance = sdk;
    void instance.activateElement().then(() => {
      if (sdk !== instance) return;
      elementActivated = true;
      if (health.error?.code === "E_AUTOPLAY") { health = { status: "ready", error: null }; emit(); }
    }, asynchronousError);
  }
  document.addEventListener("pointerdown", gesture, true);
  document.addEventListener("click", gesture, true);
  document.addEventListener("keydown", gesture, true);
  function visibility() {
    const instance = sdk;
    if (active && instance && document.visibilityState === "visible") {
      void instance.getCurrentState().then(state => { if (sdk === instance) updatePlayer(state); }, asynchronousError);
    }
  }
  document.addEventListener("visibilitychange", visibility);

  function control(run) {
    const expectedOwner = ownership;
    const expectedSession = session;
    const operation = (async () => {
      ownsPlayback(expectedOwner);
      await accessToken();
      current(expectedSession);
      ownsPlayback(expectedOwner);
      if (!sdk || !deviceId) throw failure("E_DEVICE", "Wait for this browser's Spotify device to connect.");
      return run(sdk, expectedOwner);
    })();
    commandsInFlight.add(operation);
    const finished = () => commandsInFlight.delete(operation);
    operation.then(finished, finished);
    return operation;
  }
  const playerPath = path => `${path}${path.includes("?") ? "&" : "?"}device_id=${encodeURIComponent(deviceId)}`;
  function playerRequest(path, body, owner) { return request(playerPath(path), { method: "PUT", body }, owner); }
  async function pause() {
    if (sdk && deviceId) await sdk.pause();
  }
  async function setActive(value) {
    if (value) return activate();
    active = false;
    ownership++;
    await Promise.allSettled([...commandsInFlight]);
    await pause();
    return snapshot();
  }
  async function signIn() {
    requireConfiguration();
    clearSession();
    const expected = session;
    const owner = ownership;
    health = { status: "signingIn", error: null };
    emit();
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
    const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    current(expected);
    if (owner !== ownership) throw failure("E_CANCELLED", "The Spotify login was cancelled when the workspace changed.");
    sessionStorage.setItem(SPOTIFY_STORAGE.authorization, JSON.stringify({ ...configuration, verifier, state }));
    const query = new URLSearchParams({
      client_id: configuration.clientId, response_type: "code", redirect_uri: configuration.redirectUri,
      code_challenge_method: "S256", code_challenge: challenge, state, scope: SPOTIFY_SCOPES.join(" "), show_dialog: "true",
    });
    location.assign(`https://accounts.spotify.com/authorize?${query}`);
  }
  async function configure(args) {
    const changed = args.clientId.trim() !== configuration.clientId || (args.redirectUri && args.redirectUri !== configuration.redirectUri);
    if (changed) clearSession();
    configuration = { clientId: args.clientId.trim(), redirectUri: args.redirectUri || `${location.origin}${location.pathname}` };
    storage.setItem(SPOTIFY_STORAGE.configuration, JSON.stringify(configuration));
    if (configuration.clientId) health = { status: "ready", error: null };
    else health = { status: "failed", error: { code: "E_CONFIG", message: "Add your Spotify application Client ID and register the displayed redirect URI." } };
    emit();
    return snapshot();
  }
  async function coverColors(imageUrl) {
    if (!imageUrl) return [];
    const image = new browser.Image();
    image.crossOrigin = "anonymous";
    image.src = imageUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 32; canvas.height = 32;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, 32, 32);
    const pixels = context.getImageData(0, 0, 32, 32).data;
    const colors = new Map();
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] < 128) continue;
      const [r, g, b] = pixels.subarray(index, index + 3);
      const key = `${r >> 5},${g >> 5},${b >> 5}`;
      const value = colors.get(key) || { r: 0, g: 0, b: 0, count: 0 };
      value.r += r; value.g += g; value.b += b; value.count++;
      colors.set(key, value);
    }
    return [...colors.values()].sort((a, b) => b.count - a.count).slice(0, 5)
      .map(value => "#" + [value.r, value.g, value.b].map(channel => Math.round(channel / value.count).toString(16).padStart(2, "0")).join(""));
  }

  const commands = {
    snapshot,
    activate,
    setActive: args => setActive(args.active),
    configure,
    async token() { const access = await accessToken(); return { accessToken: access, expiresAt: tokens.expiresAt }; },
    home: () => api.home(), search: args => api.search(args.query), playlist: args => api.playlist(args.uri),
    album: args => api.album(args.uri), artist: args => api.artist(args.uri), likedSongs: () => api.likedSongs(),
    library: () => api.library(), me: () => api.me(), lyrics: args => api.lyrics(args.trackUri),
    coverColors: args => coverColors(args.imageUrl),
    play: () => control(async (instance, owner) => {
      const state = await instance.getCurrentState();
      ownsPlayback(owner);
      if (state) await instance.resume();
      else await request("/me/player", { method: "PUT", body: { device_ids: [deviceId], play: true } }, owner);
    }),
    toggle: () => player.playing ? pause() : commands.play(),
    pause,
    next: () => control(instance => instance.nextTrack()),
    previous: () => control(instance => instance.previousTrack()),
    seek: args => control(instance => instance.seek(Math.round(args.ms))),
    setVolume: args => control(async instance => {
      if (ios) throw failure("E_VOLUME", "Use the device volume controls on iOS.");
      await instance.setVolume(args.volume);
      if (sdk !== instance) return;
      player = { ...player, volume: args.volume, muted: false }; emit();
    }),
    setMuted: args => control(async instance => {
      if (ios) throw failure("E_VOLUME", "Use the device volume controls on iOS.");
      const volume = player.volume || 1;
      await instance.setVolume(args.on ? 0 : volume);
      if (sdk !== instance) return;
      player = { ...player, volume, muted: args.on }; emit();
    }),
    setShuffle: args => control((_, owner) => playerRequest(`/me/player/shuffle?state=${args.on}`, undefined, owner)),
    setRepeat: args => control((_, owner) => playerRequest(`/me/player/repeat?state=${args.mode}`, undefined, owner)),
    async setLiked(args) {
      const uri = player.trackUri;
      if (!uri.startsWith("spotify:track:")) throw failure("E_TRACK", "No Spotify song is currently loaded.");
      const expected = session;
      await api.setLiked(uri, args.on);
      if (expected === session && player.trackUri === uri) { player = { ...player, liked: args.on }; emit(); }
    },
    playTrack: args => control((_, owner) => playerRequest("/me/player/play", { uris: [args.uri] }, owner)),
    playContext: args => control(async (_, owner) => {
      if (args.uri === "spotify:collection:tracks") {
        const collection = await api.likedSongs();
        const start = args.trackUri ? collection.tracks.findIndex(track => track.uri === args.trackUri) : 0;
        const uris = collection.tracks.slice(Math.max(0, start)).filter(track => track.playable).map(track => track.uri);
        if (!uris.length) throw failure("E_EMPTY", "There are no playable saved tracks.");
        await playerRequest("/me/player/play", { uris }, owner);
      } else {
        const body = { context_uri: args.uri };
        if (args.trackUri && /spotify:(album|playlist):/.test(args.uri)) body.offset = { uri: args.trackUri };
        await playerRequest("/me/player/play", body, owner);
      }
    }),
    signIn,
    cancelSignIn() {
      session++;
      sessionStorage.removeItem(SPOTIFY_STORAGE.authorization);
      restorePromise = undefined;
      refreshPromise = undefined;
      health = { status: "ready", error: null }; emit();
    },
    signOut() { clearSession(); health = { status: "ready", error: null }; emit(); },
    async retry() {
      session++;
      ownership++;
      restorePromise = undefined;
      refreshPromise = undefined;
      disconnectPlayer();
      return activate();
    },
    setBridge() {},
  };
  return {
    call(name, args = {}) {
      const method = name.startsWith("app.spotify.") ? name.slice("app.spotify.".length) : "";
      if (!Object.hasOwn(commands, method)) throw failure("E_COMMAND", `Unknown Spotify command: ${name}`);
      return commands[method](args);
    },
    dispose() {
      disposed = true;
      active = false;
      session++;
      ownership++;
      disconnectPlayer();
      document.removeEventListener("pointerdown", gesture, true);
      document.removeEventListener("click", gesture, true);
      document.removeEventListener("keydown", gesture, true);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
