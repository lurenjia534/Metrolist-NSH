import { mount, signal, Text, View } from "nsh";
import { Button } from "nsh/base";
import { api } from "../server/index.mjs";
import { accountRequest, setApiOrigin } from "../src/api";

const accountA = { cookie: "SAPISID=fixture-native-A", visitorData: "native-visitor-A", dataSyncId: "native-channel-A", authUser: "0" };
const accountB = { cookie: "SAPISID=fixture-native-B", visitorData: "native-visitor-B", dataSyncId: "native-channel-B", authUser: "1" };
const state = signal("Ready");
const result = signal<unknown>(null);
const error = signal("");
const run = async (work: () => unknown) => {
  state.set("Working"); error.set("");
  try { result.set(await work()); } catch (reason) { error.set(reason instanceof Error ? reason.message : String(reason)); }
  state.set("Done");
};

function Fixture() {
  setApiOrigin("");
  const commands: { name: string; work: () => unknown }[] = [
    { name: "Native profile", work: () => accountRequest("account", accountA) },
    { name: "Native two accounts", work: () => Promise.all([accountA, accountB].map(account => accountRequest("account", account))) },
    { name: "Native audio sources", work: () => Promise.all([accountA, accountB].map(account => accountRequest("stream?id=native-fixture-audio&quality=high&container=mp4", account))) },
    { name: "Issued browser source", work: async () => {
      const streamResponse = await api(new Request("https://web.test/api/stream?id=native-fixture-source&container=mp4", {
        headers: { "X-Metrolist-Account": encodeURIComponent(JSON.stringify(accountA)) },
      }));
      const stream = await streamResponse.json() as { url: string; error?: string };
      if (!streamResponse.ok) throw new Error(stream.error);
      const audio = await api(new Request(stream.url, { headers: { Range: "bytes=2-5" } }));
      return { stream, status: audio.status, body: await audio.text(), range: audio.headers.get("content-range") };
    } },
    { name: "Native anonymous account", work: async () => {
      const response = await api(new Request("https://metrolist.local/api/account"), { directStreams: true });
      return { status: response.status, body: await response.json() };
    } },
  ];
  return <View style={{ flex: 1, padding: 20, gap: 12 }}>
    <Text>{state()}</Text>
    <Each of={commands}>{command => <Button onPress={() => void run(command().work)}><Text>{command().name}</Text></Button>}</Each>
    <Text>{`result:${JSON.stringify(result())}`}</Text>
    <Text>{`error:${error()}`}</Text>
  </View>;
}
mount(Fixture);
