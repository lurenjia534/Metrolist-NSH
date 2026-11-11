#!/usr/bin/env sh
set -eu

# Keep the CLI, QuickJS bytecode and Android host on the same pinned NSH revision.
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
python3 "$script_dir/install-nsh.py" "$@"
printf '\nUse the printed NSH_BIN, or add ../toolchain/nsh/bin to PATH.\n'
printf 'Then run: node scripts/run-native.mjs\n'
