# Step 03 — Docker daemon gate

**Phase:** Startup gates
**Status:** `done`
**Depends on:** —
**Unblocks:** [Step 04](step-04-q1-image-pull.md), [Step 05](step-05-startup-navigation.md)
**Plan index:** [README](README.md)

## Summary

Make `/docker-check` a real gate: the app asks main whether the Docker daemon is running, stays on this screen until it is, and only then continues startup. Replace the dummy Continue button with retry / “I started Docker” behavior aligned with V1’s Docker-not-running screen.

## Context

DEVELOPMENT.md: if the daemon is not started, stay on `/docker-check` and ask the user to install or start Docker. V1 used `docker info` and pushed a docker state event to the renderer. V3’s docker service currently returns `running: null` and the page never calls it.

## Scope

**In scope**
- Implement `docker.getStatus()` in main so `running` is `true` or `false` (not `null` once the check has finished).
- Renderer `/docker-check` consumes `window.studio.docker.status`, shows install/start guidance, and re-checks on an explicit user action and optionally on a modest poll while the page is visible.
- Link to Docker’s official get-started / install documentation (same idea as V1).
- Loading flow (step 05) will call this status; this step can land the service + page even if navigation is still dummy, as long as the page itself is real.

**Out of scope**
- Image list, pull, or Q1 (step 04).
- Starting Docker Desktop programmatically (tell the user; do not try to launch the daemon as root).
- Docker context switching, remote Docker hosts, or Compose.

## Requirements

### Daemon check

- Main process runs the check (CLI `docker info` or Docker Engine HTTP ping — pick one and stick to it; V1 used `docker info`).
- Timeout: fail closed to `running: false` if Docker does not answer within a few seconds (document the timeout in a comment-level constant / DEVELOPMENT.md, not as magic UX).
- `docker` binary missing: `running: false`, not a thrown IPC error. Distinguish “not installed” vs “installed but stopped” only if it is cheap (e.g. binary missing vs non-zero `docker info`); if not cheap, one combined message is acceptable: install or start Docker.

### `/docker-check` UI

- Same color tokens as `src/renderer/styles/base.css`. Card layout is fine (full chrome is for `/main`).
- Explain that Studio needs Docker.
- Primary action: re-check now.
- External link: Docker install / get started (https://docs.docker.com/get-docker/ or V1’s equivalent).
- While a check is in flight, disable the button and show a short waiting state (no fake Continue).
- When `running` becomes true, this page should not be the resting place: either navigate onward if step 05 is already wired, or call a small shared “continue startup” helper that step 05 will own. Until step 05 lands, navigating to `/start-project` on success is an acceptable interim **only if** documented as temporary; prefer leaving a `continueAfterDocker()` hook so step 05 does not fight the page.

### IPC

- Existing channel `docker:status` is enough for this step.
- Do not expose a shell to the renderer.

## Technical direction

- `src/main/services/docker/index.js` — real `getStatus`.
- `src/renderer/pages/docker-check/index.js` — remove dummy Continue; use `src/renderer/lib/api.js`.
- Optional: `src/main/services/docker/` helpers for spawn + timeout.
- Update `src/shared/types.js` if `running: null` is retired after first check (`null` may remain for “not yet queried”).

## Security & compliance

- Only invoke a fixed Docker diagnostic command with no user-supplied arguments.
- Do not pass `project_path` or settings into this check.

## Acceptance criteria

- [x] Docker Desktop/engine running → status `running: true`.
- [x] Docker stopped or missing → `running: false` and the docker-check page remains with a clear message.
- [x] User starts Docker, clicks re-check → page observes `true` without restarting the whole Electron app.
- [x] Dummy “Continue (dummy)” control is gone from this page.
- [x] Renderer never spawns `docker` itself.

## Verification

- Manual: stop Docker, open `/docker-check`, confirm copy and failed check.
- Manual: start Docker, re-check, confirm success.
- Manual: machine without Docker in PATH — failed check, no main-process crash.

## Risks & edge cases

- Docker Desktop “starting…” — `docker info` may fail for 10–30s; polling on this page should be gentle (on the order of a few seconds, not tens of times per second).
- WSL vs Hyper-V vs macOS VM — still “is the daemon up?”; do not special-case engines in this step.
- Permission errors (`docker` needs the docker group on Linux) — treat as not running and mention permissions in the page lede if the error string is recognizable; otherwise generic install/start copy.

## Follow-ups

- Q1 image availability and pull (step 04).
- Status chip on main chrome (step 09) reusing the same `getStatus`.

## Landed

- Main runs a fixed `docker info` with a 5s timeout and fail-closed `running: false`. Optional `reason` for page copy (`ok` / `not_installed` / `not_running` / `timeout` / `permission`).
- `/docker-check` uses Re-check now + ~4s poll. Dummy Continue is gone. Success calls `continueAfterDocker()` (interim `#/start-project` until step 05).
- Tests: `npm run test:docker` (42 passed). Live `docker info` on the implementer machine was `running=true`.
- Deviations: extra `reason` field; `setWindowOpenHandler` so the Get Docker https link opens in the system browser.
- Electron click-through of the page was not run in this PR; UI behavior is covered by code review plus unit tests.
- PR: https://github.com/lugobots/studio-v3/pull/3
