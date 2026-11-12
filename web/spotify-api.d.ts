import type { Collection, Home, Item, Library, Lyrics, Me, SearchResults, Track } from "../src/spotish/backend/types";

export const SPOTIFY_SCOPES: string[];
export type SpotifyRequest = (path: string, options?: { method?: string; body?: unknown }) => Promise<any>;
export interface SpotifyApi {
  home(): Promise<Home>;
  search(query: string): Promise<SearchResults>;
  playlist(uri: string): Promise<Collection>;
  album(uri: string): Promise<Collection>;
  artist(uri: string): Promise<Collection>;
  likedSongs(): Promise<Collection>;
  library(): Promise<Library>;
  me(): Promise<Me>;
  track(uri: string): Promise<Track>;
  likes(uris: string[]): Promise<boolean[]>;
  setLiked(uri: string, on: boolean): Promise<void>;
  lyrics(uri: string): Promise<Lyrics>;
}
export function createSpotifyApi(request: SpotifyRequest, options?: { lyricsFetch?: typeof fetch }): SpotifyApi;
export function spotifyItem(value: any): Item;
export function spotifyTrack(value: any, options?: { album?: any; addedAt?: string; uid?: string; contextIndex?: number }): Track;
export function parseSpotifyLyrics(record: { instrumental?: boolean; syncedLyrics?: string | null; plainLyrics?: string | null }): Lyrics;
