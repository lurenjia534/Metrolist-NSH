#!/usr/bin/env python3
"""Build the pinned NSH ARM64 simulator and unsigned/signed iOS device releases."""
import argparse
import os
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess
from release import ROOT, APP, VERSION, CONFIG, OUTPUT, report_artifact, run
from nsh_path import NSH, NSH_ENV


def package(target, directory, icon, signing=False):
    command = [NSH, 'package', '--target', target,
               '--id', CONFIG['iosApplicationId'], '--icon', icon, '--out', directory]
    if signing:
        command += ['--sign', os.environ['IOS_SIGNING_IDENTITY'], '--profile', os.environ['IOS_PROVISION_PROFILE']]
    run(*command, cwd=ROOT, env=NSH_ENV)
    return directory / (APP['name'] + '.app')


def archive_app(app, destination):
    run('ditto', '-c', '-k', '--keepParent', '--norsrc', app, destination)


def inspect(app, target, signing):
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    executable = app / info['CFBundleExecutable']
    architecture = subprocess.check_output(['lipo', '-archs', str(executable)], text=True).strip()
    if architecture != 'arm64':
        raise RuntimeError(f'Expected the pinned ARM64 iOS runtime; found {architecture}')
    return {'target': target, 'arch': architecture, 'signing': signing,
            'applicationId': info['CFBundleIdentifier'], 'minimumOSVersion': info.get('MinimumOSVersion'),
            'nshRuntimeCommit': 'c5214aa', 'runtime': 'nsh-native',
            'bundledNode': False, 'bundledGateway': False}


def main(signed_only):
    if platform.system() != 'Darwin' or platform.machine().lower() != 'arm64':
        raise RuntimeError('The pinned iOS runtime must be packaged on an Apple Silicon Mac.')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    base = ROOT / 'releases/ios'
    base.mkdir(parents=True, exist_ok=True)
    # NSH's iOS catalog declares one 1024px icon; our shared artwork is 512px.
    # Generate the exact catalog size without changing the source asset.
    icon = base / 'AppIcon-1024.png'
    run('sips', '-z', '1024', '1024', ROOT / APP['icon'], '--out', icon)
    if not signed_only:
        simulator = package('ios-simulator', base / 'simulator', icon)
        run('codesign', '--verify', '--deep', '--strict', simulator)
        archive = OUTPUT / f'Metrolist-NSH-{VERSION}-ios-simulator-arm64.zip'
        archive_app(simulator, archive)
        report_artifact(archive, **inspect(simulator, 'ios-simulator', 'ad-hoc'))
        device = package('ios', base / 'unsigned', icon)
        app_zip = OUTPUT / f'Metrolist-NSH-{VERSION}-ios-device-arm64-unsigned.app.zip'
        archive_app(device, app_zip)
        values = inspect(device, 'ios-device', 'unsigned; requires user signing')
        report_artifact(app_zip, **values)
        payload = base / 'unsigned-ipa/Payload'
        shutil.rmtree(payload.parent, ignore_errors=True)
        payload.mkdir(parents=True)
        shutil.copytree(device, payload / device.name)
        ipa = OUTPUT / f'Metrolist-NSH-{VERSION}-ios-device-arm64-unsigned.ipa'
        archive_app(payload, ipa)
        report_artifact(ipa, **values)
    else:
        device = package('ios', base / 'signed', icon, signing=True)
        run('codesign', '--verify', '--deep', '--strict', device)
        ipa = OUTPUT / f'Metrolist-NSH-{VERSION}-ios-device-arm64-signed.ipa'
        shutil.copy2(base / 'signed' / (APP['name'] + '.ipa'), ipa)
        report_artifact(ipa, **inspect(device, 'ios-device', 'provisioned'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--signed-only', action='store_true')
    main(parser.parse_args().signed_only)
