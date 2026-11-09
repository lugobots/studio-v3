#!/usr/bin/env bash
# Scripted smoke for studio-v3-pull-level-1-binary (OpenSpec task 3.2).
# Requires Docker. Exercises real Level-1 pull/extract, API container mount,
# and POST /api/game/start with active opponents / inactive rows stopped.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/smoke-level1-opponent.js
