"use strict";

const { app, ipcMain } = require("electron");
const { CHANNELS } = require("../../shared/ipc-channels");

function register() {
  ipcMain.on(CHANNELS.app.version, (event) => {
    try {
      event.returnValue = app.getVersion();
    } catch {
      event.returnValue = "";
    }
  });
}

module.exports = { register };
