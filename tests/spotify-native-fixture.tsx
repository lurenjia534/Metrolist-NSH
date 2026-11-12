import { cleanup, mount, signal, Text, View } from "nsh";
import { Button } from "nsh/base";
import { Spotify } from "metrolist/native";
import { cacheReady } from "../src/spotish/data/cache";
import { homeQuery } from "../src/spotish/data/queries";
import { activateSpotify, backend, workspaceActive } from "../src/spotish/state/engine";
import { accountId } from "../src/spotish/state/session";

const shown = signal(false);
const error = signal("");
const sent = signal("");
let native: Spotify | undefined;

async function rawVolume(value: number) {
  // A separate Rust handle changes the session. The displayed backend state
  // can learn of this only through its native onPlayer listener.
  native ??= new Spotify();
  await native.setVolume(value);
  sent.set(`raw-volume:${value.toFixed(2)}`);
}

function CachedWorkspace() {
  // This is the original race: the restored account makes homeQuery's
  // resource fetch synchronously during render, before activation's await.
  void activateSpotify().catch(reason => error.set(String(reason)));
  const home = homeQuery();
  return <View testID="cached-spotify-mounted">
    <Text>Cached workspace mounted</Text>
    <Text>{home.data()?.greeting || "Loading native home"}</Text>
    <Button testID="native-refetch" onPress={home.refetch}><Text>Refetch native home</Text></Button>
  </View>;
}

function Fixture() {
  cleanup(() => native?.dispose());
  return <View style={{ flex: 1, padding: 20, gap: 8 }}>
    <Text>{cacheReady() && accountId() === "demo" ? "Cached native account ready" : "Hydrating cached account"}</Text>
    <Text>{`backend:${backend.kind}`}</Text>
    <Text>{`health:${backend.health().status}`}</Text>
    <Text>{`native-volume:${backend.player().volume.toFixed(2)}`}</Text>
    <Text>{sent()}</Text>
    <Text>{error()}</Text>
    <Button testID="native-mount" onPress={() => shown.set(true)}><Text>Mount Spotify</Text></Button>
    <Button testID="native-unmount" onPress={() => { workspaceActive.set(false); shown.set(false); }}><Text>Unmount Spotify</Text></Button>
    <Button testID="native-volume-31" onPress={() => void rawVolume(0.31).catch(reason => error.set(String(reason)))}><Text>Set raw volume 31</Text></Button>
    <Button testID="native-volume-47" onPress={() => void rawVolume(0.47).catch(reason => error.set(String(reason)))}><Text>Set raw volume 47</Text></Button>
    <Button testID="native-volume-73" onPress={() => void rawVolume(0.73).catch(reason => error.set(String(reason)))}><Text>Set raw volume 73</Text></Button>
    <If when={shown()}><CachedWorkspace /></If>
  </View>;
}

mount(Fixture);
