# Step 01 — Mock update HTTP server

**Phase:** Infrastructure
**Status:** `done`
**Depends on:** —
**Unblocks:** [Step 07](step-07-updater-client.md)
**Plan index:** [README](README.md)

## Summary

Add a small Node HTTP server inside `studio-v3` that the Electron app can call in development to ask whether a newer Studio binary exists and to download it. Operators drop files into a `releases` directory using a fixed name pattern; the server never builds installers and never talks to production.

## Context

V1 used `electron-updater` against `https://lugobots.ai/api/studio/check-update` (generic YAML feeds) and skipped checks entirely in development. This slice uses a custom JSON protocol so we can test version detection and download without packaging. The mock is a separate process so it can keep serving files while Electron restarts.

## Scope

**In scope**
- New folder `mock-update-server/` with its own package metadata and a start script reachable from the repo root.
- Listen only on loopback, port 47821.
- Scan `mock-update-server/releases/` for binaries matching the naming convention below.
- Version-check and download HTTP endpoints as specified.
- A short README in that folder: how to run, how to name files, example drop for Windows.

**Out of scope**
- electron-updater / `latest.yml`.
- HTTPS, authentication, or binding on all interfaces.
- Generating YAML, NSIS, DMG, or AppImage artifacts.
- Wiring the Electron updater client (step 07).
- Production CDN or `lugobots.ai` hosting.

## Requirements

### Drop folder and naming

- Directory: `mock-update-server/releases/` (create it empty; ignore binaries in git).
- File name pattern: `Lugo-Studio-{Platform}-{version}.{ext}`
  - Platform tokens: `Windows`, `Mac`, `Linux` (exact spelling).
  - Version: semver string with no `v` prefix (example: `0.2.0`).
  - Extension: whatever the operator drops (`.exe`, `.dmg`, `.AppImage`, `.zip` are all valid). The server does not validate the extension beyond serving the file.
- Example: `Lugo-Studio-Windows-0.2.0.exe`
- Multiple files may exist; the check endpoint picks the **highest semver** for the requested platform that is **strictly greater** than `currentVersion`. Equal or older versions are not “available.”
- Unparseable names are ignored (logged to stdout, not served as latest).

### API / interface surface

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| GET | `/api/studio/check-update` | Compare running version + platform to drop folder | None; loopback only |
| GET | `/api/studio/download/{fileName}` | Stream one file from `releases/` | None; loopback only |
| GET | `/health` | Liveness for operators | None |

Query parameters for check-update:

| Name | Required | Meaning |
|------|----------|---------|
| `currentVersion` | Yes | Running app semver (same as `package.json` version). |
| `platform` | Yes | Electron `process.platform`: `win32`, `darwin`, or `linux`. Map to `Windows`, `Mac`, `Linux` when matching file names. |

Check-update response shape (JSON object, always HTTP 200 when the query is valid):

| Field | When `available` is true | When false |
|-------|--------------------------|------------|
| `available` | `true` | `false` |
| `version` | Winning file’s version string | `null` |
| `fileName` | Exact drop-file name | `null` |
| `downloadPath` | Path to the download route for that file (same origin) | `null` |
| `sizeBytes` | File size on disk | `null` |

Error semantics:

- Missing or unknown `platform`, or missing/invalid `currentVersion`: HTTP 400 with a short JSON `error` string. No stack traces.
- Download of a name that is not a basename sitting in `releases/`, or that contains path separators / `..`: HTTP 404. Never read files outside `releases/`.
- Download success: HTTP 200, `Content-Type` octet-stream, `Content-Disposition` attachment using the original file name.

### Operator workflow

1. Start the mock (`npm` script at repo root, name documented in the mock README).
2. Copy a dummy or real binary into `releases/` with a version **above** the app’s `package.json` version.
3. Hit check-update with the app version and `win32` (or the OS in use) and confirm `available` is true.
4. Hit download and confirm the bytes match the dropped file.

## Technical direction

- Create `mock-update-server/` (entry script, package metadata, `releases/`, `.gitignore` for binaries, README).
- Add a root `package.json` script that starts this process without launching Electron.
- Keep dependencies minimal (Node built-in HTTP is enough).
- Log bind address, each check result (available or not, chosen version), and each download (file name + status) to stdout.

## Security & compliance

- Bind `127.0.0.1` only. Do not listen on `0.0.0.0`.
- Treat `fileName` as an untrusted path segment: allow only a single path component that exists as a direct child of `releases/`.
- No CORS wildcards needed if the Electron main process (not the renderer) performs the HTTP calls. If a browser is used for manual curl-style tests, that is operator-only.
- Do not log file contents.

## Acceptance criteria

- [x] Mock process starts on `127.0.0.1:47821` and `/health` returns success.
- [x] Empty `releases/` → check-update with a valid query returns `available: false`.
- [x] A correctly named file with version greater than `currentVersion` for that platform → `available: true` and matching `fileName` / `version` / `sizeBytes`.
- [x] A file with version less than or equal to `currentVersion` is not advertised.
- [x] Download returns the exact bytes of the dropped file.
- [x] `GET /api/studio/download/../package.json` (or equivalent traversal) is 404 and does not read outside `releases/`.
- [x] Process does not start if the port is taken; it exits with a clear error.

## Verification

- Manual: drop a dummy file named for the current OS with version `9.9.9`, call check-update with `currentVersion=0.1.0`, then download and compare size.
- Manual: repeat with version `0.0.1` and confirm not available.
- Automated: optional unit tests around name parsing, platform mapping, and path-safety — not required to close the step if manual checks are recorded.

## Risks & edge cases

- Two files for the same platform and version — pick one deterministically (e.g. lexicographically last name) and mention it in the mock README.
- Prerelease semver in the file name (`0.2.0-beta.1`) — treat as valid semver if the parser supports it; otherwise ignore the file.
- Operator drops a huge file — no size cap in this step; document that this is a local test tool.
- Port 47821 already in use — fail fast; do not silently pick another port (the Electron client will be hardcoded to this origin in step 07).

## Follow-ups

- Production JSON (or YAML) host on `lugobots.ai` — later packaging/release work.
- electron-updater compatibility if/when quit-and-install is required.
- Optional `latest.json` override if scanning filenames becomes painful — not needed now.

## Landed

- `mock-update-server/` Node HTTP process on `127.0.0.1:47821` with `/health`, check-update, and download.
- Root scripts: `npm run mock-update-server`, `npm run test:mock-update-server` (50 checks).
- Deviations: added a Node test script; prerelease semver in drop names is accepted; dotfiles under `releases/` are skipped without an unparseable log line.
- PR: pending (filled in after open).
