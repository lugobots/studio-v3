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
  ipcMain.handle(CHANNELS.server.start, (_event, settings) => session.startServer(settings));
  ipcMain.handle(CHANNELS.server.stop, () => session.stopServer());
  ipcMain.handle(CHANNELS.server.status, () => session.serverStatus());
  ipcMain.handle(CHANNELS.server.watchStatus, () => session.watchServerStatus());
  ipcMain.handle(CHANNELS.match.start, (_event, payload) => session.startMatch(payload || {}));
  ipcMain.handle(CHANNELS.match.status, () => session.projectStatus());
  ipcMain.handle(CHANNELS.match.reset, () => session.resetMatch());
  ipcMain.handle(CHANNELS.match.getPositions, () => session.getPositions());
  ipcMain.handle(CHANNELS.match.applyPositions, (_event, snapshot) => session.applyPositions(snapshot || {}));
  ipcMain.handle(CHANNELS.bot.start, (_event, payload) => session.startBot(payload || {}));
  ipcMain.handle(CHANNELS.bot.stop, (_event, payload) => session.stopBot(payload || {}));
  ipcMain.handle(CHANNELS.bot.status, (_event, payload) => session.botStatus(payload || {}));
  ipcMain.handle(CHANNELS.publish.bot, (_event, payload) => session.publish(payload));
}

module.exports = { register };
