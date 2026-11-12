#!/usr/bin/env python3
"""Launch a packaged native desktop app and record process/window startup."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parent.parent


def smoke(target, arch, seconds):
    app = ROOT / 'releases' / f'{target}-{arch}' / 'Metrolist'
    if target == 'macos':
        bundle = app / 'Metrolist.app'
        plist = plistlib.loads((bundle / 'Contents/Info.plist').read_bytes())
        executable = bundle / 'Contents/MacOS' / plist['CFBundleExecutable']
    else:
        executable = app / ('Metrolist.exe' if target == 'windows' else 'Metrolist')
    output = ROOT / 'dist/smoke'
    output.mkdir(parents=True, exist_ok=True)
    log_path = output / f'{target}-{arch}.log'
    env = dict(os.environ)
    if target == 'linux':
        env.update(GDK_BACKEND='x11', GSK_RENDERER='cairo')
    with log_path.open('wb') as log:
        process = subprocess.Popen([str(executable)], cwd=app, env=env, stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError(f'Native application exited during startup ({process.returncode}); see {log_path}')
                time.sleep(0.25)
            result = {'target': target, 'arch': arch, 'processAliveAfterSeconds': seconds,
                      'executable': executable.relative_to(ROOT).as_posix(), 'pid': process.pid,
                      'audioOutputVerified': False}
            if target == 'linux':
                windows = subprocess.check_output(['xwininfo', '-root', '-tree'], text=True)
                (output / f'{target}-{arch}-windows.txt').write_text(windows)
                if 'Metrolist' not in windows:
                    raise RuntimeError('The native process is alive but no Metrolist X11 window was created')
                result['nativeWindowCreated'] = True
            elif target == 'windows':
                command = f'(Get-Process -Id {process.pid}).MainWindowHandle.ToInt64()'
                handle = subprocess.check_output(['powershell', '-NoProfile', '-Command', command], text=True).strip()
                if int(handle) == 0:
                    raise RuntimeError('The native process is alive but no application window was created')
                result['nativeWindowCreated'] = True
            else:
                # Process liveness on macOS is separate from a screenshot or accessibility audit.
                result['nativeWindowCreated'] = 'not checked'
            log.flush()
            text = log_path.read_text(errors='replace')
            if re.search(r'panicked at|binding failed|Error resolving module|No native module|cannot load shared library', text, re.IGNORECASE):
                raise RuntimeError(f'Native runtime reported a startup failure; see {log_path}')
            (output / f'{target}-{arch}.json').write_text(json.dumps(result, indent=2) + '\n')
            print(json.dumps(result))
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target', choices=('linux', 'windows', 'macos'))
    parser.add_argument('--arch', choices=('x64', 'arm64'), required=True)
    parser.add_argument('--seconds', type=float, default=12)
    args = parser.parse_args()
    smoke(args.target, args.arch, args.seconds)
