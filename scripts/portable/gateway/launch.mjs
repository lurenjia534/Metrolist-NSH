#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway } from './server/dev.mjs';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executable = resolve(appDirectory, process.platform === 'win32' ? 'Metrolist.exe' : 'Metrolist');
const port = Number(process.env.PORT || 8787);
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

server.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`Metrolist music gateway: http://127.0.0.1:${port}`);
  native = spawn(executable, [], { cwd: appDirectory, stdio: 'inherit' });
  native.on('error', (error) => { console.error(error.message); stop(1); });
  native.on('exit', (code) => stop(code ?? 0));
});
process.once('SIGINT', () => stop(130));
process.once('SIGTERM', () => stop(143));
