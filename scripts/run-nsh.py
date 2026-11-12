#!/usr/bin/env python3
"""Run the pinned NSH CLI directly."""
import subprocess
import sys
import json
import shutil
from nsh_path import NSH, NSH_ENV, ROOT

if __name__ == '__main__':
    # Headless NSH has no dataDir or pluginDir anchor. Give local-media tests
    # their actual private fixture root, keeping the production manifest intact.
    if sys.argv[1:2] == ['test']:
        fixtures = ROOT / '.nsh/local-media'
        fixtures.mkdir(parents=True, exist_ok=True)
        config = json.loads((ROOT / 'tests/local-media/nsh.json').read_text())
        config['theme'] = str(ROOT / 'theme.json')
        config['capabilities']['fs']['read'] = [str(ROOT / 'tests/local-media/media')]
        (fixtures / 'nsh.json').write_text(json.dumps(config, indent=2) + '\n')
        for name, source in {
            'download-replacement': 'tests/download-replacement-fixture',
            'runtime': 'tests/runtime-fixture',
            'native-media': 'tests/native-media-fixture',
        }.items():
            (fixtures / f'{name}.tsx').write_text(f'import {json.dumps("../../" + source)};\n')
        # A complete app's assets must stay inside its bundle root. Copy its
        # source and resources unchanged for the full-shell local-file case.
        for directory in ('src', 'assets', 'server', 'web'):
            shutil.rmtree(fixtures / directory, ignore_errors=True)
            shutil.copytree(ROOT / directory, fixtures / directory)
        for filename in ('theme.json', 'package.json'):
            shutil.copy2(ROOT / filename, fixtures / filename)
        shutil.copy2(ROOT / 'App.tsx', fixtures / 'app.tsx')
    raise SystemExit(subprocess.run([NSH, *sys.argv[1:]], cwd=ROOT, env=NSH_ENV).returncode)
