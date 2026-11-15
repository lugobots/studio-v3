const { ipcMain } = require("electron");
const { CHANNELS } = require("../../shared/ipc-channels");
const config = require("../services/config");

async function refreshOpponentMountAfter(result) {
  if (!result || result.ok !== true) {
    return result;
  }
  // Lazy require avoids load-order coupling with session create/open flows.
  const session = require("../services/session");
  await session.refreshOpponentMount();
  return result;
}

function register() {
  ipcMain.handle(CHANNELS.config.get, () => config.get());
  ipcMain.handle(CHANNELS.config.set, (_event, patch) => config.set(patch));
  ipcMain.handle(CHANNELS.config.matchGet, () => config.getMatch());
  ipcMain.handle(CHANNELS.config.matchSet, (_event, patch) => config.setMatch(patch));
  ipcMain.handle(CHANNELS.config.opponentGet, () => config.getOpponentSource());
  ipcMain.handle(CHANNELS.config.opponentSet, async (_event, source, folder) => (
    refreshOpponentMountAfter(await config.setOpponentSource(source, folder))
  ));
  ipcMain.handle(CHANNELS.config.opponentRemember, async (_event, entry) => (
    refreshOpponentMountAfter(await config.rememberOpponentProject(entry))
  ));
  ipcMain.handle(CHANNELS.config.opponentForget, async (_event, folder) => {
    const data = await config.forgetOpponentProject(folder);
    const session = require("../services/session");
    await session.refreshOpponentMount();
    return data;
  });
}

module.exports = { register };
