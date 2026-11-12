#!/usr/bin/env python3
"""Run the pinned NSH CLI directly."""
import subprocess
import sys
from nsh_path import NSH, NSH_ENV, ROOT

if __name__ == '__main__':
    raise SystemExit(subprocess.run([NSH, *sys.argv[1:]], cwd=ROOT, env=NSH_ENV).returncode)
