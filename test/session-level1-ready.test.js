"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createLevel1Ready, DEFAULT_FAIL } = require("../src/main/services/session/level1-ready");

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("kick starts ensure without awaiting and does not emit progress", async () => {
  const gate = deferred();
  const progress = [];
  const notifications = [];
  let ensureCalls = 0;

  const ready = createLevel1Ready({
    getResolved: async () => ({ ref: "lugobots/level-1:v1" }),
    ensureLevel1: async () => {
      ensureCalls += 1;
      await gate.promise;
      return { ok: true, hostBinaryPath: "/tmp/my-bot", cached: false };
    },
    onProgress: (input) => progress.push(input),
    notify: (payload) => notifications.push(payload),
  });

  ready.kick();
  assert.deepEqual(progress, []);
  // kick returns before ensure finishes (gate still closed).
  assert.equal(
    await Promise.race([ready.awaitReady().then(() => "done"), Promise.resolve("immediate")]),
    "immediate",
  );

  gate.resolve();
  const result = await ready.awaitReady();
  assert.equal(result.ok, true);
  assert.equal(ensureCalls, 1);
  assert.deepEqual(notifications, []);
});

test("awaitReady reports progress when it starts the ensure work", async () => {
  const progress = [];
  const ready = createLevel1Ready({
    getResolved: async () => ({ ref: "lugobots/level-1:v2" }),
    ensureLevel1: async () => ({ ok: true, hostBinaryPath: "/cache/my-bot", cached: true }),
    onProgress: (input) => progress.push(input),
    notify: () => {},
  });

  const result = await ready.awaitReady();
  assert.equal(result.ok, true);
  assert.equal(progress.length, 1);
  assert.match(progress[0].detail, /Level-1 opponent binary/);
});

test("extract failure notifies and returns a clear error for match/API callers", async () => {
  const notifications = [];
  const progress = [];
  const extractError =
    "Could not extract Level-1 binary from lugobots/level-1:v1:/bin/my-bot: No such file";

  const ready = createLevel1Ready({
    getResolved: async () => ({ ref: "lugobots/level-1:v1" }),
    ensureLevel1: async () => ({ ok: false, error: extractError }),
    onProgress: (input) => progress.push(input),
    notify: (payload) => notifications.push(payload),
  });

  const first = await ready.awaitReady();
  assert.equal(first.ok, false);
  assert.equal(first.error, extractError);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].mode, "notify");
  assert.equal(notifications[0].title, "Level-1 opponent");
  assert.equal(notifications[0].body, extractError);
  assert.ok(progress.some((item) => item.detail === extractError));
});

test("failed ensure clears inflight so a later awaitReady can retry", async () => {
  let attempts = 0;
  const notifications = [];
  const ready = createLevel1Ready({
    getResolved: async () => ({ ref: "lugobots/level-1:retry" }),
    ensureLevel1: async () => {
      attempts += 1;
      if (attempts === 1) {
        return { ok: false, error: "Could not extract Level-1 binary: docker cp failed" };
      }
      return { ok: true, hostBinaryPath: "/cache/my-bot", pulled: true };
    },
    onProgress: () => {},
    notify: (payload) => notifications.push(payload),
  });

  const first = await ready.awaitReady();
  assert.equal(first.ok, false);
  assert.match(first.error, /Could not extract Level-1 binary/);

  const second = await ready.awaitReady();
  assert.equal(second.ok, true);
  assert.equal(attempts, 2);
  assert.equal(notifications.length, 1);
});

test("thrown ensure errors surface a clear failure message", async () => {
  const ready = createLevel1Ready({
    getResolved: async () => ({ ref: "lugobots/level-1:v1" }),
    ensureLevel1: async () => {
      throw new Error("docker daemon gone");
    },
    onProgress: () => {},
    notify: () => {},
  });
  const result = await ready.awaitReady();
  assert.equal(result.ok, false);
  assert.equal(result.error, "docker daemon gone");
  assert.match(DEFAULT_FAIL, /Level-1 opponent binary/);
});
