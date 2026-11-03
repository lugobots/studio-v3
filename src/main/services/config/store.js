"use strict";

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

const TEAM_SIDES = ["home", "away"];
const GAME_SPEEDS = ["slow", "normal", "fast"];
/** Values stored under opponent_team — opponent Level-1 MODE strings used today. */
const OPPONENT_MODES = ["default", "zombies", "statues", "kids", "defenses"];

const MATCH_DEFAULTS = {
  team_side: "home",
  skip_to_golden_goal: false,
  game_speed: "normal",
  opponent_team: "default",
  saved_positions: [],
};

function settingsFile(appData, platform = process.platform) {
  const joiner = platform === "win32" ? path.win32 : path;
  return joiner.join(appData, ".LugoStudio", "user.json");
}

function read(file, fsImpl = fs) {
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { exists: true, data: {} };
    }
    return { exists: true, data: parsed };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { exists: false, data: {} };
    }
    throw error;
  }
}

function write(file, data, fsImpl = fs) {
  fsImpl.mkdirSync(path.dirname(file), { recursive: true });
  fsImpl.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
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
 * Normalized app-level match prefs from user.json data.
 * Missing or invalid keys use defaults (home, no golden skip, normal, default, []).
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

function telemetryEnabled(data) {
  if (!data || !Object.prototype.hasOwnProperty.call(data, "telemetry_enabled")) {
    return true;
  }
  return data.telemetry_enabled !== false;
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
  TEAM_SIDES,
  GAME_SPEEDS,
  OPPONENT_MODES,
  settingsFile,
  read,
  write,
  applyPatch,
  matchConfig,
  matchPatch,
  telemetryEnabled,
  projectReady,
  botPaths,
  rememberBot,
  forgetBot,
};
