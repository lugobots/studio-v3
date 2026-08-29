"use strict";

const LUGO_STUDIO_FOLDER = ".LugoStudio";
const LUGO_STUDIO_USER_DATA_FILE = "user.json";
const BOT_LUGO_FOLDER = ".lugo";
const BOT_INFO_JSON = "info.json";

const KNOWN_USER_DATA_KEYS = [
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

const SKIP_PATCH_KEYS = new Set(["projectCreated", "error"]);

const PATCH_ALIASES = {
  projectPath: "project_path",
  debugMode: "debug_mode",
  teamSide: "team_side",
  opponentTeam: "opponent_team",
  gameSpeed: "game_speed",
  savedPositions: "saved_positions",
  composeFile: "compose_file",
  gameServerImage: "game_server_image",
  gameServerVersion: "game_server_version",
  botLevel0Image: "bot_level_0_image",
  botLevel0Version: "bot_level_0_version",
  botLevel1Image: "bot_level_1_image",
  botLevel1Version: "bot_level_1_version",
  appPath: "app_path",
  appVersion: "app_version",
  installUniqueId: "install_unique_id",
};

module.exports = {
  LUGO_STUDIO_FOLDER,
  LUGO_STUDIO_USER_DATA_FILE,
  BOT_LUGO_FOLDER,
  BOT_INFO_JSON,
  KNOWN_USER_DATA_KEYS,
  SKIP_PATCH_KEYS,
  PATCH_ALIASES,
};
