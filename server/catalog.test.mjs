import test from 'node:test';
import assert from 'node:assert/strict';
import { items, parseBrowse, parseLrc, continuation } from './catalog.mjs';
import { api } from './index.mjs';

const run = (text, browseId, pageType) => ({ text, ...(browseId ? {
  navigationEndpoint: { browseEndpoint: { browseId,
    browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } },
  } },
} : {}) });

// Reduced renderer shape from a live WEB_REMIX response, 2026-11-11.
const song = {
  musicResponsiveListItemRenderer: {
    playlistItemData: { videoId: 'Q0PzQGV7LEE' },
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [run('物をぱらぱら壊す')] } } },
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [
        run('きくお', 'UCsrf178D7cjgbhrxfcIWcXg', 'MUSIC_PAGE_TYPE_ARTIST'),
        run('和'), run('初音ミク', 'UCR29q3hGlpPRDrR1bk_8XqQ', 'MUSIC_PAGE_TYPE_ARTIST'),
        run(' • '), run('きくおミク', 'MPREb_nzh81WlIaOS', 'MUSIC_PAGE_TYPE_ALBUM'),
        run(' • '), run('4:00'),
      ] } } },
    ],
    thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [
      { url: 'https://yt3.googleusercontent.com/example=w120-h120-l90-rj', width: 120 },
    ] } } },
    menu: { menuRenderer: { items: [
      { menuNavigationItemRenderer: { navigationEndpoint: { watchEndpoint: { videoId: 'MENU_NOT_A_SONG' } } } },
    ] } },
  },
};

test('a song has playable identity, attributed artists, album and duration; menu actions do not become songs', () => {
  const result = items({ contents: [song, song] });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'Q0PzQGV7LEE');
  assert.equal(result[0].artist, 'きくお / 初音ミク');
  assert.equal(result[0].albumId, 'MPREb_nzh81WlIaOS');
  assert.equal(result[0].duration, 240);
  assert.equal(result[0].source, 'youtube');
});

test('album headers supply artwork and metadata to compact playlist rows', () => {
  const data = {
    microformat: { microformatDataRenderer: { urlCanonical: 'https://music.youtube.com/playlist?list=OLAK5uy-fixture' } },
    header: { musicResponsiveHeaderRenderer: {
      title: { runs: [run('きくおミク')] },
      straplineTextOne: { runs: [run('きくお')] },
      thumbnail: { thumbnails: [{ url: 'https://example.com/album.jpg' }] },
    } },
    contents: [{ musicShelfRenderer: { contents: [{ musicResponsiveListItemRenderer: {
      playlistItemData: { videoId: 'song' },
      flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [run('Track')] } } }],
      fixedColumns: [{ musicResponsiveListItemFixedColumnRenderer: { text: { simpleText: '1:02:03' } } }],
    } }] } }],
  };
  const album = parseBrowse(data, 'MPRE-album');
  assert.equal(album.tracks[0].artist, 'きくお');
  assert.equal(album.tracks[0].duration, 3723);
  assert.equal(album.tracks[0].artwork, 'https://example.com/album.jpg');
  assert.equal(album.tracks[0].album, 'きくおミク');
  assert.equal(album.playlistId, 'OLAK5uy-fixture');
});

test('continuation preserves the visitor identity required for home pagination', () => {
  const value = continuation({ responseContext: { visitorData: 'visitor' },
    continuations: [{ nextContinuationData: { continuation: 'page-two' } }],
  });
  assert.deepEqual(JSON.parse(atob(value.slice(4))), { token: 'page-two', visitorData: 'visitor' });
});

test('repeated LRC timestamps become separate chronologically ordered lyric cues', () => {
  assert.deepEqual(parseLrc('[ar:Artist]\n[00:05.50][00:20.00]Chorus\n[00:01.25]Opening'), [
    { time: 1.25, text: 'Opening' }, { time: 5.5, text: 'Chorus' }, { time: 20, text: 'Chorus' },
  ]);
});

test('stream metadata exposes a same-origin audio endpoint with real format information', async () => {
  const response = await api(new Request('https://metrolist.test/api/stream?id=G2PDJTkFiA8&quality=high'), {
    resolveAudio: async () => ({ url: 'https://audio-source.test/file', headers: { 'User-Agent': 'source-agent' },
      mimeType: 'audio/webm', bitrate: 146959, formatId: '251', quality: 'high', duration: 223 }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  const source = new URL(body.url);
  assert.equal(source.origin + source.pathname, 'https://metrolist.test/api/audio');
  assert.equal(source.searchParams.get('id'), 'G2PDJTkFiA8');
  assert.equal(source.searchParams.get('quality'), 'high');
  assert.equal(source.searchParams.get('source'), 'https://audio-source.test/file');
  assert.equal(source.searchParams.get('mime'), 'audio/webm');
  assert.equal(body.bitrate, 146959);
  assert.equal(body.headers, undefined);
});

// Request profile and session, as InnertubeX builds them.
import { innertube as innertubeRequest, acceptLanguage, withPrefCookie as prefCookie, send as sendRequest } from './catalog.mjs';
const workerData = visitor => new Response(")]}'\n" + JSON.stringify([['yt.sw.adr', null, [[[...Array(13).fill(null), visitor]]]]]));

test('catalog requests carry the locale, its PREF and one bootstrapped session visitor', async () => {
  const calls = [];
  const transport = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined });
    if (String(url) === 'https://www.youtube.com/sw.js_data') return workerData('worker-visitor');
    return Response.json({ contents: [] });
  };
  await Promise.all([innertubeRequest('browse', { browseId: 'FEmusic_home' }, { fetch: transport, hl: 'zh-CN', gl: 'US' }),
    innertubeRequest('browse', { browseId: 'FEmusic_explore' }, { fetch: transport, hl: 'zh-CN', gl: 'US' })]);
  assert.equal(calls.filter(call => call.url.endsWith('/sw.js_data')).length, 1);
  for (const call of calls.filter(call => call.url.includes('/youtubei/v1/browse'))) {
    assert.equal(call.headers['Accept-Language'], 'zh-CN,zh;q=0.9');
    assert.equal(call.headers.Cookie, 'PREF=hl=zh-CN&gl=US');
    assert.equal(call.headers['X-Goog-Visitor-Id'], 'worker-visitor');
    assert.equal(call.body.context.client.visitorData, 'worker-visitor');
  }
  assert.equal(acceptLanguage('en', 'US'), 'en-US,en;q=0.9');
  assert.equal(prefCookie('SID=a; PREF=f6=40000000&hl=ja&gl=JP; SAPISID=b', 'zh-CN', 'US'), 'SID=a; SAPISID=b; PREF=hl=zh-CN&gl=US&f6=40000000');
});

test('transient failures retry with backoff, a 429 only with a short Retry-After', async () => {
  let attempts = 0;
  const flaky = async () => (++attempts < 3 ? new Response('', { status: 503 }) : Response.json({ ok: true }));
  assert.equal((await sendRequest(flaky, 'https://music.youtube.com/youtubei/v1/browse', {}, { initialDelay: 1 })).status, 200);
  assert.equal(attempts, 3);
  let limited = 0;
  const bare429 = async () => { limited++; return new Response('', { status: 429 }); };
  assert.equal((await sendRequest(bare429, 'https://music.youtube.com/youtubei/v1/browse', {}, { initialDelay: 1 })).status, 429);
  assert.equal(limited, 1);
  let waited = 0;
  const shortWait = async () => (++waited < 2 ? new Response('', { status: 429, headers: { 'Retry-After': '0' } }) : Response.json({}));
  assert.equal((await sendRequest(shortWait, 'https://music.youtube.com/youtubei/v1/browse', {}, { initialDelay: 1 })).status, 200);
  assert.equal(waited, 2);
});
