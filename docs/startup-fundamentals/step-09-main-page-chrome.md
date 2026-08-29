# Step 09 — Main page chrome and placeholder

**Phase:** Shell UX
**Status:** `pending`
**Depends on:** [Step 05](step-05-startup-navigation.md), [Step 06](step-06-dialog-notification.md)
**Unblocks:** —
**Plan index:** [README](README.md)

## Summary

Add the real post-startup layout on `/main`: sidebar, header, and status region using the same color tokens as the rest of the app. Show the open project path and Studio version. Leave the primary content area as an explicit placeholder. Loading, docker-check, and welcome may stay card-based but must not introduce a second palette.

## Context

DEVELOPMENT.md item 5: replace the centered-card-only shell for the main experience; `/main` is the first screen that must use the full layout. V1 Home had player grids and a game iframe — those are out of this plan. After step 05, `/main` may still be a stub card; this step is that screen’s real chrome.

## Scope

**In scope**
- Layout structure in `src/renderer/layout/shell.js` (or a `shell-main` vs `shell-simple` mode selected by route).
- `/main` page module filling the content outlet with placeholder copy (e.g. that game run comes later) plus project path from `config.get()`.
- Header: product name, maybe window-title equivalent.
- Sidebar: placeholder nav items for future `/settings` and `/images` (disabled or non-navigating is OK if those routes do not exist; do not add fake pages). Do not register stub routes that violate DEVELOPMENT.md (“do not invent extra startup screens”).
- Status region: Docker running yes/no; Studio image pull state from step 04 if available; app version from step 07 if already exposed (if step 07 is not merged yet, show version via `versions.studio` once that preload field exists — coordinate, or read version from a tiny IPC added in 07).
- Tokens remain in `src/renderer/styles/base.css`; layout CSS in existing or adjacent stylesheet files.

**Out of scope**
- Game iframe, start/stop server, players 01–11, formations, publish, logs viewer, VS Code.
- Implementing `/settings` or `/images`.
- Dark/light theme toggle (V1 `localStorage`).
- Pixel-perfect clone of V1 Tailwind Home.

## Requirements

### Layout regions

| Region | Content in this step |
|--------|----------------------|
| Sidebar | Branding + disabled or labeled-soon entries for Settings and Images; highlight Main |
| Header | Title; project path (truncated with full path in tooltip or subtitle) |
| Status / footer | Studio version; Docker; image pull idle/pulling/ready/error |
| Main outlet | Placeholder explanation; no dummy Continue |

### Startup pages vs chrome

- `/loading`, `/docker-check`, `/start-project`: keep simple card layout **or** share a reduced chrome without the sidebar. Full sidebar on welcome is optional; do not make welcome look like the bot is already open.
- Switching from welcome to `/main` after step 08 should rebuild or switch shell mode so chrome appears.

### Consistency

- `--bg`, `--panel`, `--text`, `--muted`, `--accent`, `--border` as defined today unless a documented token addition is required (e.g. `--danger` for errors) — if added, use it in dialogs too.

## Technical direction

- `src/renderer/layout/shell.js` — structure.
- `src/renderer/styles/base.css` and `pages.css` (or a `shell.css`).
- `src/renderer/pages/main/index.js` — placeholder + data from `window.studio`.
- Subscribe to docker/image progress events for the status line; unsubscribe on navigate away if the shell is not global.
- DEVELOPMENT.md: mark `/main` as created; item 5 notes the files that own the chrome.

## Security & compliance

- Display `project_path` as text only.
- Status strings from main are plain text, not HTML.

## Acceptance criteria

- [ ] `/main` is visually distinct from the centered-card startup pages (sidebar + header + status present).
- [ ] Open project path matches `user.json` `project_path`.
- [ ] Studio version is visible (once step 07 preload field exists; if 07 is later, show a clear “version pending” only during partial merges — prefer landing 07’s version field first or in the same PR as chrome).
- [ ] Placeholder body has no game controls.
- [ ] Startup pages still use the same tokens (no unstyled white flash).
- [ ] DEVELOPMENT.md route map: `/main` status updated.

## Verification

- Manual: complete Q2-yes launch; inspect layout regions.
- Manual: open existing bot from welcome; confirm chrome appears and path updates without restart.
- Manual: with image pulling, status line changes without leaving `/main`.
- Manual: resize the window; sidebar/header remain usable (no overlapping unreadable text). Desktop-sized window is enough; no mobile layout requirement.

## Risks & edge cases

- Shell created once in `app.js` today — changing structure on route change must not duplicate `#outlet` or break the router.
- Long Windows paths — truncate in header, full string available to copy later (copy button is nice-to-have, not required).
- Step 04 events not ready — status can show “unknown” rather than lying “ready.”

## Follow-ups

- Wire sidebar to `/settings` and `/images` when those pages exist.
- Game area and run controls (V1 Home).
- Open-in-explorer / VS Code from the header (V1 `OpenProjectPath`).
