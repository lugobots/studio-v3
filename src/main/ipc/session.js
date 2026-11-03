const { ipcMain } = require("electron");
const { CHANNELS } = require("../../shared/ipc-channels");
const session = require("../services/session");

function register() {
  ipcMain.handle(CHANNELS.startup.next, () => session.next());
  ipcMain.handle(CHANNELS.startup.retry, () => session.retry());
  ipcMain.handle(CHANNELS.startup.current, () => session.current());
  ipcMain.handle(CHANNELS.project.pickFolder, () => session.pickFolder());
  ipcMain.handle(CHANNELS.project.open, (_event, folder) => session.open(folder));
  ipcMain.handle(CHANNELS.project.create, (_event, payload) => session.create(payload));
  ipcMain.handle(CHANNELS.project.remove, (_event, folder) => session.remove(folder));
  ipcMain.handle(CHANNELS.server.start, () => session.startServer());
  ipcMain.handle(CHANNELS.match.start, () => session.startMatch());
  ipcMain.handle(CHANNELS.match.status, () => session.projectStatus());
  ipcMain.handle(CHANNELS.publish.bot, (_event, payload) => session.publish(payload));
}

module.exports = { register };
