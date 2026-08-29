const { ipcMain } = require("electron");
const { CHANNELS } = require("../../shared/ipc-channels");
const config = require("../services/config");

function register() {
  ipcMain.handle(CHANNELS.config.get, () => config.get());
  ipcMain.handle(CHANNELS.config.set, (_event, patch) => config.set(patch));
}

module.exports = { register };
