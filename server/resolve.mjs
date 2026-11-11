// Native playback resolver. Node-only; not imported by the Cloudflare Worker.
// SPDX-License-Identifier: GPL-3.0-only
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { delimiter } from 'node:path';
import { resolveWorkerAudio } from './streaming.mjs';

const execute = promisify(execFile);
const resolved = new Map();

export async function resolveAudio(id, options = {}) {
  if (options.account) return resolveWorkerAudio(id, options);
  const quality = options.quality || 'auto';
  const cacheKey = `${id}:${quality}:${options.container || ''}`;
  const previous = resolved.get(cacheKey);
  if (previous && previous.expiresAt > Date.now() + 60000) return previous;
  const program = process.env.YT_DLP_PATH || process.env.PYTHON || 'python3';
  const args = process.env.YT_DLP_PATH ? [] : ['-m', 'yt_dlp'];
  const container = options.container === 'mp4' ? 'm4a' : options.container;
  const selector = container ? `${quality === 'low' ? 'worst' : 'best'}audio[ext=${container}]` :
    quality === 'low' ? 'worstaudio[ext=m4a]/worstaudio' :
    quality === 'medium' ? 'bestaudio[ext=m4a]/bestaudio' :
    quality === 'high' ? 'bestaudio' : 'bestaudio[ext=webm]/bestaudio';
  args.push('--no-playlist', '--no-warnings', '--dump-single-json', '--skip-download',
    '--js-runtimes', 'node', '-f', selector,
    ...(quality === 'high' ? ['-S', 'abr'] : []),
    `https://www.youtube.com/watch?v=${id}`);
  const pythonPath = fileURLToPath(new URL('./.yt-dlp', import.meta.url));
  let stdout;
  try {
    ({ stdout } = await execute(program, args, {
      maxBuffer: 10 * 1024 * 1024,
      signal: options.signal,
      env: { ...process.env, PYTHONPATH: [pythonPath, process.env.PYTHONPATH].filter(Boolean).join(delimiter) },
    }));
  } catch (error) {
    const message = error.stderr || error.message;
    throw new Error(message.includes('No module named yt_dlp') ?
      '请先运行 python3 -m pip install -U yt-dlp，然后重新播放。' : message.trim());
  }
  const media = JSON.parse(stdout);
  const value = {
    url: media.url,
    headers: media.http_headers || {},
    mimeType: media.ext === 'm4a' ? 'audio/mp4' : media.ext === 'webm' ? 'audio/webm' : `audio/${media.ext}`,
    expiresAt: Number(new URL(media.url).searchParams.get('expire') || Math.floor(Date.now() / 1000) + 1800) * 1000,
    title: media.title, duration: media.duration, quality,
    artist: media.artist || media.uploader || '', artwork: media.thumbnail || '',
    bitrate: Math.round(Number(media.abr || media.tbr || 0) * 1000),
    formatId: media.format_id, sampleRate: media.asr, contentLength: media.filesize,
    codecs: media.acodec, client: 'yt-dlp',
  };
  resolved.set(cacheKey, value);
  return value;
}
