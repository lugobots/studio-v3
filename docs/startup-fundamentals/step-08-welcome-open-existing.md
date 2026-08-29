# Step 08 — Welcome screen: open existing bot

**Phase:** First-run
**Status:** `pending`
**Depends on:** [Step 02](step-02-v1-compatible-settings.md), [Step 05](step-05-startup-navigation.md), [Step 06](step-06-dialog-notification.md)
**Unblocks:** —
**Plan index:** [README](README.md)

## Summary

Turn `/start-project` into the welcome screen for Q2-no: explain that Studio needs a bot project, let the user pick an existing folder, validate it the V1 way (`.lugo/info.json`), write V1-compatible `user.json`, then navigate to `/main`. Creating a new bot from a language template is not part of this step.

## Context

V1 `FirstTime` offered “existing bot” and “new bot.” New bot runs `lugobots/bot-setup` and compose — deferred. Existing bot: folder dialog, `checkIfBotIsValid`, then persist `project_path` / `compose_file` / `app_path`. V3 welcome is currently a header with no CTA. After step 05, this is the Q2-no landing page.

## Scope

**In scope**
- Welcome copy and a primary action: open an existing bot.
- Main-process folder picker (directory only).
- Validity: `{folder}/.lugo` and `{folder}/.lugo/info.json` exist. Do not require parsing `info.json` beyond existence for this step (if the file is empty/invalid JSON, still treat as invalid if parse is needed later; existence is the V1 boolean check).
- On success: merge into `user.json` (step 02 rules): keep all existing keys; set `project_path` to the chosen absolute folder; set `compose_file` to `{folder}/docker-compose.yml` (whether that file exists or not — same as modern V1 open path); set `app_path` from `app.getAppPath()`; set `app_version` from `app.getVersion()`. If `user.json` did not exist, create defaults first then apply those fields. Generate `install_unique_id` only when creating a new file.
- Navigate to `/main` without restarting Electron.
- Error dialog (step 06) for: user cancelled picker (no dialog, just stay); empty selection; not a valid bot; write failure.

**Out of scope**
- Language select, empty-folder picker, `bot-setup` image, log streaming, terms-and-conditions block from V1 (can mention terms as static text if copy already exists; do not block on a legal checkbox unless product asks later).
- Fixing legacy bots that stored compose under `.studio/`.
- Writing `.studio.env`.
- Opening the project in VS Code or Explorer (V1 Home had that; main chrome may show the path only in step 09).

## Requirements

### IPC

Add capabilities (names in `ipc-channels.js`):

| Action | Process | Result |
|--------|---------|--------|
| Pick bot folder | Main `dialog.showOpenDialog` | Path or cancelled |
| Open existing bot | Main: validate + save settings | Success or error string |

Renderer: button → pick → open → `navigate("/main")` on success.

### UX

- Card layout, same tokens as other startup pages (full chrome not required until `/main`).
- Disabled state while validation/save runs.
- If Q2 is already yes and the user lands here via hash, step 05 redirect still applies.

### Compatibility with V1 bots

- A folder that V1 would accept (`checkIfBotIsValid`) must be accepted.
- Do not rewrite `.lugo/info.json`.
- Do not copy compose files into `.studio/`.

## Technical direction

- `src/renderer/pages/start-project/index.js` — real welcome.
- Main: folder dialog + reuse config + bot-validity helper from step 02 (same validity function, one implementation).
- Preload: `studio.project.openExisting` (or equivalent) — do not put `fs` in the renderer.
- Update DEVELOPMENT.md route map: `/start-project` is no longer a dummy page.

## Security & compliance

- Folder path comes from the OS picker, not a typed renderer path (no arbitrary path injection from the page).
- Validate the path is a directory and passes the `.lugo/info.json` rule before writing settings.
- Do not follow symlinks in a special way; OS/fs existence check is enough. If `info.json` is a symlink outside the project, still only check existence (acceptable for local trust).

## Acceptance criteria

- [ ] Q2-no user sees welcome with an Open existing bot action (no dummy-only page).
- [ ] Choosing a valid V1 bot folder writes `user.json` and shows `/main`.
- [ ] Subsequent launch (Docker up) goes to `/main` via Q2 (step 05).
- [ ] Choosing a folder without `.lugo/info.json` shows an error and does not write a misleading `project_path`.
- [ ] Cancelling the picker leaves the user on welcome with no error dialog.
- [ ] Existing V1 keys (e.g. `game_speed`, image tags) survive if `user.json` already existed.

## Verification

- Manual: open a real V1 bot directory; confirm `user.json` on disk; confirm `/main`.
- Manual: pick a random empty folder; confirm error.
- Manual: second launch skips welcome.
- If a V1 `user.json` existed with a dead `project_path`, welcome still shows (Q2 no); opening a valid folder repairs `project_path`.

## Risks & edge cases

- `docker-compose.yml` missing on disk — still save `compose_file` as specified; game run later will fail until compose exists. Do not block welcome.
- Very old bots with only `.studio/*.yml` — may open (validity is only `.lugo/info.json`) but compose path may be wrong. Document as known gap; do not clone compose in this step.
- Path with non-ASCII characters on Windows — use Electron dialog paths as given.

## Follow-ups

- Create new bot (V1 `START_WITH_NEW_BOT`).
- Legacy compose clone for `studio.major/minor` &lt; 1.1.
- Terms acceptance if legal requires it.
