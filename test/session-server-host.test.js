"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { CHANNELS } = require("../src/shared/ipc-channels");
const studioApi = require("../src/main/services/studio-api");
const { createServerControls } = require("../src/main/services/session/server-controls");

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

function createThinDesktopServerHost({ apiCalls }) {
  const statusListeners = new Set();
  const controls = createServerControls({
    ensureReady: async () => ({ ok: true }),
    api: {
      startServer: async () => {
        apiCalls.push("start");
        return { status: "OK" };
      },
      stopServer: async () => {
        apiCalls.push("stop");
        return { status: "OK" };
      },
      serverStatus: async () => {
        apiCalls.push("status");
        return { running: true };
      },
      subscribeServerStatus: (onStatus, options) =>
        studioApi.subscribeServerStatus(onStatus, options),
    },
    sendStatus: (status) => {
      for (const listener of statusListeners) {
        listener(status);
      }
    },
  });

  // Mirrors window.studio.server from preload (start/stop/status/onStatus).
  return {
    host: "desktop",
    server: {
      start: () => controls.start(),
      stop: () => controls.stop(),
      status: () => controls.status(),
      onStatus(callback) {
        statusListeners.add(callback);
        controls.watch({ WebSocketImpl: FakeWebSocket });
        return () => {
          statusListeners.delete(callback);
        };
      },
    },
    dispose: () => controls.dispose(),
  };
}

test("ipc channels expose server stop, status, watch, and status events", () => {
  assert.equal(CHANNELS.server.start, "server:start");
  assert.equal(CHANNELS.server.stop, "server:stop");
  assert.equal(CHANNELS.server.status, "server:status");
  assert.equal(CHANNELS.server.watchStatus, "server:watch-status");
  assert.equal(CHANNELS.server.statusEvent, "server:status-event");
});

test("thin desktop host stop hits session controls and onStatus receives events", async () => {
  FakeWebSocket.instances = [];
  const apiCalls = [];
  const studio = createThinDesktopServerHost({ apiCalls });
  const updates = [];

  const unsubscribe = studio.server.onStatus((status) => {
    updates.push(status);
  });

  assert.equal(FakeWebSocket.instances.length, 1);
  assert.match(FakeWebSocket.instances[0].url, /\/api\/server\/status\/ws$/);

  const stopped = await studio.server.stop();
  assert.equal(stopped.ok, true);
  assert.deepEqual(apiCalls, ["stop"]);

  const status = await studio.server.status();
  assert.equal(status.ok, true);
  assert.equal(status.body.running, true);
  assert.deepEqual(apiCalls, ["stop", "status"]);

  FakeWebSocket.instances[0].emit({ running: false });
  FakeWebSocket.instances[0].emit({ running: true });
  assert.deepEqual(updates, [{ running: false }, { running: true }]);

  unsubscribe();
  FakeWebSocket.instances[0].emit({ running: false });
  assert.equal(updates.length, 2);

  studio.dispose();
  assert.equal(FakeWebSocket.instances[0].closed, true);
});
