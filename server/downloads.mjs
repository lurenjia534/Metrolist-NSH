// SPDX-License-Identifier: GPL-3.0-only
import { homedir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const extensions = { 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3', 'audio/webm': '.webm',
  'audio/ogg': '.ogg', 'audio/flac': '.flac', 'audio/wav': '.wav', 'audio/aac': '.aac' };
const filename = text => String(text).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0,160);

export function createDownloads({ resolveMedia, directory = process.env.DOWNLOAD_DIR || join(homedir(), 'Music', 'Metrolist') }) {
  directory = resolve(directory);
  const manifest = join(directory, 'library.json');
  const tasks = new Map();
  let loaded = false;
  let writes = Promise.resolve();

  async function load() {
    if (loaded) return;
    try {
      const data = JSON.parse(await readFile(manifest, 'utf8'));
      for (const item of data.downloads || []) {
        if (['queued', 'resolving', 'downloading'].includes(item.status)) {
          item.status = 'failed'; item.error = '上次下载未完成，请重新下载。';
        }
        tasks.set(item.id, item);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    loaded = true;
  }

  function stored(task) {
    const { controller, promise, account, ...data } = task;
    return data;
  }

  function persist() {
    const data = JSON.stringify({ version: 1, downloads: [...tasks.values()].map(stored) });
    writes = writes.then(async () => {
      await mkdir(directory, { recursive: true });
      await writeFile(`${manifest}.tmp`, data);
      await rename(`${manifest}.tmp`, manifest);
    });
    return writes;
  }

  function view(task, origin) {
    const { controller, promise, sourceUrl, partFile, account, ...data } = task;
    if (task.status === 'completed') {
      const url = new URL('/api/offline', origin);
      url.searchParams.set('id', task.id);
      data.url = url.href;
    }
    return data;
  }

  async function download(task) {
    try {
      task.status = 'resolving'; task.updatedAt = Date.now();
      const media = task.sourceUrl ? { url: task.sourceUrl, headers: {} } :
        await resolveMedia(task.id, { quality: task.quality, container: task.container, account: task.account, signal: task.controller.signal });
      task.controller.signal.throwIfAborted();
      const response = await fetch(media.url, { headers: { ...media.headers, 'Accept-Encoding': 'identity' }, signal: task.controller.signal });
      if (!response.ok) throw new Error(`音频下载失败（HTTP ${response.status}）`);
      const mimeType = (response.headers.get('Content-Type') || media.mimeType || 'application/octet-stream').split(';')[0];
      if (mimeType === 'text/html') throw new Error('音频源返回了网页而非音频，无法下载。');
      const extension = extensions[mimeType] || extname(new URL(media.url).pathname) || '.audio';
      const name = filename(task.name || `${task.track?.artist ? task.track.artist + ' - ' : ''}${task.track?.title || media.title || task.id}`);
      task.destination = join(directory, `${name} (${filename(task.id)})${extension}`);
      task.partFile = `${task.destination}.part`;
      task.mimeType = mimeType;
      task.totalBytes = Number(response.headers.get('Content-Length') || media.contentLength || 0);
      task.status = 'downloading'; task.updatedAt = Date.now();
      await persist();
      const progress = new Transform({ transform(chunk, encoding, callback) {
        task.bytes += chunk.length;
        task.progress = task.totalBytes ? Math.min(task.bytes / task.totalBytes, 1) : 0;
        task.updatedAt = Date.now();
        callback(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(task.partFile), { signal: task.controller.signal });
      await rename(task.partFile, task.destination);
      task.status = 'completed'; task.progress = 1; task.totalBytes = task.bytes;
      delete task.partFile;
    } catch (error) {
      task.status = task.controller.signal.aborted ? 'cancelled' : 'failed';
      if (task.status === 'failed') task.error = error.message;
      if (task.partFile) await rm(task.partFile, { force: true });
    }
    task.updatedAt = Date.now();
    delete task.account;
    await persist();
  }

  return {
    async start(input, origin, account) {
      await load();
      const id = input.id || input.track?.id;
      if (!id) throw new Error('下载任务需要曲目 id。');
      const existing = tasks.get(id);
      if (existing && ['queued', 'resolving', 'downloading', 'completed'].includes(existing.status)) return view(existing, origin);
      const task = { id, status: 'queued', bytes: 0, totalBytes: 0, progress: 0,
        quality: input.quality || 'auto', container: input.container || '', track: input.track,
        name: input.name || input.track?.title || id, createdAt: Date.now(), updatedAt: Date.now(),
        sourceUrl: input.url || (input.track?.source === 'audio' ? input.track.url : undefined),
        controller: new AbortController(), account };
      tasks.set(id, task);
      await persist();
      task.promise = download(task);
      return view(task, origin);
    },
    async get(id, origin) {
      await load();
      const task = tasks.get(id);
      return task ? view(task, origin) : null;
    },
    async list(origin) {
      await load();
      return { downloads: [...tasks.values()].map(task => view(task, origin)) };
    },
    async remove(id) {
      await load();
      const task = tasks.get(id);
      if (task) {
        task.controller?.abort();
        if (task.promise) await task.promise;
        if (task.destination) await rm(task.destination, { force: true });
        if (task.partFile) await rm(task.partFile, { force: true });
        tasks.delete(id);
        await persist();
      }
      return { id, status: 'cancelled' };
    },
    async file(id) {
      await load();
      const task = tasks.get(id);
      return task?.status === 'completed' ? { path: task.destination, mimeType: task.mimeType } : null;
    },
  };
}
