import { AudioPlayer, mount, Scroll, signal, Text, View } from "nsh";
import { Button } from "nsh/base";
import * as p from "../src/playback";
import * as s from "../src/store";
import type { Track } from "../src/model";

const alpha: Track = { id: "alpha", title: "Alpha", artist: "First artist", album: "Album", artwork: "", duration: 60, source: "audio", url: "https://audio.test/alpha.mp3" };
const beta: Track = { ...alpha, id: "beta", title: "Beta", artist: "Second artist", url: "https://audio.test/beta.mp3" };
const video: Track = { ...alpha, id: "video", title: "Video song", artist: "Online artist", source: "youtube", url: undefined };
const selectedPlaylist = signal("");
const playlistQuery = signal("");
const run = (work: () => unknown) => { void Promise.resolve().then(work).catch(s.showError); };

function Fixture() {
  void s.initialize();
  const commands: { name: string; action: () => unknown }[] = [
    { name: "Block next autoplay", action: () => {
      const original = AudioPlayer.prototype.play;
      AudioPlayer.prototype.play = function () {
        AudioPlayer.prototype.play = original;
        return Promise.reject(Object.assign(new Error("Playback requires a user gesture"), { code: "not-allowed" }));
      };
    } },
    { name: "Start local", action: () => p.playList([alpha, beta, alpha]) },
    { name: "Start video", action: () => p.playList([video]) },
    { name: "Pause", action: p.pause }, { name: "Play", action: p.resumePlayback }, { name: "Retry playback", action: p.retryPlayback },
    { name: "Seek 21", action: () => p.seek(21) }, { name: "Seek 50", action: () => p.seek(50) },
    { name: "High quality", action: () => s.updateSettings({ audioQuality: "high" }) },
    { name: "Move third first", action: () => p.moveQueue(2, 0) },
    { name: "Remove current", action: () => p.removeFromQueue(p.currentIndex()) },
    { name: "Repeat one", action: () => { p.cycleRepeat(); p.cycleRepeat(); } },
    { name: "Clear queue", action: p.clearQueue },
    { name: "Search catalog", action: () => s.search("Catalog") },
    { name: "Save catalog result", action: () => s.addToLibrary(s.searchResults()[0] as Track) },
    { name: "Like alpha", action: () => s.toggleLike(alpha) },
    { name: "Remove alpha", action: () => s.removeFromLibrary(alpha.id) },
    { name: "Create playlist", action: () => { const list = s.createPlaylist("Fixture playlist"); s.addTracksToPlaylist(list.id, [beta, alpha, beta]); selectedPlaylist.set(list.id); } },
    { name: "Find beta", action: () => playlistQuery.set("Beta") },
    { name: "Remove last visible", action: () => { const rows = s.playlistEntries(selectedPlaylist(), playlistQuery()); const row = rows[rows.length - 1]; s.removeFromPlaylist(selectedPlaylist(), row.track.id, row.index); } },
    { name: "Sort playlist", action: () => s.sortPlaylist(selectedPlaylist(), "title") },
    { name: "Move playlist", action: () => s.movePlaylistTrack(selectedPlaylist(), 1, 0) },
    { name: "Save collections", action: () => { s.toggleCollectionSaved({ id: "album", browseId: "album", title: "Saved album", subtitle: "Artist", artwork: "", type: "album", params: "album-params" }); s.toggleCollectionSaved({ id: "artist", browseId: "artist", title: "Saved artist", subtitle: "Artist", artwork: "", type: "artist" }); } },
    { name: "Download", action: () => s.downloadTrack(video) },
    { name: "Retry download", action: () => s.retryDownload(video.id) },
    { name: "Cancel download", action: () => s.cancelDownload(video.id) },
    { name: "Remove download", action: () => s.removeDownload(video.id) },
    { name: "Remote guest", action: () => { p.remoteControlled.set(true); return p.applyRemoteState({ queue: [alpha, beta], index: 0, position: 0, playing: true }); } },
  ];
  return <View style={{ flex: 1, padding: 20, gap: 12 }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}><Each of={commands}>{(command) => <Button onPress={() => run(command().action)}><Text>{command().name}</Text></Button>}</Each></View>
    <Text>{p.buffering() ? "Loading" : p.playing() ? "Playing" : "Paused"}</Text>
    <Scroll style={{ flex: 1 }}><View style={{ gap: 8 }}>
      <Text>{`queue:${JSON.stringify({ ids: p.queue().map((track) => track.id), index: p.currentIndex(), position: p.position(), buffered: p.bufferedPosition(), buffering: p.buffering(), playing: p.playing(), error: p.playbackError(), errorCode: p.playbackErrorCode() })}`}</Text>
      <Text>{`library:${JSON.stringify({ ids: s.libraryTracks().map((track) => track.id), liked: s.likedIds(), albums: s.savedAlbums(), artists: s.savedArtists(), search: s.searchHistory() })}`}</Text>
      <Text>{`rows:${JSON.stringify(s.playlistEntries(selectedPlaylist(), playlistQuery()).map((entry) => ({ id: entry.track.id, index: entry.index })))}`}</Text>
      <Text>{`stats:${JSON.stringify(s.statistics())}`}</Text>
      <Text>{`downloads:${JSON.stringify(s.downloadJobs())}`}</Text>
      <Text>{`error:${s.error()}`}</Text>
    </View></Scroll>
  </View>;
}
mount(Fixture);
