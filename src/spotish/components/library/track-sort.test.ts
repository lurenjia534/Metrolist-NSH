import { expect, test } from "nsh/test";
import type { Track } from "../../backend/types";
import { chooseSort, directionOf, sortTracks, trackReversed, trackSort } from "./track-sort";

const track = (name: string, extra: Partial<Track> = {}): Track => ({
  uri: `spotify:track:${name}`,
  uid: name,
  name,
  artists: "",
  album: "",
  albumUri: "",
  image: "",
  durationMs: 1000,
  explicit: false,
  playable: true,
  ...extra,
});
const names = (tracks: Track[]) => tracks.map((t) => t.name);

test("the playlist's own order is returned as it came", () => {
  const tracks = [track("b"), track("a")];
  expect(sortTracks(tracks, "custom")).toBe(tracks);
});

test("title, artist and album run A to Z, ignoring case and reading numbers as numbers", () => {
  expect(names(sortTracks([track("b"), track("A"), track("c10"), track("c9")], "title"))).toEqual(["A", "b", "c9", "c10"]);
  const byArtist = [track("1", { artists: "Zed" }), track("2", { artists: "abe" }), track("3", { artists: "Mia" })];
  expect(names(sortTracks(byArtist, "artist"))).toEqual(["2", "3", "1"]);
  const byAlbum = [track("1", { album: "Two" }), track("2", { album: "One" })];
  expect(names(sortTracks(byAlbum, "album"))).toEqual(["2", "1"]);
});

test("duration runs shortest first", () => {
  const tracks = [track("long", { durationMs: 300000 }), track("short", { durationMs: 100000 }), track("mid", { durationMs: 200000 })];
  expect(names(sortTracks(tracks, "duration"))).toEqual(["short", "mid", "long"]);
});

test("recently added and release date put the newest first, undated last, ties in the playlist's order", () => {
  const same = "2026-01-01T00:00:00Z";
  const added = [
    track("x"),
    track("t1", { addedAt: same }),
    track("bad", { addedAt: "not a date" }),
    track("t2", { addedAt: same }),
    track("newest", { addedAt: "2026-02-01T00:00:00Z" }),
  ];
  expect(names(sortTracks(added, "added"))).toEqual(["newest", "t1", "t2", "x", "bad"]);
  const released = [track("old", { releaseDate: "1999" }), track("none"), track("new", { releaseDate: "2024-05-01T00:00:00Z" })];
  expect(names(sortTracks(released, "release"))).toEqual(["new", "old", "none"]);
});

test("every sort runs both ways, undated tracks last in either, ties in the playlist's order", () => {
  expect(names(sortTracks([track("b"), track("A"), track("c")], "title", true))).toEqual(["c", "b", "A"]);
  const byDuration = [track("a", { durationMs: 2 }), track("b", { durationMs: 3 }), track("c", { durationMs: 1 })];
  expect(names(sortTracks(byDuration, "duration", true))).toEqual(["b", "a", "c"]);
  const dated = [track("none"), track("old", { addedAt: "2025-01-01T00:00:00Z" }), track("new", { addedAt: "2026-01-01T00:00:00Z" })];
  expect(names(sortTracks(dated, "added", true))).toEqual(["old", "new", "none"]);
  const released = [track("none"), track("old", { releaseDate: "1999" }), track("new", { releaseDate: "2024" })];
  expect(names(sortTracks(released, "release", true))).toEqual(["old", "new", "none"]);
  const tied = [track("1", { album: "Same" }), track("2", { album: "Same" }), track("3", { album: "Other" })];
  expect(names(sortTracks(tied, "album", true))).toEqual(["1", "2", "3"]);
});

test("picking the sort in use turns it round, and another sort starts from its usual direction", () => {
  chooseSort("custom");
  expect(trackReversed()).toBe(false);
  chooseSort("title");
  expect(directionOf(trackSort(), trackReversed())).toBe("asc");
  chooseSort("title");
  expect(directionOf(trackSort(), trackReversed())).toBe("desc");
  chooseSort("added");
  expect(trackSort()).toBe("added");
  expect(directionOf("added", trackReversed())).toBe("desc");
  chooseSort("added");
  expect(directionOf("added", trackReversed())).toBe("asc");
  chooseSort("custom");
  chooseSort("custom");
  expect(trackReversed()).toBe(false);
});
