const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const store = require("../src/main/services/config/store");

test("windows appData path uses the V1 settings file", () => {
  const file = store.settingsFile("C:\\Users\\me\\AppData\\Roaming", "win32");
  assert.equal(file, "C:\\Users\\me\\AppData\\Roaming\\.LugoStudio\\user.json");
});

test("round-trip keeps unknown keys and defaults telemetry on", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-config-"));
  const file = store.settingsFile(dir, "linux");
  store.write(file, { custom_flag: true, project_path: "/bots/demo" });
  const next = store.applyPatch(store.read(file).data, { telemetry_enabled: false });
  store.write(file, next);
  const saved = store.read(file).data;
  assert.equal(saved.custom_flag, true);
  assert.equal(saved.project_path, "/bots/demo");
  assert.equal(saved.telemetry_enabled, false);
  assert.equal(store.telemetryEnabled({}), true);
  assert.equal(store.telemetryEnabled(saved), false);
});

test("a missing bot list is seeded from project_path", () => {
  assert.deepEqual(store.botPaths({ project_path: "/bots/demo" }), ["/bots/demo"]);
  assert.deepEqual(store.botPaths({ project_path: "" }), []);
  assert.deepEqual(store.botPaths({ bot_paths: [], project_path: "/bots/demo" }), []);
});

test("adding a listed path does not duplicate it and still writes project_path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-config-"));
  const file = store.settingsFile(dir, "linux");
  store.write(file, { custom_flag: true, project_path: "/bots/demo" });
  const seeded = store.rememberBot(store.read(file).data, "/bots/demo");
  assert.deepEqual(seeded.bot_paths, ["/bots/demo"]);
  assert.equal(seeded.project_path, "/bots/demo");
  const added = store.rememberBot(seeded, "/bots/other");
  assert.deepEqual(added.bot_paths, ["/bots/demo", "/bots/other"]);
  store.write(file, added);
  const saved = store.read(file).data;
  assert.equal(saved.custom_flag, true);
  assert.equal(saved.project_path, "/bots/other");
  assert.deepEqual(store.rememberBot(saved, "/bots/other").bot_paths, ["/bots/demo", "/bots/other"]);
});

test("project readiness requires info.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-bot-"));
  assert.equal(store.projectReady({ project_path: dir }, fs.existsSync), false);
  fs.mkdirSync(path.join(dir, ".lugo"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".lugo", "info.json"), "{}");
  assert.equal(store.projectReady({ project_path: dir }, fs.existsSync), true);
});
