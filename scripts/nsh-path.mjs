import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const local = resolve(projectRoot, '../toolchain/nsh/bin', process.platform === 'win32' ? 'nsh.exe' : 'nsh');
export const nsh = process.env.NSH_BIN || (existsSync(local) ? local : 'nsh');
export const nshEnv = { ...process.env, NSH_CACHE: process.env.NSH_CACHE || resolve(projectRoot, '../toolchain/nsh-cache') };
