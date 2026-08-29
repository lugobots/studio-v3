const { ipcMain } = require("electron");
const { CHANNELS } = require("../../shared/ipc-channels");
const notifications = require("../services/notifications");

function register() {
  ipcMain.handle(CHANNELS.notifications.show, (_event, payload) => {
    notifications.show(payload);
  });
}

module.exports = { register };
