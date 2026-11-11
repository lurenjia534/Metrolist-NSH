import { host, platform } from "nsh";
import { api as nativeGateway } from "../server/index.mjs";
import { currentCredentials, useAccountForBrowse } from "./account";
import type { AudioQuality, BrowseResponse, DownloadJob, ExploreResponse, ExploreTab, HomeResponse, Lyrics, SearchResponse, SearchType, StreamInfo, Track } from "./model";

let origin = "";
export interface SessionCredentials { cookie: string; visitorData?: string; dataSyncId?: string; authUser?: string }

export function setApiOrigin(value: string) {
  origin = value.trim().replace(/\/+$/, "");
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
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error(`音乐服务未返回数据（${response.status}）。请检查设置中的音乐服务地址。`);
  }
  const body = await response.json() as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(body.error || body.message || `音乐服务返回 ${response.status}`);
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
export const fetchStream = (id: string, quality: AudioQuality = "auto") =>
  request<StreamInfo>(apiUrl("stream", { id, quality, ...(platform.os === "android" ? {} : { container: "mp4" }) }), {}, currentCredentials());

export async function resolvePlayback(track: Track, quality: AudioQuality = "auto"): Promise<StreamInfo> {
  if (track.url?.startsWith("local:")) {
    const local = await host.call<{ url: string }>("files.resolve", { id: track.url.slice(6) });
    return { url: local.url, duration: track.duration };
  }
  if (track.source === "audio" && track.url) return { url: track.url, duration: track.duration };
  const result = await fetchStream(track.id, quality);
  return { ...result, url: result.url.startsWith("/") ? `${origin}${result.url}` : result.url };
}

export async function resolveStream(track: Track, quality: AudioQuality = "auto"): Promise<string> {
  return (await resolvePlayback(track, quality)).url;
}

export const fetchDownloads = () => get<{ downloads: DownloadJob[] }>("download");
export const fetchDownload = (id: string) => get<DownloadJob>("download", { id });
export const beginDownload = (track: Track, quality: AudioQuality, name: string) => request<DownloadJob>(apiUrl("download"), {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: track.id, track, quality, container: "mp4", name, ...(track.source === "audio" ? { url: track.url } : {}) }),
});
export const deleteDownload = (id: string) => request<{ id: string; status: "cancelled" }>(apiUrl("download", { id }), { method: "DELETE" });
