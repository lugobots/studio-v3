"use strict";

const fs = require("fs");
const path = require("path");
const { isBotValid } = require("../config/helpers");
const {
  COMPOSE_FILE_NAME,
  DIALOG_PROPERTIES,
  DIALOG_TITLE,
  EMPTY_SELECTION_ERROR,
  PICKER_FAILED_ERROR,
  SAVE_FAILED_ERROR,
  invalidBotMessage,
} = require("./constants");

function isDirectory(folder) {
  try {
    return fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

function errorMessage(err, fallback) {
  return err && err.message ? String(err.message) : fallback;
}

function createProjectService(options = {}) {
  const showOpenDialog = options.showOpenDialog;
  const getWindow = options.getWindow;
  const getAppPath = options.getAppPath;
  const config = options.config;
  const log = options.log || ((message) => console.error(message));

  async function pickFolder(win) {
    const dialogOptions = {
      title: DIALOG_TITLE,
      properties: [...DIALOG_PROPERTIES],
    };
    const parent = win || (typeof getWindow === "function" ? getWindow() : null) || null;
    let result;
    try {
      result = await showOpenDialog(parent, dialogOptions);
    } catch (err) {
      const message = errorMessage(err, PICKER_FAILED_ERROR);
      log(`[project] Folder picker failed: ${message}`);
      return { ok: false, error: message };
    }
    if (!result || result.canceled === true) {
      return { cancelled: true };
    }
    const folder = Array.isArray(result.filePaths) ? result.filePaths[0] : "";
    if (typeof folder !== "string" || folder.trim() === "") {
      return { ok: false, error: EMPTY_SELECTION_ERROR, reason: "empty" };
    }
    return { ok: true, folder };
  }

  async function openFolder(folder) {
    if (typeof folder !== "string" || folder.trim() === "") {
      return { ok: false, error: EMPTY_SELECTION_ERROR, reason: "empty" };
    }
    if (!isDirectory(folder) || !isBotValid(folder)) {
      return { ok: false, error: invalidBotMessage(folder), reason: "invalid" };
    }

    let appPath;
    try {
      appPath = getAppPath();
    } catch (err) {
      const message = errorMessage(err, SAVE_FAILED_ERROR);
      log(`[project] Could not read app path: ${message}`);
      return { ok: false, error: message, reason: "write" };
    }
    if (typeof appPath !== "string" || !appPath) {
      return { ok: false, error: SAVE_FAILED_ERROR, reason: "write" };
    }

    let saved;
    try {
      saved = await config.set({
        project_path: folder,
        compose_file: path.join(folder, COMPOSE_FILE_NAME),
        app_path: appPath,
      });
    } catch (err) {
      const message = errorMessage(err, SAVE_FAILED_ERROR);
      log(`[project] Failed to save settings: ${message}`);
      return { ok: false, error: message, reason: "write" };
    }
    if (saved && saved.error) {
      return { ok: false, error: saved.error, reason: "write" };
    }
    return { ok: true };
  }

  async function openExisting(callOptions = {}) {
    const picked = await pickFolder(callOptions.window);
    if (picked.cancelled) {
      return { cancelled: true };
    }
    if (!picked.ok) {
      return { ok: false, error: picked.error, reason: picked.reason };
    }
    return openFolder(picked.folder);
  }

  return { pickFolder, openFolder, openExisting };
}

let service = null;

function getElectronService() {
  if (!service) {
    const { app, dialog, BrowserWindow } = require("electron");
    const config = require("../config");
    service = createProjectService({
      showOpenDialog: (win, opts) => {
        if (win) {
          return dialog.showOpenDialog(win, opts);
        }
        return dialog.showOpenDialog(opts);
      },
      getWindow: () => BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null,
      getAppPath: () => app.getAppPath(),
      config,
      log: (message) => console.error(message),
    });
  }
  return service;
}

async function openExisting(callOptions) {
  return getElectronService().openExisting(callOptions);
}

module.exports = {
  createProjectService,
  openExisting,
};
