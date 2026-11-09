const { ipcMain } = require("electron");
const { CHANNELS } = require("../../shared/ipc-channels");
const docker = require("../services/docker");
const session = require("../services/session");

function register() {
  ipcMain.handle(CHANNELS.docker.status, () => docker.getStatus());
  ipcMain.handle(CHANNELS.docker.pull, () => {
    docker.startPull();
    return docker.getStatus();
  });
  ipcMain.handle(CHANNELS.docker.ensureEditor, () => session.startEditor());
  ipcMain.handle(CHANNELS.docker.stopEditor, () => session.stopEditor());
}

module.exports = { register };
