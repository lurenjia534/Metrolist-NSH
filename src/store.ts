import { batch, computed, host, openUrl, Picker, platform, setColorScheme, signal, Storage } from "nsh";
import { mkdir, writeFile } from "fs/promises";
import process from "process";
import { pathToFileURL } from "url";
import { NativeFiles } from "metrolist/native";
import seed from "../assets/catalog-seed.json";
import * as api from "./api";
import * as account from "./account";
import * as player from "./playback";
import { isTrack } from "./model";
import type { AudioQuality, BrowseEndpoint, BrowseResponse, CatalogItem, Collection, DownloadJob, ExploreResponse, ExploreTab, HomeChip, HomeResponse, LibrarySnapshot, LibrarySort, ListenEvent, ListeningStatistics, Lyrics, PlayEndpoint, Playlist, PlaylistEntry, PlaylistSort, SavedCollection, SearchType, Settings, StatsPeriod, StreamInfo, Track } from "./model";

const seedCatalog = seed as { tracks: Track[]; collections?: Collection[]; sections?: HomeResponse["sections"] };

export const tracks = signal<Track[]>(seedCatalog.tracks);
export const collections = signal<Collection[]>(seedCatalog.collections ?? []);
export const playlists = signal<Playlist[]>([]);
export const libraryIds = signal<string[]>([]);
export const likedIds = signal<string[]>([]);
export const history = signal<Track[]>([]);
export const savedCollections = signal<SavedCollection[]>([]);
export const listenEvents = signal<ListenEvent[]>([]);
export const searchHistory = signal<string[]>([]);
export const searchSuggestions = signal<string[]>([]);
export const libraryQuery = signal("");
export const librarySort = signal<LibrarySort>("recent");
export const libraryDescending = signal(true);
export const statsPeriod = signal<StatsPeriod>("month");
export const settings = signal<Settings>({
  theme: "dark", apiBase: "", nativeFirst: true,
  audioQuality: "auto", autoRadio: true, pauseHistory: false, libraryView: "grid",
  lyricFontSize: "medium", lyricAlignment: "center", lyricsOffset: 0,
  volume: 0.7, rate: 1, shuffle: false, repeat: "off",
});
export const home = signal<HomeResponse>({ sections: [], chips: [] });
export const selectedHomeChip = signal<HomeChip | null>(null);
export const explore = signal<ExploreResponse>({ sections: [], moods: [] });
export const exploreTab = signal<ExploreTab>("all");
export const exploreEndpoint = signal<BrowseEndpoint | null>(null);
export const exploreLoading = signal(false);
export const query = signal("");
export const searchType = signal<SearchType>("all");
export const searchResults = signal<CatalogItem[]>([]);
export const searchContinuation = signal<string | undefined>();
export const searching = signal(false);
export const homeLoading = signal(false);
export const collectionLoading = signal(false);
export const loading = computed(() => homeLoading() || collectionLoading());
export const error = signal("");
export const activeCollection = signal<Collection | null>(null);
export const collectionTracks = signal<Track[]>([]);
export const collectionDetails = signal<BrowseResponse | null>(null);
export const lyrics = signal<Lyrics | null>(null);
export const lyricsLoading = signal(false);
export const lyricsError = signal("");
export const downloadJobs = signal<DownloadJob[]>([]);
export const downloading = computed(() => downloadJobs().filter((job) => ["queued", "resolving", "downloading"].includes(job.status)).map((job) => job.id));
export const downloads = computed(() => downloadJobs().filter((job) => job.status === "completed").map((job): Track => ({ ...job.track, source: "audio", url: job.url })));
export const likedTracks = computed(() => likedIds().map((id) => tracks().find((track) => track.id === id)).filter((track): track is Track => !!track));
export const libraryTracks = computed(() => libraryIds().map((id) => tracks().find((track) => track.id === id)).filter((track): track is Track => !!track));
export const savedAlbums = computed(() => savedCollections().filter((item) => item.type === "album"));
export const savedArtists = computed(() => savedCollections().filter((item) => item.type === "artist"));
export const filteredTracks = computed(() => sortTracks(libraryTracks().filter((track) => matches(libraryQuery(), track.title, track.artist, track.album)), librarySort(), libraryDescending()));
export const filteredPlaylists = computed(() => sortPlaylists(playlists().filter((item) => matches(libraryQuery(), item.name))));
export const filteredAlbums = computed(() => sortCollections(savedAlbums().filter((item) => matches(libraryQuery(), item.title, item.subtitle))));
export const filteredArtists = computed(() => sortCollections(savedArtists().filter((item) => matches(libraryQuery(), item.title, item.subtitle))));
export const statistics = computed<ListeningStatistics>(() => calculateStatistics());

let initialized = false;
let searchRequest = 0;
let browseRequest = 0;
let lyricRequest = 0;
let suggestionRequest = 0;
let exploreRequest = 0;
let homeRequest = 0;
let unfilteredHome: HomeResponse | null = null;
const downloadRuns = new Map<string, AbortController>();
const downloadTransfers = new Map<string, Promise<{ destination: string; url: string; bytes: number }>>();
const downloadReplacements = new Map<string, { controller: AbortController; job: DownloadJob }>();
const hostFiles = platform.os === "web" || platform.os === "android";
const nativeDesktop = platform.os !== "web" && platform.desktop;
const nativeDownloadsDirectory = `${process.dataDir}/downloads`;

export function showError(reason: unknown) {
  error.set(reason instanceof Error ? reason.message : String(reason));
}
export function clearError() { error.set(""); }

function matches(query: string, ...fields: string[]) {
  const normalized = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  const text = normalized(fields.join(" "));
  return normalized(query).trim().split(/\s+/).every((word) => text.includes(word));
}
function trackSeconds(id: string) { return listenEvents().filter((event) => event.trackId === id).reduce((sum, event) => sum + event.seconds, 0); }
export function sortTracks(items: Track[], sort: LibrarySort | PlaylistSort, descending: boolean) {
  if (sort === "custom") return [...items];
  if (sort === "recent") return descending ? [...items] : [...items].reverse();
  const result = [...items].sort((a, b) => sort === "artist" ? a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title)
    : sort === "playTime" ? trackSeconds(a.id) - trackSeconds(b.id)
    : sort === "duration" ? a.duration - b.duration : a.title.localeCompare(b.title));
  return descending ? result.reverse() : result;
}
function sortPlaylists(items: Playlist[]) {
  const sort = librarySort();
  const result = [...items].sort((a, b) => sort === "recent" ? a.createdAt - b.createdAt
    : sort === "songCount" ? a.tracks.length - b.tracks.length
    : sort === "playTime" ? a.tracks.reduce((n, t) => n + trackSeconds(t.id), 0) - b.tracks.reduce((n, t) => n + trackSeconds(t.id), 0)
    : a.name.localeCompare(b.name));
  return libraryDescending() ? result.reverse() : result;
}
function sortCollections(items: SavedCollection[]) {
  const sort = librarySort();
  const localTracks = (item: Collection) => tracks().filter((track) => item.type === "artist" ? track.artistId === item.id : track.albumId === item.id);
  const result = [...items].sort((a, b) => sort === "recent" ? a.savedAt - b.savedAt
    : sort === "artist" ? a.subtitle.localeCompare(b.subtitle)
    : sort === "songCount" ? (a.songCount ?? localTracks(a).length) - (b.songCount ?? localTracks(b).length)
    : sort === "playTime" ? localTracks(a).reduce((n, t) => n + trackSeconds(t.id), 0) - localTracks(b).reduce((n, t) => n + trackSeconds(t.id), 0)
    : a.title.localeCompare(b.title));
  return libraryDescending() ? result.reverse() : result;
}
function calculateStatistics(): ListeningStatistics {
  const days = { week: 7, month: 30, year: 365, all: Infinity }[statsPeriod()];
  const events = listenEvents().filter((event) => event.startedAt >= Date.now() - days * 86400000);
  const byTrack = new Map<string, { playCount: number; seconds: number }>();
  const byDay = new Map<string, { date: string; seconds: number; plays: number }>();
  for (const event of events) {
    const entry = byTrack.get(event.trackId) || { playCount: 0, seconds: 0 };
    entry.playCount++; entry.seconds += event.seconds; byTrack.set(event.trackId, entry);
    const date = new Date(event.startedAt).toISOString().slice(0, 10);
    const day = byDay.get(date) || { date, seconds: 0, plays: 0 };
    day.seconds += event.seconds; day.plays++; byDay.set(date, day);
  }
  const topTracks = tracks().filter((track) => byTrack.has(track.id)).map((track) => ({ track, ...byTrack.get(track.id)! })).sort((a, b) => b.seconds - a.seconds);
  const byArtist = new Map<string, ListeningStatistics["topArtists"][number]>();
  for (const item of topTracks) {
    const id = item.track.artistId || item.track.artist;
    const artist = byArtist.get(id) || { id, name: item.track.artist, artwork: item.track.artwork, playCount: 0, seconds: 0 };
    artist.playCount += item.playCount; artist.seconds += item.seconds; byArtist.set(id, artist);
  }
  return {
    plays: events.length, totalSeconds: events.reduce((sum, event) => sum + event.seconds, 0), uniqueTracks: byTrack.size,
    topTracks, topArtists: [...byArtist.values()].sort((a, b) => b.seconds - a.seconds), daily: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function librarySnapshot(): LibrarySnapshot {
  return {
    version: 2, exportedAt: new Date().toISOString(), tracks: tracks(), likedIds: likedIds(), history: history(), playlists: playlists(),
    libraryIds: libraryIds(), savedCollections: savedCollections(), listenEvents: listenEvents(), searchHistory: searchHistory(),
  };
}
function saveLibrary() {
  return Storage.setItem("metrolist.library", JSON.stringify(librarySnapshot())).catch(showError);
}
function saveSettings() {
  return Storage.setItem("metrolist.settings", JSON.stringify(settings())).catch(showError);
}
function savePlayer() {
  return Storage.setItem("metrolist.player", JSON.stringify({ queue: player.queue(), index: player.currentIndex(), position: player.position(), title: player.queueTitle() })).catch(showError);
}
function saveDownloads() { return Storage.setItem("metrolist.downloads", JSON.stringify(downloadJobs())).catch(showError); }
function savePlayerPreferences() {
  settings.update((value) => ({ ...value, volume: player.volume(), rate: player.rate(), shuffle: player.shuffle(), repeat: player.repeat() }));
  void saveSettings();
}

function remember(track: Track) {
  addTracks([track], false);
  void loadLyrics(track);
}
function recordListen(track: Track, event: ListenEvent) {
  if (settings().pauseHistory || event.seconds < 30) return;
  batch(() => {
    addTracks([track], false);
    history.update((items) => [track, ...items.filter((item) => item.id !== track.id)]);
    listenEvents.update((items) => [event, ...items.filter((item) => item.id !== event.id)]);
  });
  void saveLibrary();
}

/** Restores the device library, then refreshes the online home shelves. */
export async function initialize() {
  if (initialized) return;
  initialized = true;
  player.initPlayback({
    resolveStream: async (track, request) => {
      const downloaded = downloadJobs().find((job) => job.id === track.id && job.status === "completed"
        && (track.source === "audio" || settings().audioQuality === "auto" || job.quality === settings().audioQuality));
      if (downloaded?.url) return { ...await api.resolvePlayback({ ...track, source: "audio", url: downloaded.url }), quality: downloaded.quality };
      return api.resolvePlayback(track, settings().audioQuality, request);
    },
    sourceContext: () => JSON.stringify([settings().apiBase, settings().audioQuality, account.currentCredentials()]),
    autoRadio: () => settings().autoRadio,
    fetchRadio: async (track) => { const result = await api.fetchNext(track.id); addTracks(result.tracks, false); return result.tracks; },
    onTrack: remember, onListen: recordListen, onError: showError,
    onQueueChange: () => { void savePlayer(); },
    onPreferences: savePlayerPreferences,
  });
  if ((platform.os === "web" || platform.os === "android")) host.on("files.download.progress", (payload: unknown) => {
    const progress = payload as { id: string; bytes: number; totalBytes?: number; progress: number };
    if (downloadRuns.has(progress.id) && !downloadRuns.get(progress.id)!.signal.aborted)
      updateDownload(progress.id, { status: "downloading", bytes: progress.bytes, totalBytes: progress.totalBytes, progress: progress.progress });
  });
  try {
    const [savedLibrary, savedSettings, savedPlayer, savedDownloads] = await Promise.all([
      Storage.getItem("metrolist.library"), Storage.getItem("metrolist.settings"), Storage.getItem("metrolist.player"), Storage.getItem("metrolist.downloads"),
    ]);
    if (savedLibrary) {
      const saved = JSON.parse(savedLibrary) as LibrarySnapshot;
      batch(() => {
        addTracks(saved.tracks, false);
        likedIds.set(saved.likedIds);
        history.set(saved.history);
        playlists.set(saved.playlists);
        libraryIds.set(saved.libraryIds || [...new Set([...saved.likedIds, ...saved.playlists.flatMap((item) => item.tracks.map((track) => track.id)), ...saved.tracks.filter((track) => track.source === "audio").map((track) => track.id)])]);
        savedCollections.set(saved.savedCollections || []);
        listenEvents.set(saved.listenEvents || []);
        searchHistory.set(saved.searchHistory || []);
      });
    }
    if (savedSettings) {
      const restored = JSON.parse(savedSettings) as Record<string, unknown>;
      // 0.5 desktop packages supplied this address themselves. 0.6 runs in-process.
      if (nativeDesktop && !restored.nativeFirst && String(restored.apiBase).replace(/\/+$/, "") === "http://127.0.0.1:8787") restored.apiBase = "";
      restored.nativeFirst = true;
      for (const key of Object.keys(restored)) if (!(key in settings())) delete restored[key];
      settings.update((value) => ({ ...value, ...restored }));
      await saveSettings();
    }
    if (savedDownloads) downloadJobs.set((JSON.parse(savedDownloads) as DownloadJob[]).map((job) =>
      ["queued", "resolving", "downloading"].includes(job.status) ? { ...job, status: "cancelled" } : job));
    if (nativeDesktop) {
      for (const job of downloadJobs()) {
        if (job.status !== "completed" || !job.destination || !job.url?.startsWith("http://127.0.0.1:8787/api/offline")) continue;
        try {
          const saved = await NativeFiles.copyInto(job.destination, nativeDownloadsDirectory, job.name);
          updateDownload(job.id, { ...saved, totalBytes: saved.bytes });
        } catch (reason) {
          updateDownload(job.id, { status: "failed", error: `旧版下载迁移失败：${reason instanceof Error ? reason.message : String(reason)}` });
        }
      }
    }
    if (savedDownloads) await saveDownloads();
    const preferences = settings();
    api.setApiOrigin(preferences.apiBase);
    setColorScheme(preferences.theme === "black" ? "dark" : preferences.theme);
    batch(() => {
      player.volume.set(preferences.volume); player.rate.set(preferences.rate);
      player.shuffle.set(preferences.shuffle); player.repeat.set(preferences.repeat);
    });
    if (savedPlayer) {
      const saved = JSON.parse(savedPlayer) as { queue: Track[]; index: number; position: number; title?: string };
      player.restoreQueue(saved.queue, saved.index, saved.position, saved.title);
    }
    await player.reconnectNativePlayback();
  } catch (reason) { showError(reason); }
  void loadHome();
}

export function updateSettings(patch: Partial<Settings>) {
  settings.update((value) => ({ ...value, ...patch }));
  const value = settings();
  api.setApiOrigin(value.apiBase);
  setColorScheme(value.theme === "black" ? "dark" : value.theme);
  if (patch.volume !== undefined) player.setVolume(patch.volume);
  if (patch.rate !== undefined) player.setRate(patch.rate);
  if (patch.shuffle !== undefined && patch.shuffle !== player.shuffle()) player.toggleShuffle();
  if (patch.repeat !== undefined) player.repeat.set(patch.repeat);
  void saveSettings();
  if (patch.audioQuality !== undefined || patch.apiBase !== undefined) void player.reloadPlayback();
  if (patch.apiBase !== undefined) void resetHome();
}

export function addTracks(items: Track[], persist = true) {
  const catalog = new Map(tracks().map((track) => [track.id, track]));
  for (const track of items) catalog.set(track.id, track);
  tracks.set([...catalog.values()]);
  if (persist) void saveLibrary();
}
function addLibraryTracks(items: Track[], persist = true) {
  batch(() => {
    addTracks(items, false);
    const incoming = new Set(items.map((track) => track.id));
    libraryIds.update((ids) => [...incoming, ...ids.filter((id) => !incoming.has(id))]);
  });
  if (persist) void saveLibrary();
}
export function addToLibrary(track: Track) { addLibraryTracks([track]); }
export function isInLibrary(id: string) { return libraryIds().includes(id); }
export function removeFromLibrary(id: string) {
  batch(() => { libraryIds.update((ids) => ids.filter((item) => item !== id)); likedIds.update((ids) => ids.filter((item) => item !== id)); });
  void saveLibrary();
}
export function isCollectionSaved(id: string) { return savedCollections().some((item) => item.id === id); }
export function toggleCollectionSaved(collection: Collection) {
  savedCollections.update((items) => items.some((item) => item.id === collection.id)
    ? items.filter((item) => item.id !== collection.id) : [{ ...collection, savedAt: Date.now() }, ...items]);
  void saveLibrary();
}

function register(items: CatalogItem[]) {
  addTracks(items.filter(isTrack), false);
  const catalog = new Map(collections().map((item) => [item.id, item]));
  for (const item of items) if (!isTrack(item)) catalog.set(item.id, item);
  collections.set([...catalog.values()]);
}

export async function loadHome() {
  const request = ++homeRequest;
  const endpoint = selectedHomeChip()?.endpoint;
  homeLoading.set(true);
  try {
    const result = await api.fetchHome(endpoint);
    if (request !== homeRequest) return;
    batch(() => {
      home.set({ ...result, chips: selectedHomeChip() ? home().chips : result.chips });
      if (!selectedHomeChip()) unfilteredHome = home();
      register(result.sections.flatMap((section) => section.items));
    });
  } catch (reason) { if (request === homeRequest) showError(reason); }
  finally { if (request === homeRequest) homeLoading.set(false); }
}

export function clearHomeFilter() {
  ++homeRequest;
  batch(() => {
    selectedHomeChip.set(null);
    homeLoading.set(false);
    if (unfilteredHome) home.set(unfilteredHome);
  });
}

export async function selectHomeChip(chip: HomeChip) {
  if (selectedHomeChip()?.title === chip.title || !chip.endpoint) { clearHomeFilter(); return; }
  if (!selectedHomeChip()) unfilteredHome = home();
  batch(() => {
    selectedHomeChip.set(chip);
    home.set({ sections: [], chips: home().chips });
  });
  await loadHome();
}

export async function resetHome() {
  unfilteredHome = null;
  batch(() => { selectedHomeChip.set(null); home.set({ sections: [], chips: [] }); });
  await loadHome();
}

export async function loadMoreHome() {
  const continuation = home().continuation;
  if (!continuation || homeLoading()) return;
  const request = homeRequest;
  homeLoading.set(true);
  try {
    const result = await api.fetchHome(selectedHomeChip()?.endpoint, continuation);
    if (request !== homeRequest) return;
    batch(() => {
      home.update(value => ({ ...value, sections: [...value.sections, ...result.sections], continuation: result.continuation }));
      if (!selectedHomeChip()) unfilteredHome = home();
      register(result.sections.flatMap(section => section.items));
    });
  } catch (reason) { if (request === homeRequest) showError(reason); }
  finally { if (request === homeRequest) homeLoading.set(false); }
}

export async function loadExplore(tab: ExploreTab = exploreTab()) {
  const request = ++exploreRequest;
  batch(() => { exploreEndpoint.set(null); exploreTab.set(tab); explore.set({ sections: [], moods: [] }); exploreLoading.set(true); });
  try {
    const result = await api.fetchExplore(tab);
    if (request !== exploreRequest) return;
    batch(() => { explore.set(result); register(result.sections.flatMap((section) => section.items)); });
  } catch (reason) { if (request === exploreRequest) showError(reason); }
  finally { if (request === exploreRequest) exploreLoading.set(false); }
}

function browseFeed(result: BrowseResponse): ExploreResponse {
  return { sections: result.sections.length ? result.sections : result.tracks.length ? [{ title: result.title, items: result.tracks, layout: "list" }] : [], moods: [], continuation: result.continuation };
}

export async function loadExploreEndpoint(endpoint: BrowseEndpoint) {
  const request = ++exploreRequest;
  batch(() => { exploreEndpoint.set(endpoint); explore.set({ sections: [], moods: [] }); exploreLoading.set(true); });
  try {
    const result = browseFeed(await api.fetchBrowse(endpoint.browseId, undefined, endpoint.params));
    if (request !== exploreRequest) return;
    batch(() => { explore.set(result); register(result.sections.flatMap(section => section.items)); });
  } catch (reason) { if (request === exploreRequest) showError(reason); }
  finally { if (request === exploreRequest) exploreLoading.set(false); }
}

export function captureExploreState() {
  return { endpoint: exploreEndpoint(), tab: exploreTab(), result: explore(), loading: exploreLoading() };
}

export function restoreExploreState(state: ReturnType<typeof captureExploreState>) {
  ++exploreRequest;
  batch(() => { exploreEndpoint.set(state.endpoint); exploreTab.set(state.tab); explore.set(state.result); exploreLoading.set(false); });
  if (state.loading && !state.result.sections.length && !state.result.moods.length) {
    if (state.endpoint) void loadExploreEndpoint(state.endpoint);
    else void loadExplore(state.tab);
  }
}

export async function loadMoreExplore() {
  const continuation = explore().continuation;
  if (!continuation || exploreLoading()) return;
  const request = exploreRequest;
  exploreLoading.set(true);
  try {
    const endpoint = exploreEndpoint();
    const result = endpoint ? browseFeed(await api.fetchBrowse(endpoint.browseId, continuation, endpoint.params)) : await api.fetchExplore(exploreTab(), continuation);
    if (request !== exploreRequest) return;
    batch(() => {
      explore.update((value) => ({ ...result, sections: [...value.sections, ...result.sections], moods: [...value.moods, ...result.moods] }));
      register(result.sections.flatMap((section) => section.items));
    });
  } catch (reason) { if (request === exploreRequest) showError(reason); }
  finally { if (request === exploreRequest) exploreLoading.set(false); }
}

export async function playEndpoint(endpoint: PlayEndpoint, title: string) {
  const result = await api.fetchEndpointQueue(endpoint);
  addTracks(result.tracks, false);
  await player.playList(result.tracks, result.currentIndex ?? 0, title);
}
/** Plays an album or playlist from its card without opening its page. */
export async function playCollection(collection: Collection) {
  const result = await api.fetchBrowse(collection.browseId || collection.id, undefined, collection.params);
  addTracks(result.tracks, false);
  await player.playList(result.tracks, 0, result.title || collection.title);
}
export function saveSearchHistory(text: string) {
  const value = text.trim();
  if (!value) return;
  searchHistory.update((items) => [value, ...items.filter((item) => item !== value)].slice(0, 30));
  void saveLibrary();
}
export function removeSearchHistory(text: string) { searchHistory.update((items) => items.filter((item) => item !== text)); void saveLibrary(); }
export function clearSearchHistory() { searchHistory.set([]); void saveLibrary(); }
export async function loadSuggestions(text: string) {
  const request = ++suggestionRequest;
  if (!text.trim()) { searchSuggestions.set([]); return; }
  try {
    const result = await api.fetchSuggestions(text.trim());
    if (request === suggestionRequest) searchSuggestions.set(result.suggestions);
  } catch (reason) { if (request === suggestionRequest) showError(reason); }
}

export async function search(text: string, type: SearchType = searchType()) {
  const request = ++searchRequest;
  batch(() => {
    query.set(text); searchType.set(type); searchResults.set([]);
    searchContinuation.set(undefined); searching.set(!!text.trim());
  });
  if (!text.trim()) return;
  saveSearchHistory(text);
  try {
    const result = await api.fetchSearch(text.trim(), type);
    if (request !== searchRequest) return;
    batch(() => {
      searchResults.set(result.items); searchContinuation.set(result.continuation); register(result.items);
    });
  } catch (reason) { if (request === searchRequest) showError(reason); }
  finally { if (request === searchRequest) searching.set(false); }
}

export function captureSearchState() {
  return { query: query(), type: searchType(), items: searchResults(), continuation: searchContinuation(),
    suggestions: searchSuggestions(), loading: searching() };
}
export function restoreSearchState(state: ReturnType<typeof captureSearchState>) {
  ++searchRequest;
  ++suggestionRequest;
  batch(() => {
    query.set(state.query); searchType.set(state.type); searchResults.set(state.items);
    searchContinuation.set(state.continuation); searchSuggestions.set(state.suggestions); searching.set(false);
  });
  if (state.loading && !state.items.length) void search(state.query, state.type);
}

export async function loadMoreSearch() {
  const continuation = searchContinuation();
  if (!continuation || searching()) return;
  const request = searchRequest;
  searching.set(true);
  try {
    const result = await api.fetchSearch(query(), searchType(), continuation);
    if (request !== searchRequest) return;
    batch(() => {
      searchResults.update((items) => [...items, ...result.items]);
      searchContinuation.set(result.continuation); register(result.items);
    });
  } catch (reason) { if (request === searchRequest) showError(reason); }
  finally { if (request === searchRequest) searching.set(false); }
}

export async function openCollection(collection: Collection) {
  const request = ++browseRequest;
  batch(() => {
    activeCollection.set(collection); collectionTracks.set([]); collectionDetails.set(null); collectionLoading.set(true);
  });
  try {
    const result = await api.fetchBrowse(collection.browseId || collection.id, undefined, collection.params);
    if (request !== browseRequest) return;
    batch(() => {
      collectionDetails.set(result); collectionTracks.set(result.tracks); addTracks(result.tracks, false);
      register(result.sections.flatMap((section) => section.items));
    });
  } catch (reason) { if (request === browseRequest) showError(reason); }
  finally { if (request === browseRequest) collectionLoading.set(false); }
}

export function captureCollectionState() {
  return { collection: activeCollection(), tracks: collectionTracks(), details: collectionDetails(), loading: collectionLoading() };
}
export function restoreCollectionState(state: ReturnType<typeof captureCollectionState>) {
  ++browseRequest;
  batch(() => {
    activeCollection.set(state.collection); collectionTracks.set(state.tracks);
    collectionDetails.set(state.details); collectionLoading.set(false);
  });
  if (state.loading && !state.details && state.collection) void openCollection(state.collection);
}

export async function loadMoreCollection() {
  const collection = activeCollection();
  const continuation = collectionDetails()?.continuation;
  if (!collection || !continuation || collectionLoading()) return;
  const request = browseRequest;
  collectionLoading.set(true);
  try {
    const result = await api.fetchBrowse(collection.browseId || collection.id, continuation, collection.params);
    if (request !== browseRequest) return;
    batch(() => {
      collectionTracks.update((items) => [...items, ...result.tracks]);
      collectionDetails.update((details) => ({
        ...details!, tracks: collectionTracks(),
        sections: [...details!.sections, ...result.sections], continuation: result.continuation,
      }));
      addTracks(result.tracks, false);
      register(result.sections.flatMap((section) => section.items));
    });
  } catch (reason) { if (request === browseRequest) showError(reason); }
  finally { if (request === browseRequest) collectionLoading.set(false); }
}

export async function startRadio(track: Track) {
  try {
    const result = await api.fetchNext(track.id);
    const items = [track, ...result.tracks.filter((item) => item.id !== track.id)];
    addTracks(items, false);
    await player.playList(items, 0, `${track.title} · 电台`);
  } catch (reason) { showError(reason); }
}

export async function loadLyrics(track: Track) {
  const request = ++lyricRequest;
  batch(() => { lyrics.set(null); lyricsLoading.set(true); lyricsError.set(""); });
  try {
    const result = await api.fetchLyrics(track);
    if (request === lyricRequest) lyrics.set(result);
  } catch (reason) {
    if (request === lyricRequest) lyricsError.set(reason instanceof Error ? reason.message : String(reason));
  } finally { if (request === lyricRequest) lyricsLoading.set(false); }
}

export function isLiked(id: string) {
  const local = tracks().find(track => track.id === id)?.source === "audio";
  return account.signedIn() && !local ? account.isCloudLiked(id) : likedIds().includes(id);
}
export function toggleLike(track: Track) {
  if (account.signedIn() && track.source === "youtube") {
    void account.setLike(track.id, !account.isCloudLiked(track.id)).catch(showError);
    return;
  }
  addTracks([track], false);
  if (!isLiked(track.id)) addLibraryTracks([track], false);
  likedIds.update((ids) => ids.includes(track.id) ? ids.filter((id) => id !== track.id) : [track.id, ...ids]);
  void saveLibrary();
}

function makePlaylist(name: string, tracks: Track[] = []): Playlist {
  return {
    id: `playlist-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || "新建歌单", tracks, createdAt: Date.now(), updatedAt: Date.now(),
  };
}

export function createPlaylist(name: string): Playlist {
  const playlist = makePlaylist(name);
  playlists.update((items) => [...items, playlist]);
  void saveLibrary();
  return playlist;
}

export function renamePlaylist(id: string, name: string) {
  playlists.update((items) => items.map((item) => item.id === id ? { ...item, name: name.trim() || item.name, updatedAt: Date.now() } : item));
  void saveLibrary();
}
export function deletePlaylist(id: string) {
  playlists.update((items) => items.filter((item) => item.id !== id));
  void saveLibrary();
}
export function addToPlaylist(id: string, track: Track) { addTracksToPlaylist(id, [track]); }
export function addTracksToPlaylist(id: string, incoming: Track[]) {
  addLibraryTracks(incoming, false);
  playlists.update((items) => items.map((item) => {
    if (item.id !== id) return item;
    return { ...item, tracks: [...item.tracks, ...incoming], updatedAt: Date.now() };
  }));
  void saveLibrary();
}
export function removeFromPlaylist(id: string, trackId: string, rowIndex?: number) {
  playlists.update((items) => items.map((item) => item.id === id ? {
    ...item,
    tracks: item.tracks.filter((track, index) => rowIndex === undefined ? track.id !== trackId : index !== rowIndex),
    updatedAt: Date.now(),
  } : item));
  void saveLibrary();
}
export function removePlaylistEntries(id: string, indices: number[]) {
  const selected = new Set(indices);
  playlists.update(items => items.map(item => item.id === id ? {
    ...item, tracks: item.tracks.filter((_, index) => !selected.has(index)), updatedAt: Date.now(),
  } : item));
  void saveLibrary();
}
export function playlistEntries(id: string, query = "", sort: PlaylistSort = "custom", descending = false): PlaylistEntry[] {
  const entries = (playlists().find((item) => item.id === id)?.tracks || []).map((track, index) => ({ track, index }))
    .filter(({ track }) => matches(query, track.title, track.artist, track.album));
  if (sort === "custom") return entries;
  entries.sort((a, b) => sort === "recent" ? a.index - b.index : sort === "artist" ? a.track.artist.localeCompare(b.track.artist)
    : sort === "playTime" ? trackSeconds(a.track.id) - trackSeconds(b.track.id)
    : sort === "duration" ? a.track.duration - b.track.duration : a.track.title.localeCompare(b.track.title));
  return descending ? entries.reverse() : entries;
}
export function movePlaylistTrack(id: string, from: number, to: number) {
  playlists.update((items) => items.map((item) => {
    if (item.id !== id || to < 0 || to >= item.tracks.length || from === to) return item;
    const rows = [...item.tracks];
    rows.splice(to, 0, rows.splice(from, 1)[0]);
    return { ...item, tracks: rows, updatedAt: Date.now() };
  }));
  void saveLibrary();
}
export function sortPlaylist(id: string, sort: PlaylistSort, descending = false) {
  const rows = playlistEntries(id, "", sort, descending).map((entry) => entry.track);
  playlists.update((items) => items.map((item) => item.id === id ? { ...item, tracks: rows, updatedAt: Date.now() } : item));
  void saveLibrary();
}

export function clearHistory() { history.set([]); void saveLibrary(); }
export function removeHistory(trackIds: string[]) {
  const selected = new Set(trackIds);
  history.update(items => items.filter(track => !selected.has(track.id)));
  void saveLibrary();
}
export function clearStatistics() { listenEvents.set([]); void saveLibrary(); }

export async function importUrl(value: string): Promise<Track | Playlist> {
  try {
    const url = new URL(value.trim());
    const youtube = /(^|\.)(youtube\.com|youtu\.be)$/.test(url.hostname);
    if (youtube && url.searchParams.has("list") && !url.searchParams.has("v")) {
      const id = url.searchParams.get("list")!;
      const browseId = id.startsWith("VL") ? id : `VL${id}`;
      const result = await api.fetchBrowse(browseId);
      const imported = [...result.tracks];
      let continuation = result.continuation;
      while (continuation) {
        const page = await api.fetchBrowse(browseId, continuation);
        imported.push(...page.tracks);
        continuation = page.continuation;
      }
      const playlist = makePlaylist(result.title || "导入的歌单", imported);
      playlist.browseId = browseId;
      batch(() => {
        addLibraryTracks(imported, false);
        playlists.update((items) => [...items, playlist]);
      });
      await saveLibrary();
      return playlist;
    }
    let id = "";
    if (youtube) id = url.hostname === "youtu.be" ? url.pathname.slice(1).split("/")[0] : url.searchParams.get("v") || url.pathname.split("/").filter(Boolean).pop() || "";
    const name = decodeURIComponent(url.pathname.split("/").pop() || "音频链接").replace(/\.[A-Za-z0-9]+$/, "");
    let track: Track = youtube
      ? { id, title: "YouTube Music", artist: "导入的链接", album: "", artwork: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, duration: 0, source: "youtube" }
      : { id: `url:${url.href}`, title: name, artist: "音频链接", album: "", artwork: "", duration: 0, source: "audio", url: url.href };
    if (youtube) {
      const existing = tracks().find((item) => item.id === id);
      if (existing) track = existing;
    }
    addToLibrary(track);
    player.addToQueue(track);
    return track;
  } catch (reason) { showError(reason); throw reason; }
}

export async function importFiles(): Promise<Track[]> {
  try {
    let imported: Track[];
    if ((platform.os === "web" || platform.os === "android")) imported = await host.call<Track[]>("files.import", { kind: "audio" }, { timeout: 0 });
    else if (nativeDesktop) {
      const files = await NativeFiles.importAudio(`${process.dataDir}/music`);
      imported = files.map((file, index) => ({ id: `local-${Date.now().toString(36)}-${index}`, title: file.name.replace(/\.[^.]+$/, ""), artist: "本地音乐", album: "", artwork: "", duration: 0, source: "audio", url: file.url }));
    } else {
      const files = await Picker.pickFiles({ multiple: true, filters: [{ name: "音乐", extensions: ["mp3", "m4a", "aac", "wav", "ogg", "flac", "opus"] }] });
      const directory = `${process.dataDir}/music`;
      await mkdir(directory, { recursive: true });
      imported = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i].file;
        const id = `local-${Date.now().toString(36)}-${i}`;
        const path = `${directory}/${id}-${file.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
        await writeFile(path, new Uint8Array(await file.arrayBuffer()));
        imported.push({ id, title: file.name.replace(/\.[^.]+$/, ""), artist: "本地音乐", album: "", artwork: "", duration: 0, source: "audio", url: pathToFileURL(path).href });
      }
    }
    addLibraryTracks(imported);
    return imported;
  } catch (reason) { showError(reason); throw reason; }
}

export async function importLibrary(json?: string): Promise<void> {
  try {
    let imported: LibrarySnapshot | Playlist | Track[];
    if (json !== undefined) imported = JSON.parse(json);
    else if ((platform.os === "web" || platform.os === "android")) imported = await host.call<LibrarySnapshot | Playlist | Track[]>("files.import", { kind: "library" }, { timeout: 0 });
    else {
      const files = await Picker.pickFiles({ filters: [{ name: "Metrolist 曲库", extensions: ["json"] }] });
      if (!files.length) return;
      imported = JSON.parse(await files[0].file.text());
    }
    if (Array.isArray(imported)) addLibraryTracks(imported, false);
    else if ("playlists" in imported) {
      const saved = imported;
      batch(() => {
        addTracks(saved.tracks, false);
        likedIds.update((ids) => [...new Set([...ids, ...saved.likedIds])]);
        history.update((items) => [...new Map([...items, ...saved.history].map((track) => [track.id, track])).values()]);
        playlists.update((items) => [...new Map([...items, ...saved.playlists].map((playlist) => [playlist.id, playlist])).values()]);
        libraryIds.update((ids) => [...new Set([...ids, ...(saved.libraryIds || saved.tracks.map((track) => track.id))])]);
        savedCollections.update((items) => [...new Map([...items, ...(saved.savedCollections || [])].map((item) => [item.id, item])).values()]);
        listenEvents.update((items) => [...new Map([...items, ...(saved.listenEvents || [])].map((item) => [item.id, item])).values()]);
        searchHistory.update((items) => [...new Set([...items, ...(saved.searchHistory || [])])]);
      });
    } else {
      const playlist = createPlaylist(imported.name);
      addTracksToPlaylist(playlist.id, imported.tracks);
    }
    await saveLibrary();
  } catch (reason) { showError(reason); throw reason; }
}

async function exportJson(name: string, value: unknown): Promise<string> {
  const content = JSON.stringify(value, null, 2);
  if ((platform.os === "web" || platform.os === "android")) {
    await host.call("files.export", { name, content, type: "application/json" }, { timeout: 0 });
    return name;
  }
  const path = `${process.dataDir}/${name}`;
  await writeFile(path, content);
  return path;
}

export async function exportLibrary(): Promise<string | undefined> {
  try { return await exportJson(`metrolist-library-${new Date().toISOString().slice(0, 10)}.json`, librarySnapshot()); }
  catch (reason) { showError(reason); throw reason; }
}
export async function exportPlaylist(id: string): Promise<string | undefined> {
  const playlist = playlists().find((item) => item.id === id);
  if (!playlist) return;
  try { return await exportJson(`${playlist.name.replace(/[\/\\:*?"<>|]/g, "_")}.json`, playlist); }
  catch (reason) { showError(reason); throw reason; }
}

function updateDownload(id: string, patch: Partial<DownloadJob>) {
  downloadJobs.update((items) => items.map((item) => item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item));
}
function audioFilename(track: Track, mimeType = "") {
  const extension = mimeType.includes("webm") ? "webm" : mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") || track.source === "youtube" ? "m4a"
    : track.url?.match(/\.([a-z0-9]{2,4})(?:[?#]|$)/i)?.[1] || "mp3";
  return `${track.artist} - ${track.title}`.replace(/[\/\\:*?"<>|]/g, "_") + `.${extension}`;
}
async function nativeDownload(id: string, source: StreamInfo, name: string, controller: AbortController) {
  const transfer = source.url.startsWith("file:")
    ? NativeFiles.copyInto(source.url, nativeDownloadsDirectory, name)
    : NativeFiles.download({ id, url: source.url, name, directory: nativeDownloadsDirectory, headers: source.headers || {} });
  downloadTransfers.set(id, transfer);
  const polling = setInterval(() => {
    void Promise.resolve(NativeFiles.progress(id)).then(progress => {
      if (progress && downloadRuns.get(id) === controller && !controller.signal.aborted
          && downloadJobs().find(job => job.id === id)?.status === "downloading") updateDownload(id, progress);
    });
  }, 250);
  try { return await transfer; }
  finally {
    clearInterval(polling);
    if (downloadTransfers.get(id) === transfer) downloadTransfers.delete(id);
  }
}

export async function downloadTrack(track: Track, quality: AudioQuality = settings().audioQuality): Promise<string | undefined> {
  if (downloadRuns.has(track.id)) return;
  const previous = downloadJobs().find(job => job.id === track.id && job.status === "completed");
  const controller = new AbortController();
  downloadRuns.set(track.id, controller);
  if (previous) downloadReplacements.set(track.id, { controller, job: previous });
  const now = Date.now();
  const job: DownloadJob = { id: track.id, track, quality, status: "resolving", progress: 0, bytes: 0, name: audioFilename(track), createdAt: now, updatedAt: now };
  downloadJobs.update((items) => [job, ...items.filter((item) => item.id !== track.id)]);
  void saveDownloads();
  try {
    const source = await api.resolvePlayback(track, quality);
    if (controller.signal.aborted) return;
    const name = audioFilename(track, source.mimeType);
    updateDownload(track.id, { status: "downloading", name, totalBytes: source.contentLength });
    const saved = hostFiles
      ? await host.call<{ destination: string; url: string; bytes: number }>("files.download", {
        id: track.id, url: source.url, headers: source.headers || {}, name, track,
      }, { timeout: 0 })
      : await nativeDownload(track.id, source, name, controller);
    if (controller.signal.aborted) return;
    updateDownload(track.id, { status: "completed", progress: 1, bytes: saved.bytes, totalBytes: saved.bytes,
      destination: saved.destination, url: saved.url, error: undefined });
    addLibraryTracks([track], false);
    await Promise.all([saveDownloads(), saveLibrary()]);
    if (!hostFiles && previous?.url?.startsWith("file:") && previous.destination !== saved.destination) await NativeFiles.remove(previous.destination!).catch(showError);
    return saved.destination;
  } catch (reason) {
    if (controller.signal.aborted) return;
    const message = reason instanceof Error ? reason.message : String(reason);
    updateDownload(track.id, previous ? { ...previous, error: `更新下载失败，已保留原音频：${message}` } : { status: "failed", error: message });
    await saveDownloads();
    showError(reason);
    throw reason;
  } finally {
    if (downloadRuns.get(track.id) === controller) downloadRuns.delete(track.id);
    if (downloadReplacements.get(track.id)?.controller === controller) downloadReplacements.delete(track.id);
  }
}
export function retryDownload(id: string) {
  const job = downloadJobs().find((item) => item.id === id)!;
  return downloadTrack(job.track, job.quality);
}
async function stopDownload(id: string) {
  const controller = downloadRuns.get(id);
  controller?.abort();
  if (hostFiles) await host.call("files.cancelDownload", { id });
  else {
    NativeFiles.cancel(id);
    const transfer = downloadTransfers.get(id);
    if (transfer) {
      // Wait for the writer to close before retrying or removing the same track.
      const saved = await transfer.catch(() => undefined);
      if (saved) await NativeFiles.remove(saved.destination);
    }
  }
  if (downloadRuns.get(id) === controller) downloadRuns.delete(id);
}
export async function cancelDownload(id: string) {
  const previous = downloadReplacements.get(id)?.job;
  await stopDownload(id);
  updateDownload(id, previous ? { ...previous, error: undefined } : { status: "cancelled", error: undefined });
  await saveDownloads();
}
export async function removeDownload(id: string) {
  const job = downloadJobs().find((item) => item.id === id)!;
  const previous = downloadReplacements.get(id)?.job;
  if (downloadRuns.has(id)) await stopDownload(id);
  if (hostFiles) await host.call("files.removeDownload", { id, destination: job.destination });
  else if (job.destination && job.url?.startsWith("file:")) await NativeFiles.remove(job.destination);
  else if (previous?.destination && previous.url?.startsWith("file:")) await NativeFiles.remove(previous.destination);
  downloadJobs.update((items) => items.filter((item) => item.id !== id));
  await saveDownloads();
}
export async function exportDownloaded(id: string) {
  const job = downloadJobs().find((item) => item.id === id)!;
  if (hostFiles) await host.call("files.exportAudio", { id, name: job.name }, { timeout: 0 });
  else if (job.url?.startsWith("file:")) await NativeFiles.exportAudio(job.destination!, job.name);
  else if (job.url) await openUrl(job.url);
}

export async function revealDownload(id: string) {
  const job = downloadJobs().find(item => item.id === id)!;
  await NativeFiles.reveal(job.destination!);
}
