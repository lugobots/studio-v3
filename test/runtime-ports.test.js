"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const runtimePorts = require("../src/main/services/runtime-ports");

test("runtime ports store API host ports and clear on teardown", () => {
  runtimePorts.clearAll();
  assert.equal(runtimePorts.getApiHostPorts(), null);

  runtimePorts.setApiHostPorts({
    api: "18081",
    gameServer: "15000",
    gameFrontend: "18080",
  });
  assert.deepEqual(runtimePorts.getApiHostPorts(), {
    api: "18081",
    gameServer: "15000",
    gameFrontend: "18080",
  });

  runtimePorts.clearApiHostPorts();
  assert.equal(runtimePorts.getApiHostPorts(), null);
});

test("runtime ports store editor host port and clear on teardown", () => {
  runtimePorts.clearAll();
  runtimePorts.setEditorHostPort("18082");
  assert.equal(runtimePorts.getEditorHostPort(), "18082");
  runtimePorts.clearEditorHostPort();
  assert.equal(runtimePorts.getEditorHostPort(), null);
});

test("clearAll clears API and editor host ports", () => {
  runtimePorts.setApiHostPorts({ api: "1", gameServer: "2", gameFrontend: "3" });
  runtimePorts.setEditorHostPort("4");
  runtimePorts.clearAll();
  assert.equal(runtimePorts.getApiHostPorts(), null);
  assert.equal(runtimePorts.getEditorHostPort(), null);
});
