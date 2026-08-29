# Step 02 — V1-compatible settings and Q2 detection

**Phase:** Persistence
**Status:** `done`
**Depends on:** —
**Unblocks:** [Step 05](step-05-startup-navigation.md), [Step 08](step-08-welcome-open-existing.md)
**Plan index:** [README](README.md)

## Summary

Replace the config stub so main reads and writes the same local preferences file as Lugo Studio V1. Derive Q2 (“bot project created?”) from that file plus the V1 bot-validity rule (`.lugo/info.json` under `project_path`). Do not introduce a second settings format.

## Context

V3’s config service always returns `projectCreated: false` and does not persist. V1 stores pretty-printed JSON at `{appData}/.LugoStudio/user.json`. First-run in V1 was “file missing.” DEVELOPMENT.md Q2 is “bot project created?”; this plan answers that with **file present and bot folder still valid**, so a leftover `user.json` pointing at a deleted project does not skip welcome.

## Scope

**In scope**
- Resolve the V1 folder and `user.json` path from Electron `app.getPath("appData")` plus `.LugoStudio` / `user.json` (same constants as V1).
- Load, save, and create-default with the full V1 `UserData` key set.
- Ensure the `.LugoStudio` directory exists when writing.
- Bot validity: `{folder}/.lugo/info.json` must exist (directory `.lugo` plus that file).
- Expose via existing `config:get` / `config:set` IPC a derived `projectCreated` boolean plus enough fields for later screens (at least `project_path`).
- Record V1 path, format, and kept keys in `DEVELOPMENT.md` open decisions (implementer updates that file).

**Out of scope**
- Settings UI (`/settings`).
- `.studio.env`, `studio.log`, `positions/` (create folders only if a later write needs them; not in this step).
- V1 development-mode override that stored `.LugoStudio` next to the repo.
- Schema migration of missing keys beyond: if `user.json` exists but a known key is absent, fill that key from V1 defaults **without** removing unknown extra keys.
- Creating or opening a bot (step 08).

## Requirements

### Storage location

| OS | Folder |
|----|--------|
| Windows | `%APPDATA%\.LugoStudio\` |
| macOS | `~/Library/Application Support/.LugoStudio/` |
| Linux | `$XDG_CONFIG_HOME/.LugoStudio/` or `~/.config/.LugoStudio/` |

File: `user.json`, UTF-8, pretty-printed JSON (two-space indent, same as V1).

Use this path in **development and packaged** builds. Do not redirect to the studio-v3 repo root.

### Data model (stored)

Round-trip these keys (types and V1 defaults):

| Key | Role | Default when creating a new file |
|-----|------|----------------------------------|
| `install_unique_id` | Stable install id | Machine id if a library is already acceptable; otherwise a generated UUID documented in `DEVELOPMENT.md` if `node-machine-id` is not added. Prefer matching V1 (`node-machine-id` `machineIdSync(true)`) if the dependency is added. |
| `debug_mode` | Verbose / debug | `false` |
| `project_path` | Absolute bot root | `"."` until a project is opened |
| `team_side` | `home` or `away` | `home` |
| `opponent_team` | Opponent id | `level-0` |
| `game_speed` | 1 / 2 / 3 | `1` |
| `saved_positions` | Array of saved formations | `[]` |
| `compose_file` | Absolute compose path | `""` |
| `game_server_image` | Image name | `lugobots/server` |
| `game_server_version` | Tag | `v2` |
| `bot_level_0_image` | | `lugobots/level-0` |
| `bot_level_0_version` | | `v2` |
| `bot_level_1_image` | | `lugobots/level-1` |
| `bot_level_1_version` | | `v4` |
| `app_path` | Electron app path at last write | `"."` until opened |
| `app_version` | Last-seen Studio version | Current `app.getVersion()` on load/save |

On successful load, set in-memory `app_version` to the running app version (V1 did this on load). Persist that refresh on the next save, not necessarily on every launch unless a write already happens.

### Derived Q2

`projectCreated` is **true** only when:

1. `user.json` exists and parses as an object, and
2. `project_path` is a non-empty path other than the placeholder `"."`, and
3. `{project_path}/.lugo/info.json` exists on disk.

Otherwise `projectCreated` is **false**. Do not delete `user.json` automatically when the bot is invalid; welcome will offer to open a folder (step 08).

### IPC / preload

- `config.get()` must return at least `{ projectCreated, projectPath }` where `projectPath` is the stored `project_path` or empty/`null` when Q2 is no. Keep backward-compatible `projectCreated` used by `src/shared/types.js` and `src/preload/api.d.ts`.
- `config.set(patch)` applies a partial update to the **stored V1 keys** (map renderer-friendly names to snake_case storage). Never replace the file with only V3-only fields. Never persist `projectCreated` as a JSON key.
- Invalid JSON on disk: treat as Q2 no, surface a log line, do not crash the app. Do not overwrite the corrupt file until a later explicit save.

## Technical direction

- Replace the stub in `src/main/services/config/index.js` (and split helpers under `src/main/services/config/` if the file would otherwise mix path, parse, and validity).
- Extend `src/shared/types.js` and `src/preload/api.d.ts` for the get payload.
- IPC handlers in `src/main/ipc/config.js` stay thin.
- Renderer must not read the filesystem; only `window.studio.config`.
- Update `DEVELOPMENT.md` “V1 settings path and format” with the table above.

## Security & compliance

- Settings live on the local machine only; no network.
- `project_path` is an absolute filesystem path chosen by the user later; do not execute it.
- Do not write secrets. V1 `publish_data` lives in the bot’s `.lugo/info.json`, not in `user.json`.
- Preserve unknown keys so a future V1 field is not stripped if the user still runs V1 against the same file.

## Acceptance criteria

- [x] With no `user.json`, `config.get()` reports `projectCreated: false`.
- [x] Copying a real V1 `user.json` whose `project_path` still has `.lugo/info.json` → `projectCreated: true` and `projectPath` matches.
- [x] Same file but `project_path` deleted or missing `.lugo/info.json` → `projectCreated: false`; file left intact.
- [x] `config.set` of a partial patch (e.g. `debug_mode`) does not drop other V1 keys.
- [x] Path is under OS appData `.LugoStudio`, not Electron `userData` and not the git working tree (unless the developer’s appData happens to coincide).
- [x] `DEVELOPMENT.md` open decision for V1 settings path/format is filled in.

## Verification

- Manual: point `project_path` at a known V1 bot folder; launch V3; inspect get payload.
- Manual: rename `.lugo` on that folder; get again; confirm Q2 flips to false.
- Manual: hex-edit `user.json` to invalid JSON; app still reaches loading/welcome without throwing in main.
- Automated: unit tests for validity helper and merge-on-set with a temp directory (recommended).

## Risks & edge cases

- V1 allowed `project_path: "."` as default — must count as Q2 no.
- Relative `project_path` from an old file — resolve against the current working directory only if that was V1 behavior; prefer treating non-absolute paths as invalid for Q2 (welcome) rather than guessing.
- File locked by another process — fail the write, return an error through IPC for step 08 to show a dialog.
- Adding `node-machine-id` vs UUID — if the dependency is skipped, document that `install_unique_id` will not match V1’s value on first create; existing V1 files already have an id and must be left alone.

## Follow-ups

- Settings page to edit image tags, debug flag, etc. (DEVELOPMENT.md item 7).
- `.studio.env` generation when game run exists.
- Reset-settings (V1 deleted the whole `.LugoStudio` folder) — not in this slice.

## Landed

- `src/main/services/config/` reads and writes `{appData}/.LugoStudio/user.json` with the full V1 key set. Q2 is derived from an absolute `project_path` plus `.lugo/info.json`.
- `install_unique_id` uses `node-machine-id` `machineIdSync(true)` on first create.
- Tests: `npm run test:config` (46 passed).
- Deviations: `config.get()` also returns stored V1 keys (not only `projectCreated` / `projectPath`); write failures return `{ error }` instead of throwing.
- PR: https://github.com/lugobots/studio-v3/pull/2
