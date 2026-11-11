#!/usr/bin/env sh
set -eu

# The app uses the current AudioPlayer, ImageAsset and web host APIs.
export NSH_VERSION="${NSH_VERSION:-nightly}"
curl -fsSL https://nsh.dev/install.sh | sh
printf '\nOpen a new terminal, or run: export PATH="$HOME/.local/bin:$PATH"\n'
printf 'Then run: node scripts/run-native.mjs\n'
