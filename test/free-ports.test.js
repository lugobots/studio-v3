"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { resolveHostPorts } = require("../src/main/services/docker/free-ports");

function occupy(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("resolveHostPorts keeps preferred ports when free", async () => {
  const preferred = { api: "28181", gameFrontend: "28180" };
  const resolved = await resolveHostPorts(preferred);
  assert.equal(resolved.api, "28181");
  assert.equal(resolved.gameFrontend, "28180");
});

test("resolveHostPorts remaps a busy preferred port to an alternate", async () => {
  const blocker = await occupy(28280);
  try {
    const resolved = await resolveHostPorts({ gameFrontend: "28280" });
    assert.notEqual(resolved.gameFrontend, "28280");
    assert.match(resolved.gameFrontend, /^\d+$/);
    assert.notEqual(Number(resolved.gameFrontend), 0);
  } finally {
    await close(blocker);
  }
});

test("resolveHostPorts returns unique ports within one resolve set", async () => {
  const a = await occupy(28381);
  const b = await occupy(28380);
  const c = await occupy(28300);
  try {
    const resolved = await resolveHostPorts({
      api: "28381",
      gameFrontend: "28380",
      gameServer: "28300",
    });
    const ports = Object.values(resolved);
    assert.equal(new Set(ports).size, ports.length);
    assert.notEqual(resolved.api, "28381");
    assert.notEqual(resolved.gameFrontend, "28380");
    assert.notEqual(resolved.gameServer, "28300");
  } finally {
    await close(a);
    await close(b);
    await close(c);
  }
});
