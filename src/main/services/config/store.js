"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const workspaceSplit = require("../../../shared/workspace-split");

const V1_KEYS = [
  "install_unique_id",
  "debug_mode",
  "project_path",
  "team_side",
  "skip_to_golden_goal",
  "opponent_team",
  "game_speed",
  "saved_positions",
  "compose_file",
  "game_server_image",
  "game_server_version",
  "bot_level_0_image",
  "bot_level_0_version",
  "bot_level_1_image",
  "bot_level_1_version",
  "bot_setup_image",
  "bot_setup_version",
  "app_path",
  "app_version",
];

/** App-level match preference keys persisted in user.json (not per-bot). */
const MATCH_KEYS = [
  "team_side",
  "skip_to_golden_goal",
  "game_speed",
  "opponent_team",
  "saved_positions",
];

/** Max length for new opponent project labels (after trim). */
const OPPONENT_LABEL_MAX = 20;

/** Runtime Docker image name/tag keys (V1-compatible + bot_setup_*). */
const IMAGE_KEYS = [
  "game_server_image",
  "game_server_version",
  "bot_level_0_image",
  "bot_level_0_version",
  "bot_level_1_image",
  "bot_level_1_version",
  "bot_setup_image",
  "bot_setup_version",
];

const TEAM_SIDES = ["home", "away"];
const GAME_SPEEDS = ["slow", "normal", "fast"];
/** Values stored under opponent_team — opponent Level-1 MODE strings used today. */
const OPPONENT_MODES = ["default", "zombies", "statues", "kids", "defenses"];
/** Opponent source: official Level-1 binary or a labeled local bot project. */
const OPPONENT_SOURCES = ["level1", "local"];
/** Roster size for Home/Away desired-active arrays. */
const BOT_ROSTER_SIZE = 11;
/** In-container bind-mount target for a local opponent bot project. */
const OPPONENT_PROJECT_CONTAINER_PATH = "/bot-opponent";

const MATCH_DEFAULTS = {
  team_side: "home",
  skip_to_golden_goal: false,
  game_speed: "normal",
  opponent_team: "default",
  saved_positions: [],
};

const OPPONENT_SOURCE_DEFAULTS = {
  opponent_source: "level1",
  opponent_projects: [],
  opponent_project_path: "",
};

/** Studio V1 defaults for runtime image settings (level-1 is consumed now; others reserved). */
const IMAGE_DEFAULTS = {
  game_server_image: "lugobots/server",
  game_server_version: "v2",
  bot_level_0_image: "lugobots/level-0",
  bot_level_0_version: "v2",
  bot_level_1_image: "lugobots/level-1",
  bot_level_1_version: "v4",
  bot_setup_image: "lugobots/bot-setup",
  bot_setup_version: "latest",
};

/** In-image path of the official Level-1 bot binary (docker cp source). */
const LEVEL1_IMAGE_BINARY_PATH = "/bin/my-bot";
/** Path the Studio API bot manager expects inside the API container. */
const LEVEL1_CONTAINER_BINARY_PATH = "/usr/local/lib/lugo/bot-level-1";

function settingsFile(appData, platform = process.platform) {
  const joiner = platform === "win32" ? path.win32 : path;
  return joiner.join(appData, ".LugoStudio", "user.json");
}

/**
 * Fill missing runtime image keys with V1-compatible defaults.
 * Existing non-empty string values are preserved.
 */
function withImageDefaults(data) {
  const next = data && typeof data === "object" && !Array.isArray(data) ? { ...data } : {};
  for (const key of IMAGE_KEYS) {
    const value = next[key];
    if (typeof value !== "string" || value.length === 0) {
      next[key] = IMAGE_DEFAULTS[key];
    }
  }
  return next;
}

/**
 * Resolved runtime image settings from user.json data.
 * Missing or empty keys use IMAGE_DEFAULTS.
 */
function imageConfig(data) {
  const filled = withImageDefaults(data);
  const out = {};
  for (const key of IMAGE_KEYS) {
    out[key] = filled[key];
  }
  return out;
}

/**
 * Stable short digest of an image:tag used as the Level-1 host cache key.
 */
function level1CacheKey(imageRef) {
  return crypto.createHash("sha256").update(String(imageRef || "")).digest("hex").slice(0, 16);
}

/**
 * Resolved Level-1 image:tag and host/container binary paths for Docker/session startup.
 * Missing image keys use IMAGE_DEFAULTS; cache path is keyed by image:tag under .LugoStudio.
 */
function level1Resolved(data, appData, platform = process.platform) {
  const images = imageConfig(data);
  const image = images.bot_level_1_image;
  const tag = images.bot_level_1_version;
  const ref = `${image}:${tag}`;
  const cacheKey = level1CacheKey(ref);
  const joiner = platform === "win32" ? path.win32 : path;
  const cacheDir = joiner.join(appData, ".LugoStudio", "cache", "level-1", cacheKey);
  return {
    image,
    tag,
    ref,
    cacheKey,
    cacheDir,
    hostBinaryPath: joiner.join(cacheDir, "my-bot"),
    imageBinaryPath: LEVEL1_IMAGE_BINARY_PATH,
    containerBinaryPath: LEVEL1_CONTAINER_BINARY_PATH,
  };
}

function read(file, fsImpl = fs) {
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { exists: true, data: withImageDefaults({}) };
    }
    return { exists: true, data: withImageDefaults(parsed) };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { exists: false, data: withImageDefaults({}) };
    }
    throw error;
  }
}

function write(file, data, fsImpl = fs) {
  const filled = withImageDefaults(data);
  fsImpl.mkdirSync(path.dirname(file), { recursive: true });
  fsImpl.writeFileSync(file, `${JSON.stringify(filled, null, 2)}\n`);
}

function applyPatch(current, patch) {
  const next = { ...(current || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value !== undefined) {
      if (key === "workspace_split_horizontal") {
        next[key] = workspaceSplit.clampHorizontal(value);
      } else if (key === "workspace_split_logs") {
        next[key] = workspaceSplit.clampLogs(value);
      } else {
        next[key] = value;
      }
    }
  }
  return next;
}

function pickAllowed(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/**
 * Normalize a Home/Away desired-active array to exactly BOT_ROSTER_SIZE booleans.
 * Missing, wrong type, or wrong length falls back to all true.
 */
function normalizeBotsActive(value) {
  if (!Array.isArray(value) || value.length !== BOT_ROSTER_SIZE) {
    return Array.from({ length: BOT_ROSTER_SIZE }, () => true);
  }
  return value.map((entry) => entry === true);
}

/**
 * Normalized app-level match prefs from user.json data.
 * Missing or invalid keys use defaults (home, no golden skip, normal, default, []).
 * opponent_team holds opponent mode values (default/zombies/statues/kids/defenses).
 * Legacy home_bots_active / away_bots_active keys are ignored (session-only desired-active).
 */
function matchConfig(data) {
  const source = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const positions = Array.isArray(source.saved_positions) ? source.saved_positions.slice() : [];
  return {
    team_side: pickAllowed(source.team_side, TEAM_SIDES, MATCH_DEFAULTS.team_side),
    skip_to_golden_goal: source.skip_to_golden_goal === true,
    game_speed: pickAllowed(source.game_speed, GAME_SPEEDS, MATCH_DEFAULTS.game_speed),
    opponent_team: pickAllowed(source.opponent_team, OPPONENT_MODES, MATCH_DEFAULTS.opponent_team),
    saved_positions: positions,
  };
}

/**
 * Normalize labeled local opponent entries: keep non-empty string label+path pairs.
 * Duplicate paths keep the last label.
 */
function normalizeOpponentProjects(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const byPath = new Map();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const label = typeof entry.label === "string" ? entry.label.trim() : "";
    const folder = typeof entry.path === "string" ? entry.path.trim() : "";
    if (!label || !folder) {
      continue;
    }
    byPath.set(folder, { label, path: folder });
  }
  return Array.from(byPath.values());
}

/**
 * App-level opponent source selection from user.json.
 * Invalid local selection falls back to Level-1 without wiping the labeled list.
 * `pathReady` decides whether a local path is still usable (defaults to always true
 * for pure data normalization; callers pass exists/compat checks for effective source).
 */
function opponentSourceConfig(data, pathReady = () => true) {
  const source = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const projects = normalizeOpponentProjects(source.opponent_projects);
  const requested = pickAllowed(
    source.opponent_source,
    OPPONENT_SOURCES,
    OPPONENT_SOURCE_DEFAULTS.opponent_source,
  );
  const storedPath =
    typeof source.opponent_project_path === "string" ? source.opponent_project_path.trim() : "";
  const knownPaths = new Set(projects.map((entry) => entry.path));
  const pathOk =
    storedPath.length > 0 && knownPaths.has(storedPath) && pathReady(storedPath) === true;
  const effectiveSource = requested === "local" && pathOk ? "local" : "level1";
  return {
    opponent_source: requested,
    opponent_projects: projects,
    opponent_project_path: storedPath,
    effective_source: effectiveSource,
    effective_project_path: effectiveSource === "local" ? storedPath : "",
  };
}

/**
 * Build a patch of only known match keys from a partial update.
 * Undefined fields are omitted so applyPatch leaves them unchanged.
 */
function matchPatch(partial) {
  const patch = {};
  if (!partial || typeof partial !== "object") {
    return patch;
  }
  for (const key of MATCH_KEYS) {
    if (Object.prototype.hasOwnProperty.call(partial, key) && partial[key] !== undefined) {
      patch[key] = partial[key];
    }
  }
  return patch;
}

/**
 * Map app-level match prefs to the Studio API request body shape.
 * user.json stores opponent mode under opponent_team; the API uses opponent_mode.
 * Team display names come from the open project folder name and active opponent label.
 */
function matchSettingsForApi(data) {
  const match = matchConfig(data);
  const source = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const projectPath = typeof source.project_path === "string" ? source.project_path.trim() : "";
  const playerName = projectPath ? path.basename(projectPath) : "";
  const opponent = opponentSourceConfig(source);
  let opponentName = "Level-1";
  if (opponent.effective_source === "local" && opponent.effective_project_path) {
    const entry = opponent.opponent_projects.find(
      (item) => item.path === opponent.effective_project_path,
    );
    opponentName = entry && entry.label ? entry.label : "Level-1";
  }
  return {
    team_side: match.team_side,
    skip_to_golden_goal: match.skip_to_golden_goal,
    game_speed: match.game_speed,
    opponent_mode: match.opponent_team,
    player_team_name: playerName,
    opponent_team_name: opponentName,
  };
}

function telemetryEnabled(data) {
  if (!data || !Object.prototype.hasOwnProperty.call(data, "telemetry_enabled")) {
    return true;
  }
  return data.telemetry_enabled !== false;
}

/**
 * Shell appearance preference in user.json (`appearance`).
 * Only "light" selects light mode; missing/invalid values default to dark.
 */
function appearance(data) {
  return data && data.appearance === "light" ? "light" : "dark";
}

/**
 * Workspace editor open preference in user.json (`workspace_editor_open`).
 * Missing/invalid values default to open (true). Only boolean false is closed.
 */
function workspaceEditorOpen(data) {
  if (!data || !Object.prototype.hasOwnProperty.call(data, "workspace_editor_open")) {
    return true;
  }
  return data.workspace_editor_open !== false;
}

/**
 * Game share of the Workspace horizontal split (`workspace_split_horizontal`).
 * Missing/invalid → equal panes; otherwise clamped to the 10:1 band.
 */
function workspaceSplitHorizontal(data) {
  if (!data || !Object.prototype.hasOwnProperty.call(data, "workspace_split_horizontal")) {
    return workspaceSplit.DEFAULT_HORIZONTAL;
  }
  return workspaceSplit.clampHorizontal(data.workspace_split_horizontal);
}

/**
 * Logs share of Workspace main height (`workspace_split_logs`).
 * Missing/invalid → default; otherwise clamped to ≤ 1/3.
 */
function workspaceSplitLogs(data) {
  if (!data || !Object.prototype.hasOwnProperty.call(data, "workspace_split_logs")) {
    return workspaceSplit.DEFAULT_LOGS;
  }
  return workspaceSplit.clampLogs(data.workspace_split_logs);
}

/**
 * Persisted Studio API debug preference (user.json `debug_mode`).
 * Only boolean true is on. This does not arm game-server or per-bot capture.
 * The game frontend's live `debug_mode` event field is a different document.
 */
function apiDebugEnabled(data) {
  return Boolean(data && data.debug_mode === true);
}

function projectReady(data, existsSync) {
  if (!data || typeof data.project_path !== "string" || data.project_path.length === 0) {
    return false;
  }
  return existsSync(path.join(data.project_path, ".lugo", "info.json"));
}

function botPaths(data) {
  if (data && Array.isArray(data.bot_paths)) {
    return data.bot_paths.filter((item) => typeof item === "string" && item.length > 0);
  }
  if (data && typeof data.project_path === "string" && data.project_path.length > 0) {
    return [data.project_path];
  }
  return [];
}

function rememberBot(data, folder) {
  const paths = botPaths(data);
  const bot_paths = paths.includes(folder) ? paths.slice() : paths.concat(folder);
  return {
    ...(data || {}),
    bot_paths,
    project_path: folder,
  };
}

function forgetBot(data, folder) {
  const next = {
    ...(data || {}),
    bot_paths: botPaths(data).filter((item) => item !== folder),
  };
  if (next.project_path === folder) {
    next.project_path = "";
    next.compose_file = "";
  }
  return next;
}

/**
 * Add or update a labeled local opponent project and select it as the active source.
 * `compatibility` must be `{ ok: true }` or `{ ok: false, error }`; incompatible folders
 * leave data unchanged and return `{ ok: false, error, data }`.
 */
function rememberOpponentProject(data, entry, compatibility) {
  const label = entry && typeof entry.label === "string" ? entry.label.trim() : "";
  const folder = entry && typeof entry.path === "string" ? entry.path.trim() : "";
  if (!label || !folder) {
    return { ok: false, error: "Opponent projects need a label and a folder path.", data };
  }
  if (label.length > OPPONENT_LABEL_MAX) {
    return {
      ok: false,
      error: `Opponent labels must be ${OPPONENT_LABEL_MAX} characters or fewer.`,
      data,
    };
  }
  if (!compatibility || compatibility.ok !== true) {
    return {
      ok: false,
      error: (compatibility && compatibility.error) || "That folder is not a compatible Lugo bot.",
      data,
    };
  }
  const current = opponentSourceConfig(data);
  const without = current.opponent_projects.filter((item) => item.path !== folder);
  const projects = without.concat([{ label, path: folder }]);
  const next = {
    ...(data || {}),
    opponent_source: "local",
    opponent_projects: projects,
    opponent_project_path: folder,
  };
  return { ok: true, data: next };
}

/**
 * Remove a labeled opponent by path. If it was the active local selection, fall back to Level-1.
 */
function forgetOpponentProject(data, folder) {
  const current = opponentSourceConfig(data);
  const projects = current.opponent_projects.filter((item) => item.path !== folder);
  const next = {
    ...(data || {}),
    opponent_projects: projects,
  };
  if (current.opponent_project_path === folder) {
    next.opponent_project_path = "";
    next.opponent_source = "level1";
  }
  return next;
}

/**
 * Set the active opponent source to Level-1 or a known labeled local path.
 * Unknown local paths leave data unchanged and return `{ ok: false, ... }`.
 */
function setOpponentSource(data, source, folder = "") {
  const current = opponentSourceConfig(data);
  if (source === "level1") {
    return {
      ok: true,
      data: {
        ...(data || {}),
        opponent_source: "level1",
      },
    };
  }
  if (source !== "local") {
    return { ok: false, error: "Opponent source must be level1 or local.", data };
  }
  const pathValue = typeof folder === "string" ? folder.trim() : "";
  const known = current.opponent_projects.some((item) => item.path === pathValue);
  if (!pathValue || !known) {
    return {
      ok: false,
      error: "Choose a saved labeled opponent project before selecting local source.",
      data,
    };
  }
  return {
    ok: true,
    data: {
      ...(data || {}),
      opponent_source: "local",
      opponent_project_path: pathValue,
    },
  };
}

module.exports = {
  V1_KEYS,
  MATCH_KEYS,
  MATCH_DEFAULTS,
  OPPONENT_SOURCE_DEFAULTS,
  BOT_ROSTER_SIZE,
  IMAGE_KEYS,
  IMAGE_DEFAULTS,
  LEVEL1_IMAGE_BINARY_PATH,
  LEVEL1_CONTAINER_BINARY_PATH,
  OPPONENT_PROJECT_CONTAINER_PATH,
  TEAM_SIDES,
  GAME_SPEEDS,
  OPPONENT_MODES,
  OPPONENT_SOURCES,
  OPPONENT_LABEL_MAX,
  settingsFile,
  read,
  write,
  applyPatch,
  withImageDefaults,
  imageConfig,
  level1CacheKey,
  level1Resolved,
  normalizeBotsActive,
  matchConfig,
  matchPatch,
  matchSettingsForApi,
  normalizeOpponentProjects,
  opponentSourceConfig,
  telemetryEnabled,
  appearance,
  workspaceEditorOpen,
  workspaceSplitHorizontal,
  workspaceSplitLogs,
  apiDebugEnabled,
  projectReady,
  botPaths,
  rememberBot,
  forgetBot,
  rememberOpponentProject,
  forgetOpponentProject,
  setOpponentSource,
};
