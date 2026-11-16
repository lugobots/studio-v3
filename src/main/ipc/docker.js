const { ipcMain, shell } = require("electron");
const { CHANNELS } = require("../../shared/ipc-channels");
const config = require("../services/config");
const docker = require("../services/docker");
const { openDockerInstallPage } = require("../services/docker/install-page");
const session = require("../services/session");

function register() {
  ipcMain.handle(CHANNELS.docker.status, () => docker.getStatus());
  ipcMain.handle(CHANNELS.docker.pull, () => {
    docker.startPull();
    return docker.getStatus();
  });
  ipcMain.handle(CHANNELS.docker.ensureRef, (_event, ref) => docker.ensureRef(ref));
  ipcMain.handle(CHANNELS.docker.ensureLevel1, async () => {
    const resolved = await config.getLevel1();
    return docker.ensureLevel1(resolved);
  });
  ipcMain.handle(CHANNELS.docker.ensureEditor, () => session.startEditor());
  ipcMain.handle(CHANNELS.docker.stopEditor, () => session.stopEditor());
  ipcMain.handle(CHANNELS.docker.openInstallPage, () =>
    openDockerInstallPage((url) => shell.openExternal(url)),
  );
}

module.exports = { register };
