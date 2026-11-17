import { expect, test } from "nsh/test";
import type { Track } from "./model";
import { calculateStatistics } from "./statistics";

const first: Track = { id: "a", title: "First", artist: "Solo", album: "Live", albumId: "album-1", artwork: "", duration: 90, source: "audio" };
const now = new Date(2026, 6, 10, 12).getTime();

test("album rankings combine catalog tracks and distinguish same-title local releases", () => {
  const tracks = [
    first, { ...first, id: "b", artist: "Guest" },
    { ...first, id: "c", albumId: undefined }, { ...first, id: "d", albumId: undefined, artist: "Other" },
    { ...first, id: "e", album: "" },
  ];
  const events = tracks.map((track, index) => ({ id: track.id, trackId: track.id, startedAt: now, seconds: 40 + index }));
  const stats = calculateStatistics(events, tracks, "all", now);
  expect(stats.topAlbums.map(album => [album.albumId ?? album.artist, album.playCount, album.seconds])).toEqual([
    ["album-1", 2, 81], ["Other", 1, 43], ["Solo", 1, 42],
  ]);
  expect(stats.plays).toBe(5);
  expect(stats.uniqueTracks).toBe(5);
  expect(stats.totalSeconds).toBe(210);
});

test("90 and 180 day windows include their local-time boundary and exclude future plays", () => {
  const event = (daysAgo: number, offset = 0) => {
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    return { id: String(date.getTime() + offset), trackId: first.id, startedAt: date.getTime() + offset, seconds: 50 };
  };
  const events = [event(90), event(90, -1), event(180), event(180, -1), event(0, 1)];
  expect(calculateStatistics(events, [first], "quarter", now).plays).toBe(1);
  expect(calculateStatistics(events, [first], "halfYear", now).plays).toBe(3);
  expect(calculateStatistics(events, [first], "all", now).plays).toBe(4);
});

test("daily and hourly play counts use the same local clock across midnight", () => {
  const events = [new Date(2026, 6, 8, 23, 59), new Date(2026, 6, 9, 0, 1), new Date(2026, 6, 9, 0, 20)]
    .map((date, index) => ({ id: String(index), trackId: first.id, startedAt: date.getTime(), seconds: 60 }));
  const stats = calculateStatistics(events, [first], "week", now);
  expect(stats.daily).toEqual([
    { date: "2026-07-08", seconds: 60, plays: 1 }, { date: "2026-07-09", seconds: 120, plays: 2 },
  ]);
  expect(stats.hourlyPlays.length).toBe(24);
  expect(stats.hourlyPlays[0]).toBe(2);
  expect(stats.hourlyPlays[23]).toBe(1);
  expect(stats.hourlyPlays.slice(1, 23).every(count => count === 0)).toBe(true);
});
