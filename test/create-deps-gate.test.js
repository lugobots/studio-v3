"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createBot, openBot } = require("../src/main/services/bots/actions");
const { describeStartup } = require("../src/shared/startup-progress");

function createHarness(language) {
  const calls = [];
  let checks = 0;
  return {
    calls,
    deps: {
      folder: `/bots/${language}`,
      language,
      overwrite: true,
      listEntries: () => ({ exists: true, entries: [] }),
      check: () => {
        checks += 1;
        return checks === 1
          ? { ok: false, error: "missing" }
          : { ok: true };
      },
      remember: async (folder) => {
        calls.push("save");
        return { project_path: folder };
      },
      stop: async () => {
        calls.push("stop");
        return { ok: true };
      },
      start: async () => {
        calls.push("start");
        return { ok: true };
      },
      setup: async (lang) => {
        calls.push(`setup:${lang}`);
        return { ok: true };
      },
      prepare: async (lang) => {
        calls.push(`prepare:${lang}`);
        // Simulate stamp-ready after create prepare (no cold re-prepare needed).
        calls.push(`stamp:${lang}`);
        return { ok: true };
      },
      watch: () => {
        calls.push("watch");
      },
    },
  };
}

for (const language of ["python", "go", "typescript"]) {
  test(`create ${language} waits for deps before workspace watch`, async () => {
    const { calls, deps } = createHarness(language);
    const result = await createBot(deps);
    assert.equal(result.ok, true);
    assert.equal(result.route, "/api-loading");
    const gate = calls.filter((call) =>
      ["setup:" + language, "prepare:" + language, "stamp:" + language, "save", "watch"].includes(call),
    );
    assert.deepEqual(gate, [
      `setup:${language}`,
      "save",
      `prepare:${language}`,
      `stamp:${language}`,
      "watch",
    ]);
  });
}

test("open existing bot does not run prepare", async () => {
  const calls = [];
  const result = await openBot({
    folder: "/bots/existing",
    check: () => ({ ok: true }),
    remember: async (folder) => {
      calls.push("save");
      return { project_path: folder };
    },
    stop: async () => {
      calls.push("stop");
      return { ok: true };
    },
    start: async () => {
      calls.push("start");
      return { ok: true };
    },
    watch: () => {
      calls.push("watch");
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls.includes("prepare:python"), false);
  assert.deepEqual(calls, ["save", "stop", "start", "watch"]);
});

test("create progress includes deps before health for workspace entry", () => {
  const deps = describeStartup({
    flow: "create",
    phase: "deps",
    detail: "Installing Go dependencies.",
    logs: ["$ go build"],
  });
  assert.equal(deps.label, "Installing bot dependencies");
  const health = describeStartup({ flow: "create", phase: "health" });
  const depsIndex = health.steps.findIndex((step) => step.id === "deps");
  const healthIndex = health.steps.findIndex((step) => step.id === "health");
  assert.ok(depsIndex >= 0 && healthIndex > depsIndex);
});

test("forced prepare failure never reaches workspace watch", async () => {
  const { deps } = createHarness("python");
  deps.prepare = async () => ({ ok: false, error: "offline registry" });
  const result = await createBot(deps);
  assert.equal(result.ok, false);
  assert.equal(result.prepareFailed, true);
  assert.equal(result.route, "/api-error");
  assert.match(result.error, /offline registry/);
});
