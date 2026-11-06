"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const store = require("../src/main/services/config/store");
const {
  ensureLevel1Binary,
  isExecutableFile,
} = require("../src/main/services/docker/level1");

function resolvedFor(appData, data = {}) {
  return store.level1Resolved(data, appData, "linux");
}

test("present Level-1 image extracts an executable cache file keyed by image:tag", async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), "studio-level1-present-"));
  const resolved = resolvedFor(appData, {
    bot_level_1_image: "lugobots/level-1",
    bot_level_1_version: "v4",
  });
  const calls = [];
  const result = await ensureLevel1Binary({
    resolved,
    createTempName: () => "lugo-studio-level1-test",
    execDocker: async (args) => {
      calls.push(args.slice());
      if (args[0] === "image" && args[1] === "inspect") {
        return { ok: true, stdout: "[]", stderr: "" };
      }
      if (args[0] === "create") {
        return { ok: true, stdout: "cid\n", stderr: "" };
      }
      if (args[0] === "cp") {
        fs.mkdirSync(resolved.cacheDir, { recursive: true });
        fs.writeFileSync(resolved.hostBinaryPath, "#!/bin/sh\necho level1\n");
        return { ok: true, stdout: "", stderr: "" };
      }
      if (args[0] === "rm") {
        return { ok: true, stdout: "", stderr: "" };
      }
      return { ok: false, stdout: "", stderr: `unexpected: ${args.join(" ")}` };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.cached, false);
  assert.equal(result.pulled, false);
  assert.equal(result.ref, "lugobots/level-1:v4");
  assert.equal(result.hostBinaryPath, resolved.hostBinaryPath);
  assert.ok(fs.existsSync(resolved.hostBinaryPath));
  assert.ok(isExecutableFile(resolved.hostBinaryPath));
  assert.ok(
    resolved.hostBinaryPath.includes(path.join(".LugoStudio", "cache", "level-1", resolved.cacheKey)),
  );
  assert.deepEqual(
    calls.map((args) => args[0]),
    ["image", "create", "cp", "rm"],
  );
  assert.deepEqual(calls[0], ["image", "inspect", "lugobots/level-1:v4"]);
  assert.deepEqual(calls[1], ["create", "--name", "lugo-studio-level1-test", "lugobots/level-1:v4"]);
  assert.deepEqual(calls[2], [
    "cp",
    "lugo-studio-level1-test:/bin/my-bot",
    resolved.hostBinaryPath,
  ]);
  assert.deepEqual(calls[3], ["rm", "-f", "lugo-studio-level1-test"]);
  assert.equal(
    calls.some((args) => args[0] === "pull"),
    false,
  );
});

test("missing Level-1 image triggers pull then extract into cache", async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), "studio-level1-missing-"));
  const resolved = resolvedFor(appData, {
    bot_level_1_image: "custom/level-1",
    bot_level_1_version: "v99",
  });
  const calls = [];
  const result = await ensureLevel1Binary({
    resolved,
    createTempName: () => "lugo-studio-level1-pull",
    execDocker: async (args) => {
      calls.push(args.slice());
      if (args[0] === "image" && args[1] === "inspect") {
        return { ok: false, stdout: "", stderr: "No such image" };
      }
      if (args[0] === "pull") {
        assert.deepEqual(args, ["pull", "custom/level-1:v99"]);
        return { ok: true, stdout: "Pulled\n", stderr: "" };
      }
      if (args[0] === "create") {
        return { ok: true, stdout: "cid\n", stderr: "" };
      }
      if (args[0] === "cp") {
        fs.mkdirSync(resolved.cacheDir, { recursive: true });
        fs.writeFileSync(resolved.hostBinaryPath, "binary-bytes");
        return { ok: true, stdout: "", stderr: "" };
      }
      if (args[0] === "rm") {
        return { ok: true, stdout: "", stderr: "" };
      }
      return { ok: false, stdout: "", stderr: `unexpected: ${args.join(" ")}` };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.pulled, true);
  assert.equal(result.cached, false);
  assert.equal(result.ref, "custom/level-1:v99");
  assert.ok(fs.existsSync(resolved.hostBinaryPath));
  assert.ok(isExecutableFile(resolved.hostBinaryPath));
  assert.deepEqual(
    calls.map((args) => args[0]),
    ["image", "pull", "create", "cp", "rm"],
  );
});

test("cached Level-1 binary is reused without pull or extract", async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), "studio-level1-cached-"));
  const resolved = resolvedFor(appData);
  fs.mkdirSync(resolved.cacheDir, { recursive: true });
  fs.writeFileSync(resolved.hostBinaryPath, "cached-bot");
  fs.chmodSync(resolved.hostBinaryPath, 0o755);

  const calls = [];
  const result = await ensureLevel1Binary({
    resolved,
    execDocker: async (args) => {
      calls.push(args.slice());
      return { ok: false, stdout: "", stderr: "should not call docker" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.cached, true);
  assert.equal(result.pulled, false);
  assert.deepEqual(calls, []);
});

test("extract failure reports a clear error and does not claim success", async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), "studio-level1-fail-"));
  const resolved = resolvedFor(appData);
  const result = await ensureLevel1Binary({
    resolved,
    createTempName: () => "lugo-studio-level1-fail",
    execDocker: async (args) => {
      if (args[0] === "image") {
        return { ok: true, stdout: "[]", stderr: "" };
      }
      if (args[0] === "create") {
        return { ok: true, stdout: "cid\n", stderr: "" };
      }
      if (args[0] === "cp") {
        return { ok: false, stdout: "", stderr: "Error: No such file: /bin/my-bot" };
      }
      if (args[0] === "rm") {
        return { ok: true, stdout: "", stderr: "" };
      }
      return { ok: false, stdout: "", stderr: "unexpected" };
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /Could not extract Level-1 binary/);
  assert.match(result.error, /\/bin\/my-bot/);
  assert.equal(fs.existsSync(resolved.hostBinaryPath), false);
});
