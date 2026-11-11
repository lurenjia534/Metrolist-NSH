#!/usr/bin/env python3
"""Install the simulator app, check it stays alive, and capture its rendered UI."""
import json
import os
from pathlib import Path
import plistlib
import subprocess
import time
from release import ROOT, APP, run, source_revision

app = ROOT / 'releases/ios/simulator' / (APP['name'] + '.app')
info = plistlib.loads((app / 'Info.plist').read_bytes())
devices = json.loads(subprocess.check_output(['xcrun', 'simctl', 'list', 'devices', 'available', '--json'], text=True))
phones = [device for runtime in devices['devices'].values() for device in runtime if device['name'].startswith('iPhone')]
phone = next((device for device in phones if device['state'] == 'Booted'), phones[0])
if phone['state'] != 'Booted':
    run('xcrun', 'simctl', 'boot', phone['udid'])
run('xcrun', 'simctl', 'bootstatus', phone['udid'], '-b')
run('xcrun', 'simctl', 'install', phone['udid'], app)
launch = subprocess.check_output(['xcrun', 'simctl', 'launch', '--terminate-running-process',
                                  phone['udid'], info['CFBundleIdentifier']], text=True).strip()
print(launch)
pid = int(launch.rsplit(':', 1)[1].strip())
time.sleep(3)
os.kill(pid, 0)
evidence = ROOT / 'dist/smoke'
evidence.mkdir(parents=True, exist_ok=True)
screenshot = evidence / 'ios-simulator.png'
run('xcrun', 'simctl', 'io', phone['udid'], 'screenshot', '--type=png', screenshot)
os.kill(pid, 0)
report = {'simulator': phone['name'], 'applicationId': info['CFBundleIdentifier'],
          'version': APP['version'], 'build': APP['build'], **source_revision(),
          'installedAndLaunched': True, 'processAliveAfterSeconds': 3,
          'pid': pid, 'screenshot': screenshot.name}
(evidence / 'ios-simulator.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
