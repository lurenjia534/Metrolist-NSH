// Spotify's public Web API, shared by the browser and native App Remote backends.
// `request` supplies the account's token; this module never stores credentials.
// Endpoint shapes: https://developer.spotify.com/documentation/web-api/references/changes/february-2026

export const SPOTIFY_SCOPES = [
  "streaming", "user-read-email", "user-read-private", "app-remote-control",
  "user-read-playback-state", "user-modify-playback-state",
  "user-library-read", "user-library-modify", "playlist-read-private",
  "playlist-read-collaborative", "user-read-recently-played", "user-follow-read",
];

const LIKED = "spotify:collection:tracks";
const imageOf = value => value?.images?.[0]?.url || value?.album?.images?.[0]?.url || "";
const artistsOf = value => (value?.artists || []).map(artist => artist.name).join(", ");
const idOf = (uri, type) => {
  const match = new RegExp(`^spotify:${type}:([A-Za-z0-9]+)$`).exec(uri);
  if (!match) throw new Error(`E_URI: Expected a Spotify ${type} URI`);
  return match[1];
};
const unique = values => [...new Map(values.map(value => [value.uri, value])).values()];

export function spotifyItem(value) {
  return {
    uri: value.uri,
    kind: value.type,
    name: value.name,
    subtitle: value.type === "playlist" ? (value.owner?.display_name || value.owner?.id || "") : artistsOf(value),
    image: imageOf(value),
  };
}

export function spotifyTrack(value, { album = value.album, addedAt, uid = value.uri, contextIndex } = {}) {
  return {
    uri: value.uri,
    uid,
    name: value.name,
    artists: artistsOf(value),
    album: album?.name || "",
    albumUri: album?.uri || "",
    image: imageOf(album),
    durationMs: value.duration_ms,
    explicit: value.explicit === true,
    playable: value.is_playable !== false && !value.is_local && !value.restrictions,
    ...(contextIndex === undefined ? {} : { contextIndex }),
    ...(addedAt ? { addedAt } : {}),
    ...(album?.release_date ? { releaseDate: album.release_date } : {}),
  };
}

function header(value, description = value.description || "") {
  return { ...spotifyItem(value), description };
}

function nextPath(next) {
  const url = new URL(next);
  return url.pathname.replace(/^\/v1/, "") + url.search;
}

export function parseSpotifyLyrics(record) {
  if (record.instrumental) return { synced: false, lines: [], provider: "LRCLIB" };
  const lines = [];
  const offset = Number(/\[offset:([+-]?\d+)\]/i.exec(record.syncedLyrics || "")?.[1] || 0);
  for (const row of (record.syncedLyrics || "").split(/\r?\n/)) {
    const stamps = [...row.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const words = row.replace(/\[[^\]]*\]/g, "").trim();
    for (const stamp of stamps) {
      lines.push({ startMs: Math.max(0, Math.round((Number(stamp[1]) * 60 + Number(stamp[2])) * 1000) + offset), words });
    }
  }
  if (lines.length) return { synced: true, lines: lines.sort((a, b) => a.startMs - b.startMs), provider: "LRCLIB" };
  return {
    synced: false,
    lines: (record.plainLyrics || "").split(/\r?\n/).filter(Boolean).map(words => ({ startMs: 0, words })),
    provider: "LRCLIB",
  };
}

/** request(path, {method?, body?}) returns decoded Spotify JSON (null for 204).
 * Paths are relative to https://api.spotify.com/v1. */
export function createSpotifyApi(request, { lyricsFetch = (...args) => fetch(...args) } = {}) {
  async function pages(first, select = value => value) {
    let page = typeof first === "string" ? select(await request(first)) : first;
    const result = [...page.items];
    while (page.next) {
      page = select(await request(nextPath(page.next)));
      result.push(...page.items);
    }
    return result;
  }

  const api = {
    async me() {
      const account = await request("/me");
      return { id: account.account_id, name: account.display_name || account.id, image: imageOf(account) };
    },

    async home() {
      const [playlists, albums, recent] = await Promise.all([
        request("/me/playlists?limit=20"),
        request("/me/albums?limit=20"),
        request("/me/player/recently-played?limit=30"),
      ]);
      const hour = new Date().getHours();
      return {
        greeting: hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening",
        sections: [
          { title: "Recently played", items: unique(recent.items.filter(value => value.track).map(value => spotifyItem(value.track))) },
          { title: "Your playlists", items: playlists.items.filter(Boolean).map(spotifyItem) },
          { title: "Saved albums", items: albums.items.filter(value => value.album).map(value => spotifyItem(value.album)) },
        ].filter(section => section.items.length),
      };
    },

    async search(query) {
      if (!query.trim()) return { tracks: [], artists: [], albums: [], playlists: [] };
      const params = new URLSearchParams({ q: query, type: "track,artist,album,playlist", limit: "10" });
      const data = await request(`/search?${params}`);
      return {
        tracks: data.tracks.items.filter(Boolean).map(value => spotifyTrack(value)),
        artists: data.artists.items.filter(Boolean).map(spotifyItem),
        albums: data.albums.items.filter(Boolean).map(spotifyItem),
        playlists: data.playlists.items.filter(Boolean).map(spotifyItem),
      };
    },

    async track(uri) {
      return spotifyTrack(await request(`/tracks/${idOf(uri, "track")}`));
    },

    async playlist(uri) {
      const value = await request(`/playlists/${idOf(uri, "playlist")}`);
      // Development-mode clients only receive contents of owned/collaborative playlists.
      if (!value.items) throw new Error("E_PLAYLIST_ACCESS: Spotify only exposes playlist contents when you own or collaborate on the playlist.");
      const entries = await pages(value.items);
      const tracks = entries.flatMap((entry, index) => {
        const track = entry?.item;
        return track?.type === "track" ? [spotifyTrack(track, { addedAt: entry.added_at, uid: `${uri}:${index}:${track.uri}`, contextIndex: index })] : [];
      });
      return { header: header(value), tracks, releases: [], total: value.items.total };
    },

    async album(uri) {
      const value = await request(`/albums/${idOf(uri, "album")}`);
      const tracks = (await pages(value.tracks)).flatMap((track, index) => track ? [spotifyTrack(track, { album: value, contextIndex: index })] : []);
      return { header: header(value, value.release_date || ""), tracks, releases: [], total: value.total_tracks };
    },

    async artist(uri) {
      const id = idOf(uri, "artist");
      const [value, releases] = await Promise.all([
        request(`/artists/${id}`),
        pages(`/artists/${id}/albums?include_groups=album,single&limit=50`),
      ]);
      // Artist top tracks was removed from the public API in February 2026.
      return { header: header(value), tracks: [], releases: unique(releases.filter(Boolean).map(spotifyItem)), total: 0 };
    },

    async likedSongs() {
      const saved = await pages("/me/tracks?limit=50");
      const tracks = saved.flatMap((value, index) => value?.track ? [spotifyTrack(value.track, { addedAt: value.added_at, contextIndex: index })] : []);
      return {
        header: { uri: LIKED, kind: "collection", name: "Liked Songs", subtitle: "Your saved music", image: "", description: "" },
        tracks, releases: [], total: tracks.length,
      };
    },

    async library() {
      const [playlists, albums, artists] = await Promise.all([
        pages("/me/playlists?limit=50"),
        pages("/me/albums?limit=50"),
        pages("/me/following?type=artist&limit=50", value => value.artists),
      ]);
      return { items: [
        { uri: LIKED, kind: "collection", name: "Liked Songs", subtitle: "Your saved music", image: "" },
        ...playlists.filter(Boolean).map(spotifyItem),
        ...albums.filter(value => value?.album).map(value => spotifyItem(value.album)),
        ...artists.filter(Boolean).map(spotifyItem),
      ] };
    },

    async likes(uris) {
      const result = [];
      for (let index = 0; index < uris.length; index += 40) {
        result.push(...await request(`/me/library/contains?${new URLSearchParams({ uris: uris.slice(index, index + 40).join(",") })}`));
      }
      return result;
    },

    async setLiked(uri, on) {
      await request(`/me/library?${new URLSearchParams({ uris: uri })}`, { method: on ? "PUT" : "DELETE" });
    },

    async lyrics(uri) {
      const track = await request(`/tracks/${idOf(uri, "track")}`);
      const params = new URLSearchParams({ track_name: track.name, artist_name: track.artists[0].name });
      if (track.album?.name) params.set("album_name", track.album.name);
      const duration = Math.round(track.duration_ms / 1000);
      if (duration >= 1 && duration <= 3600) params.set("duration", String(duration));
      const response = await lyricsFetch(`https://lrclib.net/api/get?${params}`, {
        headers: { "Lrclib-Client": "Metrolist NSH (https://github.com/lurenjia534/Metrolist-NSH)" },
      });
      if (response.status === 404) return { synced: false, lines: [], provider: "LRCLIB" };
      if (!response.ok) throw new Error(`E_LYRICS: LRCLIB returned HTTP ${response.status}`);
      return parseSpotifyLyrics(await response.json());
    },
  };
  return api;
}
