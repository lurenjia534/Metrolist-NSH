#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
exec node --use-env-proxy --max-http-header-size=65536 gateway/launch.mjs
