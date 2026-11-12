"""Locate the project's pinned NSH toolchain without a Node launcher."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
local = ROOT.parent / 'toolchain/nsh/bin' / ('nsh.exe' if os.name == 'nt' else 'nsh')
NSH = os.environ.get('NSH_BIN') or (str(local) if local.exists() else 'nsh')
# Match NSH 0.5.0's generated Info.plist minimum versions for Rust and C alike.
NSH_ENV = {
    **os.environ,
    'NSH_CACHE': os.environ.get('NSH_CACHE', str(ROOT.parent / 'toolchain/nsh-cache')),
    'IPHONEOS_DEPLOYMENT_TARGET': '15.0',
    'MACOSX_DEPLOYMENT_TARGET': '14.0',
}
