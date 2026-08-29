"use strict";

/**
 * How long main waits for a fixed `docker info` before treating Docker as not
 * running. Fail closed: a hang (Docker Desktop still booting, blocked CLI)
 * becomes `running: false`. `/docker-check` polls every few seconds instead of
 * stretching this timeout.
 */
const DOCKER_INFO_TIMEOUT_MS = 5000;

/** Fixed diagnostic only — never interpolate user input into this command. */
const DOCKER_INFO_COMMAND = "docker";
const DOCKER_INFO_ARGS = Object.freeze(["info"]);

const DOCKER_STATUS_REASON = Object.freeze({
  OK: "ok",
  NOT_INSTALLED: "not_installed",
  NOT_RUNNING: "not_running",
  TIMEOUT: "timeout",
  PERMISSION: "permission",
});

module.exports = {
  DOCKER_INFO_ARGS,
  DOCKER_INFO_COMMAND,
  DOCKER_INFO_TIMEOUT_MS,
  DOCKER_STATUS_REASON,
};
