const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MAX_BOT_TEMPLATE_VERSION, checkBotCompatibility } = require("../src/main/services/bots/compatibility");

function readOnly(dir) {
  const impl = {
    writes: 0,
    statSync: (target) => fs.statSync(target),
    readFileSync: (target, encoding) => fs.readFileSync(target, encoding),
    writeFileSync() {
      impl.writes += 1;
    },
    mkdirSync() {
      impl.writes += 1;
    },
  };
  return { dir, fsImpl: impl };
}

function writeInfo(dir, contents) {
  fs.mkdirSync(path.join(dir, ".lugo"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".lugo", "info.json"), contents);
}

test("each failed descriptor check names the problem and does not write", () => {
  assert.equal(MAX_BOT_TEMPLATE_VERSION, 1);
  const missing = readOnly(path.join(os.tmpdir(), "studio-missing-bot"));
  const missingResult = checkBotCompatibility(missing.dir, missing.fsImpl);
  assert.equal(missingResult.ok, false);
  assert.equal(missingResult.error, "That bot folder is missing.");
  assert.equal(missing.fsImpl.writes, 0);

  const empty = readOnly(fs.mkdtempSync(path.join(os.tmpdir(), "studio-empty-bot-")));
  const emptyResult = checkBotCompatibility(empty.dir, empty.fsImpl);
  assert.equal(emptyResult.error, "That folder is not a Lugo bot (.lugo/info.json is missing).");
  assert.equal(empty.fsImpl.writes, 0);

  const invalid = readOnly(fs.mkdtempSync(path.join(os.tmpdir(), "studio-invalid-bot-")));
  writeInfo(invalid.dir, "{");
  const invalidResult = checkBotCompatibility(invalid.dir, invalid.fsImpl);
  assert.equal(invalidResult.error, "`.lugo/info.json` is not valid JSON.");
  assert.equal(invalid.fsImpl.writes, 0);

  const noMajor = readOnly(fs.mkdtempSync(path.join(os.tmpdir(), "studio-major-bot-")));
  writeInfo(noMajor.dir, JSON.stringify({ studio: { major: "1" } }));
  const noMajorResult = checkBotCompatibility(noMajor.dir, noMajor.fsImpl);
  assert.equal(noMajorResult.error, "`.lugo/info.json` has no numeric studio.major.");
  assert.equal(noMajor.fsImpl.writes, 0);

  const newer = readOnly(fs.mkdtempSync(path.join(os.tmpdir(), "studio-newer-bot-")));
  writeInfo(newer.dir, JSON.stringify({ studio: { major: 2 } }));
  const newerResult = checkBotCompatibility(newer.dir, newer.fsImpl);
  assert.equal(
    newerResult.error,
    "This bot\u2019s template major is 2, and Studio supports up to 1.",
  );
  assert.equal(newer.fsImpl.writes, 0);
});

test("a template major of 1 is compatible and does not write", () => {
  const current = readOnly(fs.mkdtempSync(path.join(os.tmpdir(), "studio-current-bot-")));
  writeInfo(current.dir, JSON.stringify({ studio: { major: 1 } }));
  const result = checkBotCompatibility(current.dir, current.fsImpl);
  assert.equal(result.ok, true);
  assert.equal(result.error, undefined);
  assert.equal(current.fsImpl.writes, 0);
});
