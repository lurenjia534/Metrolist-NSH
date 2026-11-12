"""Locate the project's pinned NSH toolchain without a Node launcher."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
local = ROOT.parent / 'toolchain/nsh/bin' / ('nsh.exe' if os.name == 'nt' else 'nsh')
NSH = os.environ.get('NSH_BIN') or (str(local) if local.exists() else 'nsh')
NSH_ENV = {**os.environ, 'NSH_CACHE': os.environ.get('NSH_CACHE', str(ROOT.parent / 'toolchain/nsh-cache'))}
