const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildDockerStatus,
  classifyDockerInfoFailure,
} = require("../src/main/services/docker/status");

test("ENOENT from docker means not installed", () => {
  const classified = classifyDockerInfoFailure(Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" }));
  assert.deepEqual(classified, {
    running: false,
    installed: false,
    reason: "not_installed",
  });
});

test("other docker info failures mean installed but not running", () => {
  const classified = classifyDockerInfoFailure(Object.assign(new Error("Cannot connect"), { code: 1 }));
  assert.deepEqual(classified, {
    running: false,
    installed: true,
    reason: "not_running",
  });
  assert.deepEqual(classifyDockerInfoFailure(null), {
    running: false,
    installed: true,
    reason: "not_running",
  });
});

test("buildDockerStatus reports not_installed when docker is missing", () => {
  const status = buildDockerStatus({
    info: { ok: false, error: Object.assign(new Error("missing"), { code: "ENOENT" }) },
    image: "lugobots/studio:dev",
    pull: { status: "idle", message: "" },
  });
  assert.equal(status.running, false);
  assert.equal(status.installed, false);
  assert.equal(status.reason, "not_installed");
  assert.equal(status.imagePresent, false);
  assert.equal(status.image, "lugobots/studio:dev");
});

test("buildDockerStatus reports not_running when daemon is down", () => {
  const status = buildDockerStatus({
    info: { ok: false, error: Object.assign(new Error("daemon"), { code: 1 }) },
    image: "lugobots/studio:dev",
  });
  assert.equal(status.running, false);
  assert.equal(status.installed, true);
  assert.equal(status.reason, "not_running");
});

test("buildDockerStatus reports running when docker info succeeds", () => {
  const status = buildDockerStatus({
    info: { ok: true },
    image: "lugobots/studio:dev",
    imagePresent: true,
    pull: { status: "present", message: "ready" },
  });
  assert.deepEqual(status, {
    running: true,
    installed: true,
    reason: null,
    image: "lugobots/studio:dev",
    imagePresent: true,
    pull: { status: "present", message: "ready" },
  });
});
