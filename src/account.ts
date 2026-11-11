import { batch, computed, host, Picker, platform, signal, Storage } from "nsh";
import { accountRequest } from "./api";
import type { CatalogItem, Collection, Track } from "./model";

export interface AccountCredentials { cookie: string; visitorData?: string; dataSyncId?: string; authUser?: string }
export interface AccountProfile { name: string; email?: string; channelHandle?: string; channelId?: string; avatar?: string }
export interface AccountSummary extends AccountProfile { id: string; verifiedAt: number }
export interface YouTubeChannel extends AccountProfile { pageId?: string; dataSyncId?: string; signinUrl?: string; authUser: string; selected?: boolean }
export type CloudType = "playlists" | "liked" | "songs" | "albums" | "artists";
export type CloudLibrary = Record<CloudType, CatalogItem[]>;
export interface CloudPlaylist extends Collection { playlistId?: string; editable?: boolean }
export interface CloudTrack extends Track { setVideoId?: string }
interface AccountResponse { account: AccountProfile; session?: Omit<AccountCredentials, "cookie"> }
interface CloudResponse { type: CloudType; items: CatalogItem[]; continuation?: string }
interface SavedAccount { profile: AccountSummary; credentials: AccountCredentials; library: CloudLibrary; lastSynced: number; likedIds?: string[]; subscribedIds?: string[] }
interface PlaylistResult { ok: boolean; playlistId: string; browseId?: string; title?: string }

const cloudTypes: CloudType[] = ["playlists", "liked", "songs", "albums", "artists"];
const emptyLibrary = (): CloudLibrary => ({ playlists: [], liked: [], songs: [], albums: [], artists: [] });
export const accounts = signal<AccountSummary[]>([]);
export const activeId = signal("");
export const currentAccount = computed(() => accounts().find((account) => account.id === activeId()));
export const signedIn = computed(() => !!currentAccount());
export const busy = signal(false);
export const error = signal("");
export const status = signal("");
export const sessionStatus = signal<"none" | "saved" | "verifying" | "connected" | "error">("none");
export const nativeLoginAvailable = signal(false);
export const channels = signal<YouTubeChannel[]>([]);
export const syncing = signal(false);
export const syncProgress = signal("");
export const lastSynced = signal(0);
export const cloudLibrary = signal<CloudLibrary>(emptyLibrary());
export const cloudType = signal<CloudType>("playlists");
export const cloudItems = computed(() => cloudLibrary()[cloudType()]);
export const cloudContinuation = signal<string | undefined>();
export const cloudLoading = signal(false);
export const mutation = signal("");
export const useAccountForBrowse = signal(true);
export const syncEnabled = signal(true);
export const cloudLikedIds = signal<string[]>([]);
export const cloudSubscribedIds = signal<string[]>([]);
let savedAccounts: SavedAccount[] = [];
let initialized = false;
let cloudRequest = 0;
let syncRequest = 0;
let onAccountChanged: (() => void) | undefined;
let onLibrarySynced: ((library: CloudLibrary) => void) | undefined;

export function setAccountHooks(hooks: { onChange?: () => void; onLibrary?: (library: CloudLibrary) => void }) {
  onAccountChanged = hooks.onChange; onLibrarySynced = hooks.onLibrary;
}
function selected() { return savedAccounts.find((account) => account.profile.id === activeId()); }
export function currentCredentials(): AccountCredentials | undefined { return selected()?.credentials; }
export function accountHeaders(): Record<string, string> {
  const credentials = useAccountForBrowse() ? currentCredentials() : undefined;
  return credentials ? { "X-Metrolist-Account": encodeURIComponent(JSON.stringify(credentials)) } : {};
}
function fail(reason: unknown) { error.set(reason instanceof Error ? reason.message : String(reason)); }
export function clearAccountError() { error.set(""); }
function accountKey(profile: AccountProfile, credentials: AccountCredentials) {
  return `${credentials.authUser || "0"}:${credentials.dataSyncId || profile.channelId || profile.channelHandle || profile.email || profile.name}`;
}
async function saveAccounts() {
  await Storage.setItem("metrolist.accounts", JSON.stringify({ accounts: savedAccounts, activeId: activeId(), useAccountForBrowse: useAccountForBrowse(), syncEnabled: syncEnabled() }));
}
function display(account?: SavedAccount) {
  ++cloudRequest; ++syncRequest;
  batch(() => {
    activeId.set(account?.profile.id || ""); accounts.set(savedAccounts.map((item) => item.profile));
    cloudLibrary.set(account?.library || emptyLibrary()); lastSynced.set(account?.lastSynced || 0);
    cloudLikedIds.set(account?.likedIds || (account?.library.liked || []).map((item) => item.id));
    cloudSubscribedIds.set(account?.subscribedIds || (account?.library.artists || []).map((item) => item.id));
    channels.set([]); cloudContinuation.set(undefined); cloudLoading.set(false);
    syncing.set(false); syncProgress.set("");
    sessionStatus.set(account ? "connected" : "none");
  });
  onAccountChanged?.();
}
export async function initializeAccounts() {
  if (initialized) return;
  initialized = true;
  const value = await Storage.getItem("metrolist.accounts");
  if (value) {
    const data = JSON.parse(value);
    savedAccounts = data.accounts;
    useAccountForBrowse.set(data.useAccountForBrowse ?? true); syncEnabled.set(data.syncEnabled ?? true);
    display(savedAccounts.find((item) => item.profile.id === data.activeId));
    if (signedIn()) { sessionStatus.set("saved"); void refreshAccount().then(() => syncEnabled() ? syncLibrary() : undefined).catch(fail); }
  }
  if (platform.os === "android") {
    const available = await host.call<{ available: boolean }>("auth.available");
    nativeLoginAvailable.set(available.available);
  }
}
export function setUseAccountForBrowse(value: boolean) {
  useAccountForBrowse.set(value); void saveAccounts().catch(fail); onAccountChanged?.();
}
export function setSyncEnabled(value: boolean) { syncEnabled.set(value); void saveAccounts().catch(fail); }

/** Reads a session supplied by its owner; validation is always performed by YouTube's account API. */
export function parseSession(input: string | AccountCredentials): AccountCredentials {
  if (typeof input !== "string") return { ...input, authUser: input.authUser || "0" };
  const text = input.trim();
  if (!text) throw new Error("请导入本人 YouTube Music 会话文件或会话文本。");
  if (text.startsWith("{") || text.startsWith("[")) {
    let value: any;
    try { value = JSON.parse(text); } catch { throw new Error("会话 JSON 格式不正确，请重新选择导出的文件。"); }
    if (Array.isArray(value) || Array.isArray(value.cookies)) {
      const cookies = Array.isArray(value) ? value : value.cookies;
      const cookie = cookies.filter((item: any) => !item.domain || /(^|\.)youtube\.com$/.test(String(item.domain).replace(/^\./, "")))
        .map((item: any) => `${item.name}=${item.value}`).join("; ");
      return { cookie, visitorData: value.visitorData, dataSyncId: value.dataSyncId, authUser: String(value.authUser || "0") };
    }
    const source = value.credentials || value;
    if (typeof source.cookie !== "string") throw new Error("会话文件需要 cookie 字段。");
    return { cookie: source.cookie, visitorData: source.visitorData, dataSyncId: source.dataSyncId, authUser: String(source.authUser || "0") };
  }
  const field = (label: string) => text.split(/\r?\n/).find((line) => line.startsWith(`***${label}*** =`))?.split("=").slice(1).join("=").trim();
  const originalCookie = field("INNERTUBE COOKIE");
  if (originalCookie) return { cookie: originalCookie, visitorData: field("VISITOR DATA"), dataSyncId: field("DATASYNC ID"), authUser: field("AUTH USER") || "0" };
  if (text.includes("\t")) {
    const cookie = text.split(/\r?\n/).filter((line) => line && (!line.startsWith("#") || line.startsWith("#HttpOnly_")))
      .map((line) => line.replace(/^#HttpOnly_/, "").split("\t"))
      .filter((line) => line.length >= 7 && /(^|\.)youtube\.com$/.test(line[0].replace(/^\./, "")))
      .map((line) => `${line[5]}=${line[6]}`).join("; ");
    return { cookie, authUser: "0" };
  }
  const cookie = text.match(/^cookie:\s*(.+)$/im)?.[1] || text;
  return { cookie, authUser: "0" };
}
async function validateLogin(credentials: AccountCredentials) {
  sessionStatus.set("verifying"); status.set("正在验证 YouTube Music 会话…");
  const result = await accountRequest<AccountResponse>("account/login", credentials, { method: "POST", body: JSON.stringify(credentials) });
  const merged = { ...credentials, ...result.session };
  const id = accountKey(result.account, merged);
  const previous = savedAccounts.find((item) => item.profile.id === id);
  const account: SavedAccount = { profile: { ...result.account, id, verifiedAt: Date.now() }, credentials: merged, library: previous?.library || emptyLibrary(), lastSynced: previous?.lastSynced || 0, likedIds: previous?.likedIds, subscribedIds: previous?.subscribedIds };
  savedAccounts = [account, ...savedAccounts.filter((item) => item.profile.id !== id)];
  display(account); await saveAccounts(); status.set(`已连接 ${account.profile.name}`);
  if (syncEnabled()) void syncLibrary().catch(fail);
  return account.profile;
}
export async function importSession(input: string | AccountCredentials) {
  const previousStatus = sessionStatus();
  busy.set(true); error.set("");
  try { return await validateLogin(parseSession(input)); }
  catch (reason) { sessionStatus.set(signedIn() ? previousStatus : "none"); status.set("会话验证未完成，请查看提示后重试。"); fail(reason); throw reason; }
  finally { busy.set(false); }
}
export async function importSessionFile() {
  const files = await Picker.pickFiles({ filters: [{ name: "YouTube 会话", extensions: ["json", "txt"] }] });
  if (files.length) return importSession(await files[0].file.text());
}
export async function loginNative() {
  busy.set(true); error.set(""); status.set("请在 Google 页面完成登录，再点击完成。");
  try {
    const credentials = await host.call<AccountCredentials>("auth.login", { url: "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmusic.youtube.com" }, { timeout: 0 });
    return await validateLogin(credentials);
  } catch (reason) { sessionStatus.set(signedIn() ? "saved" : "none"); status.set("未完成此次 Google 登录。"); fail(reason); throw reason; }
  finally { busy.set(false); }
}
export async function refreshAccount() {
  const account = selected();
  if (!account) return;
  const id = account.profile.id;
  sessionStatus.set("verifying");
  try {
    const profile = await accountRequest<AccountProfile>("account", account.credentials);
    account.profile = { ...profile, id, verifiedAt: Date.now() };
    accounts.set(savedAccounts.map((item) => item.profile));
    if (activeId() === id) sessionStatus.set("connected");
    await saveAccounts();
  } catch (reason) { if (activeId() === id) sessionStatus.set("error"); fail(reason); throw reason; }
}
export async function activateAccount(id: string) {
  const account = savedAccounts.find((item) => item.profile.id === id)!;
  const previousStatus = sessionStatus();
  busy.set(true); error.set("");
  try { return await validateLogin(account.credentials); }
  catch (reason) { sessionStatus.set(previousStatus); status.set("未完成账号切换，当前账号保持不变。"); fail(reason); throw reason; }
  finally { busy.set(false); }
}
export async function logoutAccount(id = activeId()) {
  const active = id === activeId();
  savedAccounts = savedAccounts.filter((item) => item.profile.id !== id);
  if (active) display(); else accounts.set(savedAccounts.map((item) => item.profile));
  await saveAccounts();
  status.set("已从此应用退出账号，本地音乐库保留。");
  if (active && nativeLoginAvailable()) await host.call("auth.logout");
}
export async function loadChannels() {
  busy.set(true); error.set("");
  const account = selected()!;
  try { const result = await accountRequest<{ accounts: YouTubeChannel[] }>("account/channels", account.credentials); if (activeId() === account.profile.id) channels.set(result.accounts); }
  catch (reason) { fail(reason); throw reason; }
  finally { busy.set(false); }
}
export function selectChannel(channel: YouTubeChannel) {
  return importSession({ ...currentCredentials()!, authUser: String(channel.authUser || "0"), dataSyncId: channel.dataSyncId || channel.pageId || "" });
}

function updateCloud(type: CloudType, items: CatalogItem[], account = selected()!, authoritative = true) {
  account.library = { ...account.library, [type]: items };
  if (type === "liked") account.likedIds = [...new Set([...(authoritative ? [] : account.likedIds || []), ...items.map((item) => item.id)])];
  if (type === "artists") account.subscribedIds = [...new Set([...(authoritative ? [] : account.subscribedIds || []), ...items.map((item) => item.id)])];
  if (activeId() !== account.profile.id) return;
  cloudLibrary.set(account.library);
  if (type === "liked") cloudLikedIds.set(account.likedIds!);
  if (type === "artists") cloudSubscribedIds.set(account.subscribedIds!);
}
function mergeItems(first: CatalogItem[], rest: CatalogItem[]) {
  const items = new Map<string, CatalogItem>();
  for (const item of [...first, ...rest]) if (!items.has(item.id)) items.set(item.id, item);
  return [...items.values()];
}
function cloudPath(type: CloudType, continuation?: string) {
  return `account/library?type=${type}${continuation ? `&continuation=${encodeURIComponent(continuation)}` : ""}`;
}
export async function loadCloudLibrary(type: CloudType = cloudType()) {
  const account = selected(); if (!account) return;
  const request = ++cloudRequest;
  batch(() => { cloudType.set(type); cloudLoading.set(true); cloudContinuation.set(undefined); error.set(""); });
  try {
    const result = await accountRequest<CloudResponse>(cloudPath(type), account.credentials);
    if (request !== cloudRequest || activeId() !== account.profile.id) return;
    updateCloud(type, result.continuation ? mergeItems(result.items, account.library[type]) : result.items, account, !result.continuation);
    cloudContinuation.set(result.continuation); await saveAccounts();
  } catch (reason) { if (request === cloudRequest) fail(reason); throw reason; }
  finally { if (request === cloudRequest) cloudLoading.set(false); }
}
export async function loadMoreCloudLibrary() {
  const account = selected(); const continuation = cloudContinuation();
  if (!account || !continuation) return;
  const type = cloudType(); const request = ++cloudRequest; cloudLoading.set(true);
  try {
    const result = await accountRequest<CloudResponse>(cloudPath(type, continuation), account.credentials);
    if (request !== cloudRequest || activeId() !== account.profile.id) return;
    updateCloud(type, mergeItems(account.library[type], result.items), account, false); cloudContinuation.set(result.continuation); await saveAccounts();
  } catch (reason) { if (request === cloudRequest) fail(reason); throw reason; }
  finally { if (request === cloudRequest) cloudLoading.set(false); }
}
export async function syncLibrary() {
  const account = selected(); if (!account) return;
  const request = ++syncRequest;
  syncing.set(true); error.set("");
  try {
    for (const type of cloudTypes) {
      let continuation: string | undefined; const items: CatalogItem[] = [];
      do {
        const result = await accountRequest<CloudResponse>(cloudPath(type, continuation), account.credentials);
        if (request !== syncRequest) return;
        items.push(...result.items); continuation = result.continuation;
        syncProgress.set(`${type} · ${items.length}`);
      } while (continuation);
      updateCloud(type, items, account);
    }
    account.lastSynced = Date.now();
    if (activeId() === account.profile.id) { lastSynced.set(account.lastSynced); cloudContinuation.set(undefined); onLibrarySynced?.(account.library); status.set("云端音乐库已同步到此设备。"); }
    await saveAccounts(); return account.library;
  } catch (reason) { if (request === syncRequest) fail(reason); throw reason; }
  finally { if (request === syncRequest) { syncing.set(false); syncProgress.set(""); } }
}
interface CloudChange { id: string; present: boolean }
function changeKnownIds(account: SavedAccount, type: CloudType, patch: CloudChange) {
  const field = type === "liked" ? "likedIds" : type === "artists" ? "subscribedIds" : undefined;
  if (!field) return;
  const ids = account[field] || account.library[type].map((item) => item.id);
  account[field] = patch.present ? [...new Set([...ids, patch.id])] : ids.filter((id) => id !== patch.id);
  if (activeId() === account.profile.id) (type === "liked" ? cloudLikedIds : cloudSubscribedIds).set(account[field]!);
}
async function change<T>(name: string, path: string, body: object, refreshType?: CloudType, patch?: CloudChange): Promise<T> {
  mutation.set(name); error.set("");
  const account = selected()!;
  const previousLiked = account.likedIds || account.library.liked.map((item) => item.id);
  const previousSubscribed = account.subscribedIds || account.library.artists.map((item) => item.id);
  let applied = false;
  if (refreshType && patch) changeKnownIds(account, refreshType, patch);
  try {
    const result = await accountRequest<T>(path, account.credentials, { method: "POST", body: JSON.stringify(body) });
    applied = true;
    if (refreshType) {
      if (patch && !patch.present) updateCloud(refreshType, account.library[refreshType].filter((item) => item.id.replace(/^VL/, "") !== patch.id.replace(/^VL/, "")), account, false);
      await saveAccounts();
      const fresh = await accountRequest<CloudResponse>(cloudPath(refreshType), account.credentials);
      const items = mergeItems(fresh.items, account.library[refreshType]).filter((item) => !patch || patch.present || item.id.replace(/^VL/, "") !== patch.id.replace(/^VL/, ""));
      updateCloud(refreshType, items, account, false);
      if (patch) changeKnownIds(account, refreshType, patch);
      if (activeId() === account.profile.id && cloudType() === refreshType) cloudContinuation.set(fresh.continuation);
      await saveAccounts();
    }
    return result;
  } catch (reason) {
    if (!applied) {
      account.likedIds = previousLiked; account.subscribedIds = previousSubscribed;
      if (activeId() === account.profile.id) { cloudLikedIds.set(previousLiked); cloudSubscribedIds.set(previousSubscribed); }
    }
    fail(reason); throw reason;
  }
  finally { mutation.set(""); }
}
export function isCloudLiked(id: string) { return cloudLikedIds().includes(id); }
export function isCloudSubscribed(id: string) { return cloudSubscribedIds().includes(id); }
export function setLike(id: string, liked: boolean, kind: "song" | "playlist" = "song") { return change("like", "account/like", { id, liked, kind }, kind === "song" ? "liked" : "playlists", { id, present: liked }); }
export function setSubscription(id: string, subscribed: boolean, params?: string) { return change("subscribe", "account/subscribe", { id, subscribed, params }, "artists", { id, present: subscribed }); }
export function setSavedSong(id: string, saved: boolean) { return change("song", "account/song", { id, saved }, "songs", { id, present: saved }); }
export function createCloudPlaylist(title: string, privacy = "PRIVATE", description = "") { return change<PlaylistResult>("playlist", "account/playlist", { action: "create", title, privacy, description }, "playlists"); }
export function renameCloudPlaylist(playlistId: string, title: string) { return change<PlaylistResult>("playlist", "account/playlist", { action: "rename", playlistId, title }, "playlists"); }
export function deleteCloudPlaylist(playlistId: string) { return change<PlaylistResult>("playlist", "account/playlist", { action: "delete", playlistId }, "playlists", { id: playlistId, present: false }); }
export function addToCloudPlaylist(playlistId: string, videoIds: string[]) { return change<PlaylistResult>("playlist", "account/playlist", { action: "add", playlistId, videoIds }); }
export function removeFromCloudPlaylist(playlistId: string, videoId: string, setVideoId: string) { return change<PlaylistResult>("playlist", "account/playlist", { action: "remove", playlistId, videoId, setVideoId }); }
export function moveInCloudPlaylist(playlistId: string, setVideoId: string, successorSetVideoId?: string) { return change<PlaylistResult>("playlist", "account/playlist", { action: "move", playlistId, setVideoId, successorSetVideoId }); }
