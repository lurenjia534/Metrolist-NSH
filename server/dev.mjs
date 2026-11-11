// Local website + catalog + native audio gateway. Node.js 24.
// SPDX-License-Identifier: GPL-3.0-only
import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { api, cors, json } from './index.mjs';
import { resolveAudio } from './resolve.mjs';
import { resolveWorkerAudio } from './streaming.mjs';
import { createDownloads } from './downloads.mjs';
import { accountFromRequest } from './auth.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), process.env.STATIC_DIR || '../dist/client');
const port = Number(process.env.PORT || 8787);
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json',
  '.zip': 'application/zip',
};

async function send(response, res) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) {
    const body = Readable.fromWeb(response.body);
    res.once('close', () => body.destroy());
    body.pipe(res);
  } else res.end();
}

function sendFile(req, res, file, info, type, extraHeaders = {}) {
  const headers = { ...cors, ...extraHeaders, 'Content-Type': type, 'Accept-Ranges': 'bytes' };
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size || (!range[1] && !range[2])) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` }); res.end(); return;
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': info.size });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  }
}

export function createGateway({ resolveMedia = process.env.STREAM_RESOLVER === 'yt-dlp' ? resolveAudio : resolveWorkerAudio,
  publicOrigin = process.env.PUBLIC_ORIGIN, staticRoot = root, downloadDirectory } = {}) {
const downloads = createDownloads({ resolveMedia, ...(downloadDirectory ? { directory: downloadDirectory } : {}) });
const audioEngine = resolveMedia === resolveAudio ? 'yt-dlp' : resolveMedia === resolveWorkerAudio ? 'innertube-visionos' : 'custom';
return createServer(async (req, res) => {
  const origin = publicOrigin || `http://${req.headers.host}`;
  const url = new URL(req.url, origin);
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors); res.end(); return;
    }
    if (url.pathname === '/api/download') {
      const id = url.searchParams.get('id');
      if (req.method === 'POST') {
        req.setEncoding('utf8');
        let body = '';
        for await (const chunk of req) body += chunk;
        const account = accountFromRequest(new Request(url, { headers: req.headers }));
        await send(json(await downloads.start(JSON.parse(body), origin, account), 202), res);
      } else if (req.method === 'DELETE') {
        await send(json(await downloads.remove(id)), res);
      } else {
        const value = id ? await downloads.get(id, origin) : await downloads.list(origin);
        await send(json(value || { error: '下载任务不存在。' }, value ? 200 : 404), res);
      }
      return;
    }
    if (url.pathname === '/api/offline') {
      const file = await downloads.file(url.searchParams.get('id'));
      if (!file) { await send(json({ error: '这首歌曲尚未下载完成。' }, 404), res); return; }
      const extra = url.searchParams.has('attachment') ? {
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.path.split(/[\\/]/).at(-1))}`,
      } : {};
      sendFile(req, res, file.path, await stat(file.path), file.mimeType, extra);
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const request = new Request(url, { method: req.method, headers: req.headers,
        ...(!['GET', 'HEAD'].includes(req.method) ? { body: Readable.toWeb(req), duplex: 'half' } : {}) });
      await send(await api(request, { resolveAudio: resolveMedia, audioEngine }), res);
      return;
    }
    let file = resolve(staticRoot, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(staticRoot + sep) && file !== staticRoot) {
      res.writeHead(404); res.end(); return;
    }
    if (url.pathname.endsWith('/')) file = resolve(file, 'index.html');
    let info;
    try { info = await stat(file); }
    catch {
      if (extname(file)) { res.writeHead(404); res.end('Not found'); return; }
      file = resolve(staticRoot, 'index.html'); info = await stat(file);
    }
    sendFile(req, res, file, info, contentTypes[extname(file)] || 'application/octet-stream');
  } catch (error) {
    res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: error.message }));
  }
});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createGateway().listen(port, process.env.HOST || '0.0.0.0', () => {
    console.log(`Metrolist NSH: http://localhost:${port}`);
    console.log(`Static files: ${root}`);
  });
}
