// SPDX-License-Identifier: GPL-3.0-only
// The visitor-backed VISIONOS_0_1 direct-audio path from Metrolist / InnertubeX.
import { ApiError, artwork, getAnonymousVisitor, innertube, playbackRequest, rememberAnonymousVisitor, upstreamError, WEB_USER_AGENT } from './catalog.mjs';
import { accountIdentity } from './auth.mjs';

const YOUTUBE_ORIGIN = 'https://www.youtube.com';
const MUSIC_ORIGIN = 'https://music.youtube.com';
const VISION_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const resolverStates = new WeakMap();

function resolverState(options) {
  const transport = options.fetch || fetch;
  let state = resolverStates.get(transport);
  if (!state) {
    state = { records: new Map(), requests: new Map(), visitorRequest: null };
    resolverStates.set(transport, state);
  }
  return state;
}

// InnerTubeX 0.11.2 buildHeaders: visionOS media needs no browser headers;
// WEB_REMIX retains the request profile of the music web client.
export function audioRequestHeaders(client) {
  return client === 'WEB_REMIX' ? {
    'User-Agent': WEB_USER_AGENT, Accept: '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Referer: `${MUSIC_ORIGIN}/`, Origin: MUSIC_ORIGIN,
  } : {};
}

async function watchVisitor(videoId, options = {}) {
  const state = resolverState(options);
  const cached = getAnonymousVisitor(options);
  if (cached) return cached;
  if (state.visitorRequest) return state.visitorRequest;
  state.visitorRequest = (async () => {
    const response = await playbackRequest(`${YOUTUBE_ORIGIN}/watch?v=${encodeURIComponent(videoId)}`, {
      headers: { 'User-Agent': VISION_USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' },
    }, options, 'visitor');
    const html = await response.text();
    const visitorData = html.match(/"VISITOR_DATA"\s*:\s*"([^"]+)"/)?.[1] ||
      html.match(/"visitorData"\s*:\s*"([^"]+)"/)?.[1];
    if (!visitorData) throw new ApiError('YouTube 未提供播放所需的 visitorData。');
    // This watch request is anonymous even when it follows an authenticated public-song attempt.
    return rememberAnonymousVisitor(visitorData, { fetch: options.fetch });
  })();
  try { return await state.visitorRequest; }
  finally { state.visitorRequest = null; }
}

function directAudioFormats(player) {
  return (player.streamingData?.adaptiveFormats || []).filter(format =>
    format.mimeType?.startsWith('audio/') && format.url && !new URL(format.url).searchParams.has('n'));
}

function audioPlayerRecord(player, formats, client) {
  const lifetime = Number(player.streamingData.expiresInSeconds);
  const fallbackExpiry = Date.now() + (Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 300) * 1000;
  const expiresAt = Math.min(...formats.map(format =>
    Number(new URL(format.url).searchParams.get('expire')) * 1000 || fallbackExpiry));
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12))))
    .replace(/\+/g, '-').replace(/\//g, '_');
  return { player, formats, expiresAt, nonce, client };
}

// InnerTubeX tries visitor-backed VISIONOS_0_1 first, signed in or not, with the session's
// visitor. It is loginSupported=false, so Google credentials never go to it.
async function visionPlayer(videoId, options = {}) {
  const visitorData = options.account?.visitorData || (await watchVisitor(videoId, options)).visitorData;
  const response = await playbackRequest(`${MUSIC_ORIGIN}/youtubei/v1/player?prettyPrint=false`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'User-Agent': VISION_USER_AGENT,
      'X-Goog-Api-Format-Version': '1', 'X-YouTube-Client-Name': '101',
      'X-YouTube-Client-Version': '0.1', 'X-Goog-Visitor-Id': visitorData,
      'Origin': MUSIC_ORIGIN, 'X-Origin': MUSIC_ORIGIN, 'Referer': `${MUSIC_ORIGIN}/`,
    },
    body: JSON.stringify({
      context: {
        client: { clientName: 'VISIONOS', clientVersion: '0.1', hl: 'en', gl: 'US',
          visitorData, osName: 'VISION_OS', osVersion: '1.3', deviceMake: 'Apple',
          deviceModel: 'RealityDevice14,1', platform: 'MOBILE' },
        user: { lockedSafetyMode: false },
      },
      videoId, contentCheckOk: true, racyCheckOk: true,
    }),
  }, options, 'player');
  const player = await response.json();
  if (player.playabilityStatus?.status !== 'OK') {
    throw new ApiError(player.playabilityStatus?.reason || '该曲目目前无法播放。');
  }
  const formats = directAudioFormats(player);
  if (!formats.length) throw new ApiError('YouTube 没有为这首曲目返回可直接播放的纯音频格式。');
  return audioPlayerRecord(player, formats, 'VISIONOS_0_1');
}

async function requestAudioPlayer(videoId, options = {}) {
  if (!options.account) return visionPlayer(videoId, options);
  // Signed in, the account's own player is the fallback for what visionOS cannot play
  // (private uploads); it is not a second request for every song.
  let visionFailure;
  try { return await visionPlayer(videoId, options); }
  catch (error) { visionFailure = error; }
  const player = await innertube('player', {
    videoId, contentCheckOk: true, racyCheckOk: true,
    playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } },
  }, options);
  if (player.playabilityStatus?.status !== 'OK') {
    throw new ApiError(player.playabilityStatus?.reason || '当前账号无法播放这首歌曲。');
  }
  const formats = directAudioFormats(player);
  if (formats.length) return audioPlayerRecord(player, formats, 'WEB_REMIX');
  if (player.videoDetails?.isPrivate) {
    throw new ApiError('账号已授权，但这首私有歌曲需要 YouTube 的播放器解密或令牌；当前纯音频路径没有返回可用音源。');
  }
  throw visionFailure;
}

async function playerRecord(videoId, options = {}) {
  const state = resolverState(options);
  const identity = await accountIdentity(options.account);
  const key = `${identity}:${videoId}`;
  const refresh = options.refresh === true || options.refresh === '1';
  const pending = state.requests.get(key);
  if (refresh) state.records.delete(key);
  const cached = state.records.get(key);
  if (cached?.expiresAt > Date.now() + 60000) return cached;
  if (pending && (!refresh || pending.refresh)) return pending.promise;
  const entry = { refresh, promise: null };
  entry.promise = requestAudioPlayer(videoId, options).then(record => {
    const value = { ...record, identity };
    if (state.requests.get(key) === entry) state.records.set(key, value);
    return value;
  }).finally(() => {
    if (state.requests.get(key) === entry) state.requests.delete(key);
  });
  state.requests.set(key, entry);
  return entry.promise;
}

function protoFields(bytes) {
  let offset = 0;
  const fields = [];
  const number = () => {
    let value = 0, shift = 0, byte;
    do { byte = bytes[offset++]; value += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
    return value;
  };
  while (offset < bytes.length) {
    const tag = number(), wire = tag & 7;
    if (wire === 2) {
      const length = number();
      fields.push({ field: tag >> 3, bytes: bytes.slice(offset, offset + length) });
      offset += length;
    } else if (wire === 0) number();
    else if (wire === 1) offset += 8;
    else if (wire === 5) offset += 4;
    else break;
  }
  return fields;
}

function audioContent(format) {
  if (!format.xtags) return '';
  const bytes = Uint8Array.from(atob(format.xtags.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
  const decoder = new TextDecoder();
  for (const field of protoFields(bytes)) {
    if (field.field !== 1) continue;
    const entry = protoFields(field.bytes);
    const key = entry.find(value => value.field === 1);
    const value = entry.find(value => value.field === 2);
    if (key && value && decoder.decode(key.bytes) === 'acont') return decoder.decode(value.bytes);
  }
  return '';
}

export function chooseAudioFormat(formats, quality = 'auto', container = '') {
  let choices = formats.filter(format => format.mimeType?.startsWith('audio/') && format.url);
  const originals = choices.filter(format => audioContent(format) === 'original');
  const defaults = choices.filter(format => format.audioTrack?.audioIsDefault);
  choices = originals.length ? originals : defaults.length ? defaults : choices;
  if (container) choices = choices.filter(format => format.mimeType.includes(`audio/${container}`));
  if (!choices.length) throw new ApiError('没有与当前设备兼容的音频格式。');
  const rate = format => Number(format.bitrate || format.averageBitrate || 0);
  const aac = choices.filter(format => format.mimeType.includes('audio/mp4'));
  if (quality === 'low') return (aac.length ? aac : choices).sort((a, b) => rate(a) - rate(b))[0];
  if (quality === 'medium') return (aac.length ? aac : choices).sort((a, b) => rate(b) - rate(a))[0];
  const channels = format => format.audioChannels === 2 ? 2 : format.audioChannels == null ? 1 : 0;
  if (quality === 'high') return choices.sort((a, b) =>
    rate(b) - rate(a) || channels(b) - channels(a) ||
    Number(b.audioSampleRate || 0) - Number(a.audioSampleRate || 0))[0];
  const score = format => (format.mimeType.includes('audio/webm') ? 100 : 50) * 1000000 +
    (format.audioChannels === 2 ? 50000 : format.audioChannels === 1 ? 0 : 25000) +
    rate(format) + Math.min(Number(format.audioSampleRate || 0), 48000) / 10;
  return choices.sort((a, b) => score(b) - score(a))[0];
}

export async function resolveWorkerAudio(videoId, options = {}) {
  const { player, formats, expiresAt, nonce, client, identity } = await playerRecord(videoId, options);
  const quality = options.quality || 'auto';
  const format = chooseAudioFormat(formats, quality, options.container || '');
  const url = new URL(format.url);
  url.searchParams.set('cpn', nonce);
  const details = player.videoDetails || {};
  const audioConfig = player.playerConfig?.audioConfig || {};
  return {
    url: url.href, headers: audioRequestHeaders(client), expiresAt, quality, container: options.container || '',
    cacheKey: `${identity === 'anonymous' ? '' : `${identity}:`}${videoId}:${format.itag}:${format.contentLength || ''}`,
    mimeType: format.mimeType.split(';')[0], codecs: format.mimeType.match(/codecs="([^"]+)"/)?.[1],
    bitrate: Number(format.bitrate || format.averageBitrate), formatId: String(format.itag),
    sampleRate: Number(format.audioSampleRate), contentLength: Number(format.contentLength),
    duration: Number(details.lengthSeconds || Number(format.approxDurationMs) / 1000),
    title: details.title || '', artist: details.author || '', artwork: artwork(details.thumbnail),
    loudnessDb: audioConfig.loudnessDb ?? format.loudnessDb,
    perceptualLoudnessDb: audioConfig.perceptualLoudnessDb,
    client, authenticated: client === 'WEB_REMIX',
  };
}

export function streamMetadata(media, request, params = {}, direct = false) {
  const url = new URL('/api/audio', request.url);
  url.searchParams.set('id', params.id);
  url.searchParams.set('quality', params.quality || 'auto');
  if (params.container) url.searchParams.set('container', params.container);
  url.searchParams.set('source', media.url);
  url.searchParams.set('mime', media.mimeType || 'audio/mp4');
  if (media.client) url.searchParams.set('client', media.client);
  const { headers, url: upstream, ...metadata } = media;
  return { ...metadata, ...(direct ? { headers, cacheKey: media.cacheKey || `${params.id}:${media.formatId || media.quality || "audio"}` } : {}), url: direct ? upstream : url.href };
}

// googlevideo sends a request for at most 10 MiB at full speed and holds one without a Range
// header, or for more, to about twice the audio's real-time rate (~30 KB/s). yt-dlp's
// http_chunk_size and InnerTubeX's bounded media ranges read YouTube media the same way.
export const RANGE_CHUNK_BYTES = 10 * 1024 * 1024;

function contentRange(response) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') || '');
  return match && { last: Number(match[2]), total: Number(match[3]) };
}

/** Bytes `start..=end` (to the end without `end`) of a source as one response, fetched one
 * bounded range after another. A source that ignores or refuses the range answers as it did. */
export async function fetchRanges(url, headers, { start = 0, end, signal } = {}) {
  const open = (from, to) => {
    const request = new Headers(headers);
    request.set('Accept-Encoding', 'identity');
    request.set('Range', `bytes=${from}-${Math.min(to ?? Infinity, from + RANGE_CHUNK_BYTES - 1)}`);
    return fetch(url, { headers: request, signal });
  };
  const first = await open(start, end);
  const range = first.status === 206 && contentRange(first);
  if (!range) return first;
  const last = Math.min(end ?? range.total - 1, range.total - 1);
  let next = range.last + 1;
  let reader = first.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read();
        if (!done) { controller.enqueue(value); return; }
        if (next > last) { controller.close(); return; }
        const response = await open(next, last);
        const part = response.status === 206 && contentRange(response);
        if (!part) {
          await response.body?.cancel();
          throw upstreamError(response, 'audio', `音频源返回 HTTP ${response.status}。`);
        }
        next = part.last + 1;
        reader = response.body.getReader();
      }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  const output = new Headers(first.headers);
  output.set('Content-Length', String(last + 1 - start));
  output.set('Content-Range', `bytes ${start}-${last}/${range.total}`);
  return new Response(body, { status: 206, headers: output });
}

export async function proxyAudio(request, media, extraHeaders = {}) {
  const range = request.headers.get('Range');
  const bounds = range ? /^bytes=(\d+)-(\d*)$/.exec(range.trim()) : ['', '0', ''];
  let response;
  if (request.method === 'HEAD' || !bounds) {
    const headers = new Headers(media.headers);
    headers.set('Accept-Encoding', 'identity');
    if (range) headers.set('Range', range);
    response = await fetch(media.url, { method: request.method === 'HEAD' ? 'HEAD' : 'GET', headers, signal: request.signal });
  } else {
    response = await fetchRanges(media.url, media.headers, {
      start: Number(bounds[1]), end: bounds[2] ? Number(bounds[2]) : undefined, signal: request.signal,
    });
  }
  if (!response.ok && response.status !== 416) throw upstreamError(response, 'audio', `音频源返回 HTTP ${response.status}。`);
  if (response.headers.get('Content-Type')?.includes('text/html')) {
    throw new ApiError('音频源返回了网页而非音频；当前服务节点无法取得 googlevideo 音频数据。');
  }
  const output = new Headers(response.headers);
  let status = response.status;
  // A player that asked for the whole file gets it as one.
  if (!range && status === 206) { status = 200; output.delete('Content-Range'); }
  for (const [name, value] of Object.entries(extraHeaders)) output.set(name, value);
  output.set('Accept-Ranges', 'bytes');
  output.set('Cache-Control', 'private, no-store');
  if (!output.has('Content-Type')) output.set('Content-Type', media.mimeType);
  return new Response(response.body, { status, headers: output });
}
