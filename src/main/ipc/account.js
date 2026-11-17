"use strict";

const { ipcMain } = require("electron");
const { CHANNELS } = require("../../shared/ipc-channels");
const account = require("../services/account");

function register() {
  ipcMain.handle(CHANNELS.account.status, () => account.status());
  ipcMain.handle(CHANNELS.account.signIn, () => account.signIn());
  ipcMain.handle(CHANNELS.account.signOut, () => account.signOut());
  ipcMain.handle(CHANNELS.account.profile, () => account.profile());
  ipcMain.handle(CHANNELS.account.bots, () => account.bots());
  ipcMain.handle(CHANNELS.account.openExternal, (_event, url) =>
    account.openExternalUrl(url),
  );
}

module.exports = { register };
