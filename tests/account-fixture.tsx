import { mount, Scroll, signal, Text, View } from "nsh";
import { Button } from "nsh/base";
import * as account from "../src/account";
import { setApiOrigin } from "../src/api";
import { AccountPage } from "../src/pages/Account";

const fixtureError = signal("");
const showPage = signal(false);
const ready = signal(false);
const run = async (work: () => unknown) => { fixtureError.set(""); try { await work(); } catch (reason) { fixtureError.set(reason instanceof Error ? reason.message : String(reason)); } };

function Fixture() {
  setApiOrigin("https://gateway.test");
  void run(async () => { await account.initializeAccounts(); ready.set(true); });
  const commands: { name: string; work: () => unknown }[] = [
    { name: "Show account page", work: () => showPage.set(true) },
    { name: "Import A", work: () => account.importSession({ cookie: "SAPISID=fixture-a", authUser: "0" }) },
    { name: "Import B", work: () => account.importSession({ cookie: "SAPISID=fixture-b", authUser: "1" }) },
    { name: "Import expired", work: () => account.importSession("Cookie: SAPISID=fixture-expired") },
    { name: "Import original", work: () => account.importSession("***INNERTUBE COOKIE*** =SAPISID=fixture-a\n***VISITOR DATA*** =fixture-visitor\n***DATASYNC ID*** =fixture-a-sync\n***AUTH USER*** =0") },
    { name: "Import Netscape", work: () => account.importSession("# Netscape HTTP Cookie File\n#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tSAPISID\tfixture-a\n.other.test\tTRUE\t/\tTRUE\t0\tIGNORED\tother") },
    { name: "Use A", work: () => account.activateAccount(account.accounts().find(item => item.name === "Fixture A")!.id) },
    { name: "Native login", work: account.loginNative },
    { name: "Refresh account", work: account.refreshAccount },
    { name: "Load channels", work: account.loadChannels },
    { name: "Select channel", work: () => account.selectChannel(account.channels()[1]) },
    { name: "Load liked", work: () => account.loadCloudLibrary("liked") },
    { name: "Load more", work: account.loadMoreCloudLibrary },
    { name: "Sync library", work: account.syncLibrary },
    { name: "Unlike alpha", work: () => account.setLike("alpha", false) },
    { name: "Like gamma", work: () => account.setLike("gamma", true) },
    { name: "Like rejected", work: () => account.setLike("rejected", true) },
    { name: "Logout", work: () => account.logoutAccount() },
  ];
  return <View style={{ flex: 1, padding: 16, gap: 8 }}>
    <Text>{ready() ? "Ready" : "Initializing"}</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}><Each of={commands}>{command => <Button onPress={() => void run(command().work)}><Text>{command().name}</Text></Button>}</Each></View>
    <Text>{`account:${JSON.stringify({ name: account.currentAccount()?.name, signedIn: account.signedIn(), activeId: account.activeId(), names: account.accounts().map(item => item.name), state: account.sessionStatus(), available: account.nativeLoginAvailable(), status: account.status(), error: account.error(), fixtureError: fixtureError() })}`}</Text>
    <Text>{`cloud:${JSON.stringify({ type: account.cloudType(), ids: account.cloudItems().map(item => item.id), liked: account.cloudLikedIds(), syncing: account.syncing(), lastSynced: account.lastSynced(), continuation: account.cloudContinuation(), channels: account.channels().map(item => item.name) })}`}</Text>
    <Scroll style={{ flex: 1 }} contentStyle={{ paddingBottom: 30 }}><If when={showPage()}><AccountPage /></If></Scroll>
  </View>;
}
mount(Fixture);
