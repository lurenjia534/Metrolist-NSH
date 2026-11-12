import { batch, computed, signal } from "nsh";
import { createNavStack } from "nsh/base";
import * as store from "./store";
import * as playback from "./playback";
import { fetchStream } from "./api";
import * as together from "./together";
import { parseMusicLink, type MusicLink } from "./musicLinks";
import type { Collection, Track, SearchType } from "./model";

export type Page = "home" | "search" | "library" | "liked" | "history" | "collection" | "playlist" | "downloads" | "stats" | "settings" | "browse" | "together" | "account";
export interface Route { page: Page; key: number; collection?: Collection; playlistId?: string; query?: string; searchType?: SearchType }
export type DialogKind = "create" | "rename" | "import" | "add-playlist" | "sleep" | "sort" | "song-info" | null;
let nextKey = 1;
export const stack = createNavStack<Route>([{ page: "home", key: 0 }]);
const current = signal<Route>(stack.routes()[0]);
type RouteSnapshot =
  | { page: "collection"; state: ReturnType<typeof store.captureCollectionState> }
  | { page: "search"; state: ReturnType<typeof store.captureSearchState>; text: string; type: SearchType };
const snapshots = new Map<number, RouteSnapshot>();
export const page = computed(() => current().page);
export const libraryTab = signal("all");
export const searchText = signal("");
export const searchType = signal<SearchType>("all");
export const selectedPlaylist = signal("");
export const selectedTracks = signal<Track[]>([]);
export const dialog = signal<DialogKind>(null);
export const draft = signal("");
export const fullPlayer = signal(false);
export const playerTab = signal<"cover" | "lyrics" | "queue">("cover");
export const settingsSection = signal("appearance");
export const browseTitle = signal("发现音乐");
export const currentPlaylist = computed(() => store.playlists().find(item => item.id === selectedPlaylist()));

function activate(route: Route, restore = false) {
  if (current().key === route.key) return;
  const leaving = current();
  if (leaving.page === "collection") snapshots.set(leaving.key, { page: "collection", state: store.captureCollectionState() });
  if (leaving.page === "search") snapshots.set(leaving.key, { page: "search", state: store.captureSearchState(), text: searchText(), type: searchType() });
  const snapshot = snapshots.get(route.key);
  batch(() => {
    current.set(route);
    if (route.playlistId) selectedPlaylist.set(route.playlistId);
    if (!restore) return;
    if (route.collection) {
      if (snapshot?.page === "collection") store.restoreCollectionState(snapshot.state);
      else void store.openCollection(route.collection);
    }
    if (route.page === "search") {
      searchText.set(snapshot?.page === "search" ? snapshot.text : route.query || "");
      searchType.set(snapshot?.page === "search" ? snapshot.type : route.searchType || "all");
      if (snapshot?.page === "search") store.restoreSearchState(snapshot.state);
      else if (route.query) void store.search(route.query, route.searchType);
    }
  });
}
function push(route: Omit<Route, "key">, root = false) {
  const next = { ...route, key: nextKey++ };
  activate(next);
  if (root) stack.setRoutes([next]); else stack.push(next);
}
export function onRoutesChanged(routes: readonly Route[]) {
  activate(routes[routes.length - 1], true);
  const keys = new Set(routes.map(route => route.key));
  for (const key of snapshots.keys()) if (!keys.has(key)) snapshots.delete(key);
}
export function navigate(next: Page, root = false) {
  if (page() !== next) push({ page: next }, root);
}
export function goBack() { if (stack.routes().length > 1) { stack.pop(); activate(stack.routes().at(-1)!, true); } else navigate("home", true); }
export function browse(item: Collection) { push({ page: "collection", collection: item }); void store.openCollection(item); }
export function openPlaylist(id: string) { selectedPlaylist.set(id); push({ page: "playlist", playlistId: id }); }
async function openMusicLink(link: MusicLink) {
  if (link.type === "song") {
    const known = store.tracks().find(item => item.id === link.id);
    let track: Track = known || {
      id: link.id, title: "YouTube Music", artist: "歌曲链接", album: "",
      artwork: `https://i.ytimg.com/vi/${link.id}/hqdefault.jpg`, duration: 0, source: "youtube" as const,
    };
    if (together.isGuest()) {
      if (!known) {
        const metadata = await fetchStream(link.id, store.settings().audioQuality);
        track = { ...track, title: metadata.title || track.title, artist: metadata.artist || track.artist,
          artwork: metadata.artwork || track.artwork, duration: metadata.duration || track.duration };
      }
      await together.suggestTrack(track);
    }
    else {
      await playback.playTrack(track);
      if (link.startAt && playback.currentTrack()?.id === link.id) playback.seek(link.startAt);
    }
  } else {
    const saved = store.savedCollections().find(item => item.browseId === link.browseId);
    browse(saved || { id: link.id, browseId: link.browseId, type: link.type,
      title: { album: "专辑", artist: "歌手", playlist: "歌单" }[link.type], subtitle: "YouTube Music", artwork: "" });
  }
}
export function performSearch(value = searchText(), type = searchType()) {
  value = value.trim();
  if (!value) return;
  searchText.set(value); searchType.set(type);
  const link = parseMusicLink(value);
  if (link) {
    store.saveSearchHistory(value);
    void openMusicLink(link).catch(store.showError);
    return;
  }
  if (page() !== "search") push({ page: "search", query: value, searchType: type });
  else { const route = { ...current(), query: value, searchType: type }; current.set(route); stack.replace(route); }
  void store.search(value, type);
}
export function newPlaylist() { draft.set(""); dialog.set("create"); }
export function addToPlaylist(tracks: Track[]) { selectedTracks.set(tracks); draft.set(""); dialog.set("add-playlist"); }
export function showImport() { draft.set(""); dialog.set("import"); }
export function showPlayer(tab: "cover" | "lyrics" | "queue" = "cover") { playerTab.set(tab); fullPlayer.set(true); }
