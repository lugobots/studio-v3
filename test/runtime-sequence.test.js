const test = require("node:test");
const assert = require("node:assert/strict");
const { openRuntime } = require("../src/main/services/docker/runtime");

test("health failure does not start the editor", async () => {
  const calls = [];
  const result = await openRuntime({
    ensureApi: async () => {
      calls.push("api");
      return { ok: true };
    },
    health: async () => {
      calls.push("health");
      return { ok: false, error: "down" };
    },
    ensureEditor: async () => {
      calls.push("editor");
      return { ok: true };
    },
  });
  assert.deepEqual(calls, ["api", "health"]);
  assert.equal(result.ok, false);
  assert.equal(result.editorStarted, false);
});

test("health success starts the editor", async () => {
  const calls = [];
  const result = await openRuntime({
    ensureApi: async () => {
      calls.push("api");
      return { ok: true };
    },
    health: async () => {
      calls.push("health");
      return { ok: true };
    },
    ensureEditor: async () => {
      calls.push("editor");
      return { ok: true };
    },
  });
  assert.deepEqual(calls, ["api", "health", "editor"]);
  assert.equal(result.ok, true);
  assert.equal(result.editorError, undefined);
});

test("editor failure leaves the api result successful", async () => {
  const result = await openRuntime({
    ensureApi: async () => ({ ok: true }),
    health: async () => ({ ok: true }),
    ensureEditor: async () => ({ ok: false, error: "editor failed" }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.editorError, "editor failed");
});
