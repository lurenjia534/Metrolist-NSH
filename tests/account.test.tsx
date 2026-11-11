import { expect, open, test } from "nsh/test";
import type { App, StubRequest } from "nsh/test";

const storage = { "metrolist.accounts": JSON.stringify({ accounts: [], activeId: "", syncEnabled: false, useAccountForBrowse: true }), "metrolist.library": "local-library-fixture" };
const profileA = { name: "Fixture A", email: "a@example.test", channelHandle: "@fixture-a", channelId: "channel-a", avatar: "" };
const profileB = { name: "Fixture B", email: "b@example.test", channelHandle: "@fixture-b", channelId: "channel-b", avatar: "" };
const alpha = { id: "alpha", title: "Alpha", artist: "Fixture artist", album: "Fixture album", artwork: "", duration: 120, source: "youtube" };
const beta = { ...alpha, id: "beta", title: "Beta" };
const gamma = { ...alpha, id: "gamma", title: "Gamma" };
const read = (app: App, key: string) => JSON.parse(app.texts().find(text => text.startsWith(`${key}:`))!.slice(key.length + 1));
const nativeCalls = (app: App, name: string) => (read(app, "nativecalls") as { name: string; data: any }[]).filter(call => call.name === name);
const sendNative = async (app: App, event: string, payload: unknown) => {
  const before = nativeCalls(app, "auth.test.emit").length;
  await app.clear("id:native-event-input");
  await app.type("id:native-event-input", JSON.stringify({ event, payload }));
  await app.press("Send native event");
  await app.waitUntil(() => nativeCalls(app, "auth.test.emit").length > before);
};
const credentials = (request: StubRequest) => JSON.parse(decodeURIComponent(Object.entries(request.headers).find(([key]) => key.toLowerCase() === "x-metrolist-account")![1]));
function network() {
  let liked = [alpha, beta];
  return {
    "POST https://gateway.test/api/account/login": (request: StubRequest) => {
      const session = JSON.parse(request.body!);
      if (session.cookie.includes("expired")) return { status: 401, body: { error: "Fixture session expired" } };
      return { body: { account: session.authUser === "1" ? profileB : profileA, session: { authUser: session.authUser || "0", visitorData: session.visitorData || "fixture-visitor", dataSyncId: session.dataSyncId || (session.authUser === "1" ? "fixture-b-sync" : "fixture-a-sync") } } };
    },
    "GET https://gateway.test/api/account": (request: StubRequest) => ({ body: credentials(request).authUser === "1" ? profileB : profileA }),
    "GET https://gateway.test/api/account/channels": { body: { accounts: [
      { ...profileA, authUser: "0", dataSyncId: "fixture-a-sync", selected: true }, { ...profileB, authUser: "1", dataSyncId: "fixture-b-sync", selected: false },
    ] } },
    "GET https://gateway.test/api/account/library?type=*": (request: StubRequest) => {
      const url = new URL(request.url), type = url.searchParams.get("type"), next = url.searchParams.get("continuation");
      return { body: { type, items: type === "liked" ? (next ? liked.slice(1) : liked.slice(0, 1)) : [], ...(type === "liked" && !next && liked.length > 1 ? { continuation: "page-two" } : {}) } };
    },
    "POST https://gateway.test/api/account/like": (request: StubRequest) => {
      const input = JSON.parse(request.body!);
      if (input.id === "rejected") return { status: 403, body: { error: "Fixture change rejected" } };
      liked = input.liked ? [gamma, ...liked] : liked.filter(item => item.id !== input.id);
      return { body: { ok: true, ...input } };
    },
  };
}

test("web account page imports and verifies the owner's session then removes only its local account", async () => {
  const app = await open("./account-fixture.tsx", { width: 1280, height: 980, platform: "web", storage, network: network() });
  await app.press("Show account page"); await app.press("id:account-advanced"); await app.waitFor("id:account-import"); await app.press("id:account-import");
  await app.type("id:account-session-input", JSON.stringify({ cookie: "SAPISID=fixture-a", authUser: "0" }));
  await app.press("id:account-verify-import"); await app.waitFor("id:account-name");
  expect(read(app, "account")).toMatchObject({ name: "Fixture A", signedIn: true, state: "connected" });
  const login = app.requests().find(request => request.url.endsWith("/account/login"))!;
  expect(credentials(login).cookie).toBe("SAPISID=fixture-a");
  expect(app.requests().every(request => !request.url.includes("SAPISID"))).toBe(true);
  const saved = JSON.parse(app.storage()["metrolist.accounts"]);
  expect(saved.accounts[0].profile.name).toBe("Fixture A");
  expect(saved.accounts[0].credentials.visitorData).toBe("fixture-visitor");
  await app.press("label:退出此账号"); await app.press("label:退出并移除本机会话");
  expect(read(app, "account").signedIn).toBe(false);
  expect(JSON.parse(app.storage()["metrolist.accounts"]).accounts).toHaveLength(0);
  expect(app.storage()["metrolist.library"]).toBe("local-library-fixture");
});

test("failed session validation never creates an account or reports a successful login", async () => {
  const app = await open("./account-fixture.tsx", { width: 1280, height: 900, platform: "web", storage, network: network() });
  await app.press("Import expired");
  expect(read(app, "account")).toMatchObject({ signedIn: false, names: [], state: "none", error: "Fixture session expired" });
  expect(read(app, "account").status.includes("已连接")).toBe(false);
  expect(JSON.parse(app.storage()["metrolist.accounts"]).accounts).toHaveLength(0);
});

test("account and channel switching validates the new credentials and sends the selected session on later requests", async () => {
  const app = await open("./account-fixture.tsx", { width: 1280, height: 900, platform: "web", storage, network: network() });
  await app.press("Import A"); await app.press("Import B");
  expect(read(app, "account").names).toEqual(["Fixture B", "Fixture A"]);
  await app.press("Use A"); await app.press("Refresh account");
  expect(read(app, "account")).toMatchObject({ name: "Fixture A", state: "connected" });
  await app.press("Load channels"); await app.press("Select channel"); await app.press("Load liked");
  expect(read(app, "account").name).toBe("Fixture B");
  const lastLibrary = app.requests().filter(request => request.url.includes("account/library")).at(-1)!;
  expect(credentials(lastLibrary)).toMatchObject({ authUser: "1", dataSyncId: "fixture-b-sync" });
  expect(JSON.parse(app.storage()["metrolist.accounts"]).activeId).toBe("1:fixture-b-sync");
});

test("full cloud synchronization preserves later pages across like changes and rolls back rejected optimistic likes", async () => {
  const app = await open("./account-fixture.tsx", { width: 1280, height: 900, platform: "web", storage, network: network() });
  await app.press("Import A"); await app.press("Sync library"); await app.press("Load liked");
  expect(read(app, "cloud").ids).toEqual(["alpha", "beta"]);
  expect(read(app, "cloud").lastSynced > 0).toBe(true);
  await app.press("Like gamma");
  expect(read(app, "cloud").liked.sort()).toEqual(["alpha", "beta", "gamma"]);
  await app.press("Unlike alpha");
  expect(read(app, "cloud").liked.sort()).toEqual(["beta", "gamma"]);
  expect(read(app, "cloud").ids.sort()).toEqual(["beta", "gamma"]);
  await app.press("Like rejected");
  expect(read(app, "cloud").liked.sort()).toEqual(["beta", "gamma"]);
  expect(read(app, "account").error).toBe("Fixture change rejected");
  expect(JSON.parse(app.storage()["metrolist.accounts"]).accounts[0].library.liked.map((item: { id: string }) => item.id).sort()).toEqual(["beta", "gamma"]);
});

test("Android login uses the host WebView session, validates it with the account API and clears its app session on logout", async () => {
  const app = await open("./native-login/fixture.tsx", { width: 390, height: 844, platform: "android", storage, network: network() });
  expect(read(app, "account")).toMatchObject({ available: true, nativeReady: true });
  await app.press("Native login");
  expect(read(app, "account")).toMatchObject({ signedIn: false, nativeStage: "opening", busy: true });
  expect(nativeCalls(app, "auth.login")[0]?.data).toEqual({ requestId: 1, selectAccount: false });
  await sendNative(app, "auth.progress", { requestId: 1, stage: "waiting", message: "Complete Google login" });
  await app.waitUntil(() => read(app, "account").nativeStage === "waiting");
  expect(read(app, "account")).toMatchObject({ nativeStage: "waiting", nativeMessage: "Complete Google login" });
  await sendNative(app, "auth.session", { requestId: 1, attemptId: "native-a", credentials: { cookie: "SAPISID=fixture-a", visitorData: "native-visitor", dataSyncId: "native-sync", authUser: "0" } });
  await app.waitUntil(() => !read(app, "account").busy);
  expect(read(app, "account")).toMatchObject({ name: "Fixture A", signedIn: true, activeId: "0:native-sync" });
  expect(nativeCalls(app, "auth.complete").map(call => call.data)).toEqual([{ attemptId: "native-a", ok: true, name: "Fixture A" }]);
  const login = app.requests().find(request => request.url.endsWith("/account/login"))!;
  expect(JSON.parse(login.body!)).toMatchObject({ cookie: "SAPISID=fixture-a", visitorData: "native-visitor", dataSyncId: "native-sync" });
  await app.press("Logout");
  expect(nativeCalls(app, "auth.logout")).toHaveLength(1);
  expect(read(app, "account").signedIn).toBe(false);
});

test("cancelling native login is a normal outcome and never verifies or clears the saved Google session", async () => {
  const app = await open("./native-login/fixture.tsx", { platform: "android", storage, network: network() });
  await app.press("Native login");
  await app.press("Cancel native");
  await app.waitUntil(() => !read(app, "account").busy);
  expect(read(app, "account")).toMatchObject({ signedIn: false, state: "none", busy: false, nativeStage: "idle", error: "", fixtureError: "" });
  expect(app.requests().filter(request => request.url.endsWith("/account/login"))).toHaveLength(0);
  expect(nativeCalls(app, "auth.logout")).toHaveLength(0);
});

test("a failed native session stays open for an explicit retry and repeated candidate events share one verification", async () => {
  const app = await open("./native-login/fixture.tsx", { platform: "android", storage, network: network() });
  await app.press("Native login");
  const rejected = { requestId: 1, attemptId: "expired", credentials: { cookie: "SAPISID=fixture-expired" } };
  await sendNative(app, "auth.session", rejected);
  await app.waitUntil(() => nativeCalls(app, "auth.complete").length === 1);
  expect(read(app, "account")).toMatchObject({ signedIn: false, busy: true, nativeStage: "error", nativeMessage: "Fixture session expired" });
  expect(JSON.parse(app.storage()["metrolist.accounts"]).accounts).toHaveLength(0);
  await sendNative(app, "auth.session", rejected);
  expect(app.requests().filter(request => request.url.endsWith("/account/login"))).toHaveLength(1);
  expect(nativeCalls(app, "auth.complete").map(call => call.data)).toEqual([{ attemptId: "expired", ok: false, message: "Fixture session expired", status: 401 }]);
  await sendNative(app, "auth.session", { requestId: 1, attemptId: "retry", credentials: { cookie: "SAPISID=fixture-a" } });
  await app.waitUntil(() => !read(app, "account").busy);
  expect(read(app, "account")).toMatchObject({ signedIn: true, name: "Fixture A", busy: false, nativeStage: "idle", error: "" });
  expect(app.requests().filter(request => request.url.endsWith("/account/login"))).toHaveLength(2);
});

test("cancel during account verification discards its late response without saving a different account", async () => {
  const app = await open("./native-login/fixture.tsx", { platform: "android", storage, clock: {}, network: {
    ...network(), "POST https://gateway.test/api/account/login": { delay: 2000, body: { account: profileB, session: { authUser: "1", visitorData: "b", dataSyncId: "b" } } },
  } });
  await app.press("Native login");
  await sendNative(app, "auth.session", { requestId: 1, attemptId: "cancelled", credentials: { cookie: "SAPISID=fixture-b", authUser: "1" } });
  await app.waitUntil(() => read(app, "account").nativeStage === "verifying");
  expect(read(app, "account")).toMatchObject({ state: "none", nativeStage: "verifying", signedIn: false, busy: true });
  await app.press("Cancel native");
  await app.waitUntil(() => !read(app, "account").busy);
  await app.clock!.runFor(2500);
  expect(read(app, "account")).toMatchObject({ state: "none", signedIn: false, busy: false, error: "", fixtureError: "" });
  expect(nativeCalls(app, "auth.complete")).toHaveLength(0);
  expect(JSON.parse(app.storage()["metrolist.accounts"]).accounts).toHaveLength(0);
});

test("adding an account requests the Google account chooser and cancelling preserves the verified current account", async () => {
  const app = await open("./native-login/fixture.tsx", { platform: "android", storage, network: network() });
  await app.press("Import A");
  const saved = app.storage()["metrolist.accounts"];
  await app.press("Native login");
  await app.press("Cancel native");
  await app.waitUntil(() => !read(app, "account").busy);
  expect(nativeCalls(app, "auth.login")[0]?.data).toEqual({ requestId: 1, selectAccount: true });
  expect(read(app, "account")).toMatchObject({ name: "Fixture A", state: "connected", signedIn: true, busy: false, error: "" });
  expect(app.storage()["metrolist.accounts"]).toBe(saved);
});

test("a new native login ignores session and progress events from a cancelled window", async () => {
  const app = await open("./native-login/fixture.tsx", { platform: "android", storage, network: network() });
  await app.press("Native login");
  await app.press("Cancel native");
  await app.waitUntil(() => !read(app, "account").busy);
  await sendNative(app, "auth.progress", { requestId: 1, stage: "waiting", message: "old" });
  await app.press("Native login");
  await sendNative(app, "auth.session", { requestId: 1, attemptId: "old", credentials: { cookie: "SAPISID=fixture-b", authUser: "1" } });
  await sendNative(app, "auth.progress", { requestId: 1, stage: "error", message: "old" });
  expect(read(app, "account")).toMatchObject({ nativeStage: "opening", signedIn: false, busy: true });
  expect(app.requests().filter(request => request.url.endsWith("/account/login"))).toHaveLength(0);
  await sendNative(app, "auth.session", { requestId: 2, attemptId: "new", credentials: { cookie: "SAPISID=fixture-a" } });
  await app.waitUntil(() => !read(app, "account").busy);
  expect(read(app, "account")).toMatchObject({ name: "Fixture A", signedIn: true, busy: false });
  expect(app.requests().filter(request => request.url.endsWith("/account/login"))).toHaveLength(1);
});

test("cancel keeps the current account's completed startup refresh instead of restoring an obsolete verifying state", async () => {
  const saved = { profile: { ...profileA, id: "0:a", verifiedAt: 1 }, credentials: { cookie: "SAPISID=fixture-a", authUser: "0", dataSyncId: "a" }, library: { playlists: [], liked: [], songs: [], albums: [], artists: [] }, lastSynced: 0 };
  const app = await open("./native-login/fixture.tsx", { platform: "android", clock: {}, storage: {
    ...storage, "metrolist.accounts": JSON.stringify({ accounts: [saved], activeId: "0:a", syncEnabled: false, useAccountForBrowse: true }),
  }, network: { ...network(), "GET https://gateway.test/api/account": { delay: 1000, body: profileA } } });
  expect(read(app, "account").state).toBe("verifying");
  await app.press("Native login");
  await app.clock!.runFor(1200);
  expect(read(app, "account").state).toBe("connected");
  await app.press("Cancel native");
  await app.waitUntil(() => !read(app, "account").busy);
  expect(read(app, "account")).toMatchObject({ state: "connected", name: "Fixture A", signedIn: true, error: "", busy: false });
});

test("original Metrolist and Netscape session imports retain the owner session fields and filter unrelated cookies", async () => {
  const app = await open("./account-fixture.tsx", { width: 1280, height: 900, platform: "web", storage, network: network() });
  await app.press("Import original");
  expect(JSON.parse(app.requests().find(request => request.url.endsWith("/account/login"))!.body!)).toMatchObject({ cookie: "SAPISID=fixture-a", visitorData: "fixture-visitor", dataSyncId: "fixture-a-sync", authUser: "0" });
  await app.press("Logout"); await app.press("Import Netscape");
  expect(JSON.parse(app.requests().filter(request => request.url.endsWith("/account/login")).at(-1)!.body!).cookie).toBe("SAPISID=fixture-a");
  expect(read(app, "account").signedIn).toBe(true);
});
