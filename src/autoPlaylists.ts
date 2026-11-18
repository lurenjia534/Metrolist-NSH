import type { ListenEvent, Track } from "./model";

export const autoPlaylists = {
  top100: { title: "最常听的 100 首", icon: "stats", description: "按所选时段内的聆听时长排名" },
  forgotten: { title: "久未重听", icon: "clock", description: "最近 30 天的聆听时长低于此前的五分之一" },
  files: { title: "本地音频文件", icon: "music", description: "已导入本机音乐库的音频文件" },
};
export type AutoPlaylist = keyof typeof autoPlaylists;
export const topPeriods = [
  { days: 0, label: "全部时间" }, { days: 1, label: "24 小时" }, { days: 7, label: "7 天" },
  { days: 30, label: "30 天" }, { days: 365, label: "365 天" },
];
const day = 86_400_000;

export function listeningPlaylist(kind: "top100" | "forgotten", tracks: Track[], events: ListenEvent[], days: number, now: number) {
  const totals = new Map<string, { earlier: number; recent: number }>();
  const since = days ? now - days * day : 0;
  for (const event of events) {
    if (event.startedAt > now || (kind === "top100" && event.startedAt <= since)) continue;
    const row = totals.get(event.trackId) ?? { earlier: 0, recent: 0 };
    if (kind === "forgotten" && event.startedAt < now - 30 * day) row.earlier += event.seconds;
    else row.recent += event.seconds;
    totals.set(event.trackId, row);
  }
  return tracks.flatMap(track => {
    const row = totals.get(track.id);
    if (!row || (kind === "forgotten" && row.recent >= row.earlier / 5)) return [];
    return [{ track, score: kind === "forgotten" ? row.earlier : row.recent }];
  }).sort((a, b) => kind === "forgotten" ? a.score - b.score : b.score - a.score)
    .slice(0, 100).map(row => row.track);
}

export function localFile(track: Track) {
  return track.source === "audio" && (track.url?.startsWith("local:") || track.url?.startsWith("file:"));
}
