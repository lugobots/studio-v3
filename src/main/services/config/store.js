"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

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
  "home_bots_active",
  "away_bots_active",
];

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
/** Roster size for Home/Away desired-active arrays. */
const BOT_ROSTER_SIZE = 11;

const MATCH_DEFAULTS = {
  team_side: "home",
  skip_to_golden_goal: false,
  game_speed: "normal",
  opponent_team: "default",
  saved_positions: [],
  home_bots_active: Array.from({ length: BOT_ROSTER_SIZE }, () => true),
  away_bots_active: Array.from({ length: BOT_ROSTER_SIZE }, () => true),
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
      next[key] = value;
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
 * Missing or invalid keys use defaults (home, no golden skip, normal, default, [], all bots active).
 * opponent_team holds opponent mode values (default/zombies/statues/kids/defenses).
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
    home_bots_active: normalizeBotsActive(source.home_bots_active),
    away_bots_active: normalizeBotsActive(source.away_bots_active),
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
 */
function matchSettingsForApi(data) {
  const match = matchConfig(data);
  return {
    team_side: match.team_side,
    skip_to_golden_goal: match.skip_to_golden_goal,
    game_speed: match.game_speed,
    opponent_mode: match.opponent_team,
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

module.exports = {
  V1_KEYS,
  MATCH_KEYS,
  MATCH_DEFAULTS,
  BOT_ROSTER_SIZE,
  IMAGE_KEYS,
  IMAGE_DEFAULTS,
  LEVEL1_IMAGE_BINARY_PATH,
  LEVEL1_CONTAINER_BINARY_PATH,
  TEAM_SIDES,
  GAME_SPEEDS,
  OPPONENT_MODES,
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
  telemetryEnabled,
  appearance,
  apiDebugEnabled,
  projectReady,
  botPaths,
  rememberBot,
  forgetBot,
};
