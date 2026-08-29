# Step 07 — App version display, update check, and download

**Phase:** Updates
**Status:** `done`
**Depends on:** [Step 01](step-01-mock-update-server.md), [Step 06](step-06-dialog-notification.md)
**Unblocks:** —
**Plan index:** [README](README.md)

## Summary

Expose the running Studio version from `package.json` / `app.getVersion()` on `window.studio.versions`. In development, main checks the mock JSON API in the background (non-blocking). If a newer binary exists, prompt with the shared confirm dialog; on accept, download the file into `{appData}/.LugoStudio/updates/` and notify. Do not quit-and-install.

## Context

DEVELOPMENT.md items 1–3: upgrade check, upgrade process, version on the UI. The updater stub always returns `{ available: false }`. V1 used electron-updater and skipped checks in dev; this slice does the opposite for the mock so local testing works. Renderer must never download the binary.

## Scope

**In scope**
- Studio version next to Electron/Node/Chrome on `window.studio.versions`.
- Updater service: check against `http://127.0.0.1:47821` using step 01’s query parameters (`currentVersion`, `platform`).
- Background check after the window is ready (or after loading); must not change Docker/Q1/Q2 order.
- Confirm + progress + error dialogs from step 06.
- Write the downloaded file under `.LugoStudio/updates/`, using the mock’s `fileName`.
- IPC: existing `updates:check`; add download (invoke) and optional progress events.
- Record in `DEVELOPMENT.md` that the **dev** update feed is this mock origin; production host remains TBD.

**Out of scope**
- `autoUpdater.quitAndInstall()`, electron-builder publish, YAML feeds.
- Production `https://lugobots.ai/api/studio/check-update` (do not call it from V3 yet — it is a YAML feed, not this JSON).
- Signature verification / checksum (note as follow-up; mock is local).
- Auto-download without consent (`autoDownload` stays false).

## Requirements

### Version display

- Source: Electron `app.getVersion()` (from `package.json` `version`).
- Show in the shell footer or a consistent header region once step 09 chrome exists; until then, loading/welcome may show it in the page header **and** preload must already expose it so step 09 does not change the API.

### Check

- GET check-update with `currentVersion` = running version and `platform` = `process.platform`.
- Map mock `available` into `UpdateInfo` (extend with `version` and `fileName` as needed).
- Mock down or connection refused: treat as no update, log a warning; do not block UI or show an error dialog on every launch (developers may not run the mock). Optional muted status “update server unreachable” is enough.
- Check once per launch in this slice (no interval polling).

### Download

- Only from main, only to `.LugoStudio/updates/`.
- Create the `updates` directory if missing.
- Overwrite a same-named file if re-downloading.
- Progress events for the progress dialog (bytes received vs `sizeBytes` when known).
- Cancel: abort the HTTP request; delete partial file.
- On success: close progress, toast/OS notification with the full destination path so testers can find the file.

### Dev vs prod URL

- This slice: **always** use the mock origin in development (`electron .` / `npm run dev`).
- Packaged production URL: constant placeholder or commented TBD — do not hit `lugobots.ai` until the server speaks this JSON (or a later step switches protocol).

## Technical direction

- `src/main/services/updater/index.js` — HTTP client to mock; filesystem write.
- `src/main/ipc/updates.js` — check + download + cancel.
- `src/preload/preload.js` and `api.d.ts` — `versions.studio`, richer `UpdateInfo`, `updates.download`, progress subscribe.
- `src/shared/ipc-channels.js` — new channels as needed.
- A small renderer controller that shows the confirm when check returns available (subscribe from app bootstrap, not only `/main`).
- Root README or `DEVELOPMENT.md`: run mock before testing updates.

## Security & compliance

- Download URL must be same-origin as the configured feed (loopback mock). Do not follow redirects to a different host.
- `fileName` from JSON must be a basename; reject `..` and slashes before writing under `updates/`.
- Do not execute the downloaded file.
- No renderer `fetch` to the mock (avoids CORS and keeps the file off the webview).

## Acceptance criteria

- [x] UI can show the same version string as `package.json`.
- [x] Mock not running → app still reaches welcome/main; no blocking error.
- [x] Mock running with a newer named binary → confirm dialog appears without blocking Docker/Q2.
- [x] Accept → file appears in `{appData}/.LugoStudio/updates/` with matching size.
- [x] Cancel during download → no complete file left (partial removed).
- [x] Decline confirm → no download.
- [x] `DEVELOPMENT.md` update-feed decision notes the mock JSON origin for dev and TBD for production.

## Verification

- Manual: start mock, drop `Lugo-Studio-Windows-9.9.9.exe` (or Mac/Linux equivalent), launch app, accept, confirm file in `updates/`.
- Manual: quit mock, launch app, confirm silence aside from a log line.
- Manual: confirm gates still work while the check is in flight.

## Risks & edge cases

- Windows path length / antivirus locking the new file — surface a write error via the error dialog.
- `sizeBytes` missing — indeterminate progress.
- User deletes `updates/` while downloading — recreate or fail clearly.
- Version in `package.json` accidentally bumped above the drop file — `available: false`; expected.

## Follow-ups

- Quit-and-install for packaged builds.
- Align production API with this JSON or adopt electron-updater YAML.
- Checksum / code signing verification.
- Settings “Check for updates” button (V1 Settings page).

## Landed

- `window.studio.versions.studio` from `app.getVersion()`. Background check against `http://127.0.0.1:47821` in development; packaged origin is empty TBD (does not hit lugobots.ai).
- Download-only into `{appData}/.LugoStudio/updates/`. Confirm / progress / error dialogs. Cancel deletes the partial file. Same-origin download URLs only.
- Tests: `npm run test:updater` (45 passed). Electron dialog walkthrough was not run.
- Deviations: no muted “update server unreachable” status (warning log only). Version also shown on loading/welcome headers until step 09 chrome.
- PR: https://github.com/lugobots/studio-v3/pull/7
