/** The shared catalog record used by the gateway, library and player. */
export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  artwork: string;
  thumbnailAspectRatio?: number;
  duration: number;
  source: "youtube" | "audio";
  url?: string;
  type?: "song";
  artistId?: string;
  albumId?: string;
  explicit?: boolean;
  setVideoId?: string;
}

export interface Collection {
  id: string;
  browseId: string;
  title: string;
  subtitle: string;
  artwork: string;
  type: "album" | "artist" | "playlist";
  description?: string;
  year?: number;
  songCount?: number;
  duration?: number;
  subscriberCount?: string;
  params?: string;
  editable?: boolean;
  playlistId?: string;
}

export interface SavedCollection extends Collection { savedAt: number }

export type CatalogItem = Track | Collection;
export interface BrowseEndpoint { browseId: string; params?: string }
export interface PlayEndpoint { videoId?: string; playlistId?: string; params?: string; index?: number }
export interface HomeChip { title: string; endpoint?: BrowseEndpoint; deselectEndpoint?: BrowseEndpoint; selected: boolean }
export interface CatalogSection {
  title: string;
  items: CatalogItem[];
  label?: string;
  thumbnail?: string;
  endpoint?: BrowseEndpoint;
  playEndpoint?: PlayEndpoint;
  layout?: "cards" | "list" | "grid";
  rows?: number;
  moods?: Mood[];
}
export interface HomeResponse { sections: CatalogSection[]; chips?: HomeChip[]; continuation?: string }
export type ExploreTab = "all" | "new" | "charts" | "moods";
export interface Mood { title: string; browseId: string; params?: string; color?: string }
export interface ExploreResponse extends HomeResponse { moods: Mood[]; tab?: ExploreTab }
export type SearchType = "all" | "songs" | "albums" | "artists" | "playlists";
export interface SearchResponse {
  query: string;
  type: SearchType;
  items: CatalogItem[];
  continuation?: string;
}
export interface BrowseResponse {
  id: string;
  title: string;
  subtitle: string;
  artwork: string;
  tracks: Track[];
  sections: CatalogSection[];
  continuation?: string;
  description?: string;
  subscriberCount?: string;
  year?: number;
  params?: string;
  editable?: boolean;
  playlistId?: string;
}
export interface LyricLine { time: number; text: string }
export interface Lyrics {
  plainLyrics: string;
  syncedLyrics: string;
  lines: LyricLine[];
  instrumental: boolean;
}
export interface Playlist {
  id: string;
  name: string;
  tracks: Track[];
  createdAt: number;
  updatedAt: number;
  browseId?: string;
}
export type AudioQuality = "auto" | "low" | "high";
export interface StreamInfo {
  url: string;
  headers?: Record<string, string>;
  cacheKey?: string;
  client?: string;
  mimeType?: string;
  bitrate?: number;
  quality?: string;
  expiresAt?: number;
  formatId?: string | number;
  duration?: number;
  title?: string;
  artist?: string;
  artwork?: string;
  loudnessDb?: number;
  sampleRate?: number;
  contentLength?: number;
}
export type LibrarySort = "recent" | "title" | "artist" | "playTime" | "songCount";
export type PlaylistSort = "custom" | "recent" | "title" | "artist" | "playTime" | "duration";
export interface PlaylistEntry { track: Track; index: number }
export type DownloadStatus = "queued" | "resolving" | "downloading" | "completed" | "failed" | "cancelled";
export interface DownloadJob {
  id: string;
  track: Track;
  status: DownloadStatus;
  quality: AudioQuality;
  progress: number;
  bytes: number;
  totalBytes?: number;
  name: string;
  destination?: string;
  url?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}
export interface ListenEvent {
  id: string;
  trackId: string;
  startedAt: number;
  seconds: number;
}
export type StatsPeriod = "week" | "month" | "year" | "all";
export interface TrackStats { track: Track; playCount: number; seconds: number }
export interface ArtistStats { id: string; name: string; artwork: string; playCount: number; seconds: number }
export interface ListeningStatistics {
  plays: number;
  totalSeconds: number;
  uniqueTracks: number;
  topTracks: TrackStats[];
  topArtists: ArtistStats[];
  daily: { date: string; seconds: number; plays: number }[];
}
export type RepeatMode = "off" | "all" | "one";
export interface RemotePlaybackState {
  queue: Track[];
  index: number;
  position: number;
  playing: boolean;
  shuffle?: boolean;
  repeat?: RepeatMode;
  title?: string;
}
export interface Settings {
  theme: "dark" | "light" | "black" | "system";
  apiBase: string;
  nativeFirst: boolean;
  audioQuality: AudioQuality;
  autoRadio: boolean;
  pauseHistory: boolean;
  libraryView: "grid" | "list";
  lyricFontSize: "small" | "medium" | "large";
  lyricAlignment: "left" | "center";
  lyricsOffset: number;
  volume: number;
  rate: number;
  shuffle: boolean;
  repeat: RepeatMode;
}
export interface LibrarySnapshot {
  version: 1 | 2;
  exportedAt: string;
  tracks: Track[];
  likedIds: string[];
  history: Track[];
  playlists: Playlist[];
  libraryIds?: string[];
  savedCollections?: SavedCollection[];
  listenEvents?: ListenEvent[];
  searchHistory?: string[];
}

export function isTrack(item: CatalogItem): item is Track {
  return "source" in item;
}

export function formatTime(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}
