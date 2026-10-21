"use strict";

const { CHANNELS } = require("../../../shared/ipc-channels");

let webContents = null;

function attach(contents) {
  webContents = contents;
}

function show(payload) {
  webContents?.send(CHANNELS.notifications.event, payload);
}

module.exports = { attach, show };
