"use strict";

/** Session-scoped host ports published for the running Studio API container. */
let apiHostPorts = null;
/** Session-scoped host port published for the optional VS Code helper. */
let editorHostPort = null;

function setApiHostPorts(ports) {
  apiHostPorts = ports
    ? {
        api: String(ports.api),
        gameServer: String(ports.gameServer),
        gameFrontend: String(ports.gameFrontend),
      }
    : null;
}

function getApiHostPorts() {
  return apiHostPorts;
}

function clearApiHostPorts() {
  apiHostPorts = null;
}

function setEditorHostPort(port) {
  editorHostPort = port != null && port !== "" ? String(port) : null;
}

function getEditorHostPort() {
  return editorHostPort;
}

function clearEditorHostPort() {
  editorHostPort = null;
}

function clearAll() {
  apiHostPorts = null;
  editorHostPort = null;
}

module.exports = {
  setApiHostPorts,
  getApiHostPorts,
  clearApiHostPorts,
  setEditorHostPort,
  getEditorHostPort,
  clearEditorHostPort,
  clearAll,
};
