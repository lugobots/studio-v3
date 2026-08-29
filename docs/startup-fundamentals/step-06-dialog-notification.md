# Step 06 — Dialog and notification pattern

**Phase:** Shell UX
**Status:** `done`
**Depends on:** —
**Unblocks:** [Step 07](step-07-updater-client.md), [Step 08](step-08-welcome-open-existing.md), [Step 09](step-09-main-page-chrome.md)
**Plan index:** [README](README.md)

## Summary

Introduce one in-app dialog pattern (confirm, error, progress) and one notification path (OS notification and/or in-app toast) so upgrades, Docker/image failures, and “not a valid bot folder” share the same UI. Replace the notifications stub in main; renderer owns dialogs.

## Context

DEVELOPMENT.md item 4: one dialog format and one notification format for upgrades, Docker, image pulls, settings save, and debug upload. Settings save and debug upload are out of this plan, but the **pattern** must exist so steps 07–08 do not invent one-off modals. Today `src/main/services/notifications/index.js` is empty and the renderer has no dialog system.

## Scope

**In scope**
- Renderer: modal/dialog host in the shell (usable from loading, docker-check, welcome, and main).
- Variants: confirm (accept / cancel), error (dismiss), progress (determinate if a 0–1 value is supplied; otherwise indeterminate).
- Main: `notifications.show` displays a native OS notification when the app is allowed to; if the OS blocks it, still keep an in-app toast so developers see the event.
- Preload: keep `window.studio.notifications.show`; add a renderer-only dialog API that does **not** need IPC (DOM in the shell).
- Shared visual language: tokens from `src/renderer/styles/base.css` (accent, panel, border, muted).

**Out of scope**
- Full design system / component library migration.
- HTML Electron `dialog.showMessageBox` as the only path (native boxes are OK as a fallback for fatal main-process errors; user-facing Studio flows use the in-app pattern).
- Notification preferences UI (later `/settings`).
- Log upload toasts (item 9).

## Requirements

### Dialog

- Single overlay; one dialog at a time. A second request queues or replaces — pick **queue** for confirmations so an update prompt is not lost behind a folder error.
- Confirm: title, body, primary label, secondary/cancel label. Primary is explicit (e.g. Download, Open anyway is not needed in this slice).
- Error: title, body, dismiss.
- Progress: title, optional detail line, cannot dismiss by clicking the backdrop while a download/pull is active (provide Cancel only when the caller passes a cancel handler). This slice’s updater is download-only; cancel should abort the download when step 07 wires it.
- Keyboard: Escape cancels confirm / dismisses error when allowed; focus trap inside the dialog.

### Notifications

- Payload already sketched: `title`, optional `body`.
- Main uses Electron `Notification` when `Notification.isSupported()`.
- In-app toast: same title/body, auto-hide after a few seconds, does not steal focus from dialogs.
- Do not spam: if image pull emits many progress ticks, those belong on the status line (step 09), not one OS notification per tick. OS notification is for start/success/failure and “update available.”

### Who calls what

| Event | Dialog | Notification |
|-------|--------|--------------|
| Update available | Confirm download | Optional OS “update available” |
| Download in progress | Progress | No per-tick OS |
| Download finished | Dismiss progress; optional success toast | OS optional |
| Download failed | Error | OS optional |
| Invalid bot folder | Error | No |
| Image pull failed | Not required | Yes |
| Docker still down | Page copy, not a dialog | No |

## Technical direction

- Renderer: `src/renderer/components/` dialog + toast; mount from `src/renderer/layout/shell.js` so every route can call them.
- `src/main/services/notifications/index.js` — native notification.
- Styles in `src/renderer/styles/` using existing tokens.
- Do not download or read files from dialog code.

## Security & compliance

- Dialog body text is always app-generated or a short OS/Docker error string. Do not render unsanitized HTML from Docker logs.
- OS notifications: no path to arbitrary command execution; title/body strings only.

## Acceptance criteria

- [x] A confirm dialog can be opened from a page and returns the user’s choice to the caller.
- [x] An error dialog shows a message and closes on dismiss.
- [x] A progress dialog can be shown and closed by the caller.
- [x] `window.studio.notifications.show` produces a native notification when supported, and an in-app toast is visible in all cases (or documented OS-only if toast is the renderer path triggered by the same user action).
- [x] Dummy pages that still exist do not each invent a different modal.

## Verification

- Manual: trigger confirm, cancel, and accept.
- Manual: trigger error.
- Manual: OS notification permission denied — toast still appears.
- No screenshot-only verification: actually click through.

## Risks & edge cases

- Loading page unmounts while a dialog is open — host dialogs on the shell, not inside the page card.
- Multiple toasts — stack or replace; cap visible toasts to a small number (e.g. three).
- Windows focus stealing from native notifications — keep auto-download off (already a plan decision); only notify.

## Follow-ups

- Settings save confirmation (item 7).
- Debug log upload result (item 9).
- Image pull cancel UI on `/images`.

## Landed

- Renderer `dialogs.confirm` / `error` / `progress` mounted on the shell (FIFO queue, focus trap, textContent only).
- `notifications.show` uses Electron `Notification` when supported and always broadcasts an in-app toast (cap 3). Image pull failure notifies once.
- Tests: `npm run test:dialogs` (67), `npm run test:notifications` (26). Electron click-through was not run.
- Deviations: `--danger` token added; `<progress>` used to stay within CSP `style-src 'self'`.
- PR: https://github.com/lugobots/studio-v3/pull/6
