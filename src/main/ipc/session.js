const { ipcMain } = require("electron");
const { CHANNELS } = require("../../shared/ipc-channels");
const session = require("../services/session");

function register() {
  ipcMain.handle(CHANNELS.startup.next, () => session.next());
  ipcMain.handle(CHANNELS.project.pickFolder, () => session.pickFolder());
  ipcMain.handle(CHANNELS.project.open, (_event, folder) => session.open(folder));
  ipcMain.handle(CHANNELS.project.create, (_event, payload) => session.create(payload));
  ipcMain.handle(CHANNELS.match.start, () => session.startMatch());
  ipcMain.handle(CHANNELS.match.status, () => session.projectStatus());
  ipcMain.handle(CHANNELS.publish.bot, (_event, payload) => session.publish(payload));
}

module.exports = { register };
