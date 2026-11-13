import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAudioFormat, RANGE_CHUNK_BYTES, resolveWorkerAudio, streamMetadata } from './streaming.mjs';
import { retryAfterMilliseconds, withPrefCookie } from './catalog.mjs';

// www.youtube.com/sw.js_data as InnertubeX reads it: the visitor at [0][2][0][0][13].
const serviceWorker = visitor => new Response(")]}'\n" + JSON.stringify([['yt.sw.adr', null, [[[...Array(13).fill(null), visitor]]]]]));
import { api } from './index.mjs';

const formats = [
  { itag: 139, mimeType: 'audio/mp4; codecs="mp4a.40.5"', bitrate: 50270, audioSampleRate: '22050', audioChannels: 2, url: 'https://audio.test/139' },
  { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 131021, audioSampleRate: '44100', audioChannels: 2, url: 'https://audio.test/140' },
  { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 146959, audioSampleRate: '48000', audioChannels: 2, url: 'https://audio.test/251' },
  { itag: 137, mimeType: 'video/mp4; codecs="avc1"', bitrate: 2000000, url: 'https://audio.test/video' },
];

test('quality settings select actual low AAC, compatible AAC, or highest audio bitrate', () => {
  assert.equal(chooseAudioFormat(formats, 'low').itag, 139);
  assert.equal(chooseAudioFormat(formats, 'medium').itag, 140);
  assert.equal(chooseAudioFormat(formats, 'auto').itag, 251);
  assert.equal(chooseAudioFormat(formats, 'high').itag, 251);
  assert.equal(chooseAudioFormat(formats, 'high', 'mp4').itag, 140);
});

test('a default/original audio track wins over a higher-bitrate dubbed track', () => {
  const original = { ...formats[1], audioTrack: { audioIsDefault: true } };
  const dub = { ...formats[2], bitrate: 256000, audioTrack: { audioIsDefault: false } };
  assert.equal(chooseAudioFormat([original, dub], 'high').itag, 140);
  // protobuf {1: {1: "acont", 2: "original"}}, the same xtags field used upstream.
  const tagged = { ...formats[1], xtags: btoa('\x0a\x11\x0a\x05acont\x12\x08original') };
  assert.equal(chooseAudioFormat([tagged, dub], 'high').itag, 140);
});

test('video-only responses cannot be exposed as a music stream', () => {
  assert.throws(() => chooseAudioFormat([formats[3]], 'high'), /音频格式/);
});

test('native source metadata retains request headers, expiry and stable format identity across signed URL changes', () => {
  const media = { url: 'https://audio.test/signed?expire=1800000000&signature=first', mimeType: 'audio/webm',
    formatId: '251', headers: { 'User-Agent': 'client-profile', Origin: 'https://music.youtube.com' },
    cacheKey: 'song:251:1000', expiresAt: 1800000000000, client: 'WEB_REMIX' };
  const request = new Request('https://metrolist.test/api/stream?id=song');
  const direct = streamMetadata(media, request, { id: 'song' }, true);
  assert.equal(direct.url, media.url);
  assert.deepEqual(direct.headers, media.headers);
  assert.equal(direct.expiresAt, media.expiresAt);
  assert.equal(direct.cacheKey, 'song:251:1000');
  const refreshed = streamMetadata({ ...media, url: 'https://audio.test/signed?expire=1800003600&signature=second' }, request, { id: 'song' }, true);
  assert.equal(refreshed.cacheKey, direct.cacheKey);
  const proxy = streamMetadata(media, request, { id: 'song' });
  assert.equal(proxy.headers, undefined);
  assert.equal(new URL(proxy.url).searchParams.get('client'), 'WEB_REMIX');
  assert.equal(new URL(proxy.url).searchParams.get('source'), media.url);
});

function playerResponse(id, version = 1, lifetime = 3600) {
  return Response.json({ playabilityStatus: { status: 'OK' }, videoDetails: { title: id, lengthSeconds: '180' },
    streamingData: { expiresInSeconds: String(lifetime), adaptiveFormats: formats.slice(0, 3).map(format => ({ ...format,
      contentLength: '100000', url: `https://audio.test/${id}/${format.itag}?version=${version}&expire=${Math.floor(Date.now() / 1000) + lifetime}`,
    })) },
  });
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('the anonymous session visitor serves the catalog and the first songs with zero watch requests', async () => {
  let watches = 0, pages = 0, players = 0, workers = 0;
  const visitors = [], pageVisitors = [];
  const transport = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === '/sw.js_data') { workers++; return serviceWorker('session-visitor'); }
    if (path.endsWith('/browse')) {
      pages++; pageVisitors.push(init.headers['X-Goog-Visitor-Id']);
      return Response.json({ responseContext: { visitorData: `catalog-visitor-${pages}` }, contents: [] });
    }
    if (path === '/watch') { watches++; return new Response('{"VISITOR_DATA":"watch-visitor"}'); }
    players++;
    visitors.push(init.headers['X-Goog-Visitor-Id']);
    assert.equal(init.headers.Cookie, undefined);
    return playerResponse(JSON.parse(init.body).videoId);
  };
  assert.equal((await api(new Request('https://player.test/api/home'), { fetch: transport })).status, 200);
  await resolveWorkerAudio('catalog-first-song', { fetch: transport });
  await api(new Request('https://player.test/api/home'), { fetch: transport });
  await resolveWorkerAudio('catalog-second-song', { fetch: transport });
  assert.equal(workers, 1);
  assert.equal(watches, 0);
  assert.equal(players, 2);
  assert.deepEqual(pageVisitors, ['session-visitor', 'session-visitor']);
  assert.deepEqual(visitors, ['session-visitor', 'session-visitor']);
});

test('authenticated catalog responses never seed the anonymous playback visitor', async () => {
  let watches = 0;
  const transport = async (url, init) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/browse')) {
      assert.equal(init.headers.Cookie, withPrefCookie('SAPISID=fixture-catalog-account'));
      return Response.json({ responseContext: { visitorData: 'signed-in-response-visitor' }, contents: [] });
    }
    if (path === '/watch') { watches++; return new Response('{"VISITOR_DATA":"anonymous-watch-visitor"}'); }
    assert.equal(init.headers['X-Goog-Visitor-Id'], 'anonymous-watch-visitor');
    assert.equal(init.headers.Cookie, undefined);
    return playerResponse(JSON.parse(init.body).videoId);
  };
  const account = { cookie: 'SAPISID=fixture-catalog-account', visitorData: 'signed-in-request-visitor' };
  await api(new Request('https://player.test/api/home', {
    headers: { 'X-Metrolist-Account': encodeURIComponent(JSON.stringify(account)) },
  }), { fetch: transport });
  await resolveWorkerAudio('anonymous-after-account', { fetch: transport });
  assert.equal(watches, 1);
});

test('an authenticated home response cannot replace a concurrent anonymous watch bootstrap', async () => {
  const watchStarted = deferred(), finishWatch = deferred();
  let watches = 0;
  const visitors = [];
  const transport = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === '/sw.js_data' || path === '/') return new Response('', { status: 404 });
    if (path.endsWith('/browse')) return Response.json({ responseContext: { visitorData: 'private-home-visitor' } });
    if (path === '/watch') {
      watches++; watchStarted.resolve(); await finishWatch.promise;
      return new Response('{"VISITOR_DATA":"concurrent-watch-visitor"}');
    }
    visitors.push(init.headers['X-Goog-Visitor-Id']);
    return playerResponse(JSON.parse(init.body).videoId);
  };
  const first = resolveWorkerAudio('concurrent-private-home-a', { fetch: transport });
  await watchStarted.promise;
  await api(new Request('https://player.test/api/home', {
    headers: { 'X-Metrolist-Account': encodeURIComponent(JSON.stringify({ cookie: 'SAPISID=fixture-concurrent-account' })) },
  }), { fetch: transport });
  const second = resolveWorkerAudio('concurrent-private-home-b', { fetch: transport });
  finishWatch.resolve();
  await Promise.all([first, second]);
  assert.equal(watches, 1);
  assert.deepEqual(visitors, ['concurrent-watch-visitor', 'concurrent-watch-visitor']);
});

test('anonymous catalog and a concurrent watch converge on one visitor without waiting for an unrelated watch', async () => {
  const watchStarted = deferred(), finishWatch = deferred();
  let watches = 0;
  const visitors = [];
  const transport = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === '/sw.js_data') return serviceWorker('concurrent-session-visitor');
    if (path.endsWith('/browse')) return Response.json({ responseContext: { visitorData: 'concurrent-catalog-visitor' } });
    if (path === '/watch') {
      watches++; watchStarted.resolve(); await finishWatch.promise;
      return new Response('{"VISITOR_DATA":"late-watch-visitor"}');
    }
    visitors.push(init.headers['X-Goog-Visitor-Id']);
    return playerResponse(JSON.parse(init.body).videoId);
  };
  const first = resolveWorkerAudio('concurrent-catalog-a', { fetch: transport });
  await watchStarted.promise;
  await api(new Request('https://player.test/api/home'), { fetch: transport });
  await resolveWorkerAudio('concurrent-catalog-b', { fetch: transport });
  finishWatch.resolve();
  await first;
  assert.equal(watches, 1);
  assert.deepEqual(visitors, ['concurrent-session-visitor', 'concurrent-session-visitor']);
});

test('missing catalog visitors and a different transport still bootstrap through watch', async () => {
  const seededTransport = async () => Response.json({ responseContext: { visitorData: 'other-transport-visitor' } });
  await api(new Request('https://player.test/api/home'), { fetch: seededTransport });
  let watches = 0;
  const transport = async (url, init) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/browse')) return Response.json({ contents: [] });
    if (path === '/watch') { watches++; return new Response('{"VISITOR_DATA":"own-transport-visitor"}'); }
    assert.equal(init.headers['X-Goog-Visitor-Id'], 'own-transport-visitor');
    return playerResponse(JSON.parse(init.body).videoId);
  };
  await api(new Request('https://player.test/api/home'), { fetch: transport });
  await resolveWorkerAudio('missing-catalog-visitor', { fetch: transport });
  assert.equal(watches, 1);
});

test('concurrent cold tracks share one visitor bootstrap without serializing player requests', async () => {
  const visitor = deferred();
  let watches = 0, players = 0, playingRequests = 0, peakPlayers = 0;
  const transport = async (url, init) => {
    if (new URL(url).pathname === '/watch') {
      watches++;
      await visitor.promise;
      return new Response('<script>ytcfg.set({"VISITOR_DATA":"cold-visitor"})</script>');
    }
    players++; playingRequests++; peakPlayers = Math.max(peakPlayers, playingRequests);
    assert.equal(init.headers['X-Goog-Visitor-Id'], 'cold-visitor');
    await Promise.resolve();
    playingRequests--;
    return playerResponse(JSON.parse(init.body).videoId);
  };
  const loading = Array.from({ length: 8 }, (_, index) => resolveWorkerAudio(`cold-${index}`, { fetch: transport }));
  visitor.resolve();
  const sources = await Promise.all(loading);
  assert.equal(watches, 1);
  assert.equal(players, 8);
  assert.ok(peakPlayers > 1);
  assert.equal(new Set(sources.map(source => new URL(source.url).pathname)).size, 8);
});

test('prefetch, playback and quality selection reuse one player response', async () => {
  let players = 0;
  const transport = async (url, init) => {
    if (new URL(url).pathname === '/watch') return new Response('{"VISITOR_DATA":"shared-visitor"}');
    players++;
    await Promise.resolve();
    return playerResponse(JSON.parse(init.body).videoId);
  };
  const sources = await Promise.all(Array.from({ length: 12 }, () => resolveWorkerAudio('shared-song', { fetch: transport })));
  assert.equal(players, 1);
  assert.equal(new Set(sources.map(source => source.url)).size, 1);
  const aac = await resolveWorkerAudio('shared-song', { fetch: transport, container: 'mp4', quality: 'high' });
  assert.equal(aac.formatId, '140');
  assert.equal(players, 1);
});

test('expired player and visitor caches refresh once across concurrent callers', async t => {
  let now = 1800000000000;
  t.mock.method(Date, 'now', () => now);
  let players = 0, watches = 0;
  const transport = async (url, init) => {
    if (new URL(url).pathname === '/watch') {
      watches++;
      await Promise.resolve();
      return new Response(`{"VISITOR_DATA":"visitor-${watches}"}`);
    }
    const version = ++players;
    await Promise.resolve();
    return playerResponse(JSON.parse(init.body).videoId, version);
  };
  await resolveWorkerAudio('expiring-song', { fetch: transport });
  now += 4 * 60 * 60 * 1000;
  const sources = await Promise.all(Array.from({ length: 10 }, () => resolveWorkerAudio('expiring-song', { fetch: transport })));
  assert.equal(players, 2);
  assert.equal(watches, 2);
  assert.ok(sources.every(source => new URL(source.url).searchParams.get('version') === '2'));
});

test('missing server expiry uses a finite cache lifetime instead of resolving on every call', async () => {
  let players = 0;
  const transport = async url => {
    if (new URL(url).pathname === '/watch') return new Response('{"VISITOR_DATA":"no-expiry-visitor"}');
    players++;
    return Response.json({ playabilityStatus: { status: 'OK' }, streamingData: { adaptiveFormats: [formats[1]] } });
  };
  const source = await resolveWorkerAudio('no-expiry-song', { fetch: transport });
  await resolveWorkerAudio('no-expiry-song', { fetch: transport });
  assert.ok(Number.isFinite(source.expiresAt));
  assert.ok(source.expiresAt > Date.now());
  assert.equal(players, 1);
});

test('refresh replaces the signed URL and an earlier in-flight response cannot overwrite it', async () => {
  const firstStarted = deferred();
  const firstResponse = deferred();
  let players = 0;
  const transport = async (url, init) => {
    if (new URL(url).pathname === '/watch') return new Response('{"VISITOR_DATA":"refresh-visitor"}');
    const version = ++players;
    if (version === 1) { firstStarted.resolve(); await firstResponse.promise; }
    return playerResponse(JSON.parse(init.body).videoId, version);
  };
  const first = resolveWorkerAudio('refresh-song', { fetch: transport });
  await firstStarted.promise;
  const refreshed = await resolveWorkerAudio('refresh-song', { fetch: transport, refresh: '1' });
  firstResponse.resolve();
  await first;
  const cached = await resolveWorkerAudio('refresh-song', { fetch: transport });
  assert.equal(new URL(refreshed.url).searchParams.get('version'), '2');
  assert.equal(cached.url, refreshed.url);
  assert.equal(players, 2);
});

test('changed visitor data and delegated channels retain independent signed URL and media caches', async () => {
  let players = 0;
  const transport = async (url, init) => {
    players++;
    const context = JSON.parse(init.body).context;
    return playerResponse(`${context.client.visitorData}-${context.user.onBehalfOfUser}`);
  };
  const account = { cookie: 'SAPISID=fixture-session', authUser: '0', visitorData: 'visitor-a', dataSyncId: 'channel-a' };
  const sources = await Promise.all([
    account, { ...account, visitorData: 'visitor-b' }, { ...account, dataSyncId: 'channel-b' },
  ].map(account => resolveWorkerAudio('session-song', { fetch: transport, account })));
  assert.equal(players, 3);
  assert.equal(new Set(sources.map(source => source.url)).size, 3);
  assert.equal(new Set(sources.map(source => source.cacheKey)).size, 3);
  await resolveWorkerAudio('session-song', { fetch: transport, account });
  assert.equal(players, 3);
});

test('Retry-After supports seconds and HTTP dates', () => {
  const now = Date.parse('2026-11-11T12:00:00Z');
  assert.equal(retryAfterMilliseconds('3', now), 3000);
  assert.equal(retryAfterMilliseconds('Wed, 11 Nov 2026 12:00:08 GMT', now), 8000);
  assert.equal(retryAfterMilliseconds('invalid', now), undefined);
  assert.equal(retryAfterMilliseconds(null, now), undefined);
});

test('visitor 429 keeps its status and retry metadata and failed bootstrap is not cached', async () => {
  let requests = 0;
  const transport = async (url, init) => {
    requests++;
    if (requests === 1) return new Response('limited', { status: 429, headers: { 'Retry-After': '60' } });
    if (new URL(url).pathname === '/watch') return new Response('{"VISITOR_DATA":"retry-visitor"}');
    return playerResponse(JSON.parse(init.body).videoId);
  };
  const request = new Request('https://player.test/api/stream?id=limited-visitor');
  const response = await api(request, { fetch: transport, directStreams: true });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '60');
  assert.match(response.headers.get('Access-Control-Expose-Headers'), /Retry-After/);
  assert.deepEqual(await response.json(), {
    error: 'YouTube 播放配置请求失败（HTTP 429）', code: 'rate-limited', stage: 'visitor', retryAfterMs: 60000,
  });
  assert.equal(requests, 1);
  const retry = await api(request, { fetch: transport, directStreams: true });
  assert.equal(retry.status, 200);
  assert.equal(requests, 3);
});

test('a short explicit player Retry-After retries once within the shared resolution', async () => {
  let players = 0;
  const transport = async (url, init) => {
    if (new URL(url).pathname === '/watch') return new Response('{"VISITOR_DATA":"short-retry-visitor"}');
    players++;
    if (players === 1) return new Response('limited', { status: 429, headers: { 'Retry-After': '0' } });
    return playerResponse(JSON.parse(init.body).videoId);
  };
  const sources = await Promise.all(Array.from({ length: 6 }, () => resolveWorkerAudio('short-retry-song', { fetch: transport })));
  assert.equal(players, 2);
  assert.ok(sources.every(source => source.client === 'VISIONOS_0_1'));
});

test('player 429 without Retry-After does not fan out retries or become a 502', async () => {
  let players = 0;
  const transport = async url => {
    if (new URL(url).pathname === '/watch') return new Response('{"VISITOR_DATA":"no-retry-visitor"}');
    players++;
    return new Response('limited', { status: 429 });
  };
  const responses = await Promise.all(Array.from({ length: 6 }, () => api(
    new Request('https://player.test/api/stream?id=no-retry-song'), { fetch: transport, directStreams: true },
  )));
  assert.equal(players, 1);
  for (const response of responses) {
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), null);
    assert.equal((await response.json()).stage, 'player');
  }
});

test('exhausted short retries remain bounded and authenticated player keeps 429 metadata', async () => {
  const requests = [];
  const account = { cookie: 'SAPISID=fixture-limited' };
  const response = await api(new Request('https://player.test/api/stream?id=account-limited', {
    headers: { 'X-Metrolist-Account': encodeURIComponent(JSON.stringify(account)) },
  }), { fetch: async url => {
    requests.push(new URL(url).pathname);
    return new Response('limited', { status: 429, headers: { 'Retry-After': '0' } });
  } });
  // The visionOS visitor bootstrap and then the account player each retry once.
  assert.deepEqual(requests, ['/watch', '/watch', '/youtubei/v1/player', '/youtubei/v1/player']);
  assert.equal(response.status, 429);
  assert.equal((await response.json()).stage, 'player');
});

test('audio proxy 429 reports its source stage and server delay', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response('limited', { status: 429, headers: { 'Retry-After': '30' } });
  });
  const response = await api(new Request('https://player.test/api/audio?source=https%3A%2F%2Faudio.test%2Ffile'));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '30');
  assert.equal((await response.json()).stage, 'audio');
  assert.equal(calls, 1);
});

test('the audio proxy reads googlevideo in bounded ranges for whole and open-ended requests', async t => {
  const length = 2 * RANGE_CHUNK_BYTES + 4097;
  const byte = index => index % 251;
  const ranges = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const range = new Headers(init.headers).get('Range');
    ranges.push(range);
    const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(range);
    const start = Number(from), end = Math.min(Number(to), length - 1);
    const body = Uint8Array.from({ length: end + 1 - start }, (_, index) => byte(start + index));
    return new Response(body, { status: 206, headers: {
      'Content-Type': 'audio/mp4', 'Content-Range': `bytes ${start}-${end}/${length}` } });
  });
  const audio = 'https://player.test/api/audio?source=https%3A%2F%2Frr1.googlevideo.com%2Fvideoplayback&client=VISIONOS_0_1';

  const whole = await api(new Request(audio));
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('Content-Length'), String(length));
  assert.equal(whole.headers.get('Content-Range'), null);
  const bytes = new Uint8Array(await whole.arrayBuffer());
  assert.equal(bytes.length, length);
  assert.ok(bytes.every((value, index) => value === byte(index)));
  assert.deepEqual(ranges.splice(0), [
    `bytes=0-${RANGE_CHUNK_BYTES - 1}`,
    `bytes=${RANGE_CHUNK_BYTES}-${2 * RANGE_CHUNK_BYTES - 1}`,
    `bytes=${2 * RANGE_CHUNK_BYTES}-${length - 1}`,
  ]);

  const start = RANGE_CHUNK_BYTES + 5;
  const seek = await api(new Request(audio, { headers: { Range: `bytes=${start}-` } }));
  assert.equal(seek.status, 206);
  assert.equal(seek.headers.get('Content-Range'), `bytes ${start}-${length - 1}/${length}`);
  assert.equal((await seek.arrayBuffer()).byteLength, length - start);
  assert.deepEqual(ranges, [`bytes=${start}-${start + RANGE_CHUNK_BYTES - 1}`, `bytes=${start + RANGE_CHUNK_BYTES}-${length - 1}`]);
});
