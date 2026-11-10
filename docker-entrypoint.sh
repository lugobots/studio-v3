#!/bin/sh
set -e

# Electron (and local smoke) start the image with command `api`.
if [ "${1:-}" = "api" ]; then
  shift
  exec /usr/local/bin/studio-v3-api "$@"
fi

if [ "$#" -eq 0 ]; then
  exec /usr/local/bin/studio-v3-api
fi

exec "$@"
