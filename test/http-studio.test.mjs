import assert from "node:assert/strict";
import test from "node:test";
import { createHttpStudio } from "../src/renderer/lib/http-studio.js";

function respond(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("web adapter shows the api error and retry only polls", async () => {
  const calls = [];
  const studio = createHttpStudio({
    fetchImpl: async (url) => {
      calls.push(url);
      return respond(500, { message: "down" });
    },
    storage: null,
  });
  const first = await studio.startup.next();
  assert.equal(first.route, "/api-error");
  assert.match(first.message, /down|Studio API/);
  const again = await studio.startup.retry();
  assert.equal(again.route, "/api-error");
  assert.equal(calls.length, 2);
});

test("web adapter opens the welcome screen when no bot is configured", async () => {
  const studio = createHttpStudio({
    fetchImpl: async (url) => {
      if (url.endsWith("/health")) {
        return respond(200, { status: "OK" });
      }
      return respond(200, { project_status: "missing", project_path: "" });
    },
    storage: null,
  });
  const next = await studio.startup.next();
  assert.equal(next.route, "/start-project");
});

test("web adapter opens the shell when health and status succeed", async () => {
  const studio = createHttpStudio({
    fetchImpl: async (url) => {
      if (url.endsWith("/health")) {
        return respond(200, { status: "OK" });
      }
      return respond(200, { project_status: "ready" });
    },
    storage: null,
  });
  const next = await studio.startup.next();
  assert.equal(next.route, "/main");
});

test("web adapter config.get forwards API health build version", async () => {
  const studioDev = createHttpStudio({
    fetchImpl: async (url) => {
      assert.match(url, /\/health$/);
      return respond(200, { status: "OK", version: "dev" });
    },
    storage: null,
  });
  const devConfig = await studioDev.config.get();
  assert.equal(devConfig.apiVersion, "dev");
  assert.equal(devConfig.studio_api_version, "dev");

  const studioRelease = createHttpStudio({
    fetchImpl: async () => respond(200, { status: "OK", version: "v1.0.1" }),
    storage: null,
  });
  const releaseConfig = await studioRelease.config.get();
  assert.equal(releaseConfig.apiVersion, "v1.0.1");

  const studioMissing = createHttpStudio({
    fetchImpl: async () => respond(200, { status: "OK" }),
    storage: null,
  });
  const missingConfig = await studioMissing.config.get();
  assert.equal(missingConfig.apiVersion, "dev");
});

test("web adapter treats stub server, match and publish calls as failures", async () => {
  const studio = createHttpStudio({
    fetchImpl: async () => respond(200, { implemented: false, message: "not implemented" }),
    storage: null,
  });
  const server = await studio.server.start();
  const match = await studio.match.start();
  const published = await studio.publish.bot({ botUri: "demo", tag: "v1" });
  assert.equal(server.ok, false);
  assert.equal(match.ok, false);
  assert.equal(published.ok, false);
  assert.match(server.error, /not available/);
  assert.match(match.error, /not available/);
});

test("web adapter stop hits the server stop API", async () => {
  const calls = [];
  const studio = createHttpStudio({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, method: options.method || "GET" });
      return respond(200, { status: "OK" });
    },
    storage: null,
  });
  const stopped = await studio.server.stop();
  assert.equal(stopped.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/server\/stop$/);
  assert.equal(calls[0].method, "POST");
});

test("web adapter server start posts match settings when provided", async () => {
  const calls = [];
  const studio = createHttpStudio({
    fetchImpl: async (url, options = {}) => {
      calls.push({
        url,
        method: options.method || "GET",
        body: options.body ? JSON.parse(options.body) : null,
      });
      return respond(200, { status: "OK" });
    },
    storage: null,
  });
  const settings = {
    team_side: "away",
    skip_to_golden_goal: true,
    game_speed: "slow",
    opponent_mode: "zombies",
  };
  const started = await studio.server.start(settings);
  assert.equal(started.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/server\/start$/);
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, settings);
});

test("web adapter status reads the server status API", async () => {
  const calls = [];
  const studio = createHttpStudio({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, method: options.method || "GET" });
      return respond(200, { running: true });
    },
    storage: null,
  });
  const status = await studio.server.status();
  assert.equal(status.ok, true);
  assert.equal(status.body.running, true);
  assert.match(calls[0].url, /\/api\/server\/status$/);
  assert.equal(calls[0].method, "GET");
});

test("web adapter onStatus delivers live server status updates", () => {
  const sockets = [];
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      this.closed = false;
      sockets.push(this);
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

  const studio = createHttpStudio({
    fetchImpl: async () => respond(200, {}),
    storage: null,
    WebSocketImpl: FakeWebSocket,
  });
  const updates = [];
  const unsubscribe = studio.server.onStatus((status) => {
    updates.push(status);
  });

  assert.equal(sockets.length, 1);
  assert.match(sockets[0].url, /\/api\/server\/status\/ws$/);
  assert.match(sockets[0].url, /^ws:\/\//);

  sockets[0].emit({ running: true });
  sockets[0].emit({ running: false });
  assert.deepEqual(updates, [{ running: true }, { running: false }]);

  unsubscribe();
  assert.equal(sockets[0].closed, true);
  sockets[0].emit({ running: true });
  assert.equal(updates.length, 2);
});
