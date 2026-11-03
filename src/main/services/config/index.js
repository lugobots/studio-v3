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

function projectFileReady(folder) {
  return fs.existsSync(path.join(folder, ".lugo", "info.json"));
}

module.exports = { get, set, rememberBot, forgetBot, filePath, projectFileReady };
