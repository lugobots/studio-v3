"use strict";

const { spawn } = require("child_process");
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
  releaseChildWithoutKill,
  runStreamingCommand,
  runTimedCommand,
  sanitizeErrorText,
} = require("./helpers");

const PROGRESS_THROTTLE_MS = 250;

const STATUS_TEXT = Object.freeze({
  idle: "",
  pulling: "Pulling Studio image…",
  ready: "Studio image is ready",
  error: "Studio image pull failed",
});

function defaultSpawnPull(spec) {
  const spawnFn = spec.spawnFn || spawn;
  const onData = spec.onData;
  const promise = runStreamingCommand({
    command: spec.command || DOCKER_COMMAND,
    args: spec.args || DOCKER_PULL_ARGS,
    spawnFn,
    detached: true,
    onStdout: onData,
    onStderr: onData,
    onSpawn: spec.onSpawn,
  });
  return { promise };
}

function createImageService(options = {}) {
  const spawnFn = options.spawnFn || spawn;
  const getStatus =
    options.getStatus ||
    ((...args) => {
      const status = require("./status");
      return status.getStatus(...args);
    });
  const runCommand =
    options.runCommand ||
    ((spec) =>
      runTimedCommand({
        command: spec.command || DOCKER_COMMAND,
        args: spec.args,
        timeoutMs: Number.isFinite(spec.timeoutMs) ? spec.timeoutMs : DOCKER_INFO_TIMEOUT_MS,
        spawnFn,
      }));
  const spawnPull = options.spawnPull || defaultSpawnPull;
  const log = options.log || ((message) => console.error(message));
  let progressListener = typeof options.onProgress === "function" ? options.onProgress : null;
  const notify = typeof options.notify === "function" ? options.notify : null;

  const state = {
    present: false,
    pulling: false,
    error: null,
    progressState: IMAGE_PROGRESS_STATE.IDLE,
    percent: null,
    currentBytes: null,
    totalBytes: null,
    statusText: "",
  };

  let ensureCheckPromise = null;
  let pullPromise = Promise.resolve();
  let pullChild = null;
  let lastProgressEmitAt = 0;

  function snapshotStatus() {
    return {
      present: state.present === true,
      pulling: state.pulling === true,
      error: typeof state.error === "string" && state.error.length > 0 ? state.error : null,
    };
  }

  function snapshotProgress() {
    return {
      ...snapshotStatus(),
      state: state.progressState,
      percent: Number.isFinite(state.percent) ? state.percent : null,
      currentBytes: Number.isFinite(state.currentBytes) ? state.currentBytes : null,
      totalBytes: Number.isFinite(state.totalBytes) ? state.totalBytes : null,
      status: typeof state.statusText === "string" ? state.statusText : "",
    };
  }

  function notifyProgress(payload) {
    if (typeof progressListener !== "function") {
      return;
    }
    try {
      progressListener(payload);
    } catch {
      // ignore listener errors
    }
  }

  function emitProgress(force) {
    const now = Date.now();
    if (!force && now - lastProgressEmitAt < PROGRESS_THROTTLE_MS) {
      return;
    }
    lastProgressEmitAt = now;
    notifyProgress(snapshotProgress());
  }

  function setProgressListener(listener) {
    progressListener = typeof listener === "function" ? listener : null;
  }

  async function listStudioImage() {
    const result = await runCommand({
      command: DOCKER_COMMAND,
      args: DOCKER_IMAGES_ARGS,
      timeoutMs: DOCKER_INFO_TIMEOUT_MS,
    });
    if (!result || result.ok !== true) {
      return { present: false, listed: false };
    }
    return {
      present: parseImageListHasTag(result.stdout, STUDIO_IMAGE_NAME, STUDIO_IMAGE_TAG),
      listed: true,
    };
  }

  function markReady() {
    state.present = true;
    state.pulling = false;
    state.error = null;
    state.progressState = IMAGE_PROGRESS_STATE.READY;
    state.percent = 100;
    state.currentBytes = null;
    state.totalBytes = null;
    state.statusText = STATUS_TEXT.ready;
  }

  async function getImageStatus() {
    if (state.pulling) {
      return snapshotStatus();
    }
    try {
      const daemon = await getStatus();
      if (!daemon || daemon.running !== true) {
        state.present = false;
        if (state.progressState !== IMAGE_PROGRESS_STATE.ERROR) {
          state.progressState = IMAGE_PROGRESS_STATE.IDLE;
        }
        return snapshotStatus();
      }
      const listed = await listStudioImage();
      if (listed.present) {
        markReady();
      } else {
        state.present = false;
        if (state.progressState === IMAGE_PROGRESS_STATE.READY) {
          state.progressState = IMAGE_PROGRESS_STATE.IDLE;
          state.percent = null;
          state.statusText = STATUS_TEXT.idle;
        }
      }
    } catch {
      state.present = false;
    }
    return snapshotStatus();
  }

  function applyPullChunk(chunk) {
    const parsed = parsePullProgress(chunk);
    if (!parsed || !state.pulling) {
      return;
    }
    state.percent = parsed.percent;
    state.currentBytes = parsed.currentBytes;
    state.totalBytes = parsed.totalBytes;
    state.statusText = `${STATUS_TEXT.pulling} ${state.percent}%`;
    emitProgress(false);
  }

  function failPull(message) {
    pullChild = null;
    state.pulling = false;
    state.present = false;
    state.error = message || "Studio image pull failed";
    state.progressState = IMAGE_PROGRESS_STATE.ERROR;
    state.statusText = STATUS_TEXT.error;
    emitProgress(true);
    log(`[docker] Studio image pull failed for ${STUDIO_IMAGE_REF}: ${state.error}`);
    if (typeof notify === "function") {
      try {
        notify({
          title: "Studio image pull failed",
          body: state.error,
        });
      } catch {
        // ignore notifier errors
      }
    }
  }

  function beginPull() {
    state.pulling = true;
    state.present = false;
    state.error = null;
    state.progressState = IMAGE_PROGRESS_STATE.PULLING;
    state.percent = null;
    state.currentBytes = null;
    state.totalBytes = null;
    state.statusText = STATUS_TEXT.pulling;
    emitProgress(true);

    let started;
    try {
      started = spawnPull({
        command: DOCKER_COMMAND,
        args: DOCKER_PULL_ARGS,
        spawnFn,
        onData: applyPullChunk,
        onSpawn: (child) => {
          pullChild = child;
        },
      });
    } catch (err) {
      failPull(sanitizeErrorText(err && err.message) || "Studio image pull failed");
      pullPromise = Promise.resolve();
      return;
    }

    const promise =
      started && typeof started.then === "function"
        ? started
        : started && started.promise
          ? started.promise
          : Promise.resolve(started);

    pullPromise = Promise.resolve(promise)
      .then((result) => {
        pullChild = null;
        if (result && result.ok) {
          markReady();
          emitProgress(true);
          return;
        }
        const errorText = sanitizeErrorText(result && (result.stderr || result.stdout));
        failPull(errorText || "Studio image pull failed");
      })
      .catch((err) => {
        failPull(sanitizeErrorText(err && err.message) || "Studio image pull failed");
      });
  }

  async function runEnsureCheck() {
    const daemon = await getStatus();
    if (!daemon || daemon.running !== true) {
      state.present = false;
      return snapshotStatus();
    }
    if (state.pulling) {
      return snapshotStatus();
    }
    const listed = await listStudioImage();
    if (!listed.listed) {
      state.present = false;
      return snapshotStatus();
    }
    if (listed.present) {
      markReady();
      emitProgress(true);
      return snapshotStatus();
    }
    beginPull();
    return snapshotStatus();
  }

  async function ensureStudioImage() {
    if (state.pulling) {
      return snapshotStatus();
    }
    if (ensureCheckPromise) {
      await ensureCheckPromise;
      return snapshotStatus();
    }
    ensureCheckPromise = runEnsureCheck().finally(() => {
      ensureCheckPromise = null;
    });
    return ensureCheckPromise;
  }

  function detachActivePull() {
    const child = pullChild;
    pullChild = null;
    releaseChildWithoutKill(child);
  }

  function whenPullSettles() {
    return pullPromise;
  }

  return {
    getImageStatus,
    ensureStudioImage,
    setProgressListener,
    detachActivePull,
    whenPullSettles,
  };
}

module.exports = {
  createImageService,
};
