import { host, platform } from "nsh";
import { api as nativeGateway } from "../server/index.mjs";
import { currentCredentials, useAccountForBrowse } from "./account";
import type { AudioQuality, BrowseResponse, ExploreResponse, ExploreTab, HomeResponse, Lyrics, SearchResponse, SearchType, StreamInfo, Track } from "./model";

let origin = "";
export interface SessionCredentials { cookie: string; visitorData?: string; dataSyncId?: string; authUser?: string }
export interface ResolveOptions { refresh?: boolean }
const streamCache = new Map<string, StreamInfo>();
const streamRequests = new Map<string, { promise: Promise<StreamInfo>; refresh: boolean }>();

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly stage?: string;
  readonly retryAfterMs?: number;
  constructor(message: string, status: number, details: { code?: string; stage?: string; retryAfterMs?: number } = {}) {
    super(message);
    this.status = status;
    this.code = details.code || (status === 429 ? "rate-limited" : `http-${status}`);
    this.stage = details.stage;
    this.retryAfterMs = details.retryAfterMs;
  }
}

export function setApiOrigin(value: string) {
  const next = value.trim().replace(/\/+$/, "");
  if (next !== origin) {
    streamCache.clear(); streamRequests.clear();
    origin = next;
  }
}

export function apiUrl(path: string, params: Record<string, string | number> = {}) {
  const query = Object.entries(params).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join("&");
  return `${origin}/api/${path}${query ? `${path.includes("?") ? "&" : "?"}${query}` : ""}`;
}

async function request<T>(url: string, options: RequestInit = {}, credentials = useAccountForBrowse() ? currentCredentials() : undefined): Promise<T> {
  const headers = new Headers(options.headers);
  if (credentials) headers.set("X-Metrolist-Account", encodeURIComponent(JSON.stringify(credentials)));
  const init = { ...options, headers };
  const response = platform.os !== "web" && !origin
    ? await nativeGateway(new Request(`https://metrolist.local${url}`, init), { directStreams: true })
    : await fetch(url, init);
  const retryAfter = response.headers.get("Retry-After");
  const retryDelay = retryAfter ? (/^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now())) : undefined;
  const retryAfterMs = retryDelay !== undefined && Number.isFinite(retryDelay) ? retryDelay : undefined;
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new ApiRequestError(`音乐服务未返回数据（${response.status}）。请检查设置中的音乐服务地址。`, response.status, { retryAfterMs });
  }
  const body = await response.json() as T & { error?: string; message?: string; code?: string; stage?: string; retryAfterMs?: number };
  if (!response.ok) throw new ApiRequestError(body.error || body.message || `音乐服务返回 ${response.status}`, response.status, { retryAfterMs, ...body });
  return body;
}
const get = <T>(path: string, params: Record<string, string | number> = {}) => request<T>(apiUrl(path, params));

export const accountRequest = <T>(path: string, credentials?: SessionCredentials, options: RequestInit = {}) =>
  request<T>(apiUrl(path), options, credentials);

export const fetchHome = () => get<HomeResponse>("home");
export const fetchExplore = (tab: ExploreTab = "all", continuation?: string) => get<ExploreResponse>("explore", { tab, ...(continuation ? { continuation } : {}) });
export const fetchSuggestions = (query: string) => get<{ query: string; suggestions: string[] }>("suggestions", { q: query });
export const fetchSearch = (query: string, type: SearchType = "all", continuation?: string) =>
  get<SearchResponse>("search", { q: query, type, ...(continuation ? { continuation } : {}) });
export const fetchBrowse = (id: string, continuation?: string, params?: string) =>
  get<BrowseResponse>("browse", { id, ...(continuation ? { continuation } : {}), ...(params ? { params } : {}) });
export const fetchNext = (id: string) => get<{ tracks: Track[]; lyricsId?: string }>("next", { id });
export const fetchLyrics = (track: Track) =>
  get<Lyrics>("lyrics", { title: track.title, artist: track.artist, duration: Math.round(track.duration) });
export function fetchStream(id: string, quality: AudioQuality = "auto", options: ResolveOptions = {}): Promise<StreamInfo> {
  const credentials = currentCredentials();
  const requestOrigin = origin;
  const params = { id, quality, ...(platform.os === "android" ? {} : { container: "mp4" }) };
  const url = apiUrl("stream", params);
  const key = JSON.stringify([url, credentials?.cookie, credentials?.authUser, credentials?.dataSyncId, credentials?.visitorData]);
  const pending = streamRequests.get(key);
  if (options.refresh) streamCache.delete(key);
  const cached = streamCache.get(key);
  if (cached?.expiresAt && cached.expiresAt > Date.now() + 60000) return Promise.resolve(cached);
  if (pending && (!options.refresh || pending.refresh)) return pending.promise;
  const promise = request<StreamInfo>(options.refresh ? apiUrl("stream", { ...params, refresh: 1 }) : url, {}, credentials)
    .then(result => {
      const source = { ...result, url: result.url.startsWith("/") ? `${requestOrigin}${result.url}` : result.url };
      if (streamRequests.get(key) === entry) streamCache.set(key, source);
      return source;
    }).finally(() => {
      if (streamRequests.get(key) === entry) streamRequests.delete(key);
    });
  const entry = { refresh: !!options.refresh, promise };
  streamRequests.set(key, entry);
  return entry.promise;
}

export async function resolvePlayback(track: Track, quality: AudioQuality = "auto", options: ResolveOptions = {}): Promise<StreamInfo> {
  if (track.url?.startsWith("local:")) {
    const local = await host.call<{ url: string }>("files.resolve", { id: track.url.slice(6) });
    return { url: local.url, duration: track.duration };
  }
  if (track.source === "audio" && track.url) return { url: track.url, duration: track.duration };
  return fetchStream(track.id, quality, options);
}

export async function resolveStream(track: Track, quality: AudioQuality = "auto", options: ResolveOptions = {}): Promise<string> {
  return (await resolvePlayback(track, quality, options)).url;
}
