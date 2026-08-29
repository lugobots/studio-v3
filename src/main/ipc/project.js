"use strict";

const { ipcMain, BrowserWindow } = require("electron");
const { CHANNELS } = require("../../shared/ipc-channels");
const project = require("../services/project");

function windowFromEvent(event) {
  try {
    return BrowserWindow.fromWebContents(event.sender);
  } catch {
    return null;
  }
}

function register() {
  ipcMain.handle(CHANNELS.project.openExisting, async (event) => {
    try {
      return await project.openExisting({ window: windowFromEvent(event) });
    } catch (err) {
      return {
        ok: false,
        error: err && err.message ? String(err.message) : "Could not open the bot folder.",
      };
    }
  });
}

module.exports = { register };
