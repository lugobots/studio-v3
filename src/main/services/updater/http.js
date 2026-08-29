"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { MAX_JSON_BYTES, MAX_REDIRECTS } = require("./constants");
const { isAbortError, isSameOrigin } = require("./helpers");

function abortError() {
  const err = new Error("Download cancelled");
  err.code = "ABORT_ERR";
  err.name = "AbortError";
  return err;
}

function clientFor(url) {
  return url.protocol === "https:" ? https : http;
}

function unlinkQuiet(filePath) {
  if (!filePath) {
    return;
  }
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

function httpGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let req = null;
    let onAbort = null;

    const finish = (err, value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (options.signal && onAbort) {
        options.signal.removeEventListener("abort", onAbort);
      }
      if (err) {
        reject(err);
      } else {
        resolve(value);
      }
    };

    onAbort = () => {
      if (req) {
        req.destroy();
      }
      finish(abortError());
    };

    req = clientFor(url).get(url, { timeout: options.timeoutMs }, (res) => {
      finish(null, { req, res });
    });

    req.on("error", (err) => {
      finish(options.signal && options.signal.aborted ? abortError() : err);
    });
    req.on("timeout", () => {
      req.destroy();
      const err = new Error("update server request timed out");
      err.code = "ETIMEDOUT";
      finish(err);
    });

    if (options.signal) {
      if (options.signal.aborted) {
        req.destroy();
        finish(abortError());
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

async function openSameOrigin(urlString, feedOrigin, options = {}) {
  let current;
  try {
    current = new URL(urlString);
  } catch {
    const err = new Error("Invalid update URL");
    err.code = "UPDATER_URL";
    throw err;
  }

  for (let hops = 0; hops <= MAX_REDIRECTS; hops += 1) {
    if (!isSameOrigin(current, feedOrigin)) {
      const err = new Error("Update download URL must be same-origin as the update feed");
      err.code = "UPDATER_ORIGIN";
      throw err;
    }

    const { req, res } = await httpGet(current, options);
    const status = res.statusCode || 0;
    if (status >= 300 && status < 400) {
      const location = res.headers.location;
      res.resume();
      if (!location) {
        const err = new Error("Update request redirected without a Location header");
        err.code = "UPDATER_REDIRECT";
        throw err;
      }
      let next;
      try {
        next = new URL(location, current);
      } catch {
        const err = new Error("Update request redirected to an invalid URL");
        err.code = "UPDATER_REDIRECT";
        throw err;
      }
      current = next;
      continue;
    }

    return { url: current, req, res, status };
  }

  const err = new Error("Too many redirects from the update server");
  err.code = "UPDATER_REDIRECTS";
  throw err;
}

function readBody(res, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    res.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        res.destroy();
        const err = new Error("Update server response is too large");
        err.code = "UPDATER_SIZE";
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    res.on("end", () => resolve(Buffer.concat(chunks)));
    res.on("error", reject);
  });
}

async function httpGetJson(urlString, options = {}) {
  const opened = await openSameOrigin(urlString, options.feedOrigin, {
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
  const { res, status } = opened;
  if (status !== 200) {
    res.resume();
    const err = new Error(`Update check failed (HTTP ${status})`);
    err.code = "UPDATER_HTTP";
    throw err;
  }
  const buffer = await readBody(res, options.maxBytes || MAX_JSON_BYTES);
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    const err = new Error("Update check returned invalid JSON");
    err.code = "UPDATER_JSON";
    throw err;
  }
}

function pipeToFile(res, destPath, options = {}) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const out = fs.createWriteStream(destPath);
    let received = 0;
    let settled = false;

    const onAbort = () => {
      try {
        res.unpipe(out);
      } catch {
        // ignore
      }
      res.destroy();
      if (!out.destroyed) {
        out.destroy();
      }
      finish(abortError());
    };

    const finish = (err) => {
      if (settled) {
        return;
      }
      settled = true;
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }

      const failed = Boolean(err) || Boolean(options.signal && options.signal.aborted);
      if (!failed) {
        resolve({ receivedBytes: received });
        return;
      }

      const cause =
        isAbortError(err) || (options.signal && options.signal.aborted) ? abortError() : err || abortError();
      const cleanup = () => {
        unlinkQuiet(destPath);
        reject(cause);
      };
      if (out.closed) {
        cleanup();
        return;
      }
      out.once("close", cleanup);
      if (!out.destroyed) {
        out.destroy();
      }
    };

    if (options.signal) {
      if (options.signal.aborted) {
        finish(abortError());
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    res.on("data", (chunk) => {
      received += chunk.length;
      if (typeof options.onProgress === "function") {
        options.onProgress({
          receivedBytes: received,
          totalBytes: options.totalBytes,
        });
      }
    });
    res.on("error", (err) => {
      finish(options.signal && options.signal.aborted ? abortError() : err);
    });
    out.on("error", (err) => {
      finish(options.signal && options.signal.aborted ? abortError() : err);
    });
    out.on("finish", () => finish(null));
    res.pipe(out);
  });
}

async function httpDownloadToFile(urlString, destPath, options = {}) {
  const opened = await openSameOrigin(urlString, options.feedOrigin, {
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
  const { res, status } = opened;
  if (status !== 200) {
    res.resume();
    unlinkQuiet(destPath);
    const err = new Error(`Update download failed (HTTP ${status})`);
    err.code = "UPDATER_HTTP";
    throw err;
  }

  const headerLength = Number(res.headers["content-length"]);
  const totalBytes =
    Number.isFinite(headerLength) && headerLength >= 0
      ? headerLength
      : Number.isFinite(options.totalBytes)
        ? options.totalBytes
        : null;

  try {
    await pipeToFile(res, destPath, {
      signal: options.signal,
      onProgress: options.onProgress,
      totalBytes,
    });
  } catch (err) {
    unlinkQuiet(destPath);
    throw err;
  }
}

module.exports = {
  abortError,
  httpDownloadToFile,
  httpGetJson,
  unlinkQuiet,
};
