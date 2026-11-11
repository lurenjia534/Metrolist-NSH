#!/usr/bin/env python3
"""Build native portable packages, or archive the current web build.

NSH_BIN=/path/to/nsh python3 scripts/package-portable.py linux windows
npm run build
python3 scripts/package-portable.py web
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
TEMPLATES = ROOT / 'scripts/portable'
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
SERVER_FILES = ('dev.mjs', 'auth.mjs', 'catalog.mjs', 'streaming.mjs', 'account.mjs', 'index.mjs',
                'resolve.mjs', 'downloads.mjs', 'requirements.txt')


def copy_service(destination):
    destination.mkdir(parents=True, exist_ok=True)
    for name in SERVER_FILES:
        shutil.copy2(ROOT / 'server' / name, destination / name)


def copy_notices(destination):
    for name in ('README.md', 'COPYING', 'NOTICE.md'):
        shutil.copy2(ROOT / name, destination / name)
    shutil.copytree(ROOT / 'docs', destination / 'docs', dirs_exist_ok=True)
    (destination / 'licenses').mkdir(exist_ok=True)
    shutil.copy2(TEMPLATES / 'NSH-LICENSE-APACHE.txt', destination / 'licenses/NSH-APACHE-2.0.txt')


def package(target, output):
    if target == 'web':
        app = ROOT / 'releases/web/Metrolist-Web'
        shutil.rmtree(app, ignore_errors=True)
        shutil.copytree(ROOT / 'dist/client', app / 'dist/client')
        copy_service(app / 'server')
        (app / 'package.json').write_text(json.dumps({
            'name': 'metrolist-nsh-web', 'version': VERSION, 'private': True,
            'type': 'module', 'license': 'GPL-3.0-only',
            'scripts': {'dev': 'node --max-http-header-size=65536 --use-env-proxy server/dev.mjs'},
        }, indent=2) + '\n')
    else:
        native_out = ROOT / 'releases' / target
        subprocess.run([os.environ.get('NSH_BIN', 'nsh'), 'package', '--target', target,
                        '--out', str(native_out)], cwd=ROOT, check=True)
        app = native_out / 'Metrolist'
        shutil.copytree(TEMPLATES / 'gateway', app / 'gateway', dirs_exist_ok=True)
        copy_service(app / 'gateway/server')
        start = 'start.sh' if target == 'linux' else 'start.cmd'
        shutil.copy2(TEMPLATES / target / start, app / start)
        if target == 'linux':
            (app / start).chmod(0o755)
    copy_notices(app)
    shutil.copy2(TEMPLATES / target / 'START_HERE.md', app / 'START_HERE.md')

    suffix = 'web' if target == 'web' else f'{target}-x64'
    extension = 'tar.gz' if target == 'linux' else 'zip'
    archive = output / f'Metrolist-NSH-{VERSION}-{suffix}.{extension}'
    if target == 'linux':
        with tarfile.open(archive, 'w:gz', compresslevel=6) as stream:
            stream.add(app, arcname=app.name)
    else:
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as stream:
            for path in sorted(app.rglob('*')):
                if path.is_file():
                    stream.write(path, str(Path(app.name) / path.relative_to(app)))
    print(json.dumps({'target': target, 'path': str(archive), 'bytes': archive.stat().st_size,
                      'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}))


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('targets', nargs='+', choices=('linux', 'windows', 'web'))
parser.add_argument('--out', type=Path, default=ROOT.parent / 'artifacts')
args = parser.parse_args()
args.out = args.out.resolve()
args.out.mkdir(parents=True, exist_ok=True)
for target in args.targets:
    package(target, args.out)
