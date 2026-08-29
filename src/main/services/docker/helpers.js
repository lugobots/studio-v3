"use strict";

const { spawn } = require("child_process");
const { DOCKER_INFO_TIMEOUT_MS, DOCKER_STATUS_REASON } = require("./constants");

const MAX_OUTPUT_CHARS = 1024 * 1024;

function appendOutput(current, chunk) {
  if (current.length >= MAX_OUTPUT_CHARS) {
    return current;
  }
  const next = current + chunk.toString();
  return next.length > MAX_OUTPUT_CHARS ? next.slice(0, MAX_OUTPUT_CHARS) : next;
}

function combinedText(result) {
  const errorMessage = result && result.error && result.error.message ? result.error.message : "";
  return `${result && result.stdout ? result.stdout : ""} ${result && result.stderr ? result.stderr : ""} ${errorMessage}`.toLowerCase();
}

function looksLikeMissingBinary(result) {
  if (result.errorCode === "ENOENT") {
    return true;
  }
  const text = combinedText(result);
  return text.includes("not recognized") || text.includes("command not found");
}

function looksLikePermission(result) {
  const text = combinedText(result);
  return text.includes("permission denied") || text.includes("eacces");
}

function detachStdio(child) {
  if (!child) {
    return;
  }
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) {
      continue;
    }
    try {
      stream.removeAllListeners("data");
      stream.destroy();
    } catch {
      // ignore
    }
  }
}

function killChild(child) {
  if (!child) {
    return;
  }
  detachStdio(child);
  try {
    child.kill("SIGKILL");
  } catch {
    // ignore
  }
  try {
    child.unref();
  } catch {
    // ignore
  }
}

/**
 * Spawn a fixed command with a timeout. Resolves; never rejects.
 * Callers must pass a hardcoded command and args — no user-supplied strings.
 *
 * @param {object} options
 * @param {string} options.command
 * @param {string[]} options.args
 * @param {number} options.timeoutMs
 * @param {typeof spawn} [options.spawnFn]
 * @returns {Promise<{
 *   ok: boolean,
 *   timedOut: boolean,
 *   errorCode: string | null,
 *   exitCode: number | null,
 *   signal: string | null,
 *   stdout: string,
 *   stderr: string,
 *   error: Error | null
 * }>}
 */
function runTimedCommand(options) {
  const command = options.command;
  const args = options.args;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DOCKER_INFO_TIMEOUT_MS;
  const spawnFn = options.spawnFn || spawn;

  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let child = null;
    let timer = null;
    let spawnError = null;

    function finish(result) {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      resolve(result);
    }

    try {
      child = spawnFn(command, args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      finish({
        ok: false,
        timedOut: false,
        errorCode: err && err.code ? String(err.code) : null,
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: err && err.message ? err.message : "",
        error: err,
      });
      return;
    }

    timer = setTimeout(() => {
      finish({
        ok: false,
        timedOut: true,
        errorCode: null,
        exitCode: null,
        signal: "timeout",
        stdout,
        stderr,
        error: null,
      });
      killChild(child);
    }, timeoutMs);

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout = appendOutput(stdout, chunk);
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr = appendOutput(stderr, chunk);
      });
    }

    child.on("error", (err) => {
      spawnError = err;
      finish({
        ok: false,
        timedOut: false,
        errorCode: err && err.code ? String(err.code) : null,
        exitCode: null,
        signal: null,
        stdout,
        stderr: stderr || (err && err.message ? err.message : ""),
        error: err,
      });
    });

    child.on("close", (exitCode, signal) => {
      setImmediate(() => {
        if (spawnError) {
          finish({
            ok: false,
            timedOut: false,
            errorCode: spawnError.code ? String(spawnError.code) : null,
            exitCode: null,
            signal: null,
            stdout,
            stderr: stderr || spawnError.message || "",
            error: spawnError,
          });
          return;
        }
        finish({
          ok: exitCode === 0 && !signal,
          timedOut: false,
          errorCode: null,
          exitCode: typeof exitCode === "number" ? exitCode : null,
          signal: signal || null,
          stdout,
          stderr,
          error: null,
        });
      });
    });
  });
}

/**
 * Map a spawn result to `{ running, reason }`. After this mapping, `running`
 * is always a boolean (never null).
 *
 * @param {object} result
 * @returns {{ running: boolean, reason: string }}
 */
function mapDockerInfoResult(result) {
  if (!result || typeof result !== "object") {
    return { running: false, reason: DOCKER_STATUS_REASON.NOT_RUNNING };
  }
  if (result.ok) {
    return { running: true, reason: DOCKER_STATUS_REASON.OK };
  }
  if (result.timedOut) {
    return { running: false, reason: DOCKER_STATUS_REASON.TIMEOUT };
  }
  if (looksLikeMissingBinary(result)) {
    return { running: false, reason: DOCKER_STATUS_REASON.NOT_INSTALLED };
  }
  if (looksLikePermission(result)) {
    return { running: false, reason: DOCKER_STATUS_REASON.PERMISSION };
  }
  return { running: false, reason: DOCKER_STATUS_REASON.NOT_RUNNING };
}

module.exports = {
  mapDockerInfoResult,
  runTimedCommand,
};
