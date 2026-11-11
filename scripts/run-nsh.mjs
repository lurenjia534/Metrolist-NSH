#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { nsh, nshEnv, projectRoot } from './nsh-path.mjs';

const result = spawnSync(nsh, process.argv.slice(2), { cwd: projectRoot, env: nshEnv, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
