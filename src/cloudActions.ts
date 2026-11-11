import { signal } from "nsh";
import * as account from "./account";
import type { Collection, Track } from "./model";

export const libraryScope = signal<"device" | "cloud">("device");
export const cloudDialog = signal<"create" | "rename" | "add" | null>(null);
export const cloudDraft = signal("");
export const cloudDescription = signal("");
export const cloudPrivacy = signal("PRIVATE");
export const cloudTarget = signal<Collection | null>(null);
export const cloudSelection = signal<Track[]>([]);

export function createCloudPlaylist(tracks: Track[] = []) {
  cloudDraft.set(""); cloudDescription.set(""); cloudPrivacy.set("PRIVATE");
  cloudSelection.set(tracks.filter(track => track.source === "youtube")); cloudDialog.set("create");
}
export function renameCloudPlaylist(item: Collection) {
  cloudTarget.set(item); cloudDraft.set(item.title); cloudDialog.set("rename");
}
export function addToCloudPlaylist(tracks: Track[]) {
  cloudSelection.set(tracks.filter(track => track.source === "youtube")); cloudDialog.set("add");
  void account.loadCloudLibrary("playlists");
}
export const playlistId = (item: Collection) => item.playlistId || item.browseId.replace(/^VL/, "");
