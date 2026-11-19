"use strict";

const { ipcMain } = require("electron");
const { CHANNELS } = require("../../shared/ipc-channels");
const telemetry = require("../services/telemetry");

function register() {
  ipcMain.handle(CHANNELS.telemetry.track, (_event, name, props) =>
    telemetry.track(typeof name === "string" ? name : "", props || undefined),
  );
  ipcMain.handle(CHANNELS.telemetry.setEnabled, (_event, enabled) => {
    telemetry.setEnabled(enabled !== false);
    return telemetry.snapshot();
  });
  ipcMain.handle(CHANNELS.telemetry.snapshot, () => telemetry.snapshot());
}

module.exports = { register };
