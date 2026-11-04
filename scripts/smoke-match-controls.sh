#!/usr/bin/env bash
# API-level smoke for studio-v3-workspace-match-controls (OpenSpec task 6.2).
# Exercises: away + golden skip + slow + zombies server start, partial active
# match start, bot toggle off/on, reset, positions get/apply.
set -euo pipefail
cd "$(dirname "$0")/../api"
exec go test ./internal/server/ -run TestMatchControlsSmoke -count=1 -v
