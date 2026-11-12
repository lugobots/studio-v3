"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const {
  prepareApiRunArgs,
  prepareEditorRunArgs,
} = require("../src/main/services/docker");

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

test("prepareApiRunArgs remaps busy preferred host ports in docker args", async () => {
  const blocker = await occupy(29080);
  try {
    const prepared = await prepareApiRunArgs("/bots/demo", "/bots/demo", null, {
      LUGO_STUDIO_API_PORT: "29081",
      LUGO_STUDIO_GAME_SERVER_PORT: "29000",
      LUGO_STUDIO_GAME_FRONTEND_PORT: "29080",
    });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.hostPorts.api, "29081");
    assert.equal(prepared.hostPorts.gameServer, "29000");
    assert.notEqual(prepared.hostPorts.gameFrontend, "29080");
    assert.ok(prepared.args.includes(`${prepared.hostPorts.gameFrontend}:29080`));
    assert.ok(prepared.args.includes("LUGO_STUDIO_GAME_FRONTEND_PORT=29080"));
    assert.equal(
      prepared.args.some((part) => /address already in use/i.test(part)),
      false,
    );
  } finally {
    await close(blocker);
  }
});

test("prepareEditorRunArgs remaps a busy preferred editor host port", async () => {
  const blocker = await occupy(29082);
  try {
    const prepared = await prepareEditorRunArgs("/bots/demo", {
      LUGO_VS_CODE_PORT: "29082",
    });
    assert.equal(prepared.ok, true);
    assert.notEqual(prepared.hostPorts.vsCode, "29082");
    assert.ok(prepared.args.includes(`${prepared.hostPorts.vsCode}:29082`));
    assert.ok(prepared.args.includes("PORT=29082"));
  } finally {
    await close(blocker);
  }
});
