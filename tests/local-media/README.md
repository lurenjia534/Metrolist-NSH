# Local audio test app

NSH 0.5 checks local AudioPlayer URLs against `capabilities.fs.read`. The
production app reads its downloads and imported copies under `${dataDir}`.
The headless `nsh/test.open` API does not provide an app data directory, so
`scripts/run-nsh.py test` therefore generates a test app in `.nsh/local-media`
from this directory's manifest. Its declared read root is the absolute path
of `tests/local-media/media` beneath the checkout; the headless bytecode
runner also has no `${pluginDir}` anchor. Generated entry points import the
original fixtures. The full-shell case copies the unchanged root App,
`src`, `assets`, `server`, theme, and package metadata into the generated app,
because NSH requires imported assets to remain inside its bundle root.
The ordinary playback state machine and NSH AudioPlayer remain in use,
with the runtime's normal capability checks.

The WAV files are generated silence: one second, 8 kHz, unsigned 8-bit mono.
They are project-owned fixtures. No production filesystem grant is broadened
for the tests, and external paths are still outside this test app's grant.
