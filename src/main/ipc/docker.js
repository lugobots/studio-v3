const { ipcMain } = require("electron");
const { CHANNELS } = require("../../shared/ipc-channels");
const docker = require("../services/docker");

function register() {
  ipcMain.handle(CHANNELS.docker.status, () => docker.getStatus());
  ipcMain.handle(CHANNELS.docker.pull, () => {
    docker.startPull();
    return docker.getStatus();
  });
}

module.exports = { register };
