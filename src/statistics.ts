import type { AlbumStats, ArtistStats, ListenEvent, ListeningStatistics, StatsPeriod, Track, TrackStats } from "./model";

const periodDays = { week: 7, month: 30, quarter: 90, halfYear: 180, year: 365 };

export function calculateStatistics(events: ListenEvent[], tracks: Track[], period: StatsPeriod, now: number): ListeningStatistics {
  const start = new Date(now);
  if (period !== "all") start.setDate(start.getDate() - periodDays[period]);
  const since = period === "all" ? -Infinity : start.getTime();
  const byTrack = new Map<string, { playCount: number; seconds: number }>();
  const byDay = new Map<string, ListeningStatistics["daily"][number]>();
  const hourlyPlays = Array<number>(24).fill(0);
  let plays = 0;
  let totalSeconds = 0;

  for (const event of events) {
    if (event.startedAt < since || event.startedAt > now) continue;
    plays++;
    totalSeconds += event.seconds;
    const totals = byTrack.get(event.trackId) ?? { playCount: 0, seconds: 0 };
    totals.playCount++;
    totals.seconds += event.seconds;
    byTrack.set(event.trackId, totals);

    const local = new Date(event.startedAt);
    hourlyPlays[local.getHours()]++;
    const date = [local.getFullYear(), String(local.getMonth() + 1).padStart(2, "0"), String(local.getDate()).padStart(2, "0")].join("-");
    const day = byDay.get(date) ?? { date, seconds: 0, plays: 0 };
    day.plays++;
    day.seconds += event.seconds;
    byDay.set(date, day);
  }

  const topTracks: TrackStats[] = [];
  const byArtist = new Map<string, ArtistStats>();
  const byAlbum = new Map<string, AlbumStats>();
  for (const track of tracks) {
    const totals = byTrack.get(track.id);
    if (!totals) continue;
    topTracks.push({ track, ...totals });
    const id = track.artistId || track.artist;
    const artist = byArtist.get(id) ?? { id, name: track.artist, artwork: track.artwork, playCount: 0, seconds: 0 };
    artist.playCount += totals.playCount;
    artist.seconds += totals.seconds;
    byArtist.set(id, artist);

    if (track.album.trim()) {
      const key = JSON.stringify(track.albumId ? [track.albumId] : [track.album, id]);
      const album = byAlbum.get(key) ?? { albumId: track.albumId, title: track.album, artist: track.artist, artwork: track.artwork, playCount: 0, seconds: 0 };
      album.playCount += totals.playCount;
      album.seconds += totals.seconds;
      byAlbum.set(key, album);
    }
  }

  const byListenTime = (a: { seconds: number }, b: { seconds: number }) => b.seconds - a.seconds;
  return {
    plays, totalSeconds, uniqueTracks: byTrack.size, hourlyPlays,
    topTracks: topTracks.sort(byListenTime),
    topArtists: [...byArtist.values()].sort(byListenTime),
    topAlbums: [...byAlbum.values()].sort(byListenTime),
    daily: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
