const { ipcMain } = require("electron");
const { CHANNELS } = require("../../shared/ipc-channels");
const updater = require("../services/updater");

function register() {
  ipcMain.handle(CHANNELS.updates.check, () => updater.check());
}

module.exports = { register };
