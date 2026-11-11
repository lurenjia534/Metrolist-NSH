import { expect, open, test } from "nsh/test";
import type { StubRequest } from "nsh/test";

const profile = { name: "Login UI listener", email: "listener@example.test", channelHandle: "@login-ui", channelId: "login-ui", avatar: "" };
const credentials = { cookie: "SAPISID=login-ui-fixture", authUser: "0", dataSyncId: "login-ui-sync", visitorData: "login-ui-visitor" };
const account = { profile: { ...profile, id: "0:login-ui-sync", verifiedAt: 1 }, credentials,
  library: { playlists: [], liked: [], songs: [], albums: [], artists: [] }, lastSynced: 0 };
const storage = (connected = false) => ({
  "metrolist.settings": JSON.stringify({ autoRadio: false, apiBase: "https://gateway.test" }),
  "metrolist.accounts": JSON.stringify({ accounts: connected ? [account] : [], activeId: connected ? account.profile.id : "", syncEnabled: false, useAccountForBrowse: true }),
});
const network = {
  "GET https://gateway.test/api/home": { body: { sections: [] } },
  "GET https://gateway.test/api/account": { body: profile },
  "POST https://gateway.test/api/account/login": (request: StubRequest) => JSON.parse(request.body!).cookie.includes("expired")
    ? { status: 401, body: { error: "这份会话已过期，请重新取得会话后连接。" } }
    : { delay: 250, body: { account: profile, session: { authUser: "0", dataSyncId: "login-ui-sync", visitorData: "login-ui-visitor" } } },
  "GET https://gateway.test/api/account/library?type=*": (request: StubRequest) => ({ body: { type: new URL(request.url).searchParams.get("type"), items: [] } }),
};
test("Android 340 login shows progress and connects only after automatic verification", async () => {
  const app = await open("./account-native-ui-fixture.tsx", { width: 340, height: 640, platform: "android", clock: {}, storage: storage(), network });
  await app.press("id:header-account"); await app.waitFor("id:account-native-login");
  await app.waitUntil(() => app.enabled("id:account-native-login"));
  expect(app.shows("id:account-import")).toBe(false);
  expect(app.shows("id:account-get-android")).toBe(false);
  await app.press("id:account-native-login");
  expect(app.enabled("id:account-native-login")).toBe(false);
  await app.waitFor("等待 Google 登录完成");
  await app.clock!.runFor(500);
  await app.waitFor("正在连接 YouTube Music");
  expect(app.shows("id:account-name")).toBe(false);
  await app.clock!.runFor(251); await app.waitFor("id:account-name");
  expect(app.texts()).toContain(profile.name);
  expect(app.requests().filter(item => item.url.endsWith("account/login"))).toHaveLength(1);
  await app.press("id:account-open-library"); await app.waitFor("id:cloud-library");
});

test("adding an Android account closes the app dialog before native login and cancelling preserves the current account", async () => {
  const app = await open("../App.tsx", { width: 340, height: 640, platform: "android", clock: {}, storage: storage(true), network,
    host: { handlers: { "app.audio.settings": null, "app.audio.snapshot": null, "auth.available": { available: true }, "auth.login": { cancelled: true } } } });
  await app.press("id:header-account"); await app.waitFor("id:account-name");
  await app.press("id:account-add"); await app.waitFor("id:app-dialog");
  expect(app.shows("id:account-add-import")).toBe(false);
  await app.setViewport(740, 360);
  await app.waitUntil(() => app.shows("id:account-native-login") && app.enabled("id:account-native-login"));
  await app.press("id:account-native-login"); await app.waitFor("id:app-dialog", { state: "gone" });
  await app.waitUntil(() => app.enabled("id:account-add"));
  expect(app.shows("id:account-error")).toBe(false);
  expect(app.texts().some(text => text.includes("已取消此次登录"))).toBe(true);
  expect(JSON.parse(app.storage()["metrolist.accounts"]).activeId).toBe(account.profile.id);
  expect(app.texts()).toContain(profile.name);
  await app.back(); await app.waitFor("id:page-home");
});

test("web login explains the separate browser session, folds advanced import and keeps its error and retry usable at 340 points and in landscape", async () => {
  const app = await open("../App.tsx", { width: 340, height: 640, platform: "web", storage: storage(), network,
    host: { handlers: { "app.start": null } } });
  await app.press("id:header-account"); await app.waitFor("id:account-platform-login");
  expect(app.shows("id:account-native-login")).toBe(false);
  expect(app.shows("id:account-import")).toBe(false);
  await app.scroll("id:content-account", 200);
  await app.press("id:account-get-android"); await app.press("id:account-open-youtube");
  expect(app.openedUrls()).toEqual(["https://github.com/lurenjia534/Metrolist-NSH/releases", "https://music.youtube.com"]);
  expect(app.shows("id:account-name")).toBe(false);
  await app.press("id:account-advanced"); await app.waitFor("id:account-import");
  await app.press("id:account-import"); await app.waitFor("id:account-session-input");
  expect(app.enabled("id:account-verify-import")).toBe(false);
  await app.type("id:account-session-input", "SAPISID=fixture-expired");
  await app.press("id:account-verify-import"); await app.waitFor("id:account-import-error");
  expect(app.value("id:account-session-input")).toBe("SAPISID=fixture-expired");
  expect(app.enabled("id:account-verify-import")).toBe(true);
  await app.clear("id:account-session-input"); await app.type("id:account-session-input", JSON.stringify(credentials));
  await app.setViewport(740, 360); await app.scroll("id:app-dialog", 300);
  await app.press("id:account-verify-import"); await app.waitFor("id:account-name");
  await app.waitFor("id:app-dialog", { state: "gone" });
  expect(JSON.parse(app.storage()["metrolist.accounts"]).activeId).toBe(account.profile.id);
});
