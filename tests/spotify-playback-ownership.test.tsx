import { expect, open, test } from "nsh/test";

test("a queued YouTube ended event cannot advance playback after switching to Spotify", async () => {
  const first = {
    id: "ownership-first", title: "First workspace track", artist: "Workspace artist",
    album: "Independent queue", artwork: "", duration: 180, source: "youtube",
  };
  const second = { ...first, id: "ownership-second", title: "Second workspace track" };
  const playing = {
    requestId: 73, state: "playing", position: 179, duration: 180,
    bufferedPosition: 180, playing: true, buffering: false, playWhenReady: true,
  };
  const ended = { ...playing, state: "ended", position: 180, playing: false };
  const app = await open("../App.tsx", {
    width: 390,
    height: 844,
    platform: "android",
    storage: {
      "metrolist.settings": JSON.stringify({ autoRadio: false, apiBase: "https://gateway.test" }),
      "metrolist.player": JSON.stringify({ queue: [first, second], index: 0, position: 179, title: "Workspace queue" }),
      "spotify:firstRun:done": "1",
    },
    network: {
      "GET https://gateway.test/api/home": { body: { sections: [] } },
      "GET https://gateway.test/api/stream?id=*": { body: { url: "https://audio.test/ownership.m4a", mimeType: "audio/mp4", bitrate: 128000 } },
      "GET https://gateway.test/api/lyrics?*": { body: { plainLyrics: "", syncedLyrics: "", lines: [], instrumental: true } },
    },
    host: {
      params: { backend: "demo", premium: true },
      handlers: {
        "app.audio.settings": null,
        "app.audio.pause": null,
        "app.audio.play": null,
        "app.audio.open": null,
        "app.audio.snapshot": { ...playing, track: first },
        "auth.available": { available: false },
      },
    },
  });
  const opens = () => app.host.calls().filter(call => call.name === "app.audio.open");
  const plays = () => app.host.calls().filter(call => call.name === "app.audio.play");
  await app.waitFor("id:metrolist-app");
  await app.waitFor(first.title);

  await app.press("id:provider-spotify");
  await app.waitFor("id:spotify-demo-banner");
  expect(app.host.calls().some(call => call.name === "app.audio.pause")).toBe(true);
  // The native service can already have queued the old track's end when
  // the provider switch pauses it. Deliver that actual host callback late.
  await app.host.send("audio.state", ended);
  expect(opens()).toHaveLength(0);
  expect(plays()).toHaveLength(0);

  // Once YouTube owns playback again, a newly observed end still advances.
  await app.press("id:provider-youtube");
  await app.waitFor("id:metrolist-app");
  await app.waitFor(first.title);
  await app.host.send("audio.state", playing);
  await app.host.send("audio.state", ended);
  await app.waitUntil(() => opens().length === 1);
  expect(opens()[0].data).toMatchObject({ track: { id: second.id }, playWhenReady: true });
});
