import { host, mount, signal, Text, View } from "nsh";
import { Button, Input } from "nsh/base";
import * as account from "../../src/account";
import { setApiOrigin } from "../../src/api";

const fixtureError = signal("");
const calls = signal<unknown[]>([]);
const eventText = signal("");
const run = async (work: () => unknown) => { fixtureError.set(""); try { await work(); } catch (reason) { fixtureError.set(reason instanceof Error ? reason.message : String(reason)); } };
host.on("test.calls", value => calls.set(value as unknown[]));

function Fixture() {
  setApiOrigin("https://gateway.test");
  void run(account.initializeAccounts);
  return <View style={{ padding: 16, gap: 8 }}>
    <Button onPress={() => void run(account.loginNative)}><Text>Native login</Text></Button>
    <Button onPress={() => void run(() => host.call("auth.test.cancel"))}><Text>Cancel native</Text></Button>
    <Button onPress={() => void run(() => account.importSession({ cookie: "SAPISID=fixture-a", authUser: "0" }))}><Text>Import A</Text></Button>
    <Button onPress={() => void run(() => account.logoutAccount())}><Text>Logout</Text></Button>
    <Input testID="native-event-input" value={eventText()} onChange={({ value }) => eventText.set(value)} />
    <Button onPress={() => void run(() => host.call("auth.test.emit", JSON.parse(eventText())))}><Text>Send native event</Text></Button>
    <Text style={{ numberOfLines: 1 }}>{`account:${JSON.stringify({ name: account.currentAccount()?.name, signedIn: account.signedIn(), activeId: account.activeId(), names: account.accounts().map(item => item.name), state: account.sessionStatus(), available: account.nativeLoginAvailable(), nativeReady: account.nativeLoginReady(), nativeStage: account.nativeLoginStage(), nativeMessage: account.nativeLoginMessage(), busy: account.busy(), status: account.status(), error: account.error(), fixtureError: fixtureError() })}`}</Text>
    <Text style={{ numberOfLines: 1 }}>{`nativecalls:${JSON.stringify(calls())}`}</Text>
  </View>;
}
mount(Fixture);
