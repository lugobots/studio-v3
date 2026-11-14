#!/bin/sh
set -e

# The VS Code helper runs as uid 1000 (coder). Template install and prepare
# write as root in this image; without a chown the editor gets EACCES on save.
# Best-effort: some bind mounts ignore ownership changes.
if [ -d /home/coder/project ]; then
  chown -R 1000:1000 /home/coder/project 2>/dev/null || true
fi

# Electron (and local smoke) start the image with command `api`.
if [ "${1:-}" = "api" ]; then
  shift
  exec /usr/local/bin/studio-v3-api "$@"
fi

if [ "$#" -eq 0 ]; then
  exec /usr/local/bin/studio-v3-api
fi

exec "$@"
