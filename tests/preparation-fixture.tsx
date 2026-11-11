import { mount, signal, Text, View } from "nsh";
import { Button } from "nsh/base";
import * as api from "../src/api";
import * as p from "../src/playback";
import type { AudioQuality, Track } from "../src/model";

const quality = signal<AudioQuality>("auto");
const songs: Track[] = ["first", "second", "third"].map(id => ({ id, title: id, artist: "Artist", album: "Album", artwork: "", duration: 60, source: "youtube" }));
api.setApiOrigin("https://gateway.test");
p.initPlayback({
  resolveStream: (track, request) => api.resolvePlayback(track, quality(), request),
  sourceContext: () => quality(), autoRadio: () => false,
});

function Fixture() {
  return <View style={{ flex: 1, padding: 12, gap: 8 }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
      <Button onPress={() => { void p.playList(songs); }}><Text>Start</Text></Button>
      <Button onPress={() => { void p.next(); }}><Text>Next</Text></Button>
      <Button onPress={p.pause}><Text>Pause</Text></Button>
      <Button onPress={() => { void p.resumePlayback(); }}><Text>Resume</Text></Button>
      <Button onPress={() => { void p.retryPlayback(); }}><Text>Retry</Text></Button>
      <Button onPress={() => p.moveQueue(2, 1)}><Text>Reorder next</Text></Button>
      <Button onPress={() => p.removeFromQueue(1)}><Text>Remove next</Text></Button>
      <Button onPress={p.clearUpcoming}><Text>Clear upcoming</Text></Button>
      <Button onPress={p.clearQueue}><Text>Clear all</Text></Button>
      <Button onPress={() => { quality.set("high"); void p.reloadPlayback(); }}><Text>Quality high</Text></Button>
      <Button onPress={p.toggleShuffle}><Text>Shuffle</Text></Button>
    </View>
    <Text>{p.playbackPhase()}</Text>
    <Text>{p.nextPreparation() ? `Next ${p.nextPreparation()!.state}` : "No preparation"}</Text>
    <Text>{`state:${JSON.stringify({ ids: p.queue().map(item => item.id), index: p.currentIndex(), playing: p.playing(), phase: p.playbackPhase(), next: p.upNext()?.id, preparation: p.nextPreparation(), timing: p.playbackTiming(), error: p.playbackError(), errorCode: p.playbackErrorCode() })}`}</Text>
  </View>;
}
mount(Fixture);
