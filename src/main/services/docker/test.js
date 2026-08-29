"use strict";

const {
  DOCKER_INFO_ARGS,
  DOCKER_INFO_COMMAND,
  DOCKER_INFO_TIMEOUT_MS,
  DOCKER_STATUS_REASON,
} = require("./constants");
const { mapDockerInfoResult, runTimedCommand } = require("./helpers");
const { createDockerService, getStatus } = require("./index");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`ok  ${message}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${message}`);
  }
}

function spawnResult(overrides = {}) {
  return {
    ok: false,
    timedOut: false,
    errorCode: null,
    exitCode: 1,
    signal: null,
    stdout: "",
    stderr: "",
    error: null,
    ...overrides,
  };
}

async function runTests() {
  console.log("== constants ==");
  assert(DOCKER_INFO_COMMAND === "docker", "diagnostic command is docker");
  assert(Array.isArray(DOCKER_INFO_ARGS) && DOCKER_INFO_ARGS.length === 1 && DOCKER_INFO_ARGS[0] === "info", "diagnostic args are only ['info']");
  assert(DOCKER_INFO_TIMEOUT_MS === 5000, "docker info timeout is 5 seconds");

  console.log("\n== mapDockerInfoResult ==");
  const okMapped = mapDockerInfoResult(spawnResult({ ok: true, exitCode: 0 }));
  assert(okMapped.running === true, "exit 0 → running true");
  assert(okMapped.reason === DOCKER_STATUS_REASON.OK, "exit 0 → reason ok");

  const timeoutMapped = mapDockerInfoResult(spawnResult({ timedOut: true, exitCode: null, signal: "timeout" }));
  assert(timeoutMapped.running === false, "timeout → running false (fail closed)");
  assert(timeoutMapped.reason === DOCKER_STATUS_REASON.TIMEOUT, "timeout → reason timeout");

  const missingMapped = mapDockerInfoResult(spawnResult({ errorCode: "ENOENT", exitCode: null, stderr: "spawn docker ENOENT" }));
  assert(missingMapped.running === false, "ENOENT → running false");
  assert(missingMapped.reason === DOCKER_STATUS_REASON.NOT_INSTALLED, "ENOENT → not_installed");

  const notRecognized = mapDockerInfoResult(
    spawnResult({ stderr: "'docker' is not recognized as an internal or external command" })
  );
  assert(notRecognized.reason === DOCKER_STATUS_REASON.NOT_INSTALLED, "Windows 'not recognized' → not_installed");

  const permissionMapped = mapDockerInfoResult(
    spawnResult({
      stderr: "permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock",
    })
  );
  assert(permissionMapped.running === false, "permission denied → running false");
  assert(permissionMapped.reason === DOCKER_STATUS_REASON.PERMISSION, "permission denied → permission");

  const stoppedMapped = mapDockerInfoResult(
    spawnResult({ stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" })
  );
  assert(stoppedMapped.running === false, "daemon down → running false");
  assert(stoppedMapped.reason === DOCKER_STATUS_REASON.NOT_RUNNING, "daemon down → not_running");

  const socketMissing = mapDockerInfoResult(
    spawnResult({ stderr: "dial unix /var/run/docker.sock: connect: no such file or directory" })
  );
  assert(socketMissing.reason === DOCKER_STATUS_REASON.NOT_RUNNING, "missing docker.sock is not treated as binary missing");

  const nullMapped = mapDockerInfoResult(null);
  assert(nullMapped.running === false, "malformed result → running false");
  assert(typeof nullMapped.running === "boolean", "mapped running is never null");

  console.log("\n== injected runCommand status mapping ==");
  const runningService = createDockerService({
    runCommand: async () => spawnResult({ ok: true, exitCode: 0 }),
  });
  const runningStatus = await runningService.getStatus();
  assert(runningStatus.running === true, "injected success → running true");
  assert(runningStatus.reason === DOCKER_STATUS_REASON.OK, "injected success → reason ok");

  const timeoutService = createDockerService({
    runCommand: async () => spawnResult({ timedOut: true, exitCode: null }),
  });
  const timeoutStatus = await timeoutService.getStatus();
  assert(timeoutStatus.running === false, "injected timeout → running false");
  assert(timeoutStatus.reason === DOCKER_STATUS_REASON.TIMEOUT, "injected timeout → reason timeout");

  const throwingService = createDockerService({
    runCommand: async () => {
      throw new Error("unexpected");
    },
  });
  const throwingStatus = await throwingService.getStatus();
  assert(throwingStatus.running === false, "thrown runCommand → running false, not a throw");
  assert(throwingStatus.reason === DOCKER_STATUS_REASON.NOT_RUNNING, "thrown runCommand → not_running");

  console.log("\n== runTimedCommand with fake commands ==");
  const successCmd = await runTimedCommand({
    command: process.execPath,
    args: ["-e", "process.stdout.write('ok'); process.exit(0)"],
    timeoutMs: 5000,
  });
  assert(successCmd.ok === true, "node exit 0 → ok");
  assert(mapDockerInfoResult(successCmd).running === true, "node exit 0 maps to running true");

  const failCmd = await runTimedCommand({
    command: process.execPath,
    args: ["-e", "process.stderr.write('Cannot connect to the Docker daemon'); process.exit(1)"],
    timeoutMs: 5000,
  });
  assert(failCmd.ok === false, "node exit 1 → not ok");
  assert(mapDockerInfoResult(failCmd).running === false, "node exit 1 maps to running false");
  assert(mapDockerInfoResult(failCmd).reason === DOCKER_STATUS_REASON.NOT_RUNNING, "node exit 1 daemon message → not_running");

  const permissionCmd = await runTimedCommand({
    command: process.execPath,
    args: ["-e", "process.stderr.write('permission denied while trying to connect'); process.exit(1)"],
    timeoutMs: 5000,
  });
  assert(mapDockerInfoResult(permissionCmd).reason === DOCKER_STATUS_REASON.PERMISSION, "node permission message → permission");

  const missingCmd = await runTimedCommand({
    command: "studio-v3-docker-missing-binary-9f3c1",
    args: ["info"],
    timeoutMs: 3000,
  });
  assert(missingCmd.ok === false, "missing binary → not ok");
  assert(mapDockerInfoResult(missingCmd).running === false, "missing binary maps to running false");
  assert(mapDockerInfoResult(missingCmd).reason === DOCKER_STATUS_REASON.NOT_INSTALLED, "missing binary → not_installed");

  const hungStarted = Date.now();
  const hungCmd = await runTimedCommand({
    command: process.execPath,
    args: ["-e", "setTimeout(function () {}, 20000)"],
    timeoutMs: 400,
  });
  const hungElapsed = Date.now() - hungStarted;
  assert(hungCmd.timedOut === true, "long-running command times out");
  assert(hungCmd.ok === false, "timed-out command is not ok");
  assert(mapDockerInfoResult(hungCmd).running === false, "timeout maps to running false");
  assert(mapDockerInfoResult(hungCmd).reason === DOCKER_STATUS_REASON.TIMEOUT, "timeout maps to reason timeout");
  assert(hungElapsed < 5000, "timeout returns in well under the child lifetime");

  const hungService = createDockerService({
    command: process.execPath,
    args: ["-e", "setTimeout(function () {}, 20000)"],
    timeoutMs: 400,
  });
  const hungStatus = await hungService.getStatus();
  assert(hungStatus.running === false, "service timeout → running false");
  assert(hungStatus.reason === DOCKER_STATUS_REASON.TIMEOUT, "service timeout → reason timeout");

  const fakeOkService = createDockerService({
    command: process.execPath,
    args: ["-e", "process.exit(0)"],
    timeoutMs: 5000,
  });
  const fakeOkStatus = await fakeOkService.getStatus();
  assert(fakeOkStatus.running === true, "service with node exit 0 → running true");

  console.log("\n== live docker info (informational; does not fail the step if Docker is missing) ==");
  const live = await getStatus();
  assert(typeof live.running === "boolean", "live getStatus returns boolean running (never null)");
  assert(typeof live.reason === "string" && live.reason.length > 0, "live getStatus includes a reason");
  console.log(`  live docker info: running=${live.running} reason=${live.reason}`);
}

runTests()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) {
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
