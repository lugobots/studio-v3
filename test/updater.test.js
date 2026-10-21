const test = require("node:test");
const assert = require("node:assert/strict");
const logic = require("../src/main/services/updater/logic");
const { windowsArtifactName } = require("../src/shared/artifact");
const pkg = require("../package.json");

test("a newer doorway payload notifies and a current one does not", () => {
  const newer = logic.interpret(
    { version: "0.2.0", newer: true, artifact: "Lugo-Studio-Windows-0.2.0.exe" },
    "0.1.0",
  );
  assert.equal(newer.state, "newer");
  assert.equal(logic.noticeFor(newer).mode, "notify");

  const current = logic.interpret({ version: "0.1.0", newer: false, artifact: "x" }, "0.1.0");
  assert.equal(current.state, "current");
  assert.equal(logic.noticeFor(current), null);
});

test("an unusable check becomes a non-blocking failure notice", () => {
  const failed = logic.interpret(null, "0.1.0");
  assert.equal(failed.state, "error");
  assert.equal(logic.noticeFor(failed).mode, "notify");
});

test("declining the upgrade does not apply it", async () => {
  let applied = false;
  const result = await logic.confirmUpgrade(
    async () => false,
    async () => {
      applied = true;
      return { ok: true };
    },
  );
  assert.equal(result.declined, true);
  assert.equal(applied, false);
});

test("a failed windows launch is reported and a decline keeps the running version", async () => {
  const { EventEmitter } = require("node:events");
  const failed = await logic.launch("installer.exe", "win32", () => {
    const child = new EventEmitter();
    child.unref = () => {};
    queueMicrotask(() => child.emit("error", new Error("blocked")));
    return child;
  });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /blocked/);
});

test("windows package name matches the file the updater downloads", () => {
  assert.equal(pkg.build.artifactName, "Lugo-Studio-Windows-${version}.${ext}");
  assert.equal(windowsArtifactName(pkg.version), `Lugo-Studio-Windows-${pkg.version}.exe`);
  assert.equal(pkg.build.win.target[0].target, "portable");
});
