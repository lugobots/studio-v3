"use strict";

const { ipcMain, BrowserWindow } = require("electron");
const { CHANNELS } = require("../../shared/ipc-channels");
const docker = require("../services/docker");

function broadcastImageProgress(payload) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win || win.isDestroyed()) {
      continue;
    }
    try {
      win.webContents.send(CHANNELS.docker.imageProgress, payload);
    } catch {
      // ignore
    }
  }
}

function register() {
  docker.setImageProgressListener(broadcastImageProgress);

  ipcMain.handle(CHANNELS.docker.status, async () => {
    try {
      return await docker.getStatus();
    } catch {
      return { running: false, reason: "not_running" };
    }
  });

  ipcMain.handle(CHANNELS.docker.imageStatus, async () => {
    try {
      return await docker.getImageStatus();
    } catch {
      return { present: false, pulling: false, error: null };
    }
  });

  ipcMain.handle(CHANNELS.docker.imageEnsure, async () => {
    try {
      return await docker.ensureStudioImage();
    } catch {
      return { present: false, pulling: false, error: "ensure_failed" };
    }
  });
}

module.exports = { register };
