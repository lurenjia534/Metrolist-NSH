// The real Spotify player hosted by the browser or the phone's Spotify app.
// Catalog data comes from the same Spotify Web API on all three platforms.
import { batch, host, platform, signal, Storage, UrlScheme } from "nsh";
import { SpotifyMobile } from "metrolist/native";
import { createSpotifyApi } from "../../../web/spotify-api.js";
import { announce } from "../state/feedback";
import { backendError, EMPTY_PLAYER, errorOf, kindOf, type Backend, type Collection, type Health, type PlayerState, type RepeatMode } from "./types";

export interface SpotifyConfiguration {
  clientId: string;
  redirectUri: string;
  configured: boolean;
}

interface Snapshot {
  player: Partial<PlayerState>;
  health: Health;
  signedIn: boolean | null;
  authRevision: number;
  configuration: SpotifyConfiguration;
  capabilities: { volume: boolean; lyrics: boolean };
  deviceId: string;
}

const SLOT = "__metrolistSpotifyHost";

export function hostBackend(): HostBackend {
  const global = globalThis as unknown as Record<string, HostBackend | undefined>;
  global[SLOT]?.dispose();
  return global[SLOT] = new HostBackend();
}

export class HostBackend implements Backend {
  readonly kind = "host" as const;
  readonly player = signal<PlayerState>({ ...EMPTY_PLAYER });
  readonly health = signal<Health>({ status: "starting", error: null });
  readonly signedIn = signal<boolean | null>(false);
  readonly configuration = signal<SpotifyConfiguration>({ clientId: "", redirectUri: "", configured: false });
  readonly capabilities = signal({ volume: false, lyrics: true });
  readonly deviceId = signal("");
  #native: SpotifyMobile | null = null;
  #initialized: Promise<void> | null = null;
  #stops: (() => void)[] = [];
  #auth = new Set<() => void>();
  #revision = 0;
  #likedTrack = "";
  #likes = new Map<string, boolean>();
  #collections = new Map<string, Collection>();
  #activation = 0;
  #session = 0;
  #api = createSpotifyApi(async (path, options = {}) => {
    const session = this.#session;
    const { accessToken } = await this.call<{ accessToken: string; expiresAt: number }>("token");
    if (session !== this.#session) throw backendError("E_CANCELLED", "The Spotify account changed.");
    const response = await fetch(`https://api.spotify.com/v1${path}`, {
      method: options.method ?? "GET",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    if (response.status === 204) return null;
    const text = await response.text();
    if (session !== this.#session) throw backendError("E_CANCELLED", "The Spotify account changed.");
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = typeof data.error === "object" ? data.error.message : data.error_description ?? data.error;
      throw backendError(`E_SPOTIFY_${response.status}`, String(message));
    }
    return data;
  });

  private async initialize(): Promise<void> {
    return this.#initialized ??= (async () => {
      // Host subscriptions belong to the backend's lifetime, not to the
      // workspace component which unmounts when the service is changed.
      await Promise.resolve();
      if (platform.os === "ios") {
        this.#native = new SpotifyMobile();
        this.#stops.push(this.#native.onEvent((json) => this.receive(JSON.parse(json))));
        this.#stops.push(UrlScheme.on("open", ({ url }) => {
          void this.call("handleURL", { url }).catch((error) => announce(errorOf(error).message));
        }));
      } else {
        this.#stops.push(host.on("app.spotify.state", (snapshot: unknown) => this.receive(snapshot as Snapshot)));
        this.#stops.push(host.on("app.spotify.error", (error: unknown) => announce((error as { message: string }).message)));
      }
      this.receive(await this.call<Snapshot>("snapshot"));
    })();
  }

  private call<T = void>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    if (platform.os === "ios") return this.#native!.request(method, JSON.stringify(args)).then((json) => JSON.parse(json) as T);
    return host.call(`app.spotify.${method}`, args) as Promise<T>;
  }

  private receive(snapshot: Snapshot): void {
    const changedConfiguration = snapshot.configuration.clientId !== this.configuration().clientId || snapshot.configuration.redirectUri !== this.configuration().redirectUri;
    if (changedConfiguration || (this.signedIn() !== false && snapshot.signedIn === false)) {
      this.#session++;
      this.#likedTrack = "";
      this.#likes.clear();
      this.#collections.clear();
    }
    batch(() => {
      const liked = this.#likes.get(snapshot.player.trackUri ?? "");
      this.player.set({ ...EMPTY_PLAYER, ...snapshot.player, ...(liked === undefined ? {} : { liked }) });
      this.health.set(snapshot.health);
      this.signedIn.set(snapshot.signedIn);
      this.configuration.set(snapshot.configuration);
      this.capabilities.set({ ...snapshot.capabilities, lyrics: true });
      this.deviceId.set(snapshot.deviceId);
    });
    if (changedConfiguration || snapshot.authRevision !== this.#revision) {
      this.#revision = snapshot.authRevision;
      for (const listener of this.#auth) listener();
    }
    // Native App Remote reports the song; the Web API supplies its saved
    // status. Refresh on song changes without replacing SDK playback state.
    const uri = this.player().trackUri;
    if (snapshot.signedIn && uri && uri !== this.#likedTrack) {
      this.#likedTrack = uri;
      const session = this.#session;
      void this.#api.likes([uri]).then(([liked]) => {
        if (session !== this.#session) return;
        this.#likes.set(uri, liked);
        if (this.player().trackUri === uri) this.player.update((p) => ({ ...p, liked }));
      }).catch((error) => announce(errorOf(error).message));
    }
    if (!snapshot.signedIn) { this.#likedTrack = ""; this.#likes.clear(); this.#collections.clear(); }
  }

  async activate(): Promise<void> {
    const activation = ++this.#activation;
    await this.initialize();
    if (activation !== this.#activation) return;
    await this.call("setActive", { active: true });
    if (activation !== this.#activation) return;
    this.receive(await this.call<Snapshot>("snapshot"));
  }

  async deactivate(): Promise<void> {
    ++this.#activation;
    await this.initialize();
    await this.call("setActive", { active: false });
    this.receive(await this.call<Snapshot>("snapshot"));
  }

  async configure(clientId: string): Promise<void> {
    await this.initialize();
    if (this.signedIn() && clientId.trim() !== this.configuration().clientId) await this.signOut();
    await this.call("configure", { clientId: clientId.trim() });
    this.receive(await this.call<Snapshot>("snapshot"));
  }

  onAuth(listener: () => void): () => void { this.#auth.add(listener); return () => this.#auth.delete(listener); }

  home() { return this.#api.home(); }
  search(query: string) { return this.#api.search(query); }
  private async collection(uri: string): Promise<Collection> {
    const session = this.#session;
    const value = await (kindOf(uri) === "album" ? this.#api.album(uri) : kindOf(uri) === "artist" ? this.#api.artist(uri) : kindOf(uri) === "collection" ? this.#api.likedSongs() : this.#api.playlist(uri));
    if (session !== this.#session) throw backendError("E_CANCELLED", "The Spotify account changed.");
    this.#collections.set(uri, value);
    return value;
  }
  playlist(uri: string) { return this.collection(uri); }
  album(uri: string) { return this.collection(uri); }
  artist(uri: string) { return this.collection(uri); }
  likedSongs() { return this.collection("spotify:collection:tracks"); }
  library() { return this.#api.library(); }
  me() { return this.#api.me(); }
  lyrics(uri: string) { return this.#api.lyrics(uri); }
  coverColors(imageUrl: string) { return this.call<string[]>("coverColors", { imageUrl }); }

  toggle() { return this.call("toggle"); }
  play() { return this.call("play"); }
  pause() { return this.call("pause"); }
  next() { return this.call("next"); }
  previous() { return this.call("previous"); }
  seek(ms: number) { return this.call("seek", { ms }); }
  setVolume(volume: number) { return this.call("setVolume", { volume }); }
  setShuffle(on: boolean) { return this.call("setShuffle", { on }); }
  setRepeat(mode: RepeatMode) { return this.call("setRepeat", { mode }); }
  setMuted(on: boolean) { return this.call("setMuted", { on }); }
  async playContext(uri: string, trackUri: string | null): Promise<void> {
    if (platform.os === "web" || !trackUri) return this.call("playContext", { uri, trackUri });
    const collection = this.#collections.get(uri) ?? await this.collection(uri);
    const index = collection.tracks.findIndex((track) => track.uri === trackUri);
    if (index === -1) throw backendError("E_TRACK", "This song is no longer in the playlist. Reload the playlist.");
    await this.call("playContext", { uri, trackUri, index: collection.tracks[index].contextIndex ?? index });
  }
  playTrack(uri: string) { return this.call("playTrack", { uri }); }
  async setLiked(on: boolean): Promise<void> {
    const session = this.#session;
    const uri = this.player().trackUri;
    await this.#api.setLiked(uri, on);
    if (session !== this.#session) return;
    this.#likes.set(uri, on);
    if (this.player().trackUri === uri) this.player.update((p) => ({ ...p, liked: on }));
  }

  async signIn(): Promise<void> {
    await this.initialize();
    await Storage.setItem("metrolist.provider", "spotify");
    await this.call("signIn");
  }
  cancelSignIn() { return this.call("cancelSignIn"); }
  async signOut(): Promise<void> {
    await this.call("signOut");
    this.receive(await this.call<Snapshot>("snapshot"));
  }
  retry() { return this.call("retry"); }
  setBridge(_source: string): void {}
  dispose(): void {
    for (const stop of this.#stops) stop();
    this.#stops = [];
    this.#auth.clear();
    this.#native = null;
  }
}
