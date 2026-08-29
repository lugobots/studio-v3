"use strict";

const fs = require("fs");
const path = require("path");
const {
  BOT_INFO_JSON,
  BOT_LUGO_FOLDER,
  KNOWN_USER_DATA_KEYS,
  LUGO_STUDIO_FOLDER,
  LUGO_STUDIO_USER_DATA_FILE,
  PATCH_ALIASES,
  SKIP_PATCH_KEYS,
} = require("./constants");

function getLugoStudioFolderPath(appDataPath) {
  return path.join(appDataPath, LUGO_STUDIO_FOLDER);
}

function getUserDataFilePath(appDataPath) {
  return path.join(appDataPath, LUGO_STUDIO_FOLDER, LUGO_STUDIO_USER_DATA_FILE);
}

function isPlaceholderProjectPath(projectPath) {
  return projectPath === "." || projectPath === "";
}

function isUsableProjectPath(projectPath) {
  return typeof projectPath === "string" && path.isAbsolute(projectPath) && !isPlaceholderProjectPath(projectPath);
}

function isBotValid(folder) {
  if (!isUsableProjectPath(folder)) {
    return false;
  }
  const lugoDir = path.join(folder, BOT_LUGO_FOLDER);
  const infoPath = path.join(lugoDir, BOT_INFO_JSON);
  return fs.existsSync(lugoDir) && fs.existsSync(infoPath);
}

function isProjectCreated(data) {
  if (!data || typeof data !== "object") {
    return false;
  }
  return isBotValid(data.project_path);
}

function createDefaultUserData({ getAppVersion, generateInstallId }) {
  return {
    install_unique_id: generateInstallId(),
    debug_mode: false,
    project_path: ".",
    team_side: "home",
    opponent_team: "level-0",
    game_speed: 1,
    saved_positions: [],
    compose_file: "",
    game_server_image: "lugobots/server",
    game_server_version: "v2",
    bot_level_0_image: "lugobots/level-0",
    bot_level_0_version: "v2",
    bot_level_1_image: "lugobots/level-1",
    bot_level_1_version: "v4",
    app_path: ".",
    app_version: getAppVersion(),
  };
}

function mergeLoadedUserData(parsed, defaults) {
  const merged = { ...defaults, ...parsed };
  delete merged.projectCreated;
  return merged;
}

function mapPatchKey(key) {
  if (SKIP_PATCH_KEYS.has(key)) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(PATCH_ALIASES, key)) {
    return PATCH_ALIASES[key];
  }
  return key;
}

function applyUserDataPatch(current, patch) {
  const next = { ...current };
  if (patch == null || typeof patch !== "object" || Array.isArray(patch)) {
    delete next.projectCreated;
    return next;
  }
  for (const [rawKey, value] of Object.entries(patch)) {
    const key = mapPatchKey(rawKey);
    if (!key) {
      continue;
    }
    next[key] = value;
  }
  delete next.projectCreated;
  return next;
}

function orderUserDataKeys(data) {
  const ordered = {};
  for (const key of KNOWN_USER_DATA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      ordered[key] = data[key];
    }
  }
  for (const key of Object.keys(data)) {
    if (!Object.prototype.hasOwnProperty.call(ordered, key) && key !== "projectCreated") {
      ordered[key] = data[key];
    }
  }
  return ordered;
}

function toAppConfig(data, extra = {}) {
  const stored = { ...data };
  delete stored.projectCreated;
  const projectCreated = isProjectCreated(stored);
  const result = {
    ...stored,
    projectCreated,
    projectPath: projectCreated ? stored.project_path : null,
  };
  if (extra.error) {
    result.error = extra.error;
  }
  return result;
}

function parseUserDataObject(raw) {
  const parsed = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("settings file is not a JSON object");
  }
  return parsed;
}

module.exports = {
  applyUserDataPatch,
  createDefaultUserData,
  getLugoStudioFolderPath,
  getUserDataFilePath,
  isBotValid,
  isPlaceholderProjectPath,
  isProjectCreated,
  isUsableProjectPath,
  mergeLoadedUserData,
  orderUserDataKeys,
  parseUserDataObject,
  toAppConfig,
};
