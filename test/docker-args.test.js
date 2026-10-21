const test = require("node:test");
const assert = require("node:assert/strict");
const { runArgs } = require("../src/main/services/docker/args");

test("container publish uses the studio port defaults", () => {
  const args = runArgs("/bots/demo", {});
  for (const part of [
    "/bots/demo:/home/coder/project",
    "8081:8081",
    "5000:5000",
    "8080:8080",
    "8082:8082",
  ]) {
    assert.ok(args.includes(part), part);
  }
  assert.ok(args.includes("LUGO_STUDIO_API_PORT=8081"));
  assert.equal(args.at(-1), "lugobots/studio:latest");
});
