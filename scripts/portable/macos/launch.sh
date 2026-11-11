#!/bin/sh
set -eu
contents=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec "$contents/Resources/runtime/node" --use-env-proxy --max-http-header-size=65536 "$contents/Resources/gateway/launch.mjs" "$@"
