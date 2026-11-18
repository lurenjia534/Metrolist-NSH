import { expect, test } from "nsh/test";
import type { Track } from "./model";
import { listeningPlaylist } from "./autoPlaylists";

const day = 86_400_000;
const now = 1000 * day;
const track = (id: string): Track => ({ id, title: id, artist: "", album: "", duration: 180, artwork: "", source: "youtube" });
const event = (trackId: string, daysAgo: number, seconds: number) => ({
  id: `${trackId}-${daysAgo}`, trackId, startedAt: now - daysAgo * day, seconds,
});

test("the top playlist limits the ranked result after summing plays within the period", () => {
  const songs = Array.from({ length: 105 }, (_, i) => track(String(i)));
  const events = songs.map((song, i) => event(song.id, 2, i + 1));
  events.push(event("0", 3, 220), event("1", 7, 450), event("2", -1, 600));
  const ranked = listeningPlaylist("top100", songs, events, 7, now);
  expect(ranked.length).toBe(100);
  expect(ranked.slice(0, 3).map(song => song.id)).toEqual(["0", "104", "103"]);
  expect(ranked.at(-1)?.id).toBe("6");
});

test("forgotten favorites include only songs below a fifth of their previous listening time", () => {
  const songs = ["below", "equal", "recent", "old"].map(track);
  const events = [event("below", 31, 100), event("below", 1, 19), event("equal", 31, 100), event("equal", 1, 20),
    event("recent", 1, 180), event("old", 60, 80)];
  const result = listeningPlaylist("forgotten", songs, events, 0, now);
  expect(result.map(song => song.id)).toEqual(["old", "below"]);
});
