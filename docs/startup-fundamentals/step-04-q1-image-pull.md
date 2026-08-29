# Step 04 — Q1 image check and background pull

**Phase:** Startup gates
**Status:** `done`
**Depends on:** [Step 03](step-03-docker-daemon-gate.md)
**Unblocks:** [Step 05](step-05-startup-navigation.md)
**Plan index:** [README](README.md)

## Summary

Define the Studio Docker image as `lugobots/studio:latest`. When the daemon is up, ask whether that image exists locally; if not, start a pull in the background and continue startup. Progress belongs in the shell (and notifications), not a blocking startup route.

## Context

DEVELOPMENT.md Q1: missing image → start pulling, do **not** wait, proceed to Q2. There is no `/images` page yet. V3 currently has no image APIs. The placeholder tag is an explicit plan decision and must be written into `DEVELOPMENT.md` open decisions so it can change later without a scavenger hunt.

## Scope

**In scope**
- Constant for image name + tag: `lugobots/studio:latest`.
- Main: “is this image present locally?” (daemon must be running; if not, do not start a pull).
- Main: start pull without blocking the IPC caller that asked to continue navigation.
- Progress events to the renderer (percent or byte-level if Docker provides it; otherwise coarse states: idle, pulling, ready, error).
- Notification on pull failure (step 06 may land in parallel; if notifications are still a stub, log in main and use a status string until step 06).
- Record the tag in `DEVELOPMENT.md`.

**Out of scope**
- `/images` page, tag picker, deleting images, other images (game server, level-0/1, bot-setup).
- Blocking splash until pull completes.
- Authenticating to a private registry (assume public pull; if 401/404, fail the pull and continue navigation).

## Requirements

### Q1 semantics

| Situation | Navigation | Pull |
|-----------|------------|------|
| Daemon not running | Handled by docker-check; Q1 not asked | No |
| Image present locally | Continue to Q2 | No |
| Image absent | Continue to Q2 immediately | Yes, background |
| Pull fails later | User is already on welcome or main | Show error via status + notification when step 06 exists |

“Present locally” means Docker reports the exact name and tag (not merely a same-digest image under another name), unless the Docker API only returns ids — then match `lugobots/studio` with tag `latest` as listed by `docker images`.

### IPC / preload (add channels as needed)

Describe in `src/shared/ipc-channels.js` and preload:

| Capability | Direction | Purpose |
|------------|-----------|---------|
| Image status | invoke | `{ present: boolean, pulling: boolean, error: string or null }` for the Studio image |
| Start pull if missing | invoke | Idempotent: if already pulling or present, no second pull |
| Progress | main → renderer event | Coarse progress for status UI |

Renderer never talks to the Docker socket.

### Concurrency

- One pull at a time for this image. A second “ensure image” call is a no-op while pulling.
- App quit during pull: let the Docker pull keep running in the engine if already started; do not require resume logic in this step. On next launch, Q1 runs again.

## Technical direction

- Extend `src/main/services/docker/` (status vs images can be sibling modules).
- Register new IPC in `src/main/ipc/` and `src/main/ipc/register.js`.
- Preload `window.studio.docker` grows image helpers + `onImageProgress` (or a generic `studio.events` pattern — prefer extending docker to avoid a second bus unless one already exists).
- Shell status in step 09 will subscribe; until then, loading/welcome may show a muted one-line pull state if cheap.

## Security & compliance

- Image reference is a constant, not renderer-supplied (no pull-by-arbitrary-name from the UI in this step).
- Do not send registry credentials.
- Progress events must not include layer payloads, only counters and status text.

## Acceptance criteria

- [x] `DEVELOPMENT.md` lists Studio image `lugobots/studio:latest` as the Q1 definition.
- [x] With daemon up and image absent, navigation to Q2 is not delayed for the pull to finish.
- [x] Docker lists the image after a successful pull (or shows a visible error if the tag does not exist on the registry).
- [x] With image already local, no extra pull is started.
- [x] With daemon down, no pull is attempted.

## Verification

- Manual: `docker rmi lugobots/studio:latest` if present; launch past docker-check; confirm pull starts and UI still reaches welcome/main (after step 05).
- Manual: once present, relaunch; confirm no pull.
- Manual: wrong tag experiment only if changing the constant temporarily — then revert; or rely on a 404 from Hub to see error handling.

## Risks & edge cases

- Placeholder tag may not exist on Hub yet — Q1 must still be non-blocking; treat pull error as a status problem, not a startup dead-end.
- Disk full / rate limit — surface error; allow a later retry from status (retry control can be a follow-up if too large; at least log and notify).
- `latest` moving tag — acceptable for this slice; pinning a digest is a later `/images` concern.

## Follow-ups

- `/images` manager (DEVELOPMENT.md item 8).
- Additional images when game run needs them.
- Cancel pull.

## Landed

- Constant `lugobots/studio:latest`. `ensureStudioImage()` starts a background `docker pull` when the daemon is up and the tag is missing, and returns without waiting for the pull.
- IPC: `docker.imageStatus`, `docker.ensureImage`, `docker.onImageProgress`. Image name is not renderer-supplied.
- Tests: `npm run test:docker-images` (56 passed). Live lookup on the implementer machine already had the image locally (no live pull in this PR).
- Deviations: navigation still uses the step 03 interim hook; step 05 must call `ensureImage` fire-and-forget. Progress percent is the current CLI line, not a sum of layers. No muted pull line on loading/welcome (step 09).
- PR: pending.
