"use strict";

const { app } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const store = require("./store");
const pkg = require("../../../../package.json");
const { editorUrl, gameFrontendUrl } = require("../../../shared/ports");

function filePath() {
  return store.settingsFile(app.getPath("appData"), process.platform);
}

function view(record) {
  const data = record.data;
  return {
    ...data,
    bot_paths: store.botPaths(data),
    projectCreated: store.projectReady(data, fs.existsSync),
    telemetryEnabled: store.telemetryEnabled(data),
    debugMode: store.apiDebugEnabled(data),
    measurementId: process.env.STUDIO_GA_MEASUREMENT_ID || "",
    appVersion: pkg.version,
    game_frontend_url: gameFrontendUrl(),
    editor_url: editorUrl(),
  };
}

async function get() {
  return view(store.read(filePath()));
}

async function rememberBot(folder) {
  const file = filePath();
  const record = store.read(file);
  const next = store.rememberBot(record.data, folder);
  next.compose_file = path.join(folder, "docker-compose.yml");
  if (!next.install_unique_id) {
    next.install_unique_id = crypto.randomUUID();
  }
  next.app_version = pkg.version;
  next.app_path = app.getAppPath();
  store.write(file, next);
  return view({ exists: true, data: next });
}

async function forgetBot(folder) {
  const file = filePath();
  const record = store.read(file);
  const next = store.forgetBot(record.data, folder);
  if (!next.install_unique_id) {
    next.install_unique_id = crypto.randomUUID();
  }
  next.app_version = pkg.version;
  next.app_path = app.getAppPath();
  store.write(file, next);
  return view({ exists: true, data: next });
}

async function set(patch) {
  const file = filePath();
  const record = store.read(file);
  const next = store.applyPatch(record.data, patch);
  if (!next.install_unique_id) {
    next.install_unique_id = crypto.randomUUID();
  }
  next.app_version = pkg.version;
  next.app_path = app.getAppPath();
  store.write(file, next);
  return view({ exists: true, data: next });
}

async function getMatch() {
  return store.matchConfig(store.read(filePath()).data);
}

async function setMatch(partial) {
  const file = filePath();
  const record = store.read(file);
  const merged = {
    ...store.matchConfig(record.data),
    ...store.matchPatch(partial),
  };
  const normalized = store.matchConfig(merged);
  const next = store.applyPatch(record.data, store.matchPatch(normalized));
  if (!next.install_unique_id) {
    next.install_unique_id = crypto.randomUUID();
  }
  next.app_version = pkg.version;
  next.app_path = app.getAppPath();
  store.write(file, next);
  return store.matchConfig(next);
}

/** Current match prefs shaped for server/match/bot Studio API request bodies. */
async function matchSettingsForApi() {
  return store.matchSettingsForApi(store.read(filePath()).data);
}

/**
 * Resolved Level-1 image:tag plus host cache / container binary paths for
 * Docker pull-extract and API container mounts.
 */
async function getLevel1() {
  return store.level1Resolved(store.read(filePath()).data, app.getPath("appData"), process.platform);
}

function projectFileReady(folder) {
  return fs.existsSync(path.join(folder, ".lugo", "info.json"));
}

module.exports = {
  get,
  set,
  getMatch,
  setMatch,
  matchSettingsForApi,
  getLevel1,
  rememberBot,
  forgetBot,
  filePath,
  projectFileReady,
};
