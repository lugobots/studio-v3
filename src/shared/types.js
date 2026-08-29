"use strict";

/**
 * @typedef {"ok" | "not_installed" | "not_running" | "timeout" | "permission"} DockerStatusReason
 */

/**
 * @typedef {object} DockerStatus
 * @property {boolean | null} running `null` only before a check has finished; `getStatus()` always returns a boolean.
 * @property {DockerStatusReason} [reason]
 */

/**
 * Stored V1 `user.json` fields. `projectCreated` is derived and never persisted.
 *
 * @typedef {object} StoredUserData
 * @property {string} install_unique_id
 * @property {boolean} debug_mode
 * @property {string} project_path
 * @property {"home" | "away"} team_side
 * @property {string} opponent_team
 * @property {number} game_speed
 * @property {object[]} saved_positions
 * @property {string} compose_file
 * @property {string} game_server_image
 * @property {string} game_server_version
 * @property {string} bot_level_0_image
 * @property {string} bot_level_0_version
 * @property {string} bot_level_1_image
 * @property {string} bot_level_1_version
 * @property {string} app_path
 * @property {string} app_version
 */

/**
 * @typedef {StoredUserData & {
 *   projectCreated: boolean,
 *   projectPath: string | null,
 *   error?: string
 * }} AppConfig
 */

/**
 * @typedef {object} UpdateInfo
 * @property {boolean} available
 */

module.exports = {};
