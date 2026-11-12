import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const local = resolve(projectRoot, '../toolchain/nsh/bin', process.platform === 'win32' ? 'nsh.exe' : 'nsh');
export const nsh = process.env.NSH_BIN || (existsSync(local) ? local : 'nsh');
// Match NSH 0.5.0's generated Info.plist minimum versions for both Rust and C.
export const nshEnv = {
  ...process.env,
  NSH_CACHE: process.env.NSH_CACHE || resolve(projectRoot, '../toolchain/nsh-cache'),
  IPHONEOS_DEPLOYMENT_TARGET: '15.0',
  MACOSX_DEPLOYMENT_TARGET: '14.0',
};
