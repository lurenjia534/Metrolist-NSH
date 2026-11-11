"""Download the exact NSH build inputs from the versioned project mirror."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

PROJECT = Path(__file__).resolve().parent.parent
LOCK = json.loads((PROJECT / 'scripts/nsh-toolchain.json').read_text())


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def archive_spec(target):
    if target == 'source':
        return LOCK['source'], LOCK['source']['url']
    item = LOCK['archives'][target]
    return item, LOCK['downloadBase'].rstrip('/') + '/' + item['file']


def fetch_archive(target, toolchain):
    item, upstream = archive_spec(target)
    filename = item['file']
    extension = '.zip' if filename.endswith('.zip') else '.tar.gz'
    cached = filename if target == 'source' else filename.removesuffix(extension) + '-' + LOCK['commit'] + extension
    archive = toolchain / 'downloads' / cached
    archive.parent.mkdir(parents=True, exist_ok=True)
    if not archive.exists():
        mirror = os.environ.get('NSH_DOWNLOAD_BASE', LOCK['mirrorDownloadBase']).rstrip('/') + '/' + filename
        temporary = archive.with_name(archive.name + '.part')
        print(f'Downloading {filename} ({LOCK["commit"]})', flush=True)
        command = ['curl', '--fail', '--location', '--silent', '--show-error',
                   '--output', str(temporary), '--write-out', '%{http_code}']
        result = subprocess.run([*command, mirror], capture_output=True, text=True)
        # Only the first publication may bootstrap a missing mirror asset.
        if result.returncode and result.stdout.strip() == '404':
            print(f'Mirror asset is not published yet; fetching its pinned upstream input: {filename}', flush=True)
            result = subprocess.run([*command, upstream], capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(f'NSH archive download failed for {filename}: {result.stderr.strip()}')
        if digest(temporary) != item['sha256']:
            raise RuntimeError(f'{filename} does not match NSH {LOCK["commit"]}; the fixed archive must be restored, not replaced with a newer nightly.')
        temporary.replace(archive)
    if digest(archive) != item['sha256']:
        raise RuntimeError(f'Cached {archive.name} does not match NSH {LOCK["commit"]}.')
    return archive
