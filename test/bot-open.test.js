const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openBot } = require("../src/main/services/bots/actions");
const { checkBotCompatibility } = require("../src/main/services/bots/compatibility");

function compatibleDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-open-bot-"));
  fs.mkdirSync(path.join(dir, ".lugo"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".lugo", "info.json"),
    JSON.stringify({ studio: { major: 1 } }),
  );
  return dir;
}

test("a compatible path stops then starts the container", async () => {
  const folder = compatibleDir();
  const calls = [];
  const result = await openBot({
    folder,
    check: checkBotCompatibility,
    remember: async (savedFolder) => {
      calls.push("save");
      return { project_path: savedFolder, bot_paths: [savedFolder] };
    },
    stop: async () => {
      calls.push("stop");
      return { ok: true };
    },
    start: async (savedFolder) => {
      calls.push("start");
      assert.equal(savedFolder, folder);
      return { ok: true };
    },
    watch: (savedFolder, route) => {
      calls.push(`watch:${savedFolder}:${route}`);
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.config.project_path, folder);
  assert.deepEqual(calls, ["save", "stop", "start", `watch:${folder}:/main`]);
});

test("an incompatible path does not save or start a container", async () => {
  const calls = [];
  const result = await openBot({
    folder: path.join(os.tmpdir(), "studio-missing-open-bot"),
    check: checkBotCompatibility,
    remember: async () => {
      calls.push("save");
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
  assert.equal(result.ok, false);
  assert.equal(result.error, "That bot folder is missing.");
  assert.deepEqual(calls, []);
});
