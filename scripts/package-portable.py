#!/usr/bin/env python3
"""Package the native NSH desktop application, or archive the separate web build."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess
import tarfile
import zipfile
from nsh_path import NSH, NSH_ENV

ROOT = Path(__file__).resolve().parent.parent
TEMPLATES = ROOT / 'scripts/portable'
APP = json.loads((ROOT / 'nsh.json').read_text(encoding='utf-8'))
VERSION = APP['version']
NSH_LOCK = json.loads((ROOT / 'scripts/nsh-toolchain.json').read_text())


def run(*args, **options):
    subprocess.run([str(value) for value in args], check=True, **options)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def revision():
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip())
    return {'gitCommit': commit, 'gitDirty': dirty}


def copy_service(destination):
    destination.mkdir(parents=True, exist_ok=True)
    for source in sorted((ROOT / 'server').glob('*.mjs')):
        if not source.name.endswith('.test.mjs'):
            shutil.copy2(source, destination / source.name)
    shutil.copy2(ROOT / 'server/requirements.txt', destination / 'requirements.txt')


def copy_notices(destination):
    for name in ('README.md', 'COPYING', 'NOTICE.md'):
        shutil.copy2(ROOT / name, destination / name)
    shutil.copytree(ROOT / 'docs', destination / 'docs', dirs_exist_ok=True)
    (destination / 'licenses').mkdir(exist_ok=True)
    shutil.copy2(TEMPLATES / 'NSH-LICENSE-APACHE.txt', destination / 'licenses/NSH-APACHE-2.0.txt')
    shutil.copytree(ROOT / 'third-party', destination / 'licenses/third-party', dirs_exist_ok=True)


def verify_native_package(app, target):
    """Inspect the packaged executable and bundle; this is not a GUI smoke test."""
    if target == 'macos':
        bundle = app / (APP['name'] + '.app')
        info = plistlib.loads((bundle / 'Contents/Info.plist').read_bytes())
        executable = bundle / 'Contents/MacOS' / info['CFBundleExecutable']
        resources = bundle / 'Contents/Resources/nsh'
    else:
        executable = app / (APP['name'] + ('.exe' if target == 'windows' else ''))
        resources = app / 'nsh'
    with executable.open('rb') as stream:
        magic = stream.read(4)
    formats = {'linux': (b'\x7fELF',), 'windows': (b'MZ',),
               'macos': (b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca')}
    if not any(magic.startswith(prefix) for prefix in formats[target]):
        raise RuntimeError(f'{executable} is not a native {target} executable')
    if not (resources / 'bundle.nshc').stat().st_size:
        raise RuntimeError('The packaged NSH application bundle is empty')
    metadata = json.loads((resources / 'app.json').read_text(encoding='utf-8'))
    if metadata['id'] != APP['id'] or metadata['version'] != VERSION:
        raise RuntimeError('Packaged NSH metadata differs from nsh.json')
    if metadata.get('window') != APP['window']:
        raise RuntimeError('Packaged window metadata differs from nsh.json')
    obsolete = [path.relative_to(app).as_posix() for path in app.rglob('*')
                if path.name in ('node', 'node.exe', 'gateway', 'MetrolistLauncher', 'Launcher.cs', 'portable.json')]
    if obsolete:
        raise RuntimeError('Desktop package includes obsolete gateway files: ' + ', '.join(obsolete))
    return {'nativeExecutable': executable.relative_to(app).as_posix(),
            'nativeExecutableSha256': digest(executable), 'nativeBundleSha256': digest(resources / 'bundle.nshc'),
            'nativePackageCheck': 'passed', 'bundledNode': False, 'bundledGateway': False}


def archive_directory(app, archive, target):
    archive.parent.mkdir(parents=True, exist_ok=True)
    if target == 'linux':
        with tarfile.open(archive, 'w:gz', compresslevel=6) as stream:
            stream.add(app, arcname=app.name)
    elif target == 'macos':
        run('ditto', '-c', '-k', '--keepParent', '--norsrc', app, archive)
    else:
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as stream:
            for path in sorted(app.rglob('*')):
                if path.is_file():
                    stream.write(path, str(Path(app.name) / path.relative_to(app)))


def build_info(archive, values):
    info = {'file': archive.name, 'version': VERSION, 'bytes': archive.stat().st_size,
            'sha256': digest(archive), **revision(), **values}
    archive.with_name(archive.name + '.build-info.json').write_text(json.dumps(info, indent=2) + '\n')
    print(json.dumps(info))


def package(target, output, arch):
    if target == 'web':
        app = ROOT / 'releases/web/Metrolist-Web'
        shutil.rmtree(app, ignore_errors=True)
        shutil.copytree(ROOT / 'dist/client', app / 'dist/client')
        shutil.copytree(ROOT / 'dist/server', app / 'worker')
        copy_service(app / 'server')
        (app / 'package.json').write_text(json.dumps({
            'name': 'metrolist-nsh-web', 'version': VERSION, 'private': True,
            'type': 'module', 'license': 'GPL-3.0-only',
            'scripts': {'dev': 'node --max-http-header-size=65536 --use-env-proxy server/dev.mjs'},
        }, indent=2) + '\n')
        copy_notices(app)
        shutil.copy2(TEMPLATES / 'web/START_HERE.md', app / 'START_HERE.md')
        archive = output / f'Metrolist-NSH-{VERSION}-web.zip'
        archive_directory(app, archive, target)
        build_info(archive, {'target': 'web', 'gateway': True, 'siteDeployment': 'separate'})
        return

    native_out = ROOT / 'releases' / f'{target}-{arch}'
    run(NSH, 'package', '--target', target, '--out', native_out, cwd=ROOT, env=NSH_ENV)
    app = native_out / APP['name']
    if target == 'macos':
        shutil.rmtree(app, ignore_errors=True)
        app.mkdir(parents=True)
        bundle = app / (APP['name'] + '.app')
        shutil.move(str(native_out / bundle.name), bundle)
    else:
        # Keep the portable package's window settings identical to the manifest.
        metadata = app / 'nsh/app.json'
        info = json.loads(metadata.read_text(encoding='utf-8'))
        info['window'] = APP['window']
        metadata.write_text(json.dumps(info, ensure_ascii=False) + '\n', encoding='utf-8')
    copy_notices(app)
    shutil.copy2(ROOT / 'native/Cargo.lock', app / 'licenses/MetrolistNative-Cargo.lock')
    shutil.copy2(ROOT / '.nsh/rust/Cargo.lock', app / 'licenses/NativeRuntime-Cargo.lock')
    shutil.copy2(TEMPLATES / target / 'START_HERE.md', app / 'START_HERE.md')
    if target == 'macos':
        run('codesign', '--verify', '--deep', '--strict', bundle)
    package_check = verify_native_package(app, target)
    extension = 'tar.gz' if target == 'linux' else 'zip'
    archive = output / f'Metrolist-NSH-{VERSION}-{target}-{arch}.{extension}'
    archive_directory(app, archive, target)
    rustc = subprocess.check_output(['rustc', '--version'], env=NSH_ENV, text=True).strip()
    build_info(archive, {'target': target, 'arch': arch, 'runtime': 'nsh-native', **package_check,
                        'nshRuntimeCommit': NSH_LOCK['revision'], 'rustCompiler': rustc,
                        'nativeModule': 'metrolist/native', 'nativeCargoLockSha256': digest(ROOT / 'native/Cargo.lock'),
                        'runtimeCargoLockSha256': digest(ROOT / '.nsh/rust/Cargo.lock'),
                        'signing': 'ad-hoc' if target == 'macos' else 'unsigned'})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('targets', nargs='+', choices=('linux', 'windows', 'macos', 'web'))
    parser.add_argument('--arch', choices=('x64', 'arm64'), default='arm64' if platform.machine().lower() in ('aarch64', 'arm64') else 'x64')
    parser.add_argument('--out', type=Path, default=ROOT / 'dist/release')
    args = parser.parse_args()
    args.out = args.out.resolve()
    args.out.mkdir(parents=True, exist_ok=True)
    for target in args.targets:
        package(target, args.out, args.arch)
