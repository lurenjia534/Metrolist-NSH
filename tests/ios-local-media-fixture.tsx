import { host, mount, signal, Text, View } from "nsh";
import { Button } from "nsh/base";
import { NativeFiles, NativeMedia } from "metrolist/native";
import type { Track } from "../src/model";
import * as playback from "../src/playback";
import * as store from "../src/store";

// Exercise the production store and playback lifecycle, recording only the
// platform I/O. Rust's media tests serve real local audio over the actual relay.
// The headless host has no dataDir; these recorded files belong to the app.
NativeMedia.prepare = (url, headers) => host.call("app.test.media.prepare", { url, headers });
NativeMedia.release = id => { void host.call("app.test.media.release", { id }); };
NativeFiles.download = input => host.call("app.test.files.download", input);
NativeFiles.progress = () => null;

const imported: Track = {
  id: "ios-imported", title: "Imported song", artist: "Local artist", album: "Local files",
  artwork: "", duration: 60, source: "audio",
  url: "file:///app-data/music/Imported%20song.m4a",
};
const downloadable: Track = {
  ...imported, id: "ios-downloaded", title: "Downloaded song", url: "https://audio.test/downloaded.mp3",
};

function Fixture() {
  const ready = signal(false);
  void store.initialize().then(() => ready.set(true));
  const run = (work: () => unknown) => { void Promise.resolve().then(work).catch(store.showError); };
  return <View style={{ flex: 1, padding: 20, gap: 12 }}>
    <If when={ready()}><Text>Ready</Text></If>
    <Button disabled={!ready()} onPress={() => run(() => playback.playTrack(imported))}><Text>Play imported</Text></Button>
    <Button disabled={!ready()} onPress={() => run(() => store.downloadTrack(downloadable))}><Text>Download song</Text></Button>
    <Button disabled={!ready()} onPress={() => run(() => playback.playTrack(downloadable))}><Text>Play downloaded</Text></Button>
    <Button onPress={playback.pause}><Text>Pause</Text></Button>
    <Button onPress={() => run(playback.resumePlayback)}><Text>Resume</Text></Button>
    <Button onPress={playback.clearQueue}><Text>Clear</Text></Button>
    <Text>{playback.playbackPhase()}</Text>
    <Text>{`download:${store.downloadJobs()[0]?.status ?? "none"}`}</Text>
    <Text>{`error:${store.error()}`}</Text>
  </View>;
}

mount(Fixture);
