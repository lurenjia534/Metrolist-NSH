import { AudioPlayer, mount, Text, View } from "nsh";
import type { AudioErrorInfo } from "nsh";
import { Button } from "nsh/base";
import { NativeMedia } from "metrolist/native";
import * as api from "../src/api";
import * as p from "../src/playback";
import type { Track } from "../src/model";

const songs: Track[] = ["first", "second"].map(id => ({ id, title: id, artist: "Artist", album: "Album", artwork: "", duration: 240, source: "youtube" }));
api.setApiOrigin("https://gateway.test");
p.initPlayback({ resolveStream: (track, request) => api.resolvePlayback(track, "auto", request), autoRadio: () => false });

// Headless players never read their source: the test fails the current one as the platform's player would.
let fail: ((error: AudioErrorInfo) => void) | undefined;
const on = AudioPlayer.prototype.on as (this: AudioPlayer, event: string, listener: unknown) => () => void;
(AudioPlayer.prototype as unknown as { on: typeof on }).on = function (event, listener) {
  if (event === "error") fail = listener as typeof fail;
  return on.call(this, event, listener);
};

// The desktop player reads the relay; this test needs only its address.
NativeMedia.prepare = async url => ({ id: url, url: `http://127.0.0.1:49321/media/${encodeURIComponent(url)}` });
NativeMedia.release = () => {};

function Fixture() {
  return <View style={{ flex: 1, padding: 12, gap: 8 }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
      <Button onPress={() => { void p.playList(songs); }}><Text>Start</Text></Button>
      <Button onPress={p.pause}><Text>Pause</Text></Button>
      <Button onPress={() => { void p.resumePlayback(); }}><Text>Resume</Text></Button>
      <Button onPress={() => { void p.retryPlayback(); }}><Text>Retry</Text></Button>
      <Button onPress={() => { void p.next(); }}><Text>Next</Text></Button>
      <Button onPress={() => p.seek(90)}><Text>Seek 90</Text></Button>
      <Button onPress={() => fail?.({ code: "network", message: "The player lost its source" })}><Text>Fail player</Text></Button>
    </View>
    <Text>{p.playbackPhase()}</Text>
    <Text>{`state:${JSON.stringify({ id: p.currentTrack()?.id, position: p.position(), playing: p.playing(), buffering: p.buffering(), phase: p.playbackPhase(), error: p.playbackError(), errorCode: p.playbackErrorCode() })}`}</Text>
  </View>;
}
mount(Fixture);
