import { batch, computed, signal, Storage } from "nsh";
import { connect as openSocket } from "websocket";
import type { WebSocketConnection } from "websocket";
import { gunzipSync } from "zlib";
import * as player from "./playback";
import type { Track } from "./model";

/** Metrolist e6fea3b: app/src/main/proto/listentogether.proto. Times on the wire are milliseconds. */
export const DEFAULT_SERVER = "wss://metroserverx.meowery.eu/ws";
export interface TogetherUser { userId: string; username: string; isHost: boolean; isConnected: boolean }
export interface JoinRequest { userId: string; username: string }
export interface TogetherRoom {
  roomCode: string; hostId: string; users: TogetherUser[];
  currentTrack?: Track; queue: Track[]; isPlaying: boolean;
  position: number; lastUpdate: number; volume: number; revision: number;
}
export interface TrackSuggestion { suggestionId: string; fromUserId: string; fromUsername: string; track: Track }
export const serverUrl = signal(DEFAULT_SERVER);
export const username = signal("听友");
export const connection = signal<"disconnected" | "connecting" | "connected" | "error">("disconnected");
export const room = signal<TogetherRoom | null>(null);
export const role = signal<"none" | "host" | "guest">("none");
export const userId = signal("");
export const pendingJoinRequests = signal<JoinRequest[]>([]);
export const waitingForApproval = signal(false);
export const bufferingUsers = signal<string[]>([]);
export const suggestions = signal<TrackSuggestion[]>([]);
export const error = signal("");
export const status = signal("");
export const latency = signal(0);
export const isHost = computed(() => connection() === "connected" && role() === "host");
export const isGuest = computed(() => connection() === "connected" && role() === "guest");

type Body = Record<string, any>;
type Field = [number, string, "string" | "number" | "bool" | "float" | "bytes" | "message", string?, boolean?];
const schemas: Record<string, Field[]> = {
  envelope: [[1, "type", "string"], [2, "payload", "bytes"], [3, "compressed", "bool"]],
  track: [[1, "id", "string"], [2, "title", "string"], [3, "artist", "string"], [4, "album", "string"], [5, "duration", "number"], [6, "thumbnail", "string"], [7, "suggestedBy", "string"]],
  user: [[1, "userId", "string"], [2, "username", "string"], [3, "isHost", "bool"], [4, "isConnected", "bool"]],
  room: [[1, "roomCode", "string"], [2, "hostId", "string"], [3, "users", "message", "user", true], [4, "currentTrack", "message", "track"], [5, "isPlaying", "bool"], [6, "position", "number"], [7, "lastUpdate", "number"], [8, "volume", "float"], [9, "queue", "message", "track", true], [10, "revision", "number"]],
  create_room: [[1, "username", "string"]],
  join_room: [[1, "roomCode", "string"], [2, "username", "string"]],
  approve_join: [[1, "userId", "string"]],
  reject_join: [[1, "userId", "string"], [2, "reason", "string"]],
  kick_user: [[1, "userId", "string"], [2, "reason", "string"]],
  transfer_host: [[1, "newHostId", "string"]],
  reconnect: [[1, "sessionToken", "string"]],
  room_created: [[1, "roomCode", "string"], [2, "userId", "string"], [3, "sessionToken", "string"]],
  join_request: [[1, "userId", "string"], [2, "username", "string"]],
  join_approved: [[1, "roomCode", "string"], [2, "userId", "string"], [3, "sessionToken", "string"], [4, "state", "message", "room"]],
  join_rejected: [[1, "reason", "string"]],
  host_changed: [[1, "newHostId", "string"], [2, "newHostName", "string"]],
  kicked: [[1, "reason", "string"]],
  reconnected: [[1, "roomCode", "string"], [2, "userId", "string"], [3, "state", "message", "room"], [4, "isHost", "bool"]],
  buffer_ready: [[1, "trackId", "string"]],
  buffer_wait: [[1, "trackId", "string"], [2, "waitingFor", "string", undefined, true]],
  buffer_complete: [[1, "trackId", "string"]],
  error: [[1, "code", "string"], [2, "message", "string"]],
  ping: [[1, "clientTime", "number"], [2, "sequence", "number"]],
  pong: [[1, "clientTime", "number"], [2, "serverReceiveTime", "number"], [3, "serverSendTime", "number"], [4, "sequence", "number"]],
  playback_action: [[1, "action", "string"], [2, "trackId", "string"], [3, "position", "number"], [4, "trackInfo", "message", "track"], [5, "insertNext", "bool"], [6, "queue", "message", "track", true], [7, "queueTitle", "string"], [8, "volume", "float"], [9, "serverTime", "number"], [10, "revision", "number"], [11, "capturedAtServerTime", "number"]],
  sync_state: [[1, "currentTrack", "message", "track"], [2, "isPlaying", "bool"], [3, "position", "number"], [4, "lastUpdate", "number"], [5, "queue", "message", "track", true], [6, "volume", "float"], [7, "revision", "number"]],
  suggest_track: [[1, "trackInfo", "message", "track"]],
  approve_suggestion: [[1, "suggestionId", "string"]],
  reject_suggestion: [[1, "suggestionId", "string"], [2, "reason", "string"]],
  suggestion_received: [[1, "suggestionId", "string"], [2, "fromUserId", "string"], [3, "fromUsername", "string"], [4, "trackInfo", "message", "track"]],
  suggestion_approved: [[1, "suggestionId", "string"], [2, "trackInfo", "message", "track"]],
  suggestion_rejected: [[1, "suggestionId", "string"], [2, "reason", "string"]],
  client_capabilities: [[1, "supportsProtobuf", "bool"], [2, "supportsCompression", "bool"], [3, "clientVersion", "string"]],
  server_capabilities: [[1, "supportsProtobuf", "bool"], [2, "supportsCompression", "bool"], [3, "serverVersion", "string"]],
};
schemas.sync_playback = schemas.playback_action;
for (const name of ["user_joined", "user_left", "user_reconnected", "user_disconnected"]) schemas[name] = schemas.join_request;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
function putVarint(output: number[], value: number) {
  let rest = Math.floor(value);
  while (rest >= 128) { output.push((rest % 128) | 128); rest = Math.floor(rest / 128); }
  output.push(rest);
}
function encodeBody(type: string, body: Body): Uint8Array {
  const output: number[] = [];
  for (const [number, name, kind, child, repeated] of schemas[type] ?? []) {
    const values = repeated ? (body[name] ?? []) : [body[name]];
    for (const value of values) {
      if (value === undefined || value === null) continue;
      if (kind === "number" || kind === "bool") {
        putVarint(output, number * 8); putVarint(output, Number(value));
      } else if (kind === "float") {
        putVarint(output, number * 8 + 5);
        const buffer = new ArrayBuffer(4); new DataView(buffer).setFloat32(0, value, true);
        output.push(...new Uint8Array(buffer));
      } else {
        const bytes = kind === "message" ? encodeBody(child!, value) : kind === "bytes" ? value as Uint8Array : encoder.encode(value);
        putVarint(output, number * 8 + 2); putVarint(output, bytes.length);
        for (const byte of bytes) output.push(byte);
      }
    }
  }
  return new Uint8Array(output);
}
function decodeBody(type: string, bytes: Uint8Array): Body {
  const fields = schemas[type] ?? [];
  const body: Body = {};
  for (const [, name, kind, , repeated] of fields) body[name] = repeated ? [] : kind === "string" ? "" : kind === "bool" ? false : kind === "message" || kind === "bytes" ? undefined : 0;
  let cursor = 0;
  function varint() {
    let value = 0; let shift = 0; let byte: number;
    do { byte = bytes[cursor++]; value += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
    return value;
  }
  while (cursor < bytes.length) {
    const tag = varint(); const wire = tag & 7; const field = fields.find(([number]) => number === Math.floor(tag / 8));
    let value: any;
    if (wire === 0) value = varint();
    else if (wire === 2) { const size = varint(); value = bytes.slice(cursor, cursor + size); cursor += size; }
    else if (wire === 5) { value = new DataView(bytes.buffer, bytes.byteOffset + cursor, 4).getFloat32(0, true); cursor += 4; }
    else if (wire === 1) { cursor += 8; continue; }
    else throw new Error(`Unsupported Protobuf wire type ${wire}`);
    if (!field) continue;
    const [, name, kind, child, repeated] = field;
    if (kind === "string") value = decoder.decode(value);
    if (kind === "bool") value = !!value;
    if (kind === "message") value = decodeBody(child!, value);
    if (repeated) body[name].push(value); else body[name] = value;
  }
  return body;
}
export function encodeMessage(type: string, payload: Body = {}) {
  return encodeBody("envelope", { type, payload: encodeBody(type, payload) });
}
export function decodeMessage(bytes: Uint8Array): { type: string; payload: Body } {
  const envelope = decodeBody("envelope", bytes);
  const payload = envelope.compressed ? gunzipSync(envelope.payload) : envelope.payload;
  return { type: envelope.type, payload: decodeBody(envelope.type, payload ?? new Uint8Array()) };
}
function toWire(track: Track) {
  return { id: track.id, title: track.title, artist: track.artist, album: track.album, duration: Math.round(track.duration * 1000), thumbnail: track.artwork };
}
function fromWire(track: Body): Track {
  return { id: track.id, title: track.title, artist: track.artist, album: track.album, duration: track.duration / 1000, artwork: track.thumbnail, source: "youtube" };
}
function fromRoom(state: Body): TogetherRoom {
  return { ...state, currentTrack: state.currentTrack ? fromWire(state.currentTrack) : undefined, queue: state.queue.map(fromWire) } as TogetherRoom;
}

let socket: WebSocketConnection | undefined;
let connecting: Promise<void> | undefined;
let sessionToken = "";
let clockOffset = 0;
let bestRoundTrip = Infinity;
let clockReady = false;
let pingSequence = 0;
let pingTimer: ReturnType<typeof setInterval> | undefined;
let syncTimer: ReturnType<typeof setInterval> | undefined;
let lastHostSnapshot: { track: string; queue: string; playing: boolean; position: number; volume: number; at: number } | undefined;
let lastHeartbeat = 0;
let lastReadyTrack = "";
let initialized = false;

function fail(reason: unknown) { error.set(reason instanceof Error ? reason.message : String(reason)); }
export function clearError() { error.set(""); }
export async function initializeTogether() {
  if (initialized) return;
  initialized = true;
  const saved = await Storage.getItem("metrolist.together");
  if (saved) { const value = JSON.parse(saved); serverUrl.set(value.serverUrl); username.set(value.username); }
}
export function configure(value: { serverUrl?: string; username?: string }) {
  if (value.serverUrl !== undefined) serverUrl.set(value.serverUrl.trim());
  if (value.username !== undefined) username.set(value.username);
  void Storage.setItem("metrolist.together", JSON.stringify({ serverUrl: serverUrl(), username: username() })).catch(fail);
}
async function send(type: string, payload: Body = {}) {
  await socket!.write(encodeMessage(type, payload));
}
function serverNow() { return Date.now() + clockOffset; }
function ping() { void send("ping", { clientTime: Date.now(), sequence: ++pingSequence }).catch(fail); }
function clearTimers() { clearInterval(pingTimer); clearInterval(syncTimer); pingTimer = undefined; syncTimer = undefined; }
function clearRoom() {
  sessionToken = ""; lastHostSnapshot = undefined; lastReadyTrack = "";
  player.remoteControlled.set(false);
  batch(() => { room.set(null); role.set("none"); userId.set(""); pendingJoinRequests.set([]); suggestions.set([]); waitingForApproval.set(false); bufferingUsers.set([]); });
}
export async function connect() {
  if (connection() === "connected") return;
  if (connecting) return connecting;
  connecting = (async () => {
    batch(() => { connection.set("connecting"); error.set(""); status.set("正在连接一起听服务…"); });
    clockReady = false; clockOffset = 0; bestRoundTrip = Infinity;
    const opened = await openSocket(serverUrl());
    socket = opened;
    connection.set("connected"); status.set("已连接，可以创建或加入房间");
    void readMessages(opened);
    await send("client_capabilities", { supportsProtobuf: true, supportsCompression: false, clientVersion: "Metrolist NSH/0.2.0" });
    ping();
    pingTimer = setInterval(ping, 25000);
    syncTimer = setInterval(() => { void publishPlayback().catch(fail); signalReady(); }, 300);
    if (sessionToken) await send("reconnect", { sessionToken });
  })().catch((reason) => { connection.set("error"); fail(reason); }).finally(() => { connecting = undefined; });
  return connecting;
}
async function readMessages(opened: WebSocketConnection) {
  try {
    for (;;) {
      const bytes = await opened.read();
      if (bytes === null) break;
      if (typeof bytes === "string") throw new Error("一起听服务返回了非 Protobuf 消息");
      const message = decodeMessage(bytes);
      handleMessage(message.type, message.payload);
    }
    if (socket === opened) { connection.set("disconnected"); status.set(opened.closeReason || "连接已关闭，可重新连接"); }
  } catch (reason) { if (socket === opened) { connection.set("error"); fail(reason); } }
  finally { if (socket === opened) { socket = undefined; clearTimers(); player.remoteControlled.set(false); } }
}
export async function disconnect() {
  const opened = socket; socket = undefined; clearTimers(); clearRoom();
  batch(() => { connection.set("disconnected"); status.set("已断开连接"); });
  if (opened) await opened.close(1000, "User disconnected");
}
export async function createRoom() {
  await connect();
  if (connection() !== "connected") return;
  error.set(""); status.set("正在创建房间…");
  await send("create_room", { username: username().trim() }).catch(fail);
}
export async function joinRoom(code: string) {
  await connect();
  if (connection() !== "connected") return;
  waitingForApproval.set(true); error.set(""); status.set("等待主持人批准加入");
  await send("join_room", { roomCode: code.trim().toUpperCase(), username: username().trim() }).catch(fail);
}
export async function leaveRoom() {
  await send("leave_room").catch(fail); clearRoom(); status.set("已离开房间");
}
export async function approveJoin(id: string) {
  await send("approve_join", { userId: id }).catch(fail);
  pendingJoinRequests.update((items) => items.filter((item) => item.userId !== id));
}
export async function rejectJoin(id: string) {
  await send("reject_join", { userId: id, reason: "主持人拒绝了加入请求" }).catch(fail);
  pendingJoinRequests.update((items) => items.filter((item) => item.userId !== id));
}
export function kickUser(id: string) { return send("kick_user", { userId: id, reason: "主持人将你移出了房间" }).catch(fail); }
export function transferHost(id: string) { return send("transfer_host", { newHostId: id }).catch(fail); }
export function requestSync() { return send("request_sync").catch(fail); }
export function suggestTrack(track: Track) {
  if (track.source !== "youtube") { error.set("一起听点歌需要 YouTube 曲目"); return Promise.resolve(); }
  status.set("点歌已提交，等待主持人批准");
  return send("suggest_track", { trackInfo: toWire(track) }).catch(fail);
}
export async function approveSuggestion(id: string) {
  await send("approve_suggestion", { suggestionId: id }).catch(fail);
  suggestions.update((items) => items.filter((item) => item.suggestionId !== id));
}
export async function rejectSuggestion(id: string) {
  await send("reject_suggestion", { suggestionId: id, reason: "主持人未加入这首歌曲" }).catch(fail);
  suggestions.update((items) => items.filter((item) => item.suggestionId !== id));
}

function applyRoom(state: TogetherRoom, forceSeek = false) {
  if (role() !== "guest") return;
  const items = state.currentTrack ? [state.currentTrack, ...state.queue] : state.queue;
  const elapsed = state.isPlaying && state.lastUpdate && clockReady ? Math.max(0, serverNow() - state.lastUpdate) : 0;
  const target = (state.position + elapsed) / 1000;
  const sameQueue = JSON.stringify(player.queue().map((item) => item.id)) === JSON.stringify(items.map((item) => item.id));
  if (!forceSeek && sameQueue && player.currentIndex() === (state.currentTrack ? 0 : -1) && player.playing() === state.isPlaying && Math.abs(player.position() - target) < 1.2) return;
  void player.applyRemoteState({ queue: items, index: state.currentTrack ? 0 : -1, position: target, playing: state.isPlaying, shuffle: false, repeat: "off", title: `一起听 · ${state.roomCode}` }).catch(fail);
}
function updateRoom(patch: Partial<TogetherRoom>) {
  const current = room();
  if (current) room.set({ ...current, ...patch });
}
function playbackMessage(action: Body) {
  const state = room();
  if (!state || action.revision && action.revision < state.revision) return;
  const patch: Partial<TogetherRoom> = { revision: Math.max(state.revision, action.revision) };
  if (["play", "pause", "seek", "change_track"].includes(action.action)) {
    patch.position = action.position; patch.lastUpdate = action.serverTime;
  }
  if (action.action === "play") patch.isPlaying = true;
  if (action.action === "pause") patch.isPlaying = false;
  if (action.action === "change_track") { patch.currentTrack = fromWire(action.trackInfo); patch.isPlaying = false; lastReadyTrack = ""; }
  if (["change_track", "sync_queue", "queue_add", "queue_remove", "queue_clear"].includes(action.action)) patch.queue = action.queue.map(fromWire);
  if (action.action === "set_volume") patch.volume = action.volume;
  updateRoom(patch);
  if (role() === "guest") {
    if (action.action === "set_volume") player.setVolume(action.volume);
    else applyRoom(room()!, action.action === "seek");
  } else if (action.action === "queue_add" && action.trackInfo) {
    // An approved guest suggestion is inserted by the server, including on the host.
    if (action.insertNext) player.playNext(fromWire(action.trackInfo));
    else player.addToQueue(fromWire(action.trackInfo));
  }
}
function handleMessage(type: string, value: Body) {
  switch (type) {
    case "room_created":
      sessionToken = value.sessionToken; lastHostSnapshot = undefined;
      player.remoteControlled.set(false);
      batch(() => {
        userId.set(value.userId); role.set("host");
        room.set({ roomCode: value.roomCode, hostId: value.userId, users: [{ userId: value.userId, username: username(), isHost: true, isConnected: true }], queue: [], isPlaying: false, position: 0, lastUpdate: serverNow(), volume: player.volume(), revision: 0 });
        status.set(`房间 ${value.roomCode} 已创建`);
      });
      void publishPlayback().catch(fail); break;
    case "join_request": pendingJoinRequests.update((items) => [...items, value as JoinRequest]); break;
    case "join_approved":
    case "reconnected": {
      if (value.sessionToken) sessionToken = value.sessionToken;
      const state = fromRoom(value.state);
      batch(() => { userId.set(value.userId); role.set(type === "reconnected" && value.isHost ? "host" : "guest"); room.set(state); waitingForApproval.set(false); status.set(`已加入房间 ${state.roomCode}`); });
      player.remoteControlled.set(role() === "guest");
      lastHostSnapshot = undefined; lastReadyTrack = "";
      if (role() === "guest") applyRoom(state); else void publishPlayback().catch(fail);
      break;
    }
    case "join_rejected": waitingForApproval.set(false); error.set(value.reason); status.set("加入请求被拒绝"); break;
    case "user_joined":
      updateRoom({ users: [...(room()?.users ?? []), { ...value, isHost: false, isConnected: true } as TogetherUser] });
      pendingJoinRequests.update((items) => items.filter((item) => item.userId !== value.userId)); break;
    case "user_left": updateRoom({ users: room()?.users.filter((item) => item.userId !== value.userId) ?? [] }); break;
    case "user_disconnected":
    case "user_reconnected": updateRoom({ users: room()?.users.map((item) => item.userId === value.userId ? { ...item, isConnected: type === "user_reconnected" } : item) ?? [] }); break;
    case "host_changed":
      updateRoom({ hostId: value.newHostId, users: room()?.users.map((item) => ({ ...item, isHost: item.userId === value.newHostId })) ?? [] });
      role.set(value.newHostId === userId() ? "host" : "guest"); player.remoteControlled.set(role() === "guest"); lastHostSnapshot = undefined; status.set(`主持人：${value.newHostName}`); break;
    case "kicked": clearRoom(); error.set(value.reason); status.set("已离开房间"); break;
    case "sync_playback": playbackMessage(value); break;
    case "sync_state": {
      const current = room();
      if (!current || value.revision && value.revision < current.revision) break;
      const state: TogetherRoom = { ...current, currentTrack: value.currentTrack ? fromWire(value.currentTrack) : undefined, queue: value.queue.map(fromWire), isPlaying: value.isPlaying, position: value.position, lastUpdate: value.lastUpdate, volume: value.volume, revision: value.revision };
      room.set(state); applyRoom(state); break;
    }
    case "buffer_wait": bufferingUsers.set(value.waitingFor); signalReady(); break;
    case "buffer_complete": bufferingUsers.set([]); break;
    case "pong": {
      const received = Date.now();
      const networkTime = Math.max(0, received - value.clientTime - (value.serverSendTime - value.serverReceiveTime));
      const sample = value.serverSendTime + networkTime / 2 - received;
      bestRoundTrip = Math.min(bestRoundTrip, networkTime);
      clockOffset = clockReady ? clockOffset + (networkTime <= bestRoundTrip + 50 ? 0.25 : 0.05) * (sample - clockOffset) : sample;
      const firstSample = !clockReady;
      clockReady = true; latency.set(Math.round(networkTime));
      if (firstSample && role() === "guest") void requestSync();
      break;
    }
    case "suggestion_received": suggestions.update((items) => [...items, { suggestionId: value.suggestionId, fromUserId: value.fromUserId, fromUsername: value.fromUsername, track: fromWire(value.trackInfo) }]); break;
    case "suggestion_approved": status.set("点歌已加入队列"); break;
    case "suggestion_rejected": error.set(value.reason); break;
    case "error":
      error.set(`${value.message} (${value.code})`); waitingForApproval.set(false);
      if (["invalid_session", "session_expired", "session_not_found"].includes(value.code)) clearRoom();
      break;
  }
}
function signalReady() {
  const track = player.currentTrack();
  if (connection() !== "connected" || !room() || !track || track.id === lastReadyTrack || player.buffering() || !player.playing()) return;
  lastReadyTrack = track.id;
  void send("buffer_ready", { trackId: track.id }).catch(fail);
}
async function action(name: string, payload: Body = {}) {
  const capturedAtServerTime = ["play", "pause", "seek"].includes(name) ? Math.round(serverNow()) : undefined;
  await send("playback_action", { action: name, ...payload, capturedAtServerTime });
}
/** Publishes the host's actual player; server queues contain upcoming tracks only. */
export async function publishPlayback() {
  if (!isHost() || !room() || player.syncingRemote()) return;
  const current = player.currentTrack();
  if (current && current.source !== "youtube") { error.set("一起听同步 YouTube 曲目；本地音频不会发送到房间"); return; }
  const upcoming = player.queue().slice(player.currentIndex() + 1).filter((track) => track.source === "youtube");
  const now = Date.now();
  const snapshot = { track: current?.id ?? "", queue: JSON.stringify(upcoming.map((track) => track.id)), playing: player.playing(), position: player.position(), volume: player.volume(), at: now };
  const previous = lastHostSnapshot;
  lastHostSnapshot = snapshot;
  const trackChanged = !previous || snapshot.track !== previous.track;
  const queueChanged = !previous || snapshot.queue !== previous.queue;
  if (trackChanged && current) await action("change_track", { trackId: current.id, trackInfo: toWire(current), queue: upcoming.map(toWire), queueTitle: "一起听" });
  if (trackChanged && !current && previous?.track) await action("pause", { trackId: previous.track, position: 0 });
  if (trackChanged || queueChanged) await action("sync_queue", { queue: upcoming.map(toWire), queueTitle: "一起听" });
  if (current) {
    const changedState = !previous || snapshot.playing !== previous.playing;
    const expected = previous ? previous.position + (previous.playing ? (now - previous.at) / 1000 : 0) : 0;
    const jumped = !!previous && Math.abs(snapshot.position - expected) > 1.2;
    if (trackChanged || changedState || snapshot.playing && now - lastHeartbeat >= 5000) {
      lastHeartbeat = now;
      await action(snapshot.playing ? "play" : "pause", { trackId: current.id, position: Math.round(snapshot.position * 1000) });
    } else if (jumped) await action("seek", { trackId: current.id, position: Math.round(snapshot.position * 1000) });
  }
  if (!previous || snapshot.volume !== previous.volume) await action("set_volume", { volume: snapshot.volume });
}
