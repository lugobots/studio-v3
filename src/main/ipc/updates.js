const { ipcMain, app } = require("electron");
const { CHANNELS } = require("../../shared/ipc-channels");
const updater = require("../services/updater");

function register() {
  ipcMain.handle(CHANNELS.updates.check, () => updater.check());
  ipcMain.handle(CHANNELS.updates.apply, async () => {
    const info = await updater.check();
    if (info.state !== "newer") {
      return { ok: false, error: info.message || "No upgrade is available" };
    }
    try {
      const file = await updater.download(info.artifact);
      const launched = await updater.launch(file);
      if (launched.ok) {
        app.quit();
      }
      return launched;
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}

module.exports = { register };
