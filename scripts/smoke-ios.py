#!/usr/bin/env python3
"""Install and launch the actual simulator app on an available iPhone simulator."""
import json
from pathlib import Path
import plistlib
import subprocess
from release import ROOT, APP, run

app = ROOT / 'releases/ios/simulator' / (APP['name'] + '.app')
info = plistlib.loads((app / 'Info.plist').read_bytes())
devices = json.loads(subprocess.check_output(['xcrun', 'simctl', 'list', 'devices', 'available', '--json'], text=True))
phones = [device for runtime in devices['devices'].values() for device in runtime if device['name'].startswith('iPhone')]
phone = next((device for device in phones if device['state'] == 'Booted'), phones[0])
if phone['state'] != 'Booted':
    run('xcrun', 'simctl', 'boot', phone['udid'])
run('xcrun', 'simctl', 'bootstatus', phone['udid'], '-b')
run('xcrun', 'simctl', 'install', phone['udid'], app)
run('xcrun', 'simctl', 'launch', '--terminate-running-process', phone['udid'], info['CFBundleIdentifier'])
print(json.dumps({'simulator': phone['name'], 'applicationId': info['CFBundleIdentifier'], 'installedAndLaunched': True}))
