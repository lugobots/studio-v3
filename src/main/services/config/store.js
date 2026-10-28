"use strict";

const fs = require("node:fs");
const path = require("node:path");

const V1_KEYS = [
  "install_unique_id",
  "debug_mode",
  "project_path",
  "team_side",
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

module.exports = {
  V1_KEYS,
  settingsFile,
  read,
  write,
  applyPatch,
  telemetryEnabled,
  projectReady,
  botPaths,
  rememberBot,
};
