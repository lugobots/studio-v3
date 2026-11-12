"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const runtimePorts = require("../src/main/services/runtime-ports");
const studioApi = require("../src/main/services/studio-api");

function respond(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.closed = false;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  removeEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(
      type,
      list.filter((entry) => entry !== handler),
    );
  }

  emit(data) {
    const event = { data: typeof data === "string" ? data : JSON.stringify(data) };
    for (const handler of this.listeners.get("message") || []) {
      handler(event);
    }
  }

  close() {
    this.closed = true;
  }
}

FakeWebSocket.instances = [];

test("apiBase uses session resolved API host port when set", () => {
  runtimePorts.clearAll();
  assert.equal(studioApi.apiBase(), "http://127.0.0.1:8081/api");
  runtimePorts.setApiHostPorts({
    api: "18081",
    gameServer: "15000",
    gameFrontend: "18080",
  });
  assert.equal(studioApi.apiBase(), "http://127.0.0.1:18081/api");
  runtimePorts.clearAll();
  assert.equal(studioApi.apiBase(), "http://127.0.0.1:8081/api");
});

test("healthy caches API version from health response", async () => {
  studioApi.resetApiVersionCache();
  assert.equal(studioApi.apiVersion(), null);

  const fetchDev = async () => respond(200, { status: "OK", version: "dev" });
  assert.equal(await studioApi.healthy(fetchDev), true);
  assert.equal(studioApi.apiVersion(), "dev");

  const fetchRelease = async () => respond(200, { status: "OK", version: "1.2.3" });
  assert.equal(await studioApi.healthy(fetchRelease), true);
  assert.equal(studioApi.apiVersion(), "1.2.3");

  studioApi.resetApiVersionCache();
});

test("studio api client posts server and match start routes", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body, headers: options.headers });
    return respond(200, { status: "OK" });
  };

  await studioApi.startServer(fetchImpl);
  await studioApi.startMatch(fetchImpl);

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/api\/server\/start$/);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[1].url, /\/api\/game\/start$/);
  assert.equal(calls[1].method, "POST");
});

test("studio api client posts match settings on server match and bot routes", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({
      url,
      method: options.method || "GET",
      body: options.body ? JSON.parse(options.body) : null,
    });
    return respond(200, { status: "OK", running: false });
  };

  const settings = {
    team_side: "away",
    skip_to_golden_goal: true,
    game_speed: "slow",
    opponent_mode: "zombies",
  };

  await studioApi.startServer(settings, fetchImpl);
  await studioApi.startMatch({ ...settings, active: [{ side: "HOME", number: 1 }] }, fetchImpl);
  await studioApi.startBot({ side: "HOME", number: 1, settings }, fetchImpl);

  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /\/api\/server\/start$/);
  assert.deepEqual(calls[0].body, settings);
  assert.match(calls[1].url, /\/api\/game\/start$/);
  assert.equal(calls[1].body.team_side, "away");
  assert.equal(calls[1].body.skip_to_golden_goal, true);
  assert.equal(calls[1].body.game_speed, "slow");
  assert.equal(calls[1].body.opponent_mode, "zombies");
  assert.deepEqual(calls[1].body.active, [{ side: "HOME", number: 1 }]);
  assert.match(calls[2].url, /\/api\/team\/HOME\/bots\/1$/);
  assert.equal(calls[2].method, "POST");
  assert.deepEqual(calls[2].body, settings);
});

test("studio api client reset and positions hit game routes", async () => {
  const calls = [];
  const snapshot = {
    ball: { x: 1, y: 2 },
    homeTeam: { 1: { x: 3, y: 4 } },
    awayTeam: {},
  };
  const fetchImpl = async (url, options = {}) => {
    calls.push({
      url,
      method: options.method || "GET",
      body: options.body ? JSON.parse(options.body) : null,
    });
    if (String(url).endsWith("/game/positions") && (options.method || "GET") === "GET") {
      return respond(200, snapshot);
    }
    return respond(200, { status: "OK" });
  };

  await studioApi.resetMatch(fetchImpl);
  const got = await studioApi.getPositions(fetchImpl);
  await studioApi.applyPositions(snapshot, fetchImpl);

  assert.equal(got.ball.x, 1);
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /\/api\/game\/reset$/);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[1].url, /\/api\/game\/positions$/);
  assert.equal(calls[1].method, "GET");
  assert.match(calls[2].url, /\/api\/game\/positions$/);
  assert.equal(calls[2].method, "POST");
  assert.deepEqual(calls[2].body, snapshot);
});

test("studio api client gets server status and posts stop", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET" });
    if (String(url).endsWith("/server/status")) {
      return respond(200, { running: true });
    }
    return respond(200, { status: "OK" });
  };

  const status = await studioApi.serverStatus(fetchImpl);
  assert.equal(status.running, true);

  await studioApi.stopServer(fetchImpl);

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/api\/server\/status$/);
  assert.equal(calls[0].method, "GET");
  assert.match(calls[1].url, /\/api\/server\/stop$/);
  assert.equal(calls[1].method, "POST");
});

test("studio api client subscribe delivers status updates", () => {
  FakeWebSocket.instances = [];
  const updates = [];
  const unsubscribe = studioApi.subscribeServerStatus(
    (status) => {
      updates.push(status);
    },
    { WebSocketImpl: FakeWebSocket },
  );

  assert.equal(FakeWebSocket.instances.length, 1);
  const ws = FakeWebSocket.instances[0];
  assert.match(ws.url, /\/api\/server\/status\/ws$/);
  assert.match(ws.url, /^ws:\/\//);

  ws.emit({ running: false });
  ws.emit({ running: true });
  assert.deepEqual(updates, [{ running: false }, { running: true }]);

  unsubscribe();
  assert.equal(ws.closed, true);
  ws.emit({ running: false });
  assert.equal(updates.length, 2);
});

test("studio api client arms logs and subscribe delivers snapshot lines", async () => {
  FakeWebSocket.instances = [];
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({
      url,
      method: options.method || "GET",
      body: options.body ? JSON.parse(options.body) : null,
    });
    return respond(200, { status: "OK", source: "home/1", armed: true });
  };

  await studioApi.armLogSource("home/1", fetchImpl);
  await studioApi.disarmLogSource("home/1", fetchImpl);
  assert.match(calls[0].url, /\/api\/logs\/arm$/);
  assert.deepEqual(calls[0].body, { source: "home/1" });
  assert.match(calls[1].url, /\/api\/logs\/disarm$/);

  const batches = [];
  const unsubscribe = studioApi.subscribeProcessLogs(
    (payload) => {
      batches.push(payload);
    },
    { WebSocketImpl: FakeWebSocket },
  );
  const ws = FakeWebSocket.instances[0];
  assert.match(ws.url, /\/api\/logs\/ws$/);
  ws.emit({ lines: [{ source: "home/1", text: "hi", ts: 1 }] });
  assert.equal(batches.length, 1);
  assert.equal(batches[0].lines[0].text, "hi");
  unsubscribe();
  assert.equal(ws.closed, true);
  ws.emit({ lines: [{ source: "home/1", text: "late", ts: 2 }] });
  assert.equal(batches.length, 1);
});
