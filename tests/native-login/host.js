// A separate host runtime can keep auth.login pending while the app verifies its session.
export function createHost(player) {
  const spotify = spotifyProtocolFixture(player);
  let pending;
  let auto;
  const calls = [];
  return {
    call(name, data) {
      calls.push({ name, data });
      player.hostEvent("test.calls", calls);
      if (name.startsWith("app.spotify.")) return spotify(name.slice("app.spotify.".length), data || {});
      if (name === "auth.available") return { available: true, method: "webview" };
      if (name === "auth.logout") return { cleared: true };
      if (name === "app.audio.snapshot" || name === "app.audio.settings") return null;
      if (name === "auth.test.emit") { player.hostEvent(data.event, data.payload); return null; }
      if (name === "auth.test.auto") { auto = data; return null; }
      if (name === "auth.login") {
        const result = new Promise(resolve => { pending = resolve; });
        if (auto) {
          player.hostEvent("auth.progress", { requestId: data.requestId, stage: "waiting", message: "请完成 Google 登录，随后自动返回。" });
          setTimeout(() => { if (pending) player.hostEvent("auth.session", { requestId: data.requestId, attemptId: `auto-${data.requestId}`, credentials: auto.credentials }); }, auto.delay);
        }
        return result;
      }
      if (name === "auth.complete") {
        const accepted = !!pending;
        if (accepted && data.ok) {
          const finish = pending;
          pending = undefined;
          finish({ completed: true, attemptId: data.attemptId });
        }
        return { accepted };
      }
      if (name === "auth.test.cancel") {
        const finish = pending;
        pending = undefined;
        finish({ cancelled: true });
        return null;
      }
      throw new Error(`Unexpected test host call: ${name}`);
    },
  };
}

// A protocol fixture for the real HostBackend, separate from DemoBackend.
// Actual catalog/lyrics HTTP replies are supplied by each test's network map.
function spotifyProtocolFixture(shell) {
  const empty = () => ({ title: "", artist: "", album: "", artwork: "", trackUri: "", contextUri: "", playing: false, positionMs: 0, durationMs: 0, at: 0, shuffle: false, shuffleAvailable: false, repeat: "off", volume: 1, muted: false, liked: false, canNext: false, canPrevious: false, ad: false, premium: null });
  let state = {
    player: empty(), health: { status: "failed", error: { code: "E_CONFIG", message: "Configure the fixture Spotify application." } },
    signedIn: false, authRevision: 0, configuration: { clientId: "", redirectUri: "https://metrolist.test/", configured: false },
    capabilities: { volume: true, lyrics: true }, deviceId: "",
  };
  let active = false;
  const snapshot = () => JSON.parse(JSON.stringify(state));
  const emit = () => { shell.hostEvent("app.spotify.state", snapshot()); return snapshot(); };
  function song(uri) {
    state.player = {
      ...state.player, trackUri: uri,
      title: uri === "spotify:track:protocol2" ? "Protocol Song Two" : "Protocol Song One",
      artist: "Protocol Artist", album: "Protocol Album", durationMs: 180000,
      positionMs: 0, at: Date.now(), playing: true, shuffleAvailable: true, canNext: true, canPrevious: true, premium: true,
    };
    return emit();
  }
  return (method, args) => {
    if (method === "snapshot") return snapshot();
    if (method === "configure") {
      state.configuration = { ...state.configuration, clientId: args.clientId, configured: Boolean(args.clientId) };
      state.health = { status: "ready", error: null };
      return emit();
    }
    if (method === "activate" || method === "retry" || (method === "setActive" && args.active)) { active = true; return emit(); }
    if (method === "setActive") { active = false; state.player.playing = false; return emit(); }
    if (method === "signIn") {
      if (!state.configuration.configured) throw new Error("E_CONFIG: Configure the fixture Spotify application.");
      state.signedIn = true; state.authRevision++; state.health = { status: "ready", error: null };
      state.deviceId = "protocol-device"; state.player.premium = true;
      return emit();
    }
    if (method === "signOut") { state.signedIn = false; state.player = empty(); state.deviceId = ""; return emit(); }
    if (method === "cancelSignIn") { state.health = { status: "ready", error: null }; return emit(); }
    if (method === "coverColors") return [];
    if (method === "token") {
      if (!state.signedIn) throw new Error("E_AUTH: Sign in to the fixture account.");
      return { accessToken: "protocol-account-token", expiresAt: 4102444800000 };
    }
    if (method === "pause") { state.player.playing = false; state.player.at = Date.now(); return emit(); }
    if (!active) throw new Error("E_INACTIVE: The Spotify workspace is inactive.");
    if (method === "playContext") {
      if (args.index !== undefined && args.index !== (args.trackUri === "spotify:track:protocol2" ? 3 : 2)) throw new Error("E_FIXTURE_INDEX: The native queue index lost a removed track or episode.");
      state.player.contextUri = args.uri;
      return song(args.trackUri || "spotify:track:protocol1");
    }
    if (method === "playTrack") { state.player.contextUri = ""; return song(args.uri); }
    if (method === "next") return song("spotify:track:protocol2");
    if (method === "previous") return song("spotify:track:protocol1");
    if (method === "play") { state.player.playing = true; state.player.at = Date.now(); return emit(); }
    if (method === "toggle") { state.player.playing = !state.player.playing; state.player.at = Date.now(); return emit(); }
    if (method === "seek") { state.player.positionMs = args.ms; state.player.at = Date.now(); return emit(); }
    if (method === "setVolume") { state.player.volume = args.volume; return emit(); }
    if (method === "setMuted") { state.player.muted = args.on; return emit(); }
    if (method === "setShuffle") { state.player.shuffle = args.on; return emit(); }
    if (method === "setRepeat") { state.player.repeat = args.mode; return emit(); }
    if (method === "handleURL") return snapshot();
    throw new Error(`Unknown Spotify fixture command: ${method}`);
  };
}
