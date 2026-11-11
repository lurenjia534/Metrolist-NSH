#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway } from './server/dev.mjs';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(resolve(appDirectory, 'portable.json'), 'utf8'));
const checking = process.argv.includes('--check');
const port = checking ? 0 : Number(process.env.PORT || 8787);
process.env.PYTHON ||= process.platform === 'win32' ? 'python' : 'python3';
const server = createGateway();
let native;
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  native?.kill();
  server.closeAllConnections();
  server.close();
  process.exitCode = code;
}

server.on('error', error => { console.error(error.message); stop(1); });
server.listen(port, process.env.HOST || '127.0.0.1', async () => {
  const address = `http://127.0.0.1:${server.address().port}`;
  if (checking) {
    try {
      const response = await fetch(`${address}/api/health`);
      const health = await response.json();
      if (!response.ok || !health.ok || health.service !== 'metrolist-nsh') throw new Error('Gateway health check failed');
      console.log(JSON.stringify({ node: process.version, gateway: health, version: config.version }));
      stop();
    } catch (error) { console.error(error.message); stop(1); }
    return;
  }
  console.log(`Metrolist music gateway: ${address}`);
  native = spawn(resolve(appDirectory, config.executable), process.argv.slice(2), { cwd: appDirectory, stdio: 'inherit' });
  native.on('error', (error) => { console.error(error.message); stop(1); });
  native.on('exit', (code) => stop(code ?? 0));
});
process.once('SIGINT', () => stop(130));
process.once('SIGTERM', () => stop(143));
