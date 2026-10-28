const test = require("node:test");
const assert = require("node:assert/strict");
const { createBot } = require("../src/main/services/bots/actions");

function harness(overrides) {
  const calls = [];
  const deps = {
    folder: "/bots/messy",
    language: "python",
    overwrite: false,
    check: () => ({ ok: false, error: "That folder is not a Lugo bot (.lugo/info.json is missing)." }),
    listEntries: () => ({ exists: true, entries: ["README"] }),
    remember: async (folder) => {
      calls.push("save");
      return { project_path: folder, bot_paths: [folder] };
    },
    stop: async () => {
      calls.push("stop");
      return { ok: true };
    },
    start: async () => {
      calls.push("start");
      return { ok: true };
    },
    setup: async (language) => {
      calls.push(`setup:${language}`);
      return { ok: true };
    },
    watch: () => {
      calls.push("watch");
    },
    ...overrides,
  };
  return { calls, deps };
}

test("a compatible folder skips setup and opens", async () => {
  const { calls, deps } = harness({
    check: () => ({ ok: true }),
    language: "go",
  });
  const result = await createBot(deps);
  assert.equal(result.ok, true);
  assert.equal(calls.includes("setup:go"), false);
  assert.deepEqual(
    calls.filter((call) => call === "stop" || call === "start"),
    ["stop", "start"],
  );
});

test("declining an overwrite does not call docker or the api", async () => {
  const { calls, deps } = harness();
  const result = await createBot(deps);
  assert.equal(result.ok, false);
  assert.equal(result.confirmOverwrite, true);
  assert.equal(result.error, "Existing files may be overwritten.");
  assert.deepEqual(calls, []);
});

test("accepting an overwrite calls setup and saves only after the folder is compatible", async () => {
  let checks = 0;
  const { calls, deps } = harness({
    overwrite: true,
    language: "typescript",
    check: () => {
      checks += 1;
      if (checks === 1) {
        return { ok: false, error: "That folder is not a Lugo bot (.lugo/info.json is missing)." };
      }
      return { ok: true };
    },
  });
  const result = await createBot(deps);
  assert.equal(result.ok, true);
  assert.equal(calls.includes("setup:typescript"), true);
  assert.equal(calls.includes("save"), true);
  assert.ok(calls.indexOf("setup:typescript") < calls.indexOf("save"));
});

test("a failed setup does not save bot_paths", async () => {
  const { calls, deps } = harness({
    overwrite: true,
    listEntries: () => ({ exists: true, entries: [] }),
    setup: async () => ({ ok: false, error: "clone failed" }),
  });
  const result = await createBot(deps);
  assert.equal(result.ok, false);
  assert.equal(result.error, "clone failed");
  assert.equal(calls.includes("save"), false);
  assert.equal(calls.includes("start"), true);
});

test("a setup that leaves an incompatible folder does not save bot_paths", async () => {
  const { calls, deps } = harness({
    overwrite: true,
    listEntries: () => ({ exists: true, entries: [] }),
    check: () => ({ ok: false, error: "`.lugo/info.json` has no numeric studio.major." }),
  });
  const result = await createBot(deps);
  assert.equal(result.ok, false);
  assert.equal(result.error, "`.lugo/info.json` has no numeric studio.major.");
  assert.equal(calls.includes("save"), false);
});
