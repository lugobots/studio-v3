"use strict";

const { spawn } = require("child_process");
const {
  DOCKER_INFO_ARGS,
  DOCKER_INFO_COMMAND,
  DOCKER_INFO_TIMEOUT_MS,
  DOCKER_STATUS_REASON,
} = require("./constants");
const { mapDockerInfoResult, runTimedCommand } = require("./helpers");

function notRunningStatus() {
  return { running: false, reason: DOCKER_STATUS_REASON.NOT_RUNNING };
}

function createDockerService(options = {}) {
  const spawnFn = options.spawnFn || spawn;
  const command = options.command || DOCKER_INFO_COMMAND;
  const args = options.args || DOCKER_INFO_ARGS;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DOCKER_INFO_TIMEOUT_MS;
  const runCommand =
    options.runCommand ||
    (() =>
      runTimedCommand({
        command,
        args,
        timeoutMs,
        spawnFn,
      }));

  async function getStatus() {
    try {
      const result = await runCommand();
      const mapped = mapDockerInfoResult(result);
      return {
        running: mapped.running === true,
        reason: mapped.reason,
      };
    } catch {
      return notRunningStatus();
    }
  }

  return { getStatus };
}

const defaultService = createDockerService();

async function getStatus() {
  return defaultService.getStatus();
}

module.exports = {
  createDockerService,
  getStatus,
};
