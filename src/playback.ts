import { AudioPlayer, batch, computed, effect, host, platform, signal } from "nsh";
import { NativeMedia } from "metrolist/native";
import type { ListenEvent, RemotePlaybackState, RepeatMode, StreamInfo, Track } from "./model";

export const queue = signal<Track[]>([]);
export const queueTitle = signal("");
export const currentIndex = signal(-1);
export const currentTrack = computed(() => queue()[currentIndex()]);
export const playing = signal(false);
export const buffering = signal(false);
export const position = signal(0);
export const duration = signal(0);
export const bufferedPosition = signal(0);
export const volume = signal(0.7);
export const rate = signal(1);
export const shuffle = signal(false);
export const repeat = signal<RepeatMode>("off");
export const sleepUntil = signal<number | null>(null);
export const sleepAfterTrack = signal(false);
export const sleepRemaining = signal(0);
export const sleepActive = computed(() => sleepUntil() !== null || sleepAfterTrack());
export const playbackError = signal("");
export const playbackErrorCode = signal("");
export const streamInfo = signal<StreamInfo | null>(null);
export const radioLoading = signal(false);
export const radioError = signal("");
export const syncingRemote = signal(false);
export const remoteControlled = signal(false);
/** Only the visible music workspace receives transport commands from the host. */
export const workspaceActive = signal(true);
export const playbackPhase = signal<"idle" | "resolving" | "buffering" | "playing" | "paused" | "error">("idle");
export const playbackTiming = signal<{ resolveMs: number; readyMs: number; totalMs: number; prepared: boolean } | null>(null);
export const upNext = signal<Track | undefined>();
export const nextPreparation = signal<{ trackId: string; title: string; state: "resolving" | "ready" | "caching" | "cached" } | null>(null);

interface PlaybackOptions {
  resolveStream: (track: Track, request?: { refresh?: boolean }) => Promise<StreamInfo>;
  sourceContext?: () => string;
  autoRadio?: () => boolean;
  fetchRadio?: (track: Track) => Promise<Track[]>;
  onTrack?: (track: Track) => void;
  onListen?: (track: Track, event: ListenEvent) => void;
  onError?: (message: string) => void;
  onQueueChange?: () => void;
  onPreferences?: () => void;
}
let options: PlaybackOptions;
type SourceControl = Pick<AudioPlayer, "play" | "pause" | "seek" | "dispose" | "volume" | "rate">;
let player: SourceControl | undefined;
let nativeMediaId: string | undefined;
let loadId = 0;
let playRequested = false;
let sourceStarted = false;
let nativeState = "idle";
let sleepTimer: ReturnType<typeof setTimeout> | undefined;
let shuffleBag: number[] = [];
let visited: number[] = [];
let queueGeneration = 0;
let radioPromise: Promise<Track[]> | undefined;
let listening: { track: Track; event: ListenEvent; reported: number } | undefined;
let lastPosition = 0;
let savedPosition = 0;
let startup: { requestedAt: number; resolvedAt: number; prepared: boolean } | undefined;
let prepared: { track: Track; context: string; source?: StreamInfo; cacheRequested: boolean } | undefined;

// Upstream MusicService.refreshStreamAndRetry: a source the CDN rejects with HTTP 403 or 410 (an
// expired or refused URL) is resolved again and resumes where it stopped, a second later. A song
// gets three attempts until it plays again; the rejection after them is reported.
const RECOVERY_ATTEMPTS = 3;
const RECOVERY_DELAY_MS = 1000;
const recoveries = new Map<string, number>();
/** The load whose source failure is handled; the engine and the player report one failure more than once. */
let failedLoad = -1;

function upcomingIndex() {
  if (!queue().length || currentIndex() < 0) return -1;
  if (repeat() === "one") return currentIndex();
  if (shuffle()) {
    if (!shuffleBag.length && repeat() === "all") resetShuffle();
    return shuffleBag[shuffleBag.length - 1] ?? (repeat() === "all" ? currentIndex() : -1);
  }
  const next = currentIndex() + 1;
  return next < queue().length ? next : repeat() === "all" ? 0 : -1;
}

function cancelPreparation() {
  if (prepared?.cacheRequested && platform.os === "android") void nativeCommand("cancelPreload").catch(surfaceError);
  prepared = undefined;
  nextPreparation.set(null);
}

/** Resolve only the actual next queue entry, after the current source has started. */
function prepareUpcoming() {
  const track = queue()[upcomingIndex()];
  upNext.set(track);
  if (!track || repeat() === "one" || remoteControlled() || sleepAfterTrack()) { cancelPreparation(); return; }
  const context = options.sourceContext?.() || "";
  if (prepared?.track.id === track.id && prepared.track.url === track.url && prepared.context === context
      && (!prepared.source?.expiresAt || prepared.source.expiresAt > Date.now() + 60000)) {
    cachePreparedSource();
    return;
  }
  cancelPreparation();
  if (!sourceStarted || !playing()) return;
  const next = { track, context, cacheRequested: false } as NonNullable<typeof prepared>;
  prepared = next;
  nextPreparation.set({ trackId: track.id, title: track.title, state: "resolving" });
  void options.resolveStream(track).then(source => {
    if (prepared !== next) return;
    next.source = source;
    nextPreparation.set({ trackId: track.id, title: track.title, state: "ready" });
    cachePreparedSource();
  }).catch(() => {
    // A speculative next-track failure must not replace the currently playing song's state.
    if (prepared === next) nextPreparation.set(null);
  });
}

export function invalidatePreparation() { cancelPreparation(); prepareUpcoming(); }

function cachePreparedSource() {
  const next = prepared;
  if (platform.os !== "android" || !next?.source || next.cacheRequested || !playing()
      || bufferedPosition() - position() < 12 || !/^https?:/.test(next.source.url)) return;
  next.cacheRequested = true;
  nextPreparation.set({ trackId: next.track.id, title: next.track.title, state: "caching" });
  void nativeCommand("preload", { trackId: next.track.id, ...next.source, cacheKey: sourceCacheKey(next.track, next.source) }).catch(() => {
    if (prepared === next) nextPreparation.set({ trackId: next.track.id, title: next.track.title, state: "ready" });
  });
}

function sourceCacheKey(track: Track, source: StreamInfo) {
  return source.cacheKey || (track.source === "youtube" ? `${track.id}:${source.formatId || source.quality || "audio"}` : source.url);
}

export interface NativeAudioState {
  requestId: number;
  state: "idle" | "loading" | "playing" | "paused" | "ended";
  position: number;
  duration: number;
  bufferedPosition: number;
  playing: boolean;
  buffering: boolean;
  playWhenReady: boolean;
  discontinuity?: boolean;
  volume?: number;
  rate?: number;
  error?: string;
  errorCode?: string;
  track?: Track;
  source?: StreamInfo;
}

function nativeCommand(name: string, data: Record<string, unknown> = {}) {
  return host.call<void>(`app.audio.${name}`, data);
}

/** Android owns the decoder and its buffered media in the foreground service. */
class AndroidSource implements SourceControl {
  play() { return nativeCommand("play"); }
  pause() { void nativeCommand("pause").catch(reportError); }
  seek(value: number) { void nativeCommand("seek", { position: value }).catch(reportError); }
  dispose() { /* Switching tracks reuses the native engine through audio.open. */ }
  get volume() { return volume(); }
  set volume(value: number) { void nativeCommand("settings", { volume: value }).catch(reportError); }
  get rate() { return rate(); }
  set rate(value: number) { void nativeCommand("settings", { rate: value }).catch(reportError); }
}

function errorText(reason: unknown) { return reason && typeof reason === "object" && "message" in reason ? String(reason.message) : String(reason); }
function errorCode(reason: unknown) { return reason && typeof reason === "object" && "code" in reason ? String(reason.code) : "failed"; }
function surfaceError(reason: unknown) { options.onError?.(errorText(reason)); }
function reportError(reason: unknown) {
  const code = errorCode(reason);
  playRequested = false;
  batch(() => { playbackErrorCode.set(code); playbackError.set(code === "not-allowed" ? "点按播放以开始音频" : errorText(reason)); buffering.set(false); playing.set(false); });
  playbackPhase.set("error");
  startup = undefined;
  cancelPreparation();
  updateMediaSession();
  if (code !== "not-allowed") surfaceError(reason);
}

/** The playing source failed: the native engine's error, or the player's. */
async function sourceFailed(reason: unknown) {
  if (errorCode(reason) === "not-allowed") { reportError(reason); return; }
  const request = loadId;
  if (failedLoad === request) return;
  failedLoad = request;
  let code = errorCode(reason);
  // NSH's player reports no HTTP status. The source itself answers a one-byte read as it now answers
  // the player; the desktop relay would answer from the bytes it already holds.
  const source = streamInfo();
  if (platform.os !== "android" && source && /^https?:/.test(source.url)) {
    const status = await fetch(source.url, { headers: { ...source.headers, Range: "bytes=0-0" } }).then(response => response.status, () => 0);
    if (request !== loadId) return;
    if (status === 403 || status === 410) code = `http-${status}`;
  }
  const failure = { message: errorText(reason), code };
  if (code !== "http-403" && code !== "http-410") { reportError(failure); return; }
  const id = currentTrack()!.id;
  const attempts = recoveries.get(id) ?? 0;
  if (attempts >= RECOVERY_ATTEMPTS) { recoveries.delete(id); reportError(failure); return; }
  recoveries.set(id, attempts + 1);
  batch(() => { playing.set(false); buffering.set(playRequested); playbackPhase.set(playRequested ? "buffering" : "paused"); });
  setTimeout(() => { if (request === loadId) void loadCurrent(position(), true, true, playRequested); }, RECOVERY_DELAY_MS);
}

export function initPlayback(configuration: PlaybackOptions) {
  options = configuration;
  if (platform.os === "android") {
    host.on("audio.state", (payload: unknown) => receiveNativeState(payload as NativeAudioState));
    host.on("audio.preload", (payload: unknown) => {
      const event = payload as { trackId: string; cacheKey: string; cached: boolean };
      if (prepared?.track.id !== event.trackId || !prepared.source || sourceCacheKey(prepared.track, prepared.source) !== event.cacheKey) return;
      nextPreparation.set({ trackId: prepared.track.id, title: prepared.track.title, state: event.cached ? "cached" : "ready" });
    });
    effect(() => {
      const controlled = remoteControlled() || !workspaceActive();
      void nativeCommand("settings", { remoteControlled: controlled }).catch(surfaceError);
    });
  }
  if (platform.os === "web" || platform.os === "android") host.on("media.command", (payload: unknown) => {
    if (!workspaceActive() || remoteControlled()) return;
    const event = payload as { action: "play" | "pause" | "previous" | "next" | "seek"; value?: number };
    switch (event.action) {
      case "play": if (!playRequested) void resumePlayback(); break;
      case "pause": pause(); break;
      case "previous": previous(); break;
      case "next": void next(); break;
      case "seek": seek(event.value ?? 0); break;
    }
  });
}

function updateMediaSession() {
  if (workspaceActive() && platform.os === "web") void host.call("app.playback", {
    playing: playing(), buffering: buffering(), position: position(), duration: duration(), rate: rate(),
  }).catch(surfaceError);
}
function changed() { options?.onQueueChange?.(); prepareUpcoming(); }
function flushListening() {
  if (!listening || listening.event.seconds === listening.reported) return;
  options.onListen?.(listening.track, { ...listening.event });
  listening.reported = listening.event.seconds;
}
function startListening(track: Track) {
  const now = Date.now();
  listening = { track, event: { id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, trackId: track.id, startedAt: now, seconds: 0 }, reported: 0 };
}
function resetShuffle() {
  shuffleBag = queue().map((_, index) => index).filter((index) => index !== currentIndex());
  for (let i = shuffleBag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffleBag[i], shuffleBag[j]] = [shuffleBag[j], shuffleBag[i]];
  }
}
function resetRadio() {
  queueGeneration++;
  radioPromise = undefined;
  batch(() => { radioLoading.set(false); radioError.set(""); });
}
function releaseSource(stopNative = false) {
  flushListening();
  ++loadId;
  if (platform.os === "android" && player) {
    if (stopNative) void nativeCommand("stop").catch(surfaceError);
    else player.pause();
  }
  player?.dispose();
  if (nativeMediaId) NativeMedia.release(nativeMediaId);
  nativeMediaId = undefined;
  player = undefined;
  sourceStarted = false;
  nativeState = "idle";
  batch(() => { playing.set(false); buffering.set(false); bufferedPosition.set(0); streamInfo.set(null); });
  startup = undefined;
}

function receiveProgress(seconds: number, total: number) {
  const elapsed = seconds - lastPosition;
  if (playing() && !buffering() && elapsed > 0 && listening) listening.event.seconds += elapsed / rate();
  lastPosition = seconds;
  batch(() => {
    position.set(seconds);
    if (Number.isFinite(total) && total > 0) duration.set(total);
  });
  if (listening && listening.event.seconds - listening.reported >= 10) flushListening();
  if (Math.abs(position() - savedPosition) >= 10) { savedPosition = position(); changed(); }
}

function receiveNativeState(event: NativeAudioState) {
  if (!player || event.requestId !== loadId) return;
  if (event.error) {
    if (failedLoad !== loadId) position.set(event.position);
    void sourceFailed({ message: event.error, code: event.errorCode || "failed" });
    return;
  }
  const previousState = nativeState;
  const previousIntent = playRequested;
  const wasPlaying = playing();
  nativeState = event.state;
  if (event.discontinuity) lastPosition = event.position;
  receiveProgress(event.position, event.duration);
  playRequested = event.playWhenReady;
  batch(() => {
    playing.set(event.playing);
    buffering.set(event.buffering && event.playWhenReady);
    bufferedPosition.set(event.bufferedPosition);
    playbackPhase.set(event.state === "idle" ? "idle" : event.playing ? "playing" : event.playWhenReady && event.buffering ? "buffering" : "paused");
  });
  if (event.state === "idle") {
    player = undefined;
    sourceStarted = false;
    streamInfo.set(null);
    flushListening();
    changed();
    return;
  }
  if (event.playing) {
    if (!sourceStarted) finishPlaybackStart();
    else if (!wasPlaying) prepareUpcoming();
    cachePreparedSource();
  }
  if (!event.playWhenReady && previousIntent) { startup = undefined; flushListening(); changed(); }
  if (event.state === "ended" && previousState !== "ended") { flushListening(); void advance(true); }
}

/** Reconnect after loading the saved queue; the service's position is authoritative. */
export async function reconnectNativePlayback() {
  if (platform.os !== "android") return;
  const request = loadId;
  const snapshot = await host.call<NativeAudioState | null>("app.audio.snapshot");
  if (!snapshot?.track || request !== loadId || player) return;
  const track = snapshot.track;
  let index = currentTrack()?.id === track.id ? currentIndex() : queue().findIndex(item => item.id === track.id);
  const items = [...queue()];
  if (index < 0) { index = items.length; items.push(track); }
  else items[index] = track;
  loadId = snapshot.requestId;
  player = new AndroidSource();
  sourceStarted = true;
  nativeState = "idle";
  lastPosition = snapshot.position;
  savedPosition = snapshot.position;
  startListening(track);
  batch(() => {
    queue.set(items); currentIndex.set(index); streamInfo.set(snapshot.source || null);
    if (snapshot.volume !== undefined) volume.set(snapshot.volume);
    if (snapshot.rate !== undefined) rate.set(snapshot.rate);
  });
  receiveNativeState(snapshot);
  options.onTrack?.(track);
  changed();
}

async function loadCurrent(startAt = 0, continueSession = false, refresh = false, play = true) {
  let track = currentTrack();
  if (!track) return;
  const wasPrepared = !refresh && prepared?.track.id === track.id && prepared.track.url === track.url
    && prepared.context === (options.sourceContext?.() || "") && !!prepared.source
    && (!prepared.source.expiresAt || prepared.source.expiresAt > Date.now() + 60000);
  cancelPreparation();
  releaseSource();
  const request = loadId;
  playRequested = play;
  lastPosition = startAt;
  savedPosition = startAt;
  startup = play ? { requestedAt: Date.now(), resolvedAt: 0, prepared: wasPrepared } : undefined;
  if (!continueSession || listening?.track.id !== track.id) startListening(track);
  batch(() => { position.set(startAt); duration.set(track.duration); buffering.set(play); playbackError.set(""); playbackErrorCode.set(""); playbackPhase.set("resolving"); playbackTiming.set(null); });
  changed();
  try {
    const source = await options.resolveStream(track, { refresh });
    if (request !== loadId) return;
    if (startup) startup.resolvedAt = Date.now();
    playbackPhase.set("buffering");
    track = {
      ...track, title: source.title || track.title, artist: source.artist || track.artist,
      artwork: source.artwork || track.artwork, duration: source.duration || track.duration,
    };
    const selected = currentIndex();
    batch(() => {
      streamInfo.set(source);
      duration.set(track.duration);
      queue.update((items) => items.map((item, index) => index === selected ? track : item));
    });
    if (listening) listening.track = track;
    if (platform.os === "android") {
      player = new AndroidSource();
      await nativeCommand("open", {
        requestId: request, track, url: source.url, headers: source.headers || {},
        mimeType: source.mimeType, formatId: source.formatId, expiresAt: source.expiresAt,
        cacheKey: sourceCacheKey(track, source),
        position: startAt, volume: volume(), rate: rate(), playWhenReady: playRequested,
        remoteControlled: remoteControlled() || !workspaceActive(),
      });
      return;
    }
    let playbackUrl = source.url;
    const localIOS = platform.os === "ios" && source.url.startsWith("file:");
    // The relay reads remote audio in bounded ranges: googlevideo throttles a player's own
    // requests (no Range header, or more than 10 MiB) to about twice real time.
    if (platform.os !== "web" && (localIOS || /^https?:/.test(source.url))) {
      const media = await NativeMedia.prepare(source.url, source.headers || {});
      if (request !== loadId) { NativeMedia.release(media.id); return; }
      nativeMediaId = media.id;
      playbackUrl = media.url;
    }
    const audio = new AudioPlayer(playbackUrl, { volume: volume(), rate: rate() });
    player = audio;
    audio.on("load", (event) => {
      if (request === loadId && Number.isFinite(event.duration)) duration.set(event.duration);
    });
    audio.on("progress", (event) => {
      if (request !== loadId) return;
      receiveProgress(event.currentTime, event.duration);
      updateMediaSession();
    });
    audio.on("buffer", (event) => {
      if (request !== loadId) return;
      buffering.set(event.buffering && playRequested);
      playbackPhase.set(!playRequested ? "paused" : event.buffering ? "buffering" : "playing");
    });
    audio.on("error", (event) => { if (request === loadId) void sourceFailed(event); });
    audio.on("end", () => { if (request === loadId) { flushListening(); void advance(true); } });
    if (startAt > 0) audio.seek(startAt);
    if (!playRequested) { audio.preload(); batch(() => { buffering.set(false); playbackPhase.set("paused"); }); return; }
    try { await audio.play(); } catch (reason) { if (request === loadId) void sourceFailed(reason); return; }
    if (request !== loadId || !playRequested) return;
    finishPlaybackStart();
  } catch (reason) { if (request === loadId) reportError(reason); }
}

function finishPlaybackStart() {
  recoveries.delete(currentTrack()!.id);
  batch(() => { playing.set(true); buffering.set(false); playbackError.set(""); playbackErrorCode.set(""); playbackPhase.set("playing"); });
  if (startup) {
    const readyAt = Date.now();
    playbackTiming.set({ resolveMs: startup.resolvedAt - startup.requestedAt,
      readyMs: readyAt - startup.resolvedAt, totalMs: readyAt - startup.requestedAt, prepared: startup.prepared });
    startup = undefined;
  }
  if (!sourceStarted) {
    sourceStarted = true;
    const track = currentTrack()!;
    if (platform.os === "web") void host.call("app.metadata", track).catch(surfaceError);
    options.onTrack?.(track);
    if (!remoteControlled() && !sleepAfterTrack() && options.autoRadio?.() && repeat() === "off" && queue().length - currentIndex() <= 3) void extendRadio();
  }
  updateMediaSession();
  prepareUpcoming();
}

export function playList(items: Track[], index = 0, title = "") {
  if (!items.length) return;
  resetRadio();
  batch(() => { queue.set([...items]); currentIndex.set(index); queueTitle.set(title); });
  visited = [];
  resetShuffle();
  return loadCurrent();
}
export function playTrack(track: Track, items?: Track[]) {
  const list = items?.length ? items : [track];
  const index = list.findIndex((item) => item.id === track.id);
  return playList(index < 0 ? [track, ...list] : list, Math.max(0, index));
}
export function playAt(index: number) {
  if (index < 0 || index >= queue().length) return;
  if (currentIndex() >= 0 && index !== currentIndex()) visited.push(currentIndex());
  currentIndex.set(index);
  shuffleBag = shuffleBag.filter((item) => item !== index);
  return loadCurrent();
}
export async function resumePlayback() {
  if (!currentTrack() || playRequested) return;
  if (duration() > 0 && position() >= duration()) seek(0);
  playRequested = true;
  const failed = failedLoad === loadId;
  if (!player || failed || (playbackError() && playbackErrorCode() !== "not-allowed")) {
    await loadCurrent(position(), true, failed || !!playbackError());
    return;
  }
  const request = loadId;
  buffering.set(true);
  playbackPhase.set("buffering");
  try {
    await player.play();
    if (request !== loadId || !playRequested || platform.os === "android") return;
    finishPlaybackStart();
  } catch (reason) { if (request === loadId) void sourceFailed(reason); }
}
export async function togglePlay() {
  if (playRequested || playing()) pause();
  else await resumePlayback();
}
export function pause() {
  playRequested = false;
  startup = undefined;
  flushListening();
  if (!player) releaseSource();
  else player.pause();
  batch(() => { playing.set(false); buffering.set(false); playbackPhase.set(currentTrack() ? "paused" : "idle"); });
  updateMediaSession();
  changed();
}
export async function reloadPlayback() {
  cancelPreparation();
  if (!currentTrack()) return;
  if (playRequested || playing()) await loadCurrent(position(), true);
  else { releaseSource(true); updateMediaSession(); changed(); }
}
export function retryPlayback() { return playbackErrorCode() === "not-allowed" ? resumePlayback() : loadCurrent(position(), true, true); }

export function extendRadio(): Promise<Track[]> {
  if (radioPromise) return radioPromise;
  const track = currentTrack();
  if (!track || track.source !== "youtube" || !options.fetchRadio) return Promise.resolve([]);
  const generation = queueGeneration;
  batch(() => { radioLoading.set(true); radioError.set(""); });
  radioPromise = (async () => {
    try {
      const result = await options.fetchRadio!(track);
      if (generation !== queueGeneration) return [];
      const ids = new Set(queue().map((item) => item.id));
      const incoming = result.filter((item) => { if (ids.has(item.id)) return false; ids.add(item.id); return true; });
      const start = queue().length;
      queue.update((items) => [...items, ...incoming]);
      shuffleBag.push(...incoming.map((_, index) => start + index));
      changed();
      return incoming;
    } catch (reason) {
      if (generation === queueGeneration) radioError.set(errorText(reason));
      return [];
    } finally {
      if (generation === queueGeneration) { radioLoading.set(false); radioPromise = undefined; }
    }
  })();
  return radioPromise;
}

async function advance(ended: boolean) {
  if (!workspaceActive() || !queue().length) return;
  if (ended && sleepAfterTrack()) { pause(); cancelSleepTimer(); return; }
  if (ended && remoteControlled()) { pause(); return; }
  if (ended && repeat() === "one") {
    startListening(currentTrack()!);
    seek(0);
    playRequested = false;
    await resumePlayback();
    return;
  }
  const generation = queueGeneration;
  const request = loadId;
  if (repeat() === "off" && options.autoRadio?.() && (shuffle() ? !shuffleBag.length : currentIndex() + 1 >= queue().length)) {
    await extendRadio();
    if (!workspaceActive() || generation !== queueGeneration || request !== loadId || !playRequested) return;
  }
  let index: number;
  if (shuffle()) {
    if (!shuffleBag.length && repeat() === "all") resetShuffle();
    index = shuffleBag.pop() ?? (repeat() === "all" ? currentIndex() : -1);
  } else {
    index = currentIndex() + 1;
    if (index >= queue().length) index = repeat() === "all" ? 0 : -1;
  }
  if (index < 0) { pause(); return; }
  await playAt(index);
}
export function next() { return advance(false); }
export function previous() {
  if (position() > 3) { seek(0); return; }
  const from = currentIndex();
  const index = shuffle() ? visited.pop() : from - 1;
  if (index === undefined || index < 0) { seek(0); return; }
  if (shuffle()) { shuffleBag = shuffleBag.filter((item) => item !== index); shuffleBag.push(from); }
  currentIndex.set(index);
  return loadCurrent();
}
export function seek(seconds: number) {
  const value = Math.max(0, Math.min(seconds, duration() || seconds));
  lastPosition = value;
  position.set(value);
  player?.seek(value);
  updateMediaSession();
  changed();
}
export function setVolume(value: number) {
  volume.set(value);
  if (player) player.volume = value;
  options?.onPreferences?.();
}
export function setRate(value: number) {
  rate.set(value);
  if (player) player.rate = value;
  updateMediaSession();
  options?.onPreferences?.();
}
export function toggleShuffle() { shuffle.update((value) => !value); resetShuffle(); prepareUpcoming(); options?.onPreferences?.(); }
export function cycleRepeat() {
  repeat.set(repeat() === "off" ? "all" : repeat() === "all" ? "one" : "off");
  prepareUpcoming();
  options?.onPreferences?.();
}
export function addTracksToQueue(tracks: Track[]) {
  if (!tracks.length) return;
  const start = queue().length;
  batch(() => {
    queue.update(items => [...items, ...tracks]);
    if (currentIndex() < 0) currentIndex.set(0);
  });
  for (let index = start; index < queue().length; index++) {
    if (index !== currentIndex()) shuffleBag.splice(Math.floor(Math.random() * (shuffleBag.length + 1)), 0, index);
  }
  changed();
}
export function playNextTracks(tracks: Track[]) {
  if (!tracks.length) return;
  const index = currentIndex() + 1;
  batch(() => {
    queue.update(items => [...items.slice(0, index), ...tracks, ...items.slice(index)]);
    if (currentIndex() < 0) currentIndex.set(0);
  });
  const remap = (item: number) => item >= index ? item + tracks.length : item;
  shuffleBag = shuffleBag.map(remap);
  visited = visited.map(remap);
  // The shuffle bag pops from its end; a batch must play in its displayed order.
  shuffleBag.push(...tracks.map((_, offset) => index + offset).filter(item => item !== currentIndex()).reverse());
  changed();
}
export function addToQueue(track: Track) { addTracksToQueue([track]); }
export function playNext(track: Track) { playNextTracks([track]); }
export function removeFromQueue(index: number) {
  const selected = currentIndex();
  const resume = playRequested || playing();
  const items = queue().filter((_, i) => i !== index);
  if (!items.length) { clearQueue(); return; }
  batch(() => { queue.set(items); currentIndex.set(index < selected ? selected - 1 : Math.min(selected, items.length - 1)); });
  const remap = (list: number[]) => list.filter((item) => item !== index).map((item) => item > index ? item - 1 : item);
  shuffleBag = remap(shuffleBag).filter((item) => item !== currentIndex());
  visited = remap(visited);
  if (index === selected) {
    if (resume) void loadCurrent();
    else {
      releaseSource(true);
      listening = undefined;
      batch(() => { position.set(0); duration.set(currentTrack()?.duration ?? 0); playbackError.set(""); playbackErrorCode.set(""); });
      updateMediaSession();
    }
  }
  changed();
}
function reorderQueue(from: number, to: number) {
  const items = [...queue()];
  items.splice(to, 0, items.splice(from, 1)[0]);
  const remap = (index: number) => index === from ? to : from < index && to >= index ? index - 1 : from > index && to <= index ? index + 1 : index;
  batch(() => { queue.set(items); currentIndex.set(remap(currentIndex())); });
  shuffleBag = shuffleBag.map(remap);
  visited = visited.map(remap);
}
export function moveQueue(from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= queue().length || to >= queue().length) return;
  reorderQueue(from, to);
  changed();
}
export function moveQueueNext(index: number) {
  if (index === currentIndex() || index < 0 || index >= queue().length) return;
  const target = currentIndex() + (index < currentIndex() ? 0 : 1);
  reorderQueue(index, target);
  shuffleBag = shuffleBag.filter(item => item !== target);
  shuffleBag.push(target);
  changed();
}
export function clearQueue() {
  playRequested = false;
  cancelPreparation();
  resetRadio();
  releaseSource();
  if (platform.os === "android") void nativeCommand("stop").catch(surfaceError);
  listening = undefined;
  batch(() => { queue.set([]); queueTitle.set(""); currentIndex.set(-1); position.set(0); duration.set(0); playbackError.set(""); playbackErrorCode.set(""); playbackPhase.set("idle"); playbackTiming.set(null); });
  resetSleepTimer();
  visited = [];
  shuffleBag = [];
  updateMediaSession();
  changed();
}

export function clearUpcoming() {
  if (currentIndex() < 0) { clearQueue(); return; }
  resetRadio();
  cancelPreparation();
  queue.update(items => items.slice(0, currentIndex() + 1));
  shuffleBag = [];
  visited = visited.filter(index => index <= currentIndex());
  changed();
}
export function restoreQueue(items: Track[], index: number, seconds = 0, title = "") {
  playRequested = false;
  cancelPreparation();
  resetRadio();
  releaseSource();
  listening = undefined;
  batch(() => {
    queue.set(items); queueTitle.set(title); currentIndex.set(items.length ? Math.min(index, items.length - 1) : -1);
    position.set(seconds); duration.set(currentTrack()?.duration ?? 0); playbackError.set(""); playbackErrorCode.set("");
    playbackPhase.set(items.length ? "paused" : "idle"); playbackTiming.set(null);
  });
  visited = [];
  resetShuffle();
  prepareUpcoming();
}
export async function applyRemoteState(state: RemotePlaybackState) {
  syncingRemote.set(true);
  try {
    const sameTrack = currentTrack()?.id === state.queue[state.index]?.id && !!player;
    resetRadio();
    batch(() => {
      queue.set([...state.queue]); currentIndex.set(state.index); queueTitle.set(state.title || "一起听");
      if (state.shuffle !== undefined) shuffle.set(state.shuffle);
      if (state.repeat !== undefined) repeat.set(state.repeat);
    });
    resetShuffle();
    visited = [];
    if (sameTrack) {
      seek(state.position);
      if (state.playing) await resumePlayback(); else pause();
    } else if (state.playing) await loadCurrent(state.position);
    else {
      playRequested = false;
      releaseSource(true);
      listening = undefined;
      batch(() => { position.set(state.position); duration.set(currentTrack()?.duration ?? 0); });
      playbackPhase.set(currentTrack() ? "paused" : "idle");
      updateMediaSession();
    }
    changed();
  } finally { syncingRemote.set(false); }
}
function resetSleepTimer() {
  if (sleepTimer !== undefined) clearTimeout(sleepTimer);
  sleepTimer = undefined;
  batch(() => { sleepUntil.set(null); sleepAfterTrack.set(false); sleepRemaining.set(0); });
}
function tickSleepTimer() {
  const remaining = sleepUntil()! - Date.now();
  sleepRemaining.set(Math.max(0, Math.ceil(remaining / 1000)));
  if (remaining <= 0) { pause(); resetSleepTimer(); }
  else sleepTimer = setTimeout(tickSleepTimer, Math.min(1000, remaining));
}
export function cancelSleepTimer() {
  resetSleepTimer();
  prepareUpcoming();
}
export function setSleepTimer(minutes: number) {
  resetSleepTimer();
  if (minutes > 0) {
    sleepUntil.set(Date.now() + minutes * 60000);
    tickSleepTimer();
  }
  prepareUpcoming();
}
export function setSleepAfterTrack() {
  resetSleepTimer();
  sleepAfterTrack.set(true);
  cancelPreparation();
}
