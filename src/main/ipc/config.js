const { ipcMain } = require("electron");
const { CHANNELS } = require("../../shared/ipc-channels");
const config = require("../services/config");

function register() {
  ipcMain.handle(CHANNELS.config.get, () => config.get());
  ipcMain.handle(CHANNELS.config.set, (_event, patch) => config.set(patch));
  ipcMain.handle(CHANNELS.config.matchGet, () => config.getMatch());
  ipcMain.handle(CHANNELS.config.matchSet, (_event, patch) => config.setMatch(patch));
}

module.exports = { register };
