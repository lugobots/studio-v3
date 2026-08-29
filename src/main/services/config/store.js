"use strict";

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const {
  applyUserDataPatch,
  createDefaultUserData,
  getUserDataFilePath,
  mergeLoadedUserData,
  orderUserDataKeys,
  parseUserDataObject,
  toAppConfig,
} = require("./helpers");

function defaultGenerateInstallId() {
  try {
    const { machineIdSync } = require("node-machine-id");
    return String(machineIdSync(true));
  } catch (err) {
    console.error(`[config] node-machine-id unavailable, using UUID: ${err.message}`);
    return randomUUID();
  }
}

function writeUserDataFile(filePath, data) {
  const payload = orderUserDataKeys(data);
  delete payload.projectCreated;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function createConfigService(options) {
  const getAppDataPath = options.getAppDataPath;
  const getAppVersion = options.getAppVersion;
  const log = options.log || ((message) => console.error(message));
  const generateInstallId = options.generateInstallId || defaultGenerateInstallId;
  let pendingDefaults = null;

  function defaults() {
    if (!pendingDefaults) {
      pendingDefaults = createDefaultUserData({ getAppVersion, generateInstallId });
    }
    return { ...pendingDefaults, app_version: getAppVersion() };
  }

  function load() {
    const filePath = getUserDataFilePath(getAppDataPath());
    if (!fs.existsSync(filePath)) {
      return { status: "missing", data: defaults() };
    }

    let raw;
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch (err) {
      log(`[config] Could not read ${filePath}: ${err.message}`);
      return { status: "unreadable", data: defaults() };
    }

    try {
      const parsed = parseUserDataObject(raw);
      const data = mergeLoadedUserData(parsed, defaults());
      data.app_version = getAppVersion();
      return { status: "ok", data };
    } catch (err) {
      log(`[config] Invalid JSON in ${filePath}: ${err.message}`);
      return { status: "invalid", data: defaults() };
    }
  }

  async function get() {
    try {
      return toAppConfig(load().data);
    } catch (err) {
      log(`[config] Failed to read settings: ${err.message}`);
      return { projectCreated: false, projectPath: null };
    }
  }

  async function set(patch) {
    const loaded = load();
    const next = applyUserDataPatch(loaded.data, patch);
    next.app_version = getAppVersion();
    const filePath = getUserDataFilePath(getAppDataPath());
    try {
      writeUserDataFile(filePath, next);
      pendingDefaults = null;
    } catch (err) {
      log(`[config] Failed to write ${filePath}: ${err.message}`);
      return toAppConfig(loaded.data, { error: err.message });
    }
    return toAppConfig(next);
  }

  return { get, set };
}

module.exports = {
  createConfigService,
  defaultGenerateInstallId,
  writeUserDataFile,
};
