"use strict";

const {
  DOCKER_COMMAND,
  DOCKER_IMAGES_ARGS,
  DOCKER_INFO_TIMEOUT_MS,
  DOCKER_PULL_ARGS,
  IMAGE_PROGRESS_STATE,
  STUDIO_IMAGE_NAME,
  STUDIO_IMAGE_REF,
  STUDIO_IMAGE_TAG,
} = require("./constants");
const {
  parseImageListHasTag,
  parsePullProgress,
  runStreamingCommand,
  runTimedCommand,
  sanitizeErrorText,
} = require("./helpers");
const { createImageService } = require("./images");
const { getStatus } = require("./status");

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

function createDeferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runTests() {
  console.log("== constants ==");
  assert(STUDIO_IMAGE_NAME === "lugobots/studio", "Studio image name is lugobots/studio");
  assert(STUDIO_IMAGE_TAG === "latest", "Studio image tag is latest");
  assert(STUDIO_IMAGE_REF === "lugobots/studio:latest", "Studio image ref is lugobots/studio:latest");
  assert(DOCKER_COMMAND === "docker", "image commands use docker");
  assert(DOCKER_IMAGES_ARGS[0] === "images", "list args start with images");
  assert(DOCKER_IMAGES_ARGS.includes(STUDIO_IMAGE_REF), "list args include the Studio image constant");
  assert(DOCKER_PULL_ARGS.length === 2 && DOCKER_PULL_ARGS[0] === "pull" && DOCKER_PULL_ARGS[1] === STUDIO_IMAGE_REF, "pull args are ['pull', STUDIO_IMAGE_REF]");
  assert(
    IMAGE_PROGRESS_STATE.IDLE === "idle" &&
      IMAGE_PROGRESS_STATE.PULLING === "pulling" &&
      IMAGE_PROGRESS_STATE.READY === "ready" &&
      IMAGE_PROGRESS_STATE.ERROR === "error",
    "progress states are idle/pulling/ready/error"
  );

  console.log("\n== parseImageListHasTag ==");
  assert(
    parseImageListHasTag("lugobots/studio\tlatest\n", STUDIO_IMAGE_NAME, STUDIO_IMAGE_TAG) === true,
    "tab-separated repository and tag match"
  );
  assert(
    parseImageListHasTag("docker.io/lugobots/studio\tlatest\n", STUDIO_IMAGE_NAME, STUDIO_IMAGE_TAG) === true,
    "docker.io prefix still matches"
  );
  assert(
    parseImageListHasTag("lugobots/studio latest\n", STUDIO_IMAGE_NAME, STUDIO_IMAGE_TAG) === true,
    "space-separated repository and tag match"
  );
  assert(
    parseImageListHasTag("lugobots/studio\tv1\n", STUDIO_IMAGE_NAME, STUDIO_IMAGE_TAG) === false,
    "same name with a different tag is not present"
  );
  assert(
    parseImageListHasTag("other/studio\tlatest\n", STUDIO_IMAGE_NAME, STUDIO_IMAGE_TAG) === false,
    "different repository is not present"
  );
  assert(parseImageListHasTag("", STUDIO_IMAGE_NAME, STUDIO_IMAGE_TAG) === false, "empty listing is not present");

  console.log("\n== parsePullProgress ==");
  const progress = parsePullProgress("a1b2c3d4e5f6: Downloading [=========>          ]  5MB/10MB\n");
  assert(progress != null && progress.percent === 50, "Downloading 5MB/10MB → 50%");
  assert(progress.currentBytes === 5 * 1000 * 1000, "currentBytes from 5MB");
  assert(progress.totalBytes === 10 * 1000 * 1000, "totalBytes from 10MB");
  const crProgress = parsePullProgress("Downloading 1kB/4kB\rDownloading 3kB/4kB");
  assert(crProgress != null && crProgress.percent === 75, "last \\r segment wins");
  assert(parsePullProgress("Pulling fs layer") == null, "layer status without sizes is ignored");
  assert(Object.keys(progress).sort().join(",") === "currentBytes,percent,totalBytes", "progress has counters only");

  console.log("\n== sanitizeErrorText ==");
  assert(
    sanitizeErrorText("Error response from daemon: manifest unknown") ===
      "Error response from daemon: manifest unknown",
    "keeps a one-line Docker error"
  );
  assert(sanitizeErrorText("") == null, "empty error text is null");

  console.log("\n== image present → no pull ==");
  let presentPulls = 0;
  const presentService = createImageService({
    getStatus: async () => ({ running: true, reason: "ok" }),
    runCommand: async ({ args }) => {
      assert(args === DOCKER_IMAGES_ARGS || (args && args[0] === "images"), "present path lists images with fixed args");
      return spawnResult({ ok: true, exitCode: 0, stdout: "lugobots/studio\tlatest\n" });
    },
    spawnPull: () => {
      presentPulls += 1;
      return { promise: Promise.resolve(spawnResult({ ok: true, exitCode: 0 })) };
    },
  });
  const presentResult = await presentService.ensureStudioImage();
  assert(presentResult.present === true, "present image → present true");
  assert(presentResult.pulling === false, "present image → not pulling");
  assert(presentResult.error === null, "present image → no error");
  assert(presentPulls === 0, "present image → pull not started");

  console.log("\n== image absent → pull started, ensure returns without waiting ==");
  const absentPull = createDeferred();
  let absentPulls = 0;
  const recordedPullArgs = [];
  const progressEvents = [];
  const absentService = createImageService({
    getStatus: async () => ({ running: true, reason: "ok" }),
    runCommand: async ({ args }) => {
      assert(args[0] === "images", "image lookup uses docker images");
      return spawnResult({ ok: true, exitCode: 0, stdout: "" });
    },
    spawnPull: (spec) => {
      absentPulls += 1;
      recordedPullArgs.push(spec.args);
      return { promise: absentPull.promise };
    },
    onProgress: (payload) => {
      progressEvents.push(payload);
    },
    log: () => {},
  });
  const ensureStarted = Date.now();
  const absentResult = await absentService.ensureStudioImage();
  const ensureElapsed = Date.now() - ensureStarted;
  assert(ensureElapsed < 500, "ensure returns without waiting for pull completion");
  assert(absentResult.present === false, "absent image → present false");
  assert(absentResult.pulling === true, "absent image → pulling true");
  assert(absentResult.error === null, "absent image → error null while pulling");
  assert(absentPulls === 1, "absent image → one pull started");
  assert(
    recordedPullArgs[0] && recordedPullArgs[0][0] === "pull" && recordedPullArgs[0][1] === STUDIO_IMAGE_REF,
    "pull uses fixed ['pull', lugobots/studio:latest]"
  );
  assert(
    progressEvents.some((event) => event.state === IMAGE_PROGRESS_STATE.PULLING),
    "progress event state is pulling"
  );
  assert(
    progressEvents.every((event) => event.layers == null && event.stdout == null && event.stderr == null),
    "progress events omit layer payloads and raw docker output"
  );

  console.log("\n== second ensure while pulling is a no-op ==");
  const secondEnsure = await absentService.ensureStudioImage();
  assert(absentPulls === 1, "second ensure while pulling does not start another pull");
  assert(secondEnsure.pulling === true, "second ensure still reports pulling");

  console.log("\n== pull error sets error status ==");
  absentPull.resolve(spawnResult({ ok: false, exitCode: 1, stderr: "Error response from daemon: manifest unknown" }));
  await absentService.whenPullSettles();
  const errorStatus = await absentService.getImageStatus();
  assert(errorStatus.pulling === false, "after pull error → not pulling");
  assert(errorStatus.present === false, "after pull error → not present");
  assert(typeof errorStatus.error === "string" && errorStatus.error.length > 0, "after pull error → error string");
  assert(/manifest unknown/i.test(errorStatus.error), "error status includes the Docker error");
  assert(
    progressEvents.some((event) => event.state === IMAGE_PROGRESS_STATE.ERROR),
    "progress event state is error after failure"
  );

  console.log("\n== daemon down → no pull ==");
  let downPulls = 0;
  let downListCalls = 0;
  const downService = createImageService({
    getStatus: async () => ({ running: false, reason: "not_running" }),
    runCommand: async () => {
      downListCalls += 1;
      return spawnResult({ ok: false });
    },
    spawnPull: () => {
      downPulls += 1;
      return { promise: Promise.resolve(spawnResult({ ok: true, exitCode: 0 })) };
    },
  });
  const downResult = await downService.ensureStudioImage();
  assert(downResult.present === false, "daemon down → present false");
  assert(downResult.pulling === false, "daemon down → not pulling");
  assert(downResult.error === null, "daemon down → no image error");
  assert(downPulls === 0, "daemon down → pull not started");
  assert(downListCalls === 0, "daemon down → docker images not called");

  console.log("\n== concurrent ensure during list starts a single pull ==");
  const listGate = createDeferred();
  let concurrentPulls = 0;
  const concurrentService = createImageService({
    getStatus: async () => ({ running: true, reason: "ok" }),
    runCommand: async () => {
      await listGate.promise;
      return spawnResult({ ok: true, exitCode: 0, stdout: "" });
    },
    spawnPull: () => {
      concurrentPulls += 1;
      return { promise: new Promise(() => {}) };
    },
    log: () => {},
  });
  const first = concurrentService.ensureStudioImage();
  await delay(10);
  const second = concurrentService.ensureStudioImage();
  listGate.resolve();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert(concurrentPulls === 1, "overlapping ensure calls start one pull");
  assert(firstResult.pulling === true && secondResult.pulling === true, "both overlapping ensures report pulling");

  console.log("\n== runStreamingCommand with fake pull ==");
  const streamed = [];
  const streamResult = await runStreamingCommand({
    command: process.execPath,
    args: [
      "-e",
      "process.stderr.write('Downloading 5MB/10MB\\n'); process.stderr.write('Error response from daemon: manifest unknown\\n'); process.exit(1);",
    ],
    onStderr: (chunk) => {
      streamed.push(String(chunk));
    },
  });
  assert(streamResult.ok === false, "fake pull exit 1 → not ok");
  assert(streamed.some((chunk) => chunk.includes("Downloading")), "streaming callback receives progress text");
  assert(/manifest unknown/i.test(streamResult.stderr), "stderr captured for error status");

  console.log("\n== live docker images (informational; does not pull; does not fail if Docker is missing) ==");
  const liveDaemon = await getStatus();
  assert(typeof liveDaemon.running === "boolean", "live getStatus returns boolean running");
  if (!liveDaemon.running) {
    console.log(`  skipped: daemon not running (reason=${liveDaemon.reason})`);
  } else {
    const listed = await runTimedCommand({
      command: DOCKER_COMMAND,
      args: DOCKER_IMAGES_ARGS,
      timeoutMs: DOCKER_INFO_TIMEOUT_MS,
    });
    const present = parseImageListHasTag(listed.stdout || "", STUDIO_IMAGE_NAME, STUDIO_IMAGE_TAG);
    console.log(`  live ${STUDIO_IMAGE_REF} present=${present} images_ok=${listed.ok}`);
    assert(typeof present === "boolean", "live images lookup returns a boolean");
  }
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
