import { expect, open, test } from "nsh/test";
import type { App, StubRequest } from "nsh/test";

// Every URL is handled by NSH's test network. Artificial account cookies never
// leave the test engine; this is a runtime integration test, not a Google login.
const header = (request: StubRequest, name: string) => Object.entries(request.headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
const identity = (request: StubRequest) => header(request, "Cookie")?.includes("native-B") ? "B" : "A";
const network = {
  "POST https://music.youtube.com/youtubei/v1/account/account_menu?prettyPrint=false": (request: StubRequest) => ({ body: {
    activeAccountHeaderRenderer: { accountName: { simpleText: `Native ${identity(request)}` },
      email: { simpleText: `native-${identity(request)}@example.test` }, accountPhoto: { thumbnails: [{ url: "https://images.test/avatar.jpg" }] } },
  } }),
  "POST https://music.youtube.com/youtubei/v1/player?prettyPrint=false": (request: StubRequest) => ({ body: {
    playabilityStatus: { status: "OK" }, videoDetails: { title: `Private ${identity(request)}`, author: "Fixture", isPrivate: true, lengthSeconds: "60" },
    streamingData: { expiresInSeconds: "3600", adaptiveFormats: [{
      itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000, audioSampleRate: "44100", contentLength: "8",
      url: `https://audio.test/${identity(request)}.m4a?expire=1700003600&signature=fixture-${identity(request)}`,
    }] },
  } }),
  "GET https://audio.test/A.m4a?*": { status: 206,
    headers: { "Content-Type": "audio/mp4", "Content-Length": "4", "Content-Range": "bytes 2-5/8" }, body: "2345" },
};
const read = (app: App) => JSON.parse(app.texts().find(text => text.startsWith("result:"))!.slice(7));
const openFixture = () => open("./gateway-native-fixture.tsx", { width: 1000, height: 900, platform: "android", clock: { time: 1700000000000 }, network });

test("NSH native dispatcher imports the shared account code and computes real SHA-1 authentication", async () => {
  const app = await openFixture();
  await app.press("Native profile"); await app.waitFor("Done");
  expect(app.texts().find(text => text.startsWith("error:"))).toBe("error:");
  expect(read(app)).toMatchObject({ id: "native-channel-A", name: "Native A", email: "native-A@example.test" });
  const requests = app.requests();
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe("https://music.youtube.com/youtubei/v1/account/account_menu?prettyPrint=false");
  // The account's cookie with a PREF carrying the request's language and region (InnertubeX).
  expect(header(requests[0], "Cookie")).toBe("SAPISID=fixture-native-A; PREF=hl=zh-CN&gl=US");
  expect(header(requests[0], "Authorization")).toBe("SAPISIDHASH 1700000000_93a26163874abe823fbcc69c37b6e10403e851e2");
  expect(header(requests[0], "X-Goog-AuthUser")).toBe("0");
  expect(JSON.parse(requests[0].body!).context).toMatchObject({
    client: { clientName: "WEB_REMIX", visitorData: "native-visitor-A" },
    user: { onBehalfOfUser: "native-channel-A" },
  });
});

test("NSH native requests retain separate account and channel identities without a localhost gateway", async () => {
  const app = await openFixture();
  await app.press("Native two accounts"); await app.waitFor("Done");
  expect(app.texts().find(text => text.startsWith("error:"))).toBe("error:");
  expect(read(app).map((value: { name: string }) => value.name)).toEqual(["Native A", "Native B"]);
  expect(app.requests()).toHaveLength(2);
  const b = app.requests().find(request => identity(request) === "B")!;
  expect(header(b, "X-Goog-AuthUser")).toBe("1");
  expect(JSON.parse(b.body!).context.user.onBehalfOfUser).toBe("native-channel-B");
  expect(app.requests().some(request => request.url.includes("localhost") || request.url.includes("127.0.0.1") || request.url.includes("metrolist.local"))).toBe(false);
});

test("NSH native audio resolution returns account-specific signed AAC sources and real format metadata", async () => {
  const app = await openFixture();
  await app.press("Native audio sources"); await app.waitFor("Done");
  expect(app.texts().find(text => text.startsWith("error:"))).toBe("error:");
  const [a, b] = read(app);
  expect(new URL(a.url).origin + new URL(a.url).pathname).toBe("https://audio.test/A.m4a");
  expect(new URL(b.url).origin + new URL(b.url).pathname).toBe("https://audio.test/B.m4a");
  expect(new URL(a.url).searchParams.get("signature")).toBe("fixture-A");
  expect(new URL(a.url).searchParams.get("cpn")!.length).toBe(16);
  expect(a).toMatchObject({ client: "WEB_REMIX", authenticated: true, mimeType: "audio/mp4", codecs: "mp4a.40.2", formatId: "140", bitrate: 128000, sampleRate: 44100, duration: 60 });
  expect(a.cacheKey.endsWith(":native-fixture-audio:140:8")).toBe(true);
  expect(a.cacheKey === b.cacheKey).toBe(false);
  expect(a).toMatchObject({ expiresAt: 1700003600000,
    headers: { Origin: "https://music.youtube.com", Referer: "https://music.youtube.com/", Accept: "*/*" } });
  expect(a.headers["User-Agent"]).toContain("Firefox/140.0");
  expect(app.requests()).toHaveLength(2);
});

test("NSH executes issued browser audio references with Range and no second resolver or Google cookie", async () => {
  const app = await openFixture();
  await app.press("Issued browser source"); await app.waitFor("Done");
  expect(app.texts().find(text => text.startsWith("error:"))).toBe("error:");
  const result = read(app);
  expect(result).toMatchObject({ status: 206, body: "2345", range: "bytes 2-5/8" });
  expect(new URL(result.stream.url).origin).toBe("https://web.test");
  expect(new URL(new URL(result.stream.url).searchParams.get("source")!).pathname).toBe("/A.m4a");
  expect(app.requests().filter(request => request.url.includes("/youtubei/v1/player"))).toHaveLength(1);
  const audio = app.requests().find(request => request.url.startsWith("https://audio.test/"))!;
  expect(header(audio, "Range")).toBe("bytes=2-5");
  expect(header(audio, "Origin")).toBe("https://music.youtube.com");
  expect(header(audio, "Referer")).toBe("https://music.youtube.com/");
  expect(header(audio, "Cookie")).toBe(undefined);
  expect(header(audio, "Authorization")).toBe(undefined);
});

test("NSH native anonymous account response reports the missing session without external requests", async () => {
  const app = await openFixture();
  await app.press("Native anonymous account"); await app.waitFor("Done");
  expect(read(app).status).toBe(401);
  expect(app.requests()).toHaveLength(0);
});

test("native playback preserves a long Retry-After and the actual 429 stage without retrying", async () => {
  const app = await open("./gateway-native-fixture.tsx", { width: 1000, height: 900, platform: "android", network: {
    ...network, "POST https://music.youtube.com/youtubei/v1/player?prettyPrint=false": {
      status: 429, headers: { "Retry-After": "30" }, body: "Too many requests",
    },
  } });
  await app.press("Native playback error"); await app.waitFor("Done");
  expect(read(app)).toMatchObject({ status: 429, code: "rate-limited", stage: "player", retryAfterMs: 30000 });
  expect(app.requests()).toHaveLength(1);
});

test("native playback can retry one explicit zero-delay 429 using the shared resolver", async () => {
  let attempts = 0;
  const app = await open("./gateway-native-fixture.tsx", { width: 1000, height: 900, platform: "android", network: {
    ...network, "POST https://music.youtube.com/youtubei/v1/player?prettyPrint=false": (request: StubRequest) => ++attempts === 1
      ? { status: 429, headers: { "Retry-After": "0" }, body: "Wait" }
      : network["POST https://music.youtube.com/youtubei/v1/player?prettyPrint=false"](request),
  } });
  await app.press("Native playback error"); await app.waitFor("Done");
  expect(app.texts().find(text => text.startsWith("error:"))).toBe("error:");
  expect(read(app).url.startsWith("https://audio.test/A.m4a")).toBe(true);
  expect(app.requests()).toHaveLength(2);
});
