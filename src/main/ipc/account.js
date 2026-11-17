"use strict";

const { ipcMain } = require("electron");
const { CHANNELS } = require("../../shared/ipc-channels");
const account = require("../services/account");

function register() {
  ipcMain.handle(CHANNELS.account.status, () => account.status());
  ipcMain.handle(CHANNELS.account.signIn, () => account.signIn());
  ipcMain.handle(CHANNELS.account.signOut, () => account.signOut());
  ipcMain.handle(CHANNELS.account.profile, () => account.profile());
}

module.exports = { register };
