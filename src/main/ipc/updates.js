"use strict";

const { ipcMain, BrowserWindow } = require("electron");
const { CHANNELS } = require("../../shared/ipc-channels");
const updater = require("../services/updater");

function broadcastProgress(payload) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win || win.isDestroyed()) {
      continue;
    }
    try {
      win.webContents.send(CHANNELS.updates.progress, payload);
    } catch {
      // ignore
    }
  }
}

function register() {
  updater.setProgressListener(broadcastProgress);

  ipcMain.handle(CHANNELS.updates.check, async () => {
    try {
      return await updater.check();
    } catch {
      return { available: false, version: null, fileName: null, sizeBytes: null };
    }
  });

  ipcMain.handle(CHANNELS.updates.download, async (_event, request) => {
    try {
      return await updater.download(request);
    } catch (err) {
      return {
        ok: false,
        error: err && err.message ? String(err.message) : "Download failed.",
      };
    }
  });

  ipcMain.handle(CHANNELS.updates.cancel, () => {
    try {
      return updater.cancel();
    } catch {
      return { cancelled: false };
    }
  });
}

module.exports = { register };
