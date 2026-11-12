import { host, mount, signal, Text, View } from "nsh";
import { Button } from "nsh/base";
import { NativeMedia, type MediaSource } from "metrolist/native";
import * as p from "../src/playback";
import type { StreamInfo, Track } from "../src/model";

const headers = { "User-Agent": "native-source-profile", Origin: "https://music.youtube.com", Referer: "https://music.youtube.com/" };
const sources: Record<string, StreamInfo> = {
  signed: { url: "https://audio.test/signed.m4a?signature=fixture", headers },
  replacement: { url: "https://audio.test/replacement.m4a?signature=fixture", headers },
  local: { url: "file:///music/offline.m4a", headers },
  direct: { url: "https://audio.test/direct.mp3" },
};
const track = (id: string): Track => ({ id, title: id, artist: "Fixture", album: "Native media", artwork: "", duration: 60, source: "audio", url: sources[id].url });

// Keep the actual playback state machine; replace only this fixture's native I/O.
let delayNext = false;
let held: { source: MediaSource; finish: (source: MediaSource) => void } | undefined;
const waiting = signal(false);
NativeMedia.prepare = async (url, sourceHeaders) => {
  const source = await host.call<MediaSource>("app.test.media.prepare", { url, headers: sourceHeaders });
  if (!delayNext) return source;
  delayNext = false;
  waiting.set(true);
  return new Promise<MediaSource>(finish => { held = { source, finish }; });
};
NativeMedia.release = id => { void host.call("app.test.media.release", { id }); };

function Fixture() {
  p.initPlayback({ resolveStream: async song => sources[song.id], autoRadio: () => false });
  return <View style={{ flex: 1, padding: 20, gap: 12 }}>
    <Each of={Object.keys(sources)}>{id => <Button onPress={() => void p.playTrack(track(id()))}><Text>{`Play ${id()}`}</Text></Button>}</Each>
    <Button onPress={p.clearQueue}><Text>Clear</Text></Button>
    <Button onPress={p.pause}><Text>Pause</Text></Button>
    <Button onPress={() => void p.resumePlayback()}><Text>Resume</Text></Button>
    <Button onPress={() => { delayNext = true; }}><Text>Delay preparation</Text></Button>
    <Button onPress={() => { const pending = held!; held = undefined; waiting.set(false); pending.finish(pending.source); }}><Text>Complete preparation</Text></Button>
    <If when={waiting()}><Text>Waiting for relay</Text></If>
    <Text>{p.playbackPhase()}</Text>
    <Text>{`state:${JSON.stringify({ id: p.currentTrack()?.id, playing: p.playing(), phase: p.playbackPhase(), error: p.playbackError() })}`}</Text>
  </View>;
}

mount(Fixture);
