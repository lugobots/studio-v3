"use strict";

const { spawn } = require("child_process");
const { DOCKER_INFO_TIMEOUT_MS, DOCKER_STATUS_REASON } = require("./constants");

const MAX_OUTPUT_CHARS = 1024 * 1024;

function appendOutput(current, chunk, maxChars) {
  const max = Number.isFinite(maxChars) ? maxChars : MAX_OUTPUT_CHARS;
  if (current.length >= max) {
    return current;
  }
  const next = current + chunk.toString();
  return next.length > max ? next.slice(0, max) : next;
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
 * Drop stdio listeners and unref so Electron can quit. Does not kill the
 * child — a Docker pull already handed to the engine may keep running.
 */
function releaseChildWithoutKill(child) {
  if (!child) {
    return;
  }
  detachStdio(child);
  try {
    child.unref();
  } catch {
    // ignore
  }
}

const SIZE_PAIR =
  /(\d+(?:\.\d+)?)\s*([kKmMgGtT]i?[bB]|[bB])\s*\/\s*(\d+(?:\.\d+)?)\s*([kKmMgGtT]i?[bB]|[bB])/;

function parseSizeToBytes(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  const u = String(unit || "B").toLowerCase();
  let factor = 1;
  if (u.startsWith("ki")) {
    factor = 1024;
  } else if (u.startsWith("mi")) {
    factor = 1024 * 1024;
  } else if (u.startsWith("gi")) {
    factor = 1024 * 1024 * 1024;
  } else if (u.startsWith("ti")) {
    factor = 1024 * 1024 * 1024 * 1024;
  } else if (u.startsWith("k")) {
    factor = 1000;
  } else if (u.startsWith("m")) {
    factor = 1000 * 1000;
  } else if (u.startsWith("g")) {
    factor = 1000 * 1000 * 1000;
  } else if (u.startsWith("t")) {
    factor = 1000 * 1000 * 1000 * 1000;
  }
  return Math.round(n * factor);
}

function normalizeRepository(repo) {
  let value = String(repo || "").trim();
  if (value.startsWith("docker.io/")) {
    value = value.slice("docker.io/".length);
  } else if (value.startsWith("index.docker.io/")) {
    value = value.slice("index.docker.io/".length);
  }
  return value;
}

/**
 * True when `docker images --format "{{.Repository}}\\t{{.Tag}}"` lists the
 * given repository and tag. Matches `docker.io/` prefixes. Does not treat a
 * same-digest image under another name as present.
 *
 * @param {string} stdout
 * @param {string} repository
 * @param {string} tag
 * @returns {boolean}
 */
function parseImageListHasTag(stdout, repository, tag) {
  const wantedRepo = normalizeRepository(repository);
  const wantedTag = String(tag || "");
  const text = typeof stdout === "string" ? stdout : "";
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let repo = "";
    let listedTag = "";
    if (trimmed.includes("\t")) {
      const parts = trimmed.split("\t");
      repo = parts[0] || "";
      listedTag = parts[1] || "";
    } else {
      const parts = trimmed.split(/\s+/);
      repo = parts[0] || "";
      listedTag = parts[1] || "";
    }
    if (!listedTag && repo.includes(":")) {
      const idx = repo.lastIndexOf(":");
      listedTag = repo.slice(idx + 1);
      repo = repo.slice(0, idx);
    }
    if (normalizeRepository(repo) === wantedRepo && listedTag === wantedTag) {
      return true;
    }
  }
  return false;
}

/**
 * Coarse pull progress from Docker CLI text. Returns counters only — never
 * layer ids or blob payloads.
 *
 * @param {string | Buffer} chunk
 * @returns {{ percent: number, currentBytes: number, totalBytes: number } | null}
 */
function parsePullProgress(chunk) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
  if (!text) {
    return null;
  }
  const segments = text.split(/\r|\n/);
  let best = null;
  for (const segment of segments) {
    const match = SIZE_PAIR.exec(segment);
    if (!match) {
      continue;
    }
    const currentBytes = parseSizeToBytes(match[1], match[2]);
    const totalBytes = parseSizeToBytes(match[3], match[4]);
    if (currentBytes == null || totalBytes == null || totalBytes <= 0) {
      continue;
    }
    const percent = Math.max(0, Math.min(100, Math.round((currentBytes / totalBytes) * 100)));
    best = { percent, currentBytes, totalBytes };
  }
  return best;
}

/**
 * One-line error for status / logs. Caps length and strips long hex ids.
 *
 * @param {unknown} text
 * @returns {string | null}
 */
function sanitizeErrorText(text) {
  const raw = String(text || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const interesting = raw.find((item) => /error|denied|unauthorized|not found|unknown|refused/i.test(item));
  let line = interesting || raw[raw.length - 1] || "";
  line = line.replace(/[0-9a-f]{32,}/gi, "").replace(/\s+/g, " ").trim();
  if (line.length > 240) {
    line = line.slice(0, 240).trim();
  }
  return line || null;
}

/**
 * Spawn a long-running fixed command (e.g. `docker pull`). No timeout unless
 * `timeoutMs` is passed. Resolves; never rejects. Callers must pass hardcoded
 * command and args — no user-supplied strings.
 *
 * @param {object} options
 * @param {string} options.command
 * @param {string[]} options.args
 * @param {typeof spawn} [options.spawnFn]
 * @param {boolean} [options.detached]
 * @param {(chunk: Buffer | string) => void} [options.onStdout]
 * @param {(chunk: Buffer | string) => void} [options.onStderr]
 * @param {(child: import("child_process").ChildProcess) => void} [options.onSpawn]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxOutputChars]
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
function runStreamingCommand(options) {
  const command = options.command;
  const args = options.args;
  const spawnFn = options.spawnFn || spawn;
  const detached = options.detached === true;
  const onStdout = typeof options.onStdout === "function" ? options.onStdout : null;
  const onStderr = typeof options.onStderr === "function" ? options.onStderr : null;
  const onSpawn = typeof options.onSpawn === "function" ? options.onSpawn : null;
  const maxOutputChars = Number.isFinite(options.maxOutputChars) ? options.maxOutputChars : 8192;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : null;

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
        detached,
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

    if (onSpawn) {
      try {
        onSpawn(child);
      } catch {
        // ignore listener errors
      }
    }

    if (timeoutMs != null) {
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
    }

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout = appendOutput(stdout, chunk, maxOutputChars);
        if (onStdout) {
          try {
            onStdout(chunk);
          } catch {
            // ignore
          }
        }
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr = appendOutput(stderr, chunk, maxOutputChars);
        if (onStderr) {
          try {
            onStderr(chunk);
          } catch {
            // ignore
          }
        }
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
  parseImageListHasTag,
  parsePullProgress,
  releaseChildWithoutKill,
  runStreamingCommand,
  runTimedCommand,
  sanitizeErrorText,
};
