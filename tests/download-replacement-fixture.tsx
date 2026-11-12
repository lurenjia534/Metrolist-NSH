import { host, mount, signal, Text, View } from "nsh";
import { Button } from "nsh/base";
import { NativeFiles, type SavedFile } from "metrolist/native";
import * as p from "../src/playback";
import * as s from "../src/store";
import type { Track } from "../src/model";

const remote: Track = { id: "remote", title: "Remote song", artist: "Fixture", album: "", artwork: "", duration: 60, source: "audio", url: "https://audio.test/remote.mp3" };
const local: Track = { ...remote, id: "local", title: "Local song", url: "file:///external/%E5%90%8D%20Song.mp3" };
const ready = signal(false);
const waiting = signal(false);
let rejectDownload: (reason: Error) => void;

// A host acknowledgement returns immediately; only the fixture's native write
// stays pending, so another UI event can cancel it while app.press is idle.
NativeFiles.download = async input => {
  await host.call("app.test.files.download", input);
  return new Promise<SavedFile>((_resolve, reject) => {
    rejectDownload = reject;
    waiting.set(true);
  });
};
NativeFiles.progress = () => null;
NativeFiles.cancel = id => {
  void host.call("app.test.files.cancel", { id });
  waiting.set(false);
  rejectDownload(new Error("Download cancelled"));
};
NativeFiles.remove = destination => host.call("app.test.files.remove", { destination });
NativeFiles.copyInto = (source, directory, name) => host.call("app.test.files.copyInto", { source, directory, name });

function Fixture() {
  void s.initialize().then(() => ready.set(true));
  return <View style={{ flex: 1, padding: 20, gap: 12 }}>
    <Button onPress={() => { void s.downloadTrack(remote).catch(s.showError); }}><Text>Download remote</Text></Button>
    <Button onPress={() => { void s.cancelDownload(remote.id).catch(s.showError); }}><Text>Cancel replacement</Text></Button>
    <Button onPress={() => { void p.playTrack(remote); }}><Text>Play remote</Text></Button>
    <Button onPress={() => { void s.downloadTrack(local).catch(s.showError); }}><Text>Copy local audio</Text></Button>
    <Button onPress={() => { void p.resumePlayback(); }}><Text>Play restored queue</Text></Button>
    <Text>{ready() ? "Ready" : "Restoring"}</Text>
    <If when={waiting()}><Text>Waiting for download</Text></If>
    <Text>{p.playing() ? "Playing" : "Paused"}</Text>
    <Text>{`downloads:${JSON.stringify(s.downloadJobs())}`}</Text>
    <Text>{`queue:${JSON.stringify(p.queue())}`}</Text>
  </View>;
}

mount(Fixture);
