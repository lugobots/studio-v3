const { ipcMain, app } = require("electron");
const { CHANNELS } = require("../../shared/ipc-channels");
const updater = require("../services/updater");
const logic = require("../services/updater/logic");

function register() {
  ipcMain.handle(CHANNELS.updates.check, () => updater.check());
  ipcMain.handle(CHANNELS.updates.apply, async () => {
    const info = await updater.check();
    if (info.state === "unavailable") {
      return { ok: false, rejected: true, error: info.message };
    }
    if (info.state !== "newer") {
      return { ok: false, error: info.message || "No upgrade is available" };
    }
    try {
      const file = await updater.downloadAsset(info.asset);
      const launched = await updater.launch(file);
      if (launched.ok) {
        app.quit();
      }
      return launched;
    } catch (error) {
      const rejected =
        error.code === "UPDATE_INTEGRITY" || error.code === "UPDATE_SIGNATURE";
      return {
        ok: false,
        rejected,
        error: error.message,
        notice: rejected
          ? logic.noticeFor({ state: "rejected", message: error.message })
          : null,
      };
    }
  });
}

module.exports = { register };
