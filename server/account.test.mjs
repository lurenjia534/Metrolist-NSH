import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { ACCOUNT_HEADER, normalizeAccount, authenticationHeaders, accountFromRequest } from './auth.mjs';
import { parseAccountInfo, parseAccounts } from './account.mjs';
import { items, parseBrowse, continuation, libraryTokens, withPrefCookie } from './catalog.mjs';
import { api } from './index.mjs';

// Deliberately artificial credentials. Every account request in this file uses
// a fixture transport: these tests never log in to Google or mutate an account.
const accountA = { cookie: 'SAPISID=fixture-A; SID=fixture-A', visitorData: 'visitor-A', dataSyncId: 'channel-A', authUser: '0' };
const accountB = { cookie: 'SAPISID=fixture-B; SID=fixture-B', visitorData: 'visitor-B', dataSyncId: 'channel-B', authUser: '1' };
const accountHeader = account => ({ [ACCOUNT_HEADER]: encodeURIComponent(JSON.stringify(account)) });
const profile = name => ({ activeAccountHeaderRenderer: {
  accountName: { runs: [{ text: name }] }, email: { simpleText: `${name}@example.test` },
  channelHandle: { simpleText: `@${name}` }, accountPhoto: { thumbnails: [{ url: `https://images.test/${name}.jpg` }] },
} });
const request = (path, account, body) => new Request(`https://metrolist.test/api/${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { ...(account ? accountHeader(account) : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const endpointOf = url => new URL(url).pathname.split('/youtubei/v1/')[1];
const payloadOf = options => { const { context, ...body } = JSON.parse(options.body); return body; };
const songRow = (id, setVideoId) => ({ musicResponsiveListItemRenderer: {
  playlistItemData: { videoId: id, ...(setVideoId ? { playlistSetVideoId: setVideoId } : {}) },
  flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { simpleText: id } } }],
} });

test('SAPISIDHASH, auth user, and delegated channel follow the original Google session', async () => {
  const normalized = normalizeAccount({ ...accountB, dataSyncId: 'channel-B||extra', authUser: 1 });
  assert.equal(normalized.dataSyncId, 'channel-B');
  assert.equal(normalized.authUser, '1');
  const headers = await authenticationHeaders(normalized, 'https://music.youtube.com', 1700000000123);
  const hash = createHash('sha1').update('1700000000 fixture-B https://music.youtube.com').digest('hex');
  assert.equal(headers.Authorization, `SAPISIDHASH 1700000000_${hash}`);
  assert.equal(headers.Cookie, accountB.cookie);
  assert.equal(headers['X-Goog-AuthUser'], '1');
  assert.equal(headers['X-Goog-Visitor-Id'], 'visitor-B');
  const thirdParty = await authenticationHeaders({ cookie: '__Secure-3PAPISID=fixture-B' }, 'https://music.youtube.com', 1700000000123);
  assert.equal(thirdParty.Authorization, headers.Authorization);
  assert.deepEqual(accountFromRequest(request('account', accountA)), accountA);
});

test('account header and channel-switcher renderers retain real profile and selection fields', () => {
  assert.deepEqual(parseAccountInfo({ actions: [{ popup: profile('miku') }] }, accountA), {
    id: 'channel-A', name: 'miku', email: 'miku@example.test', channelHandle: '@miku', avatar: 'https://images.test/miku.jpg',
  });
  const channel = { accountItem: {
    accountName: { simpleText: 'Miku channel' }, accountByline: { simpleText: 'miku@example.test' },
    channelHandle: { simpleText: '@miku' }, isSelected: true,
    accountPhoto: { thumbnails: [{ url: 'https://images.test/channel.jpg' }] },
    serviceEndpoint: { selectActiveIdentityEndpoint: { supportedTokens: [
      { pageIdToken: { pageId: 'UCfixture' } },
      { datasyncIdToken: { datasyncIdToken: 'brand-channel||personal' } },
      { accountSigninToken: { signinUrl: 'https://music.youtube.com/signin?authuser=2' } },
    ] } },
  } };
  const values = parseAccounts({ contents: [channel, channel] }, accountA);
  assert.equal(values.length, 1);
  assert.deepEqual(values[0], {
    name: 'Miku channel', byline: 'miku@example.test', avatar: 'https://images.test/channel.jpg',
    channelHandle: '@miku', email: 'miku@example.test', pageId: 'UCfixture', dataSyncId: 'brand-channel',
    signinUrl: 'https://music.youtube.com/signin?authuser=2', authUser: '2', selected: true,
  });
});

test('concurrent account requests keep cookies, visitor data, and channel identities separate', async () => {
  const calls = [];
  const fetchFixture = async (url, options) => {
    assert.equal(endpointOf(url), 'account/account_menu');
    const context = JSON.parse(options.body).context;
    calls.push({ headers: options.headers, context });
    await Promise.resolve();
    return Response.json(profile(options.headers.Cookie.includes('fixture-A') ? 'A' : 'B'));
  };
  const responses = await Promise.all([accountA, accountB].map(account => api(request('account', account), { fetch: fetchFixture })));
  assert.deepEqual(await Promise.all(responses.map(response => response.json().then(value => value.name))), ['A', 'B']);
  for (const account of [accountA, accountB]) {
    // InnertubeX sends the account's cookie with its PREF carrying hl and gl.
    const call = calls.find(value => value.headers.Cookie === withPrefCookie(account.cookie));
    assert.equal(call.headers['X-Goog-AuthUser'], account.authUser);
    assert.equal(call.context.client.visitorData, account.visitorData);
    assert.equal(call.context.user.onBehalfOfUser, account.dataSyncId);
    assert.equal(call.headers.Origin, 'https://music.youtube.com');
  }
});

test('cookie login discovers page session fields, verifies account, and never returns the cookie', async () => {
  const calls = [];
  const response = await api(request('account/login', null, { cookie: accountA.cookie, authUser: '2' }), {
    fetch: async (url, options) => {
      calls.push({ url: String(url), options });
      if (!endpointOf(url)) return new Response('<script>ytcfg.set({"VISITOR_DATA":"visitor-page","DATASYNC_ID":"channel-page||personal"})</script>');
      const context = JSON.parse(options.body).context;
      assert.equal(context.client.visitorData, 'visitor-page');
      assert.equal(context.user.onBehalfOfUser, 'channel-page');
      return Response.json(profile('verified'));
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.account.name, 'verified');
  assert.deepEqual(body.session, { visitorData: 'visitor-page', dataSyncId: 'channel-page', authUser: '2' });
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0].url).searchParams.get('authuser'), '2');
  assert.ok(!JSON.stringify(body).includes('fixture-A'));
});

test('account APIs report anonymous and expired sessions without claiming a successful login', async () => {
  let calls = 0;
  const fetchFixture = async () => { calls++; return Response.json({ responseContext: { mainAppWebResponseContext: { loggedOut: true } } }); };
  const anonymous = await api(request('account'), { fetch: fetchFixture });
  assert.equal(anonymous.status, 401);
  assert.equal(calls, 0);
  const expired = await api(request('account', accountA), { fetch: fetchFixture });
  assert.equal(expired.status, 401);
  const wrongMethod = await api(request('account/like', accountA), { fetch: fetchFixture });
  assert.equal(wrongMethod.status, 405);
  const missingCookie = await api(request('account/login', null, {}), { fetch: fetchFixture });
  assert.equal(missingCookie.status, 401);
  assert.equal(calls, 1);
});

test('channel switching requests the account list without the current delegated channel', async () => {
  const response = await api(request('account/channels', accountB), { fetch: async (url, options) => {
    assert.equal(endpointOf(url), 'account/accounts_list');
    assert.deepEqual(payloadOf(options), {
      requestType: 'ACCOUNTS_LIST_REQUEST_TYPE_CHANNEL_SWITCHER', callCircumstance: 'SWITCHING_USERS_FULL',
    });
    assert.equal(JSON.parse(options.body).context.user.onBehalfOfUser, undefined);
    assert.equal(options.headers.Cookie, withPrefCookie(accountB.cookie));
    return Response.json({ contents: [] });
  } });
  assert.deepEqual(await response.json(), { accounts: [] });
});

test('account library uses the original browse ids and retains account visitor data across pages', async () => {
  const ids = { playlists: 'FEmusic_liked_playlists', liked: 'VLLM', songs: 'FEmusic_liked_videos', albums: 'FEmusic_liked_albums', artists: 'FEmusic_library_corpus_artists' };
  for (const [type, browseId] of Object.entries(ids)) {
    const response = await api(request(`account/library?type=${type}`, accountA), { fetch: async (url, options) => {
      assert.equal(endpointOf(url), 'browse');
      assert.equal(payloadOf(options).browseId, browseId);
      return Response.json({ contents: [{ musicShelfRenderer: { contents: [songRow('fixture-song')] } }] });
    } });
    const body = await response.json();
    assert.equal(body.type, type);
    assert.equal(body.items[0].id, 'fixture-song');
  }
  const page = continuation({ nextContinuationData: { continuation: 'fixture-page' } });
  const response = await api(request(`account/library?type=songs&continuation=${encodeURIComponent(page)}`, accountB), { fetch: async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.continuation, 'fixture-page');
    assert.equal(body.context.client.visitorData, accountB.visitorData);
    return Response.json({ continuationContents: { musicShelfContinuation: { contents: [songRow('page-two')] } } });
  } });
  assert.equal((await response.json()).items[0].id, 'page-two');
});

test('editable playlists retain playlist ids and repeated song occurrence ids', () => {
  const first = songRow('same-song', 'occurrence-one');
  const second = songRow('same-song');
  second.musicResponsiveListItemRenderer.overlay = { musicItemThumbnailOverlayRenderer: { content: {
    musicPlayButtonRenderer: { playNavigationEndpoint: { watchEndpoint: { videoId: 'same-song', playlistSetVideoId: 'occurrence-two' } } },
  } } };
  const data = {
    header: { musicEditablePlaylistDetailHeaderRenderer: { header: { musicResponsiveHeaderRenderer: { title: { simpleText: 'My playlist' } } } } },
    contents: [{ musicPlaylistShelfRenderer: { contents: [first, second] } }],
  };
  const playlist = parseBrowse(data, 'VLPLfixture');
  assert.equal(playlist.playlistId, 'PLfixture');
  assert.equal(playlist.editable, true);
  assert.deepEqual(playlist.tracks.map(track => track.setVideoId), ['occurrence-one', 'occurrence-two']);
  const owned = items({ musicTwoRowItemRenderer: {
    title: { simpleText: 'My playlist' }, navigationEndpoint: { browseEndpoint: { browseId: 'VLPLfixture' } },
    menu: { menuRenderer: { items: [
      { menuNavigationItemRenderer: { icon: { iconType: 'EDIT' }, navigationEndpoint: { playlistEditEndpoint: { playlistId: 'PLfixture' } } } },
      { menuNavigationItemRenderer: { icon: { iconType: 'MIX' }, navigationEndpoint: { watchPlaylistEndpoint: { playlistId: 'RDAMVMfixture' } } } },
    ] } },
  } })[0];
  assert.equal(owned.playlistId, 'PLfixture');
  assert.equal(owned.editable, true);
});

test('cloud likes, subscriptions, and playlist edits send the exact upstream mutation shapes', async () => {
  const mutations = [
    ['account/like', { id: 'song', liked: true, kind: 'song' }, 'like/like', { target: { videoId: 'song' } }],
    ['account/like', { id: 'VLPLfixture', liked: false, kind: 'playlist' }, 'like/removelike', { target: { playlistId: 'PLfixture' } }],
    ['account/subscribe', { id: 'UCfixture', subscribed: true, params: 'fixture-params' }, 'subscription/subscribe', { channelIds: ['UCfixture'], params: 'fixture-params' }],
    ['account/subscribe', { id: 'UCfixture', subscribed: false }, 'subscription/unsubscribe', { channelIds: ['UCfixture'] }],
    ['account/playlist', { action: 'create', title: 'Fixture', videoIds: ['song'] }, 'playlist/create', { title: 'Fixture', privacyStatus: 'PRIVATE', videoIds: ['song'] }],
    ['account/playlist', { action: 'add', playlistId: 'VLPLfixture', videoIds: ['a', 'b'] }, 'browse/edit_playlist', { playlistId: 'PLfixture', actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: 'a' }, { action: 'ACTION_ADD_VIDEO', addedVideoId: 'b' }] }],
    ['account/playlist', { action: 'remove', playlistId: 'PLfixture', videoId: 'song', setVideoId: 'occurrence-two' }, 'browse/edit_playlist', { playlistId: 'PLfixture', actions: [{ action: 'ACTION_REMOVE_VIDEO', removedVideoId: 'song', setVideoId: 'occurrence-two' }] }],
    ['account/playlist', { action: 'move', playlistId: 'PLfixture', setVideoId: 'occurrence-two', successorSetVideoId: 'occurrence-one' }, 'browse/edit_playlist', { playlistId: 'PLfixture', actions: [{ action: 'ACTION_MOVE_VIDEO_BEFORE', setVideoId: 'occurrence-two', movedSetVideoIdSuccessor: 'occurrence-one' }] }],
    ['account/playlist', { action: 'move', playlistId: 'PLfixture', setVideoId: 'occurrence-one' }, 'browse/edit_playlist', { playlistId: 'PLfixture', actions: [{ action: 'ACTION_MOVE_VIDEO_BEFORE', setVideoId: 'occurrence-one', movedSetVideoIdSuccessor: null }] }],
    ['account/playlist', { action: 'rename', playlistId: 'PLfixture', title: 'Renamed' }, 'browse/edit_playlist', { playlistId: 'PLfixture', actions: [{ action: 'ACTION_SET_PLAYLIST_NAME', playlistName: 'Renamed' }] }],
    ['account/playlist', { action: 'description', playlistId: 'PLfixture', description: 'Description' }, 'browse/edit_playlist', { playlistId: 'PLfixture', actions: [{ action: 'ACTION_SET_PLAYLIST_DESCRIPTION', playlistDescription: 'Description' }] }],
    ['account/playlist', { action: 'delete', playlistId: 'VLPLfixture' }, 'playlist/delete', { playlistId: 'PLfixture' }],
  ];
  for (const [path, input, endpoint, payload] of mutations) {
    let calls = 0;
    const response = await api(request(path, accountA, input), { fetch: async (url, options) => {
      calls++;
      assert.equal(endpointOf(url), endpoint);
      assert.deepEqual(payloadOf(options), payload);
      assert.equal(options.headers.Cookie, withPrefCookie(accountA.cookie));
      return Response.json(endpoint === 'playlist/create' ? { playlistId: 'PLnew' } : { status: 'STATUS_SUCCEEDED' });
    } });
    assert.equal(response.status, 200, `${input.action || endpoint}: ${await response.clone().text()}`);
    assert.equal((await response.json()).ok, true);
    assert.equal(calls, 1);
  }
  const missingOccurrence = await api(request('account/playlist', accountA, { action: 'remove', playlistId: 'PLfixture', videoId: 'song' }));
  assert.equal(missingOccurrence.status, 400);
});

test('creating a cloud playlist also saves its entered description against the new playlist id', async () => {
  const calls = [];
  const response = await api(request('account/playlist', accountA, {
    action: 'create', title: 'With description', description: 'A real description', videoIds: ['song'],
  }), { fetch: async (url, options) => {
    const endpoint = endpointOf(url);
    calls.push({ endpoint, body: payloadOf(options) });
    assert.equal(options.headers.Cookie, withPrefCookie(accountA.cookie));
    return Response.json(endpoint === 'playlist/create' ? { playlistId: 'PLnew-description' } : { status: 'STATUS_SUCCEEDED' });
  } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).playlistId, 'PLnew-description');
  assert.deepEqual(calls, [
    { endpoint: 'playlist/create', body: { title: 'With description', privacyStatus: 'PRIVATE', videoIds: ['song'] } },
    { endpoint: 'browse/edit_playlist', body: { playlistId: 'PLnew-description', actions: [
      { action: 'ACTION_SET_PLAYLIST_DESCRIPTION', playlistDescription: 'A real description' },
    ] } },
  ]);
});

test('saving a song uses fresh library feedback, ignoring unrelated pin toggles', async () => {
  const menu = { menuRenderer: { items: [
    { toggleMenuServiceItemRenderer: { defaultIcon: { iconType: 'KEEP' }, defaultServiceEndpoint: { feedbackEndpoint: { feedbackToken: 'wrong-pin-token' } } } },
    { toggleMenuServiceItemRenderer: { defaultIcon: { iconType: 'LIBRARY_ADD' },
      defaultServiceEndpoint: { feedbackEndpoint: { feedbackToken: 'fresh-add-token' } },
      toggledServiceEndpoint: { feedbackEndpoint: { feedbackToken: 'fresh-remove-token' } },
    } },
  ] } };
  assert.deepEqual(libraryTokens({ menu }), { saved: false, libraryAddToken: 'fresh-add-token', libraryRemoveToken: 'fresh-remove-token' });
  const endpoints = [];
  const response = await api(request('account/song', accountA, { id: 'song', saved: true }), { fetch: async (url, options) => {
    const endpoint = endpointOf(url); endpoints.push(endpoint);
    if (endpoint === 'next') return Response.json({ playlistPanelVideoRenderer: { videoId: 'song', title: { simpleText: 'Song' }, menu } });
    assert.equal(endpoint, 'feedback');
    assert.deepEqual(payloadOf(options), { feedbackTokens: ['fresh-add-token'] });
    return Response.json({ feedbackResponses: [{ isProcessed: true }] });
  } });
  assert.equal(response.status, 200);
  assert.deepEqual(endpoints, ['next', 'feedback']);
});

test('signed-in normal songs use one visionOS request with the account visitor and no credentials', async () => {
  const requests = [];
  const response = await api(request('stream?id=signed-in-public&container=mp4', accountA), { fetch: async (url, options) => {
    requests.push({ endpoint: endpointOf(url), client: options.headers['X-YouTube-Client-Name'], visitor: options.headers['X-Goog-Visitor-Id'],
      cookie: options.headers.Cookie, authorization: options.headers.Authorization, user: JSON.parse(options.body).context.user });
    return Response.json({ playabilityStatus: { status: 'OK' }, videoDetails: { title: 'Public', lengthSeconds: '60' },
      streamingData: { expiresInSeconds: '3600', adaptiveFormats: [{ itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"',
        bitrate: 128000, audioSampleRate: '44100', url: `https://audio.test/public?expire=${Math.floor(Date.now() / 1000) + 3600}` }] } });
  }, directStreams: true });
  const source = await response.json();
  assert.equal(source.client, 'VISIONOS_0_1');
  assert.equal(source.authenticated, false);
  assert.deepEqual(requests, [{ endpoint: 'player', client: '101', visitor: 'visitor-A', cookie: undefined, authorization: undefined, user: { lockedSafetyMode: false } }]);
});

test('a visionOS 429 for a signed-in song falls back to the account player', async () => {
  const clients = [];
  const response = await api(request('stream?id=signed-in-limited&container=mp4', accountA), { fetch: async (url, options) => {
    clients.push(options.headers['X-YouTube-Client-Name']);
    if (!options.headers.Cookie) return new Response('limited', { status: 429 });
    return Response.json({ playabilityStatus: { status: 'OK' }, streamingData: { expiresInSeconds: '3600', adaptiveFormats: [{
      itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000, url: 'https://audio.test/account-fallback' }] } });
  }, directStreams: true });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).client, 'WEB_REMIX');
  assert.deepEqual(clients, ['101', '67']);
});

test('account audio resolves per identity and native dispatch returns its signed source directly', async () => {
  const calls = [];
  const fetchFixture = async (url, options) => {
    assert.equal(endpointOf(url), 'player');
    // A private upload is unplayable without the account's credentials.
    if (!options.headers.Cookie) return Response.json({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in' } });
    const name = options.headers.Cookie.includes('fixture-A') ? 'A' : 'B';
    calls.push(name);
    return Response.json({
      playabilityStatus: { status: 'OK' }, videoDetails: { title: `Private ${name}`, isPrivate: true, lengthSeconds: '60' },
      streamingData: { expiresInSeconds: '3600', adaptiveFormats: [{
        itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000, audioSampleRate: '44100',
        url: `https://audio.test/${name}?expire=${Math.floor(Date.now() / 1000) + 3600}&signature=fixture-${name}`,
      }] },
    });
  };
  const responses = await Promise.all([accountA, accountB].map(account => api(request('stream?id=account-fixture-audio&container=mp4', account), { fetch: fetchFixture, directStreams: true })));
  const [a, b] = await Promise.all(responses.map(response => response.json()));
  assert.equal(new URL(a.url).pathname, '/A');
  assert.equal(new URL(b.url).pathname, '/B');
  assert.equal(a.client, 'WEB_REMIX');
  assert.equal(a.authenticated, true);
  assert.equal(a.mimeType, 'audio/mp4');
  assert.equal(a.headers.Origin, 'https://music.youtube.com');
  assert.equal(a.headers.Referer, 'https://music.youtube.com/');
  assert.match(a.headers['User-Agent'], /Firefox\/140\.0/);
  assert.equal(a.headers.Cookie, undefined);
  assert.match(a.cacheKey, /^[a-f0-9]{40}:account-fixture-audio:140:$/);
  assert.notEqual(a.cacheKey, b.cacheKey);
  assert.equal(a.expiresAt, Number(new URL(a.url).searchParams.get('expire')) * 1000);
  const web = await (await api(request('stream?id=account-fixture-audio&container=mp4', accountA), { fetch: fetchFixture })).json();
  assert.equal(new URL(web.url).origin, 'https://metrolist.test');
  assert.equal(new URL(new URL(web.url).searchParams.get('source')).pathname, '/A');
  assert.ok(!JSON.stringify(web).includes('SAPISID'));
  assert.deepEqual(calls.sort(), ['A', 'B']);
});

test('account-private songs with cipher-only formats cannot silently use an anonymous player', async () => {
  let calls = 0;
  const response = await api(request('stream?id=private-cipher-fixture&container=mp4', accountA), { fetch: async () => {
    calls++;
    return Response.json({ playabilityStatus: { status: 'OK' }, videoDetails: { isPrivate: true },
      streamingData: { adaptiveFormats: [{ mimeType: 'audio/mp4', signatureCipher: 'fixture-cipher' }] } });
  } });
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /私有歌曲/);
  // visionOS first, then the account's own player; neither has a direct format.
  assert.equal(calls, 2);
});

test('a browser audio reference relays its resolved source without sending Google credentials or resolving again', async t => {
  let upstream;
  const source = createServer((req, res) => {
    upstream = { headers: req.headers, method: req.method, url: req.url };
    res.writeHead(206, { 'Content-Type': 'audio/mp4', 'Content-Range': 'bytes 2-5/8', 'Content-Length': '4' });
    res.end('2345');
  });
  source.listen(0, '127.0.0.1'); await once(source, 'listening');
  t.after(() => new Promise(resolve => source.close(resolve)));
  let calls = 0;
  const stream = await api(request('stream?id=fixture-source', accountA), { resolveAudio: async (id, params) => {
    calls++;
    assert.equal(params.account.cookie, accountA.cookie);
    return { url: `http://127.0.0.1:${source.address().port}/audio?signature=fixture`, mimeType: 'audio/mp4', client: 'WEB_REMIX', authenticated: true };
  } });
  const { url } = await stream.json();
  const audio = await api(new Request(url, { headers: { Range: 'bytes=2-5' } }), {
    resolveAudio: async () => { throw new Error('The issued audio reference must not resolve again'); },
  });
  assert.equal(audio.status, 206);
  assert.equal(await audio.text(), '2345');
  assert.equal(upstream.headers.range, 'bytes=2-5');
  assert.equal(upstream.headers.origin, 'https://music.youtube.com');
  assert.equal(upstream.headers.referer, 'https://music.youtube.com/');
  assert.match(upstream.headers['user-agent'], /Firefox\/140\.0/);
  assert.equal(upstream.headers.cookie, undefined);
  assert.equal(upstream.headers.authorization, undefined);
  assert.equal(upstream.url, '/audio?signature=fixture');
  assert.equal(calls, 1);
});

test('a login whose page lacks the session fields asks as a real browser and falls back to the service worker visitor', async () => {
  const seen = [];
  const response = await api(request('account/login', null, { cookie: accountA.cookie, authUser: '0' }), {
    fetch: async (url, options = {}) => {
      const href = String(url);
      seen.push({ href, agent: options.headers?.['User-Agent'] });
      if (href === 'https://www.youtube.com/sw.js_data') return new Response(")]}'\n" + JSON.stringify([['yt.sw.adr', null, [[[...Array(13).fill(null), 'worker-visitor']]]]]));
      if (!endpointOf(url)) return new Response('<title>unsupported</title>');
      assert.equal(JSON.parse(options.body).context.client.visitorData, 'worker-visitor');
      return Response.json(profile('verified'));
    },
  });
  const body = await response.json();
  assert.equal(body.session.visitorData, 'worker-visitor');
  // The page was asked for with the web client's full user agent, never a bare "Mozilla/5.0".
  assert.match(seen.find(call => call.href.startsWith('https://music.youtube.com/?'))?.agent || seen[0].agent, /Firefox\/140\.0/);
});
