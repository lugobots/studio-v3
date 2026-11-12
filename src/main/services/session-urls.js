"use strict";

const { editorUrl, gameFrontendUrl } = require("../../shared/ports");
const runtimePorts = require("./runtime-ports");

function sessionGameFrontendUrl() {
  const host = runtimePorts.getApiHostPorts();
  if (host && host.gameFrontend) {
    return `http://localhost:${host.gameFrontend}`;
  }
  return gameFrontendUrl();
}

function sessionEditorUrl() {
  const port = runtimePorts.getEditorHostPort();
  if (port) {
    return `http://localhost:${port}`;
  }
  return editorUrl();
}

module.exports = { sessionGameFrontendUrl, sessionEditorUrl };
