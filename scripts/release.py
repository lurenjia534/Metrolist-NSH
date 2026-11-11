#!/usr/bin/env python3
"""Build Android release assets, collect CI outputs, and publish their GitHub Release."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
APP = json.loads((ROOT / 'nsh.json').read_text())
VERSION = APP['version']
CONFIG = json.loads((ROOT / 'scripts/release-config.json').read_text())
OUTPUT = ROOT / 'dist/release'


def run(*args, **options):
    subprocess.run([str(value) for value in args], check=True, **options)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def source_revision():
    return {
        'gitCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'gitDirty': bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip()),
    }


def report_artifact(path, **values):
    report = {'file': path.name, 'version': VERSION, 'bytes': path.stat().st_size,
              'sha256': digest(path), **source_revision(), **values}
    path.with_name(path.name + '.build-info.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


def prepare_android():
    directory = ROOT.parent / 'toolchain/signing'
    directory.mkdir(parents=True, exist_ok=True)
    key = directory / 'metrolist-release.jks'
    password = directory / 'metrolist-password'
    encoded = os.environ.get('ANDROID_KEYSTORE_BASE64')
    if encoded:
        key.write_bytes(base64.b64decode(encoded))
        password.write_text(os.environ['ANDROID_KEYSTORE_PASSWORD'])
        key.chmod(0o600)
        password.chmod(0o600)
    if not key.exists() or not password.exists():
        raise RuntimeError('Android release signing is not configured. Restore the 0.5 preview key or set ANDROID_KEYSTORE_BASE64 and ANDROID_KEYSTORE_PASSWORD.')


def android():
    prepare_android()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    toolchain = ROOT.parent / 'toolchain'
    for variant, abi in (('universal', 'arm64-v8a,armeabi-v7a,x86_64'), ('arm64', 'arm64-v8a')):
        destination = ROOT / 'releases/android' / variant
        run(sys.executable, ROOT / 'scripts/build-android.py', '--toolchain', toolchain,
            '--sdk', toolchain / 'android-sdk', '--abi', abi, '--out', destination,
            '--application-id', CONFIG['androidApplicationId'], '--application-name', CONFIG['androidApplicationName'], cwd=ROOT)
        original = destination / f'Metrolist-{VERSION}-{variant}.apk'
        verify = subprocess.check_output(['java', '-jar', str(toolchain / 'android-sdk/build-tools/35.0.1/lib/apksigner.jar'),
                                         'verify', '--verbose', '--print-certs', str(original)], text=True)
        certificate = re.search(r'Signer #1 certificate SHA-256 digest: ([0-9a-f]+)', verify).group(1)
        if certificate != CONFIG['androidSigningCertificateSha256']:
            raise RuntimeError('Android signing certificate differs from the existing 0.5 preview identity. This APK is not staged for release.')
        final = OUTPUT / f'Metrolist-NSH-{VERSION}-android-{variant}.apk'
        shutil.copy2(original, final)
        report = json.loads((destination / 'build-info.json').read_text())
        report.update(file=final.name, signingCertificateSha256=certificate)
        final.with_name(final.name + '.build-info.json').write_text(json.dumps(report, indent=2) + '\n')


def apple_prepare():
    required = ('IOS_CERTIFICATE_P12_BASE64', 'IOS_CERTIFICATE_PASSWORD', 'IOS_PROVISION_PROFILE_BASE64', 'IOS_SIGNING_IDENTITY')
    if not all(os.environ.get(name) for name in required):
        raise RuntimeError('Optional iOS signing needs all four documented IOS_* secrets.')
    directory = Path(os.environ['RUNNER_TEMP']) / 'metrolist-ios-signing'
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    certificate = directory / 'identity.p12'
    profile = directory / 'Metrolist.mobileprovision'
    keychain = directory / 'signing.keychain-db'
    certificate.write_bytes(base64.b64decode(os.environ['IOS_CERTIFICATE_P12_BASE64']))
    profile.write_bytes(base64.b64decode(os.environ['IOS_PROVISION_PROFILE_BASE64']))
    certificate.chmod(0o600)
    profile.chmod(0o600)
    password = secrets.token_urlsafe(32)
    commands = [
        ['create-keychain', '-p', password, str(keychain)],
        ['set-keychain-settings', '-lut', '21600', str(keychain)],
        ['unlock-keychain', '-p', password, str(keychain)],
        ['import', str(certificate), '-k', str(keychain), '-P', os.environ['IOS_CERTIFICATE_PASSWORD'], '-T', '/usr/bin/codesign'],
        ['set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', password, str(keychain)],
        ['list-keychains', '-d', 'user', '-s', str(keychain)],
    ]
    for command in commands:
        completed = subprocess.run(['security', *command], capture_output=True)
        if completed.returncode:
            raise RuntimeError('Apple signing preparation failed at security ' + command[0])
    with Path(os.environ['GITHUB_ENV']).open('a') as stream:
        stream.write(f'IOS_PROVISION_PROFILE={profile}\nIOS_KEYCHAIN_PATH={keychain}\n')
    print('Prepared temporary iOS signing keychain and provisioning profile.')


def collect(inputs):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    current = source_revision()
    if current['gitDirty']:
        raise RuntimeError('Commit the release source before collecting versioned release assets.')
    for source in sorted(inputs.rglob('*')):
        if source.is_file():
            if source.name.endswith('.build-info.json'):
                provenance = json.loads(source.read_text())
                if provenance['gitCommit'] != current['gitCommit'] or provenance['gitDirty']:
                    raise RuntimeError(f'{source.name} was not built from this clean release commit.')
            shutil.copy2(source, OUTPUT / source.name)
    source_zip = OUTPUT / f'Metrolist-NSH-{VERSION}-source.zip'
    run('git', 'archive', '--format=zip', f'--prefix=Metrolist-NSH-{VERSION}/', '-o', source_zip, 'HEAD', cwd=ROOT)
    expected = {
        'Android arm64': f'Metrolist-NSH-{VERSION}-android-arm64.apk',
        'Android universal': f'Metrolist-NSH-{VERSION}-android-universal.apk',
        'Linux x64': f'Metrolist-NSH-{VERSION}-linux-x64.tar.gz',
        'Windows x64': f'Metrolist-NSH-{VERSION}-windows-x64.zip',
        'macOS Apple Silicon': f'Metrolist-NSH-{VERSION}-macos-arm64.zip',
        'macOS Intel': f'Metrolist-NSH-{VERSION}-macos-x64.zip',
        'iOS Simulator arm64': f'Metrolist-NSH-{VERSION}-ios-simulator-arm64.zip',
        'iOS device unsigned': f'Metrolist-NSH-{VERSION}-ios-device-arm64-unsigned.ipa',
        'Web': f'Metrolist-NSH-{VERSION}-web.zip',
    }
    missing = [label for label, filename in expected.items() if not (OUTPUT / filename).exists()]
    results = json.loads(os.environ.get('BUILD_RESULTS', '{}'))
    failed = [name for name, value in results.items() if value.get('result') in ('failure', 'cancelled')]
    complete = not missing and not failed
    manifest = {'version': VERSION, **source_revision(), 'complete': complete, 'missingPlatforms': missing,
                'failedJobs': failed, 'workflowResults': results,
                'assets': [{'file': p.name, 'bytes': p.stat().st_size, 'sha256': digest(p)}
                           for p in sorted(OUTPUT.iterdir()) if p.is_file()]}
    (OUTPUT / 'release-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    notes_source = ROOT / 'docs' / f'releases-{VERSION}.md'
    notes = notes_source.read_text() if notes_source.exists() else f'# Metrolist NSH {VERSION}\n'
    notes += f"\n\n## 本次构建\n\nCommit: `{manifest['gitCommit']}`\n\n"
    if not complete:
        notes += '**平台产物正在补齐。此 Release 暂标为预发布；只下载下面已列出的实际产物。**\n\n'
        if missing:
            notes += '待补齐：' + '、'.join(missing) + '。Android 需要配置既有 preview 签名，不会用随机密钥替代。\n\n'
        if failed:
            notes += '待修复的 CI job：' + '、'.join(failed) + '。\n\n'
    repo = os.environ.get('GITHUB_REPOSITORY', 'lurenjia534/Metrolist-NSH')
    notes += '| 平台 | 下载 |\n| --- | --- |\n'
    for label, filename in expected.items():
        if (OUTPUT / filename).exists():
            notes += f'| {label} | [{filename}](https://github.com/{repo}/releases/download/v{VERSION}/{filename}) |\n'
    notes += f'\n[在线 Web]({CONFIG["siteUrl"]}) · [完整源码](https://github.com/{repo}/releases/download/v{VERSION}/{source_zip.name})\n\n'
    notes += '每个二进制旁有构建报告；完整 SHA-256 见 `SHA256SUMS.txt`。iOS unsigned IPA 需要重新签名，Simulator 包仅供 Apple Silicon Mac 模拟器。\n'
    (OUTPUT / 'RELEASE_NOTES.md').write_text(notes)
    lines = [f'{digest(path)}  {path.name}\n' for path in sorted(OUTPUT.iterdir()) if path.is_file() and path.name != 'SHA256SUMS.txt']
    (OUTPUT / 'SHA256SUMS.txt').write_text(''.join(lines))
    print(json.dumps({'version': VERSION, 'complete': complete, 'missingPlatforms': missing, 'assets': len(manifest['assets'])}))


def publish():
    manifest = json.loads((OUTPUT / 'release-manifest.json').read_text())
    if manifest['gitDirty']:
        raise RuntimeError('A release manifest from an uncommitted working tree cannot be published.')
    tag = 'v' + VERSION
    ref = os.environ.get('GITHUB_REF', '')
    if ref.startswith('refs/tags/') and ref != 'refs/tags/' + tag:
        raise RuntimeError('Release tag does not match nsh.json version.')
    assets = [str(path) for path in sorted(OUTPUT.iterdir()) if path.is_file()]
    exists = subprocess.run(['gh', 'release', 'view', tag], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    refs = subprocess.check_output(['git', 'ls-remote', '--tags', 'origin', f'refs/tags/{tag}', f'refs/tags/{tag}^{{}}'], cwd=ROOT, text=True)
    remote = {line.split()[1]: line.split()[0] for line in refs.splitlines()}
    tagged_commit = remote.get(f'refs/tags/{tag}^{{}}', remote.get(f'refs/tags/{tag}'))
    if tagged_commit and tagged_commit != manifest['gitCommit']:
        raise RuntimeError(f'{tag} already points to {tagged_commit}; these artifacts were built from {manifest["gitCommit"]}. Use a new version and tag.')
    if exists and not tagged_commit:
        raise RuntimeError(f'{tag} has a release but no readable immutable tag. Resolve its target before uploading assets.')
    options = ['--title', f'Metrolist NSH {VERSION}', '--notes-file', str(OUTPUT / 'RELEASE_NOTES.md'),
               '--prerelease=' + str(not manifest['complete']).lower(), '--latest=' + str(manifest['complete']).lower()]
    if exists:
        run('gh', 'release', 'upload', tag, *assets, '--clobber', cwd=ROOT)
        run('gh', 'release', 'edit', tag, *options, cwd=ROOT)
    else:
        run('gh', 'release', 'create', tag, '--target', manifest['gitCommit'], *options, *assets, cwd=ROOT)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('android')
    sub.add_parser('apple-prepare')
    gather = sub.add_parser('collect')
    gather.add_argument('--inputs', type=Path, required=True)
    sub.add_parser('publish')
    args = parser.parse_args()
    if args.command == 'android': android()
    elif args.command == 'apple-prepare': apple_prepare()
    elif args.command == 'collect': collect(args.inputs)
    elif args.command == 'publish': publish()
