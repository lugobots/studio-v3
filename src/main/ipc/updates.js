const { ipcMain, app, BrowserWindow } = require("electron");
const { CHANNELS } = require("../../shared/ipc-channels");
const updater = require("../services/updater");
const logic = require("../services/updater/logic");

function targetWindow() {
  return (
    BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null
  );
}

function emitProgress(payload) {
  const win = targetWindow();
  win?.webContents?.send(CHANNELS.updates.progress, payload);
}

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
      const file = await updater.downloadAsset(info.asset, {
        onProgress: emitProgress,
      });
      emitProgress({
        phase: "launch",
        percent: 98,
        label: "Starting update",
        detail: "Launching the new Studio package…",
      });
      const launched = await updater.launch(file);
      if (launched.ok) {
        emitProgress({
          phase: "launch",
          percent: 100,
          label: "Starting update",
          detail: "Closing this Studio window…",
        });
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
