import { mount, signal, Text, View } from "nsh";
import { Button } from "nsh/base";
import * as p from "../src/playback";
import type { Track } from "../src/model";

const song = (id: string): Track => ({ id, title: id, artist: "Artist", album: "Album", artwork: "", duration: 300, source: "youtube" });
const alpha = song("alpha"), beta = song("beta"), gamma = song("gamma"), delta = song("delta");
const changes = signal(0);
const radioCalls = signal(0);
const autoRadio = signal(false);
const error = signal("");
p.initPlayback({
  resolveStream: async track => ({ url: `https://audio.test/${track.id}.mp3` }),
  autoRadio,
  fetchRadio: async () => { radioCalls.update(value => value + 1); return [delta]; },
  onQueueChange: () => changes.update(value => value + 1),
  onError: error.set,
});

function Fixture() {
  const commands = [
    { name: "Start", action: () => p.playList([alpha, beta, alpha], 0, "Original") },
    { name: "Start single", action: () => p.playList([alpha]) },
    { name: "Next", action: p.next }, { name: "Previous", action: p.previous },
    { name: "Pause", action: p.pause }, { name: "Resume", action: p.resumePlayback },
    { name: "Shuffle", action: p.toggleShuffle },
    { name: "Repeat one", action: () => { p.cycleRepeat(); p.cycleRepeat(); } },
    { name: "Auto radio", action: () => autoRadio.set(true) },
    { name: "Sleep one minute", action: () => p.setSleepTimer(1) },
    { name: "Sleep after song", action: p.setSleepAfterTrack },
    { name: "Cancel sleep", action: p.cancelSleepTimer },
    { name: "Cancel with zero", action: () => p.setSleepTimer(0) },
    { name: "Clear queue", action: p.clearQueue },
    { name: "Append batch", action: () => p.addTracksToQueue([gamma, delta, gamma]) },
    { name: "Play batch next", action: () => p.playNextTracks([gamma, delta, gamma]) },
    { name: "Move first next", action: () => p.moveQueueNext(0) },
    { name: "Move second next", action: () => p.moveQueueNext(1) },
    { name: "Move third next", action: () => p.moveQueueNext(2) },
    { name: "Move second last", action: () => p.moveQueue(1, 2) },
    { name: "Seek 42", action: () => p.seek(42) },
    { name: "Reset changes", action: () => changes.set(0) },
  ];
  return <View style={{ padding: 16, gap: 12 }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}><Each of={commands}>{command => <Button onPress={() => { void Promise.resolve(command().action()).catch(reason => error.set(String(reason))); }}><Text>{command().name}</Text></Button>}</Each></View>
    <Text>{p.playbackPhase()}</Text>
    <Text>{`state:${JSON.stringify({ ids: p.queue().map(track => track.id), index: p.currentIndex(), position: p.position(), playing: p.playing(), next: p.upNext()?.id, changes: changes(), radioCalls: radioCalls(), sleepUntil: p.sleepUntil(), sleepAfterTrack: p.sleepAfterTrack(), sleepRemaining: p.sleepRemaining(), sleepActive: p.sleepActive(), error: error() })}`}</Text>
  </View>;
}
mount(Fixture);
