#!/usr/bin/env python3
"""Preserve the locked upstream NSH binaries and source in a versioned Release."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
from nsh_archives import PROJECT, LOCK, archive_spec, digest, fetch_archive

TAG = 'nsh-runtime-' + LOCK['commit']
OUTPUT = PROJECT / 'dist/toolchain'


def stage(toolchain):
    shutil.rmtree(OUTPUT, ignore_errors=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    archives = []
    for target in [*LOCK['archives'], 'source']:
        item, upstream = archive_spec(target)
        downloaded = fetch_archive(target, toolchain)
        destination = OUTPUT / item['file']
        shutil.copy2(downloaded, destination)
        archives.append({'target': target, 'file': destination.name, 'bytes': destination.stat().st_size,
                         'sha256': digest(destination), 'upstreamUrl': upstream})
    with tarfile.open(OUTPUT / LOCK['source']['file']) as source:
        license_file = next(item for item in source.getmembers() if item.name.count('/') == 1 and item.name.endswith('/LICENSE-APACHE'))
        (OUTPUT / 'LICENSE-APACHE.txt').write_bytes(source.extractfile(license_file).read())
    shutil.copy2(PROJECT / 'scripts/nsh-toolchain.json', OUTPUT / 'nsh-toolchain.json')
    manifest = {'tag': TAG, 'version': LOCK['version'], 'upstreamRevision': LOCK['revision'],
                'upstreamRepository': 'https://github.com/longbridge/nsh',
                'license': {'spdx': 'Apache-2.0', 'file': 'LICENSE-APACHE.txt'}, 'archives': archives}
    (OUTPUT / 'NSH-MIRROR-MANIFEST.json').write_text(json.dumps(manifest, indent=2) + '\n')
    notes = f'''# Fixed NSH build inputs: {LOCK['commit']}

Exact upstream NSH {LOCK['version']} CLI, platform runtimes, Web component and source used by Metrolist NSH.

- Upstream source: https://github.com/longbridge/nsh/tree/{LOCK['revision']}
- Upstream revision: `{LOCK['revision']}`
- License: Apache-2.0. The upstream license and complete source archive are included.
- Every archive was verified against the project's `nsh-toolchain.json` before publication.
- These assets are fixed build dependencies. Existing assets are never replaced; a different runtime needs a new tag.
- This prerelease is not the application's latest release. It contains no application signing keys or credentials.

See `NSH-MIRROR-MANIFEST.json` for original URLs, byte sizes and SHA-256 hashes, and `SHA256SUMS.txt` for every mirrored file.
'''
    (OUTPUT / 'NSH-PINNED-RUNTIME.md').write_text(notes)
    (OUTPUT / 'SHA256SUMS.txt').write_text(''.join(f'{digest(path)}  {path.name}\n' for path in sorted(OUTPUT.iterdir())
                                                if path.is_file() and path.name != 'SHA256SUMS.txt'))
    print(json.dumps({'tag': TAG, 'archives': len(archives), 'bytes': sum(item['bytes'] for item in archives)}))


def publish():
    repository = os.environ.get('GITHUB_REPOSITORY', 'lurenjia534/Metrolist-NSH')
    result = subprocess.run(['gh', 'api', f'repos/{repository}/releases/tags/{TAG}'], cwd=PROJECT, capture_output=True, text=True)
    assets = sorted(path for path in OUTPUT.iterdir() if path.is_file())
    if result.returncode:
        if 'HTTP 404' not in result.stderr:
            raise RuntimeError(result.stderr.strip())
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=PROJECT, text=True).strip()
        subprocess.run(['gh', 'release', 'create', TAG, '--repo', repository, '--target', commit,
                        '--title', f'NSH {LOCK["commit"]} fixed build dependencies', '--prerelease', '--latest=false',
                        '--notes-file', str(OUTPUT / 'NSH-PINNED-RUNTIME.md'), *map(str, assets)], cwd=PROJECT, check=True)
        return
    remote = {item['name']: item for item in json.loads(result.stdout)['assets']}
    missing = []
    for path in assets:
        if path.name not in remote:
            missing.append(str(path))
        elif remote[path.name].get('digest') != 'sha256:' + digest(path):
            raise RuntimeError(f'{TAG}/{path.name} differs from the locked input. Existing toolchain assets must not be replaced.')
    if missing:
        subprocess.run(['gh', 'release', 'upload', TAG, '--repo', repository, *missing], cwd=PROJECT, check=True)
    print(f'Fixed toolchain mirror is complete: {TAG}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--toolchain', type=Path, default=PROJECT.parent / 'toolchain')
    publication = parser.add_mutually_exclusive_group()
    publication.add_argument('--publish', action='store_true')
    publication.add_argument('--publish-only', action='store_true', help='Publish the files already verified by this job\'s staging step.')
    args = parser.parse_args()
    if not args.publish_only:
        stage(args.toolchain.resolve())
    if args.publish or args.publish_only:
        publish()
