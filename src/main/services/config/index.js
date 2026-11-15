"use strict";

const { app } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const store = require("./store");
const { checkBotCompatibility } = require("../bots/compatibility");
const pkg = require("../../../../package.json");
const { sessionEditorUrl, sessionGameFrontendUrl } = require("../session-urls");
const studioApi = require("../studio-api");

function filePath() {
  return store.settingsFile(app.getPath("appData"), process.platform);
}

function opponentPathReady(folder) {
  return checkBotCompatibility(folder).ok === true;
}

function view(record) {
  const data = record.data;
  // Studio API build version (e.g. "dev" or "v1.0.1"), not the V3 product generation.
  const apiVersion = studioApi.apiVersion() || "dev";
  const opponent = store.opponentSourceConfig(data, opponentPathReady);
  return {
    ...data,
    bot_paths: store.botPaths(data),
    projectCreated: store.projectReady(data, fs.existsSync),
    telemetryEnabled: store.telemetryEnabled(data),
    appearance: store.appearance(data),
    workspaceEditorOpen: store.workspaceEditorOpen(data),
    workspace_editor_open: store.workspaceEditorOpen(data),
    workspace_split_horizontal: store.workspaceSplitHorizontal(data),
    workspace_split_logs: store.workspaceSplitLogs(data),
    debugMode: store.apiDebugEnabled(data),
    opponent_source: opponent.opponent_source,
    opponent_projects: opponent.opponent_projects,
    opponent_project_path: opponent.opponent_project_path,
    effective_opponent_source: opponent.effective_source,
    effective_opponent_project_path: opponent.effective_project_path,
    measurementId: process.env.STUDIO_GA_MEASUREMENT_ID || "",
    appVersion: pkg.version,
    apiVersion,
    studio_api_version: apiVersion,
    game_frontend_url: sessionGameFrontendUrl(),
    editor_url: sessionEditorUrl(),
  };
}

async function get() {
  // Refresh the Studio API build version from /api/health when the container is up.
  try {
    await studioApi.healthy();
  } catch {
    // Keep the last known / default "dev" label when health is unreachable.
  }
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

/**
 * Active opponent source with labeled list; invalid local paths fall back to Level-1.
 */
async function getOpponentSource() {
  return store.opponentSourceConfig(store.read(filePath()).data, opponentPathReady);
}

/**
 * Add/update a labeled local opponent after the same compatibility check as bot open.
 */
async function rememberOpponentProject(entry) {
  const file = filePath();
  const record = store.read(file);
  const folder = entry && typeof entry.path === "string" ? entry.path.trim() : "";
  const compatibility = checkBotCompatibility(folder);
  const result = store.rememberOpponentProject(record.data, entry, compatibility);
  if (!result.ok) {
    return result;
  }
  const next = result.data;
  if (!next.install_unique_id) {
    next.install_unique_id = crypto.randomUUID();
  }
  next.app_version = pkg.version;
  next.app_path = app.getAppPath();
  store.write(file, next);
  return { ok: true, data: view({ exists: true, data: next }) };
}

async function forgetOpponentProject(folder) {
  const file = filePath();
  const record = store.read(file);
  const next = store.forgetOpponentProject(record.data, folder);
  if (!next.install_unique_id) {
    next.install_unique_id = crypto.randomUUID();
  }
  next.app_version = pkg.version;
  next.app_path = app.getAppPath();
  store.write(file, next);
  return view({ exists: true, data: next });
}

async function setOpponentSource(source, folder = "") {
  const file = filePath();
  const record = store.read(file);
  const result = store.setOpponentSource(record.data, source, folder);
  if (!result.ok) {
    return result;
  }
  const next = result.data;
  if (!next.install_unique_id) {
    next.install_unique_id = crypto.randomUUID();
  }
  next.app_version = pkg.version;
  next.app_path = app.getAppPath();
  store.write(file, next);
  return { ok: true, data: view({ exists: true, data: next }) };
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
  getOpponentSource,
  rememberOpponentProject,
  forgetOpponentProject,
  setOpponentSource,
  rememberBot,
  forgetBot,
  filePath,
  projectFileReady,
};
