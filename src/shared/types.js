"use strict";

/**
 * @typedef {object} DockerStatus
 * @property {boolean} [running]
 * @property {boolean} [installed]
 * @property {"not_installed" | "not_running" | null} [reason]
 * @property {string} [image]
 * @property {boolean} [imagePresent]
 * @property {boolean} [unsupported]
 * @property {boolean} [ok]
 * @property {string} [error]
 * @property {{ status?: string, message?: string }} [pull]
 */

/**
 * @typedef {object} AppConfig
 * @property {boolean} projectCreated
 */

/**
 * @typedef {object} UpdateInfo
 * @property {boolean} available
 */

module.exports = {};
