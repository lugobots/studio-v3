const test = require("node:test");
const assert = require("node:assert/strict");
const {
  API_CONTAINER_NAME,
  EDITOR_CONTAINER_NAME,
  removeOk,
  stopStudioContainers,
} = require("../src/main/services/docker/stop");

test("removeOk treats missing containers as success", () => {
  assert.equal(removeOk({ ok: true, stderr: "" }), true);
  assert.equal(removeOk({ ok: false, stderr: "Error: No such container: lugo-studio-v3" }), true);
  assert.equal(removeOk({ ok: false, stderr: "permission denied" }), false);
});

test("stopStudioContainers removes API and leftover editor containers", async () => {
  const removed = [];
  const result = await stopStudioContainers(async (name) => {
    removed.push(name);
    return { ok: true, stderr: "" };
  });
  assert.equal(result.ok, true);
  assert.deepEqual(removed, [EDITOR_CONTAINER_NAME, API_CONTAINER_NAME]);
  assert.equal(API_CONTAINER_NAME, "lugo-studio-v3");
  assert.equal(EDITOR_CONTAINER_NAME, "lugo-studio-v3-editor");
});

test("stopStudioContainers succeeds when both containers are already gone", async () => {
  const result = await stopStudioContainers(async (name) => ({
    ok: false,
    stderr: `Error: No such container: ${name}`,
  }));
  assert.equal(result.ok, true);
});

test("stopStudioContainers fails when API remove fails for a real error", async () => {
  const result = await stopStudioContainers(async (name) => {
    if (name === EDITOR_CONTAINER_NAME) {
      return { ok: true, stderr: "" };
    }
    return { ok: false, stderr: "Cannot kill container: already in use" };
  });
  assert.equal(result.ok, false);
});
