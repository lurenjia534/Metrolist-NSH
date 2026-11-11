import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get as httpGet } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createGateway } from './dev.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

test('Node gateway preserves media semantics for native LAN clients and cross-origin web clients', async t => {
  const bytes = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
  const staticRoot = await mkdtemp(fileURLToPath(new URL('./.probe-http-', import.meta.url)));
  await writeFile(`${staticRoot}/tone.mp3`, bytes);
  let upstreamRequest;
  const upstream = createServer((req, res) => {
    upstreamRequest = { method: req.method, headers: req.headers };
    const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
    const start = range ? Number(range[1]) : 0;
    const end = range ? Number(range[2]) : bytes.length - 1;
    res.writeHead(range ? 206 : 200, {
      'Content-Type': 'audio/mpeg', 'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : bytes.subarray(start, end + 1));
  });
  const upstreamOrigin = await listen(upstream);
  let resolutions = 0;
  const resolveMedia = async () => {
    resolutions++;
    return { url: `${upstreamOrigin}/audio`, mimeType: 'audio/mpeg', expiresAt: Date.now() + 10000,
      headers: { 'User-Agent': 'media-source-agent', 'X-Media-Token': 'test-token' } };
  };
  const gateway = createGateway({ resolveMedia, staticRoot });
  const origin = await listen(gateway);
  const publicGateway = createGateway({ resolveMedia, staticRoot, publicOrigin: 'https://music.example' });
  const publicOrigin = await listen(publicGateway);
  t.after(async () => {
    await Promise.all([upstream, gateway, publicGateway].map(server => new Promise(resolve => server.close(resolve))));
    await rm(staticRoot, { recursive: true });
  });

  await t.test('stream URLs use the LAN Host header; an explicit public origin preserves HTTPS', async () => {
    const body = await new Promise((resolve, reject) => {
      httpGet(`${origin}/api/stream?id=track`, { headers: { Host: '192.168.0.10:8787' } }, response => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { data += chunk; });
        response.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });
    const source = new URL(body.url);
    assert.equal(source.origin + source.pathname, 'http://192.168.0.10:8787/api/audio');
    assert.equal(source.searchParams.get('id'), 'track');
    assert.equal(source.searchParams.get('source'), `${upstreamOrigin}/audio`);
    const publicBody = await (await fetch(`${publicOrigin}/api/stream?id=track`)).json();
    assert.equal(new URL(publicBody.url).origin, 'https://music.example');
  });

  await t.test('Range preflight completes without resolving or downloading audio', async () => {
    const before = resolutions;
    const response = await fetch(`${origin}/api/audio?id=track`, { method: 'OPTIONS', headers: {
      Origin: 'https://player.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Range',
    } });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.match(response.headers.get('access-control-allow-headers'), /Range/);
    assert.equal(resolutions, before);
  });

  await t.test('Node forwards JSON POST bodies into the shared account dispatcher', async () => {
    const response = await fetch(`${origin}/api/account/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookie: '' }),
    });
    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /登录/);
  });

  await t.test('audio proxy forwards source headers and Range and returns exact partial bytes', async () => {
    const response = await fetch(`${origin}/api/audio?id=track`, { headers: { Range: 'bytes=4-9' } });
    assert.equal(response.status, 206);
    assert.equal(await response.text(), '456789');
    assert.equal(response.headers.get('content-range'), `bytes 4-9/${bytes.length}`);
    assert.equal(response.headers.get('content-length'), '6');
    assert.match(response.headers.get('access-control-expose-headers'), /Content-Range/);
    assert.equal(upstreamRequest.headers['user-agent'], 'media-source-agent');
    assert.equal(upstreamRequest.headers['x-media-token'], 'test-token');
    assert.equal(upstreamRequest.headers.range, 'bytes=4-9');
    assert.match(upstreamRequest.headers['accept-encoding'], /identity/);
  });

  await t.test('HEAD probes reach the source as HEAD and return headers without a body', async () => {
    const response = await fetch(`${origin}/api/audio?id=track`, { method: 'HEAD' });
    assert.equal(upstreamRequest.method, 'HEAD');
    assert.equal(response.headers.get('content-length'), String(bytes.length));
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  });

  await t.test('static audio supports tail reads and rejects unsatisfiable ranges', async () => {
    const tail = await fetch(`${origin}/tone.mp3`, { headers: { Range: 'bytes=-5' } });
    assert.equal(tail.status, 206);
    assert.equal(await tail.text(), 'vwxyz');
    const outOfBounds = await fetch(`${origin}/tone.mp3`, { headers: { Range: 'bytes=999-' } });
    assert.equal(outOfBounds.status, 416);
    assert.equal(outOfBounds.headers.get('content-range'), `bytes */${bytes.length}`);
  });
});
