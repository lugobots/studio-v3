const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadLocalEnv } = require("../src/main/load-env");

test("loadLocalEnv fills unset keys from a dotenv file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-env-"));
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, "STUDIO_SMOKE_KEY=from-file\n# comment\nOTHER=1\n");
  delete process.env.STUDIO_SMOKE_KEY;
  process.env.OTHER = "keep";
  assert.equal(loadLocalEnv(file), true);
  assert.equal(process.env.STUDIO_SMOKE_KEY, "from-file");
  assert.equal(process.env.OTHER, "keep");
  delete process.env.STUDIO_SMOKE_KEY;
});
