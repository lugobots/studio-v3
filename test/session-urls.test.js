"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const runtimePorts = require("../src/main/services/runtime-ports");
const { sessionEditorUrl, sessionGameFrontendUrl } = require("../src/main/services/session-urls");

test("session game frontend URL follows remapped host port", () => {
  runtimePorts.clearAll();
  assert.equal(sessionGameFrontendUrl(), "http://localhost:8080");
  runtimePorts.setApiHostPorts({
    api: "18081",
    gameServer: "15000",
    gameFrontend: "18080",
  });
  assert.equal(sessionGameFrontendUrl(), "http://localhost:18080");
  runtimePorts.clearApiHostPorts();
  assert.equal(sessionGameFrontendUrl(), "http://localhost:8080");
});

test("session editor URL follows remapped host port", () => {
  runtimePorts.clearAll();
  assert.equal(sessionEditorUrl(), "http://localhost:8082");
  runtimePorts.setEditorHostPort("18082");
  assert.equal(sessionEditorUrl(), "http://localhost:18082");
  runtimePorts.clearEditorHostPort();
  assert.equal(sessionEditorUrl(), "http://localhost:8082");
});
