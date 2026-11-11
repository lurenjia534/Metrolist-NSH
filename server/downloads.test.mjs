import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, stat, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createGateway } from './dev.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

async function waitFor(origin, id, accept) {
  for (let step = 0; step < 200; step++) {
    const item = await (await fetch(`${origin}/api/download?id=${id}`)).json();
    if (accept(item)) return item;
    if (item.status === 'failed') throw new Error(item.error);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Download did not reach the expected state');
}

test('native downloads stream files larger than 8 MiB to disk and remain playable offline', async t => {
  const directory = await mkdtemp(fileURLToPath(new URL('./.probe-download-', import.meta.url)));
  const size = 9 * 1024 * 1024 + 123;
  const source = createServer((req, res) => {
    const compatible = req.url === '/compatible';
    const length = compatible ? 256 : size;
    res.writeHead(200, { 'Content-Type': compatible ? 'audio/mp4' : 'audio/mpeg', 'Content-Length': length });
    if (req.url === '/slow') {
      let sent = 0;
      const timer = setInterval(() => {
        const count = Math.min(65536, size - sent);
        res.write(Buffer.alloc(count, 109)); sent += count;
        if (sent === size) { clearInterval(timer); res.end(); }
      }, 10);
      res.once('close', () => clearInterval(timer));
    } else res.end(Buffer.alloc(length, 109));
  });
  const sourceOrigin = await listen(source);
  let resolution;
  let resolvedAccount;
  const options = { downloadDirectory: directory, resolveMedia: async (id, options) => {
    resolution = { id, quality: options.quality, container: options.container };
    resolvedAccount = options.account;
    return { url: `${sourceOrigin}/compatible`, mimeType: 'audio/mp4', headers: {} };
  } };
  const gateway = createGateway(options);
  const origin = await listen(gateway);
  let restarted;
  t.after(async () => {
    await Promise.all([source, gateway, restarted].filter(Boolean).map(server => new Promise(resolve => server.close(resolve))));
    await rm(directory, { recursive: true });
  });

  let downloaded;
  await t.test('download task reports exact file bytes, destination, and stable timestamps', async () => {
    const response = await fetch(`${origin}/api/download`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'large', quality: 'high', name: '离线音乐测试', url: `${sourceOrigin}/large`,
        track: { id: 'large', title: '离线音乐测试', artist: 'Test', source: 'audio' } }),
    });
    assert.equal(response.status, 202);
    downloaded = await waitFor(origin, 'large', item => item.status === 'completed');
    assert.equal(downloaded.bytes, size);
    assert.equal(downloaded.totalBytes, size);
    assert.equal(downloaded.progress, 1);
    assert.equal((await stat(downloaded.destination)).size, size);
    assert.equal(downloaded.name, '离线音乐测试');
    assert.equal(downloaded.quality, 'high');
    assert.ok(downloaded.updatedAt >= downloaded.createdAt);
    assert.equal(downloaded.url, `${origin}/api/offline?id=large`);
    assert.equal(resolution, undefined, 'direct audio does not invoke YouTube extraction');
  });

  await t.test('offline audio supports seek, HEAD, and an attachment filename', async () => {
    const response = await fetch(downloaded.url, { headers: { Range: `bytes=${size - 11}-${size - 1}` } });
    assert.equal(response.status, 206);
    assert.equal(await response.text(), 'm'.repeat(11));
    assert.equal(response.headers.get('content-range'), `bytes ${size - 11}-${size - 1}/${size}`);
    const head = await fetch(downloaded.url + '&attachment=1', { method: 'HEAD' });
    assert.equal(head.headers.get('content-length'), String(size));
    assert.match(head.headers.get('content-disposition'), /^attachment;/);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
  });

  await t.test('a download uses the requested AAC container and quality and saves the returned media type', async () => {
    await fetch(`${origin}/api/download`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'compatible', quality: 'low', container: 'mp4', name: 'AAC format' }),
    });
    const item = await waitFor(origin, 'compatible', job => job.status === 'completed');
    assert.deepEqual(resolution, { id: 'compatible', quality: 'low', container: 'mp4' });
    assert.equal(item.container, 'mp4');
    assert.equal(item.mimeType, 'audio/mp4');
    assert.equal(item.bytes, 256);
    assert.match(item.destination, /\.m4a$/);
    assert.equal((await fetch(item.url)).headers.get('content-type'), 'audio/mp4');
    await fetch(`${origin}/api/download?id=compatible`, { method: 'DELETE' });
  });

  await t.test('account downloads authorize resolution without persisting or returning Google cookies', async () => {
    const account = { cookie: 'SAPISID=fixture-download-cookie', visitorData: 'fixture-visitor', dataSyncId: 'fixture-channel', authUser: '1' };
    const response = await fetch(`${origin}/api/download`, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-Metrolist-Account': encodeURIComponent(JSON.stringify(account)),
    }, body: JSON.stringify({ id: 'account-download', container: 'mp4' }) });
    assert.equal(response.status, 202);
    const started = await response.json();
    assert.equal(started.account, undefined);
    const finished = await waitFor(origin, 'account-download', job => job.status === 'completed');
    assert.deepEqual(resolvedAccount, account);
    assert.equal(finished.account, undefined);
    const manifest = await readFile(`${directory}/library.json`, 'utf8');
    assert.ok(!manifest.includes('fixture-download-cookie'));
    assert.ok(!manifest.includes('SAPISID'));
    await fetch(`${origin}/api/download?id=account-download`, { method: 'DELETE' });
  });

  await t.test('cancelling a running download stops the stream and removes partial files', async () => {
    await fetch(`${origin}/api/download`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'slow', url: `${sourceOrigin}/slow` }),
    });
    await waitFor(origin, 'slow', item => item.bytes > 0);
    const response = await fetch(`${origin}/api/download?id=slow`, { method: 'DELETE' });
    assert.equal((await response.json()).status, 'cancelled');
    assert.equal((await fetch(`${origin}/api/download?id=slow`)).status, 404);
    assert.equal((await readdir(directory)).some(name => name.endsWith('.part')), false);
  });

  await t.test('a restarted gateway reads its manifest and plays the saved bytes without the source server', async () => {
    await new Promise(resolve => source.close(resolve));
    restarted = createGateway(options);
    const nextOrigin = await listen(restarted);
    const result = await (await fetch(`${nextOrigin}/api/download`)).json();
    assert.equal(result.downloads.length, 1);
    assert.equal(result.downloads[0].url, `${nextOrigin}/api/offline?id=large`);
    const partial = await fetch(result.downloads[0].url, { headers: { Range: 'bytes=0-3' } });
    assert.equal(await partial.text(), 'mmmm');
    await fetch(`${nextOrigin}/api/download?id=large`, { method: 'DELETE' });
    assert.equal((await fetch(`${nextOrigin}/api/offline?id=large`)).status, 404);
    await assert.rejects(stat(downloaded.destination), { code: 'ENOENT' });
  });
});
