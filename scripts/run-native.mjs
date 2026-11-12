#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
import { spawnSync } from 'node:child_process';
import { nsh, nshEnv, projectRoot } from './nsh-path.mjs';

// Optional npm convenience entry. The native app does not start a gateway.
const defaults = { darwin: 'macos', win32: 'windows', linux: 'linux' };
const args = process.argv.slice(2);
const requested = args[0] && !args[0].startsWith('-') ? args.shift() : defaults[process.platform];
const target = requested === 'mac' ? 'macos' : requested;
const result = spawnSync(nsh, ['run', '--target', target, ...args], { cwd: projectRoot, env: nshEnv, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
