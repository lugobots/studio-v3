const test = require("node:test");
const assert = require("node:assert/strict");
const {
  HEALTH_DEADLINE_MS,
  HEALTH_INTERVAL_MS,
  actionResult,
  decidePoll,
  decideStartup,
  routeForStatus,
} = require("../src/main/services/session/gate");

test("startup shows the bot list after docker and does not watch a container", () => {
  assert.equal(HEALTH_INTERVAL_MS, 500);
  assert.equal(HEALTH_DEADLINE_MS, 180000);
  assert.deepEqual(decideStartup({ dockerRunning: false, botPaths: ["/bots/a"] }), {
    route: "/docker-check",
    watch: false,
  });
  assert.deepEqual(decideStartup({ dockerRunning: true, botPaths: [] }), {
    route: "/start-project",
    watch: false,
  });
  assert.deepEqual(decideStartup({ dockerRunning: true, botPaths: ["/bots/a"] }), {
    route: "/bots",
    watch: false,
  });
  assert.equal(routeForStatus({ project_status: "missing" }), "/start-project");
  assert.equal(routeForStatus({ project_status: "ready" }), "/main");
});

test("poll goes to the error screen immediately when the container is down", () => {
  const decision = decidePoll({
    containerRunning: false,
    healthy: false,
    elapsedMs: 0,
  });
  assert.equal(decision.route, "/api-error");
});

test("poll waits while the container is running and then times out", () => {
  assert.equal(
    decidePoll({ containerRunning: true, healthy: false, elapsedMs: 0 }).route,
    "/api-loading",
  );
  assert.equal(
    decidePoll({ containerRunning: true, healthy: false, elapsedMs: HEALTH_DEADLINE_MS }).route,
    "/api-error",
  );
});

test("a later health failure replaces the shell", () => {
  assert.equal(
    decidePoll({ containerRunning: true, healthy: true, elapsedMs: 1000, readyRoute: "/main" }).route,
    "/main",
  );
  assert.equal(
    decidePoll({
      containerRunning: true,
      healthy: true,
      elapsedMs: 1000,
      readyRoute: "/start-project",
    }).route,
    "/start-project",
  );
  const dropped = decidePoll({
    containerRunning: true,
    healthy: false,
    elapsedMs: 1000,
    seenHealthy: true,
  });
  assert.equal(dropped.route, "/api-error");
  assert.match(dropped.message, /stopped responding/);
});

test("stub responses are failures and do not count as success", () => {
  const failed = actionResult({ implemented: false, message: "not implemented" });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /not available/);
  assert.equal(actionResult({ project_status: "ready" }).ok, true);
});
