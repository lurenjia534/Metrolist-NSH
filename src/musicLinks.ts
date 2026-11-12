export type MusicLink =
  | { type: "song"; id: string; startAt: number }
  | { type: "album" | "artist" | "playlist"; id: string; browseId: string };

function playbackTime(value: string | null): number {
  const match = value?.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  return match ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) : 0;
}

export function parseMusicLink(value: string): MusicLink | null {
  const text = value.trim();
  if (!/^(?:https?:\/\/)?(?:(?:(?:www|m|music)\.)?youtube\.com|(?:www\.)?youtu\.be)\//i.test(text)) return null;
  const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  const [route, item] = url.pathname.split("/").filter(Boolean);
  const video = url.hostname.endsWith("youtu.be") ? route
    : route === "watch" ? url.searchParams.get("v")
    : ["shorts", "embed", "live"].includes(route) ? item : null;
  if (video && /^[\w-]{11}$/.test(video)) {
    return { type: "song", id: video, startAt: playbackTime(url.searchParams.get("t") || url.searchParams.get("start") || new URLSearchParams(url.hash.slice(1)).get("t")) };
  }
  const playlist = url.searchParams.get("list");
  if ((route === "playlist" || route === "watch") && playlist) {
    const browseId = playlist.startsWith("VL") ? playlist : `VL${playlist}`;
    return { type: "playlist", id: browseId, browseId };
  }
  if (route === "channel" && item) return { type: "artist", id: item, browseId: item };
  if (route === "browse" && item) {
    const type = item.startsWith("MPRE") ? "album" : item.startsWith("UC") ? "artist" : item.startsWith("VL") ? "playlist" : null;
    if (type) return { type, id: item, browseId: item };
  }
  return null;
}
