"use strict";

const HEALTH_INTERVAL_MS = 500;
const HEALTH_DEADLINE_MS = 3 * 60 * 1000;

function decideStartup({ dockerRunning }) {
  if (!dockerRunning) {
    return { route: "/docker-check", watch: false };
  }
  return { route: "/api-loading", watch: true };
}

function routeForStatus(body) {
  if (body && body.project_status === "ready") {
    return "/main";
  }
  return "/start-project";
}

function decidePoll({
  containerRunning,
  healthy,
  elapsedMs,
  seenHealthy = false,
  deadlineMs = HEALTH_DEADLINE_MS,
  readyRoute = "/main",
}) {
  if (!containerRunning) {
    return {
      route: "/api-error",
      message: "The Studio API container is not running.",
      seenHealthy,
    };
  }
  if (healthy) {
    return { route: readyRoute, seenHealthy: true };
  }
  if (seenHealthy) {
    return {
      route: "/api-error",
      message: "The Studio API stopped responding.",
      seenHealthy: true,
    };
  }
  if (elapsedMs >= deadlineMs) {
    return {
      route: "/api-error",
      message: "The Studio API did not become ready.",
      seenHealthy: false,
    };
  }
  return { route: "/api-loading", seenHealthy: false };
}

function actionResult(body) {
  if (body && body.implemented === false) {
    return {
      ok: false,
      error: "This action is not available in this Studio version yet.",
      body,
    };
  }
  return { ok: true, body };
}

module.exports = {
  HEALTH_INTERVAL_MS,
  HEALTH_DEADLINE_MS,
  decideStartup,
  decidePoll,
  routeForStatus,
  actionResult,
};
