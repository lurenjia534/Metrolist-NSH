import type { DownloadJob, DownloadSort, ListenEvent, Track } from "./model";
import { localFile } from "./autoPlaylists";

export const sortLabels: Record<DownloadSort, string> = {
  date: "下载时间", title: "歌曲名称", artist: "歌手名称", size: "文件大小", lastPlayed: "最近播放", plays: "播放次数",
};
export const qualityLabels = { auto: "自动", low: "省流量", high: "高音质" } as const;

export function orderDownloads(jobs: DownloadJob[], sort: DownloadSort, descending: boolean, events: ListenEvent[]) {
  const listening = new Map<string, number>();
  if (sort === "plays" || sort === "lastPlayed") {
    for (const event of events) {
      const previous = listening.get(event.trackId) ?? 0;
      listening.set(event.trackId, sort === "plays" ? previous + 1 : Math.max(previous, event.startedAt));
    }
  }
  function compare(a: DownloadJob, b: DownloadJob) {
    switch (sort) {
      case "date": return a.createdAt - b.createdAt;
      case "title": return a.track.title.localeCompare(b.track.title);
      case "artist": return a.track.artist.localeCompare(b.track.artist);
      case "size": return a.bytes - b.bytes;
      default: return (listening.get(a.id) ?? 0) - (listening.get(b.id) ?? 0);
    }
  }
  return [...jobs].sort((a, b) => descending ? compare(b, a) : compare(a, b));
}

export function missingDownloads(tracks: Track[], jobs: DownloadJob[]) {
  const handled = new Set(jobs.filter(job => job.status !== "failed" && job.status !== "cancelled").map(job => job.id));
  return tracks.filter(track => {
    if (localFile(track) || handled.has(track.id)) return false;
    handled.add(track.id);
    return true;
  });
}

export function artistStorage(jobs: DownloadJob[]) {
  const artists = new Map<string, { artist: string; count: number; bytes: number }>();
  for (const job of jobs) {
    if (job.status !== "completed") continue;
    const artist = job.track.artist;
    const row = artists.get(artist) ?? { artist, count: 0, bytes: 0 };
    row.count++;
    row.bytes += job.bytes;
    artists.set(artist, row);
  }
  return [...artists.values()].sort((a, b) => b.bytes - a.bytes || a.artist.localeCompare(b.artist));
}
