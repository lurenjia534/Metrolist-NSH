import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolveAudio } from './resolve.mjs';

test('optional yt-dlp resolver shares extraction, refreshes on demand and isolates caller cancellation', async t => {
  const directory = await mkdtemp(fileURLToPath(new URL('./.probe-resolver-', import.meta.url)));
  const executable = `${directory}/extractor.mjs`;
  const callsFile = `${directory}/calls`;
  await writeFile(executable, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const id = new URL(process.argv.at(-1)).searchParams.get('v');
appendFileSync(${JSON.stringify(callsFile)}, id + '\\n');
setTimeout(() => process.stdout.write(JSON.stringify({
  url: 'https://audio.test/' + id + '?expire=' + (Math.floor(Date.now() / 1000) + 3600) + '&signature=' + process.pid,
  ext: 'm4a', format_id: '140', abr: 128, duration: 180, title: id,
})), 25);
`, { mode: 0o755 });
  const previous = process.env.YT_DLP_PATH;
  process.env.YT_DLP_PATH = executable;
  t.after(async () => {
    if (previous === undefined) delete process.env.YT_DLP_PATH;
    else process.env.YT_DLP_PATH = previous;
    await rm(directory, { recursive: true });
  });
  const calls = async () => (await readFile(callsFile, 'utf8')).trim().split('\n');

  const initial = await Promise.all(Array.from({ length: 8 }, () => resolveAudio('fixture-process-song')));
  assert.equal(new Set(initial.map(source => source.url)).size, 1);
  assert.deepEqual(await calls(), ['fixture-process-song']);
  assert.equal((await resolveAudio('fixture-process-song')).url, initial[0].url);
  assert.equal((await calls()).length, 1);

  const refreshed = await Promise.all(Array.from({ length: 6 }, () => resolveAudio('fixture-process-song', { refresh: '1' })));
  assert.notEqual(refreshed[0].url, initial[0].url);
  assert.ok(refreshed.every(source => source.url === refreshed[0].url));
  assert.equal((await resolveAudio('fixture-process-song')).url, refreshed[0].url);
  assert.equal((await calls()).length, 2);

  const controller = new AbortController();
  const cancelled = resolveAudio('fixture-shared-cancellation', { signal: controller.signal });
  const active = resolveAudio('fixture-shared-cancellation');
  controller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.match((await active).url, /fixture-shared-cancellation/);
  assert.equal((await calls()).filter(id => id === 'fixture-shared-cancellation').length, 1);
});
