#!/usr/bin/env python3
"""Open the NSH application with its native runtime and in-process music API."""
import subprocess
import sys
from nsh_path import NSH, NSH_ENV, ROOT

if __name__ == '__main__':
    targets = {'darwin': 'macos', 'win32': 'windows', 'linux': 'linux'}
    args = sys.argv[1:]
    target = args.pop(0) if args and not args[0].startswith('-') else targets[sys.platform]
    target = 'macos' if target == 'mac' else target
    raise SystemExit(subprocess.run([NSH, 'run', '--target', target, *args], cwd=ROOT, env=NSH_ENV).returncode)
