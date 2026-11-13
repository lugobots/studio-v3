const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DOCKER_INSTALL_URL,
  openDockerInstallPage,
} = require("../src/main/services/docker/install-page");

test("openDockerInstallPage opens the fixed Docker Desktop URL", async () => {
  const opened = [];
  const result = await openDockerInstallPage(async (url) => {
    opened.push(url);
  });
  assert.equal(result.ok, true);
  assert.equal(result.url, DOCKER_INSTALL_URL);
  assert.deepEqual(opened, ["https://www.docker.com/products/docker-desktop/"]);
});

test("openDockerInstallPage reports missing openExternal", async () => {
  const result = await openDockerInstallPage(null);
  assert.equal(result.ok, false);
  assert.match(result.error, /Cannot open/);
});

test("openDockerInstallPage surfaces openExternal failures", async () => {
  const result = await openDockerInstallPage(async () => {
    throw new Error("blocked");
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "blocked");
});

test("ipc channel for open install page is registered in CHANNELS", () => {
  const { CHANNELS } = require("../src/shared/ipc-channels");
  assert.equal(CHANNELS.docker.openInstallPage, "docker:open-install-page");
});
