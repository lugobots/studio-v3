"use strict";

const { ipcMain } = require("electron");
const { CHANNELS } = require("../../shared/ipc-channels");
const docker = require("../services/docker");

function register() {
  ipcMain.handle(CHANNELS.docker.status, async () => {
    try {
      return await docker.getStatus();
    } catch {
      return { running: false, reason: "not_running" };
    }
  });
}

module.exports = { register };
