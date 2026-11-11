#!/usr/bin/env python3
"""Package desktop apps with their own Node gateway, or archive the web build."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
TEMPLATES = ROOT / 'scripts/portable'
APP = json.loads((ROOT / 'nsh.json').read_text())
VERSION = APP['version']
NODE = json.loads((ROOT / 'scripts/node-toolchain.json').read_text())
TOOLCHAIN = ROOT.parent / 'toolchain'


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


def bundle_node(target, arch, destination):
    item = NODE['archives'][f'{target}-{arch}']
    archive = TOOLCHAIN / 'node-downloads' / item['file']
    archive.parent.mkdir(parents=True, exist_ok=True)
    if not archive.exists():
        temporary = archive.with_name(archive.name + '.part')
        run('curl', '--fail', '--location', '--silent', '--show-error', '--output', temporary,
            NODE['downloadBase'] + '/' + item['file'])
        temporary.replace(archive)
    if digest(archive) != item['sha256']:
        raise RuntimeError(f'Node archive checksum mismatch: {archive}')
    destination.mkdir(parents=True, exist_ok=True)
    executable = destination / ('node.exe' if target == 'windows' else 'node')
    if target == 'windows':
        with zipfile.ZipFile(archive) as package:
            prefix = archive.name.removesuffix('.zip')
            executable.write_bytes(package.read(prefix + '/node.exe'))
            (destination / 'NODE-LICENSE.txt').write_bytes(package.read(prefix + '/LICENSE'))
    else:
        with tarfile.open(archive) as package:
            prefix = archive.name.removesuffix('.tar.gz').removesuffix('.tar.xz')
            binary = package.getmember(prefix + '/bin/node')
            license_file = package.getmember(prefix + '/LICENSE')
            executable.write_bytes(package.extractfile(binary).read())
            (destination / 'NODE-LICENSE.txt').write_bytes(package.extractfile(license_file).read())
        executable.chmod(0o755)
    return executable


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
    run('node', ROOT / 'scripts/run-nsh.mjs', 'package', '--target', target,
        '--out', native_out, cwd=ROOT)
    app = native_out / APP['name']
    if target == 'macos':
        shutil.rmtree(app, ignore_errors=True)
        app.mkdir(parents=True)
        bundle = app / (APP['name'] + '.app')
        shutil.move(str(native_out / bundle.name), bundle)
        resources = bundle / 'Contents/Resources'
        executable = '../MacOS/' + APP['name']
        launcher = bundle / 'Contents/MacOS/MetrolistLauncher'
        shutil.copy2(TEMPLATES / 'macos/launch.sh', launcher)
        launcher.chmod(0o755)
        plist_path = bundle / 'Contents/Info.plist'
        info = plistlib.loads(plist_path.read_bytes())
        info['CFBundleExecutable'] = 'MetrolistLauncher'
        plist_path.write_bytes(plistlib.dumps(info))
    else:
        resources = app
        extension = '.exe' if target == 'windows' else ''
        executable = APP['name'] + '-native' + extension
        (app / (APP['name'] + extension)).rename(app / executable)
        if target == 'linux':
            shutil.copy2(TEMPLATES / 'linux/start.sh', app / APP['name'])
            (app / APP['name']).chmod(0o755)
            shutil.copy2(TEMPLATES / 'linux/start.sh', app / 'start.sh')
            (app / 'start.sh').chmod(0o755)
        else:
            compiler = Path(os.environ['WINDIR']) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
            run(compiler, '/nologo', '/target:winexe', '/optimize+',
                f'/out:{app / (APP["name"] + ".exe")}', f'/win32icon:{app / "nsh/icon.ico"}',
                TEMPLATES / 'windows/Launcher.cs')
            shutil.copy2(TEMPLATES / 'windows/start.cmd', app / 'start.cmd')
    node = bundle_node(target, arch, resources / 'runtime')
    shutil.copytree(TEMPLATES / 'gateway', resources / 'gateway', dirs_exist_ok=True)
    copy_service(resources / 'gateway/server')
    (resources / 'portable.json').write_text(json.dumps({'version': VERSION, 'executable': executable}) + '\n')
    copy_notices(app)
    shutil.copy2(TEMPLATES / target / 'START_HERE.md', app / 'START_HERE.md')
    if target == 'macos':
        run('codesign', '--force', '--deep', '--sign', '-', '--timestamp=none', bundle)
        run('codesign', '--verify', '--deep', '--strict', bundle)
    actual_node = subprocess.check_output([str(node), '--version'], text=True).strip()
    if actual_node != 'v' + NODE['version']:
        raise RuntimeError(f'Wrong embedded Node version: {actual_node}')
    run(node, '--use-env-proxy', '--max-http-header-size=65536', resources / 'gateway/launch.mjs', '--check')
    if target == 'windows':
        run(app / (APP['name'] + '.exe'), '--check')
    extension = 'tar.gz' if target == 'linux' else 'zip'
    archive = output / f'Metrolist-NSH-{VERSION}-{target}-{arch}.{extension}'
    archive_directory(app, archive, target)
    build_info(archive, {'target': target, 'arch': arch, 'nodeVersion': actual_node,
                        'bundledGateway': True, 'gatewayHealthCheck': 'passed',
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
