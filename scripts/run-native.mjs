#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaults = { darwin: 'macos', win32: 'windows', linux: 'linux' };
const requested = process.argv[2] || defaults[process.platform];
const target = requested === 'mac' ? 'macos' : requested;
const port = process.env.PORT || '8787';
const cli = process.env.NSH_BIN || 'nsh';
const gateway = spawn(process.execPath, ['--use-env-proxy', '--max-http-header-size=65536', 'server/dev.mjs'], {
  cwd: root,
  env: { ...process.env, PORT: port, PYTHON: process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3') },
  stdio: ['inherit', 'pipe', 'inherit'],
});
let native;
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  gateway.kill();
  native?.kill();
  process.exitCode = code;
}

gateway.stdout.on('data', (data) => {
  process.stdout.write(data);
  if (native || !data.toString().includes('Metrolist NSH:')) return;
  console.log(`Native target: ${target}; gateway: http://127.0.0.1:${port}`);
  if (target === 'android' || target === 'ios') {
    console.log('手机中的服务地址请填写电脑的局域网 IP；USB Android 也可先运行 adb reverse tcp:8787 tcp:8787。');
  }
  native = spawn(cli, ['run', '--target', target, ...process.argv.slice(3)], { cwd: root, stdio: 'inherit' });
  native.on('error', (error) => { console.error(error.message); stop(1); });
  native.on('exit', (code) => stop(code ?? 0));
});
gateway.on('error', (error) => { console.error(error.message); stop(1); });
gateway.on('exit', (code) => stop(code ?? 0));
process.once('SIGINT', () => stop(130));
process.once('SIGTERM', () => stop(143));
