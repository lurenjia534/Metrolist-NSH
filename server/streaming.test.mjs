import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAudioFormat, streamMetadata } from './streaming.mjs';

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
