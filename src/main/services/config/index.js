"use strict";

const { createConfigService } = require("./store");

let service = null;

function getElectronService() {
  if (!service) {
    const { app } = require("electron");
    service = createConfigService({
      getAppDataPath: () => app.getPath("appData"),
      getAppVersion: () => app.getVersion(),
      log: (message) => console.error(message),
    });
  }
  return service;
}

async function get() {
  return getElectronService().get();
}

async function set(patch) {
  return getElectronService().set(patch);
}

module.exports = { get, set, createConfigService };
