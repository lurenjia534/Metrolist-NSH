// SPDX-License-Identifier: GPL-3.0-only
// The visitor-backed VISIONOS_0_1 direct-audio path from Metrolist / InnertubeX.
import { ApiError, artwork, innertube, WEB_USER_AGENT } from './catalog.mjs';
import { accountIdentity } from './auth.mjs';

const YOUTUBE_ORIGIN = 'https://www.youtube.com';
const MUSIC_ORIGIN = 'https://music.youtube.com';
const VISION_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const playerRecords = new Map();
let visitorContext;

// InnerTubeX 0.11.2 buildHeaders: visionOS media needs no browser headers;
// WEB_REMIX retains the request profile of the music web client.
export function audioRequestHeaders(client) {
  return client === 'WEB_REMIX' ? {
    'User-Agent': WEB_USER_AGENT, Accept: '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Referer: `${MUSIC_ORIGIN}/`, Origin: MUSIC_ORIGIN,
  } : {};
}

async function watchVisitor(videoId, options = {}) {
  if (visitorContext) return visitorContext;
  const response = await (options.fetch || fetch)(`${YOUTUBE_ORIGIN}/watch?v=${encodeURIComponent(videoId)}`, {
    headers: { 'User-Agent': VISION_USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' },
  });
  if (!response.ok) throw new ApiError(`YouTube 播放配置请求失败（HTTP ${response.status}）`);
  const html = await response.text();
  const visitorData = html.match(/"VISITOR_DATA"\s*:\s*"([^"]+)"/)?.[1] ||
    html.match(/"visitorData"\s*:\s*"([^"]+)"/)?.[1];
  if (!visitorData) throw new ApiError('YouTube 未提供播放所需的 visitorData。');
  visitorContext = { visitorData };
  return visitorContext;
}

function directAudioFormats(player) {
  return (player.streamingData?.adaptiveFormats || []).filter(format =>
    format.mimeType?.startsWith('audio/') && format.url && !new URL(format.url).searchParams.has('n'));
}

function audioPlayerRecord(player, formats, client) {
  const expiresAt = Math.min(...formats.map(format =>
    Number(new URL(format.url).searchParams.get('expire')) * 1000 ||
      Date.now() + Number(player.streamingData.expiresInSeconds) * 1000));
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12))))
    .replace(/\+/g, '-').replace(/\//g, '_');
  return { player, formats, expiresAt, nonce, client };
}

async function requestAudioPlayer(videoId, options = {}) {
  if (options.account) {
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
    // VISIONOS_0_1 is explicitly loginSupported=false upstream. Public tracks
    // can use its proven direct format; Google credentials never go to it.
  }
  const { visitorData } = await watchVisitor(videoId, options);
  const response = await (options.fetch || fetch)(`${MUSIC_ORIGIN}/youtubei/v1/player?prettyPrint=false`, {
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
  });
  if (!response.ok) throw new ApiError(`YouTube 音频解析失败（HTTP ${response.status}）`);
  const player = await response.json();
  if (player.playabilityStatus?.status !== 'OK') {
    throw new ApiError(player.playabilityStatus?.reason || '该曲目目前无法播放。');
  }
  const formats = directAudioFormats(player);
  if (!formats.length) throw new ApiError('YouTube 没有为这首曲目返回可直接播放的纯音频格式。');
  return audioPlayerRecord(player, formats, 'VISIONOS_0_1');
}

async function playerRecord(videoId, options = {}) {
  const key = `${await accountIdentity(options.account)}:${videoId}`;
  const cached = playerRecords.get(key);
  if (cached) {
    const record = await cached;
    if (record.expiresAt > Date.now() + 60000) return record;
  }
  const promise = requestAudioPlayer(videoId, options);
  playerRecords.set(key, promise);
  try { return await promise; }
  catch (error) { playerRecords.delete(key); throw error; }
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
  const { player, formats, expiresAt, nonce, client } = await playerRecord(videoId, options);
  const quality = options.quality || 'auto';
  const format = chooseAudioFormat(formats, quality, options.container || '');
  const url = new URL(format.url);
  url.searchParams.set('cpn', nonce);
  const details = player.videoDetails || {};
  const audioConfig = player.playerConfig?.audioConfig || {};
  return {
    url: url.href, headers: audioRequestHeaders(client), expiresAt, quality, container: options.container || '',
    cacheKey: `${videoId}:${format.itag}:${format.contentLength || ''}`,
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

export async function proxyAudio(request, media, extraHeaders = {}) {
  const headers = new Headers(media.headers);
  headers.set('Accept-Encoding', 'identity');
  const range = request.headers.get('Range');
  if (range) headers.set('Range', range);
  const response = await fetch(media.url, {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET', headers, signal: request.signal,
  });
  if (!response.ok && response.status !== 416) throw new ApiError(`音频源返回 HTTP ${response.status}。`, response.status);
  if (response.headers.get('Content-Type')?.includes('text/html')) {
    throw new ApiError('音频源返回了网页而非音频；当前服务节点无法取得 googlevideo 音频数据。');
  }
  const output = new Headers(response.headers);
  for (const [name, value] of Object.entries(extraHeaders)) output.set(name, value);
  output.set('Accept-Ranges', 'bytes');
  output.set('Cache-Control', 'private, no-store');
  if (!output.has('Content-Type')) output.set('Content-Type', media.mimeType);
  return new Response(response.body, { status: response.status, headers: output });
}
