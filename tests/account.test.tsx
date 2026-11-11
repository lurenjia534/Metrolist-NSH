import { expect, open, test } from "nsh/test";
import type { App, StubRequest } from "nsh/test";

const storage = { "metrolist.accounts": JSON.stringify({ accounts: [], activeId: "", syncEnabled: false, useAccountForBrowse: true }), "metrolist.library": "local-library-fixture" };
const profileA = { name: "Fixture A", email: "a@example.test", channelHandle: "@fixture-a", channelId: "channel-a", avatar: "" };
const profileB = { name: "Fixture B", email: "b@example.test", channelHandle: "@fixture-b", channelId: "channel-b", avatar: "" };
const alpha = { id: "alpha", title: "Alpha", artist: "Fixture artist", album: "Fixture album", artwork: "", duration: 120, source: "youtube" };
const beta = { ...alpha, id: "beta", title: "Beta" };
const gamma = { ...alpha, id: "gamma", title: "Gamma" };
const read = (app: App, key: string) => JSON.parse(app.texts().find(text => text.startsWith(`${key}:`))!.slice(key.length + 1));
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
  await app.press("Show account page"); await app.press("id:account-import");
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
  const app = await open("./account-fixture.tsx", { width: 390, height: 844, platform: "android", storage, network: network(), host: { handlers: {
    "auth.available": { available: true, method: "webview" },
    "auth.login": { cookie: "SAPISID=fixture-a", visitorData: "native-visitor", dataSyncId: "native-sync", authUser: "0" },
    "auth.logout": null,
  } } });
  expect(read(app, "account").available).toBe(true);
  await app.press("Native login");
  expect(read(app, "account")).toMatchObject({ name: "Fixture A", signedIn: true, activeId: "0:native-sync" });
  expect(app.host.calls().find(call => call.name === "auth.login")?.data).toEqual({ url: "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmusic.youtube.com" });
  const login = app.requests().find(request => request.url.endsWith("/account/login"))!;
  expect(JSON.parse(login.body!)).toMatchObject({ cookie: "SAPISID=fixture-a", visitorData: "native-visitor", dataSyncId: "native-sync" });
  await app.press("Logout");
  expect(app.host.calls().filter(call => call.name === "auth.logout")).toHaveLength(1);
  expect(read(app, "account").signedIn).toBe(false);
});

test("original Metrolist and Netscape session imports retain the owner session fields and filter unrelated cookies", async () => {
  const app = await open("./account-fixture.tsx", { width: 1280, height: 900, platform: "web", storage, network: network() });
  await app.press("Import original");
  expect(JSON.parse(app.requests().find(request => request.url.endsWith("/account/login"))!.body!)).toMatchObject({ cookie: "SAPISID=fixture-a", visitorData: "fixture-visitor", dataSyncId: "fixture-a-sync", authUser: "0" });
  await app.press("Logout"); await app.press("Import Netscape");
  expect(JSON.parse(app.requests().filter(request => request.url.endsWith("/account/login")).at(-1)!.body!).cookie).toBe("SAPISID=fixture-a");
  expect(read(app, "account").signedIn).toBe(true);
});
