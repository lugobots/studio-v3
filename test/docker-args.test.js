const test = require("node:test");
const assert = require("node:assert/strict");
const { LEVEL1_CONTAINER_BINARY_PATH } = require("../src/main/services/config/store");
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
  assert.equal(args.at(-2), "lugobots/studio-v3-api:latest");
  assert.equal(args.at(-1), "api");
});

test("studio image can be overridden with LUGO_STUDIO_IMAGE", () => {
  const args = runArgs("/bots/demo", { LUGO_STUDIO_IMAGE: "example/studio-api:dev" });
  assert.equal(args.at(-2), "example/studio-api:dev");
  assert.equal(args.at(-1), "api");
});

test("studio container bind-mounts the Level-1 opponent binary at the API path", () => {
  const hostBinary =
    "/home/user/.LugoStudio/cache/level-1/abcd1234efgh5678/my-bot";
  const args = runArgs("/bots/demo", {}, "/bots/demo", {
    hostBinaryPath: hostBinary,
    containerBinaryPath: LEVEL1_CONTAINER_BINARY_PATH,
  });

  const mount = `${hostBinary}:${LEVEL1_CONTAINER_BINARY_PATH}`;
  assert.ok(args.includes("-v"), "includes volume flags");
  assert.ok(args.includes(mount), `bind mount ${mount}`);
  assert.ok(args.includes(`LUGO_STUDIO_OPPONENT_BOT=${LEVEL1_CONTAINER_BINARY_PATH}`));
  assert.ok(args.includes(`LUGO_HOST_OPPONENT_BOT=${hostBinary}`));
  assert.equal(args.at(-1), "api");

  // Mount appears after project volume and before the image name.
  const projectMountIdx = args.indexOf("/bots/demo:/home/coder/project");
  const opponentMountIdx = args.indexOf(mount);
  const imageIdx = args.indexOf("lugobots/studio-v3-api:latest");
  assert.ok(projectMountIdx > 0);
  assert.ok(opponentMountIdx > projectMountIdx);
  assert.ok(imageIdx > opponentMountIdx);
});

test("studio container defaults container binary path when only host path is set", () => {
  const hostBinary = "/tmp/cache/my-bot";
  const args = runArgs("/bots/demo", {}, "", { hostBinaryPath: hostBinary });
  assert.ok(args.includes(`${hostBinary}:${LEVEL1_CONTAINER_BINARY_PATH}`));
  assert.ok(args.includes(`LUGO_STUDIO_OPPONENT_BOT=${LEVEL1_CONTAINER_BINARY_PATH}`));
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

test("studio container remaps host ports while keeping container listen ports", () => {
  const args = runArgs("/bots/demo", {}, "", null, {
    api: "18081",
    gameServer: "15000",
    gameFrontend: "18080",
  });
  assert.ok(args.includes("18081:8081"));
  assert.ok(args.includes("15000:5000"));
  assert.ok(args.includes("18080:8080"));
  assert.equal(args.includes("8081:8081"), false);
  assert.equal(args.includes("8080:8080"), false);
  assert.ok(args.includes("LUGO_STUDIO_API_PORT=8081"));
  assert.ok(args.includes("LUGO_STUDIO_GAME_SERVER_PORT=5000"));
  assert.ok(args.includes("LUGO_STUDIO_GAME_FRONTEND_PORT=8080"));
});

test("editor container remaps host port while keeping container listen port", () => {
  const args = editorRunArgs("/bots/demo", {}, { vsCode: "18082" });
  assert.ok(args.includes("18082:8082"));
  assert.equal(args.includes("8082:8082"), false);
  assert.ok(args.includes("PORT=8082"));
  assert.ok(args.includes("LUGO_VS_CODE_PORT=8082"));
});
