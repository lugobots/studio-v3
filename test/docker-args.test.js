const test = require("node:test");
const assert = require("node:assert/strict");
const { editorRunArgs, runArgs } = require("../src/main/services/docker/args");

test("studio container runs the api command and does not publish the editor port", () => {
  const args = runArgs("/bots/demo", {});
  for (const part of [
    "/bots/demo:/home/coder/project",
    "8081:8081",
    "5000:5000",
    "8080:8080",
  ]) {
    assert.ok(args.includes(part), part);
  }
  assert.equal(args.includes("8082:8082"), false);
  assert.ok(args.includes("LUGO_STUDIO_API_PORT=8081"));
  assert.ok(args.includes("LUGO_HOST_PROJECT_PATH="));
  assert.ok(runArgs("/bots/demo", {}, "/bots/demo").includes("LUGO_HOST_PROJECT_PATH=/bots/demo"));
  assert.equal(args.at(-2), "lugobots/studio:latest");
  assert.equal(args.at(-1), "api");
});

test("editor container publishes only the editor port", () => {
  const args = editorRunArgs("/bots/demo", {});
  assert.ok(args.includes("--name"));
  assert.ok(args.includes("lugo-studio-v3-editor"));
  assert.ok(args.includes("/bots/demo:/home/coder/project"));
  assert.ok(args.includes("8082:8082"));
  assert.equal(args.includes("8081:8081"), false);
  assert.ok(args.includes("PORT=8082"));
  assert.ok(args.includes("LUGO_VS_CODE_PORT=8082"));
  assert.equal(args.at(-1), "lugobots/vs-code-for-lugo:latest");
});
