"use strict";

const path = require("path");
const { LUGO_STUDIO_FOLDER } = require("../config/constants");
const { CHECK_PATH, UPDATES_DIR_NAME } = require("./constants");

function unavailableInfo() {
  return {
    available: false,
    version: null,
    fileName: null,
    downloadUrl: null,
    sizeBytes: null,
  };
}

function publicUpdateInfo(info) {
  const source = info && typeof info === "object" ? info : unavailableInfo();
  return {
    available: source.available === true,
    version: typeof source.version === "string" && source.version ? source.version : null,
    fileName: typeof source.fileName === "string" && source.fileName ? source.fileName : null,
    sizeBytes: Number.isFinite(source.sizeBytes) ? source.sizeBytes : null,
  };
}

function isSafeUpdateFileName(fileName) {
  if (typeof fileName !== "string" || fileName.length === 0) {
    return false;
  }
  if (fileName === "." || fileName === "..") {
    return false;
  }
  if (fileName.includes("\0")) {
    return false;
  }
  if (fileName.includes("/") || fileName.includes("\\")) {
    return false;
  }
  if (fileName !== path.basename(fileName)) {
    return false;
  }
  return true;
}

function parseHttpOrigin(origin) {
  if (typeof origin !== "string" || origin.trim() === "") {
    return null;
  }
  try {
    const url = new URL(origin.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function isSameOrigin(urlOrString, feedOrigin) {
  const feed = parseHttpOrigin(feedOrigin);
  if (!feed) {
    return false;
  }
  try {
    const url = typeof urlOrString === "string" ? new URL(urlOrString) : urlOrString;
    return url.origin === feed;
  } catch {
    return false;
  }
}

function buildCheckUrl(feedOrigin, currentVersion, platform) {
  const origin = parseHttpOrigin(feedOrigin);
  if (!origin) {
    return null;
  }
  const url = new URL(CHECK_PATH, `${origin}/`);
  url.searchParams.set("currentVersion", currentVersion);
  url.searchParams.set("platform", platform);
  return url.href;
}

function resolveDownloadUrl(body, feedOrigin) {
  const origin = parseHttpOrigin(feedOrigin);
  if (!origin) {
    return null;
  }
  if (!body || typeof body !== "object") {
    return null;
  }

  let candidate = null;
  if (typeof body.downloadUrl === "string" && body.downloadUrl.trim()) {
    candidate = body.downloadUrl.trim();
  } else if (typeof body.downloadPath === "string" && body.downloadPath.trim()) {
    candidate = body.downloadPath.trim();
  } else if (typeof body.fileName === "string" && isSafeUpdateFileName(body.fileName)) {
    candidate = `/api/studio/download/${encodeURIComponent(body.fileName)}`;
  }
  if (!candidate) {
    return null;
  }

  let resolved;
  try {
    resolved = new URL(candidate, `${origin}/`);
  } catch {
    return null;
  }
  if (resolved.origin !== origin) {
    return null;
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    return null;
  }
  return resolved.href;
}

function normalizeSizeBytes(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function mapCheckResponse(body, feedOrigin) {
  if (!body || typeof body !== "object" || body.available !== true) {
    return unavailableInfo();
  }
  if (!isSafeUpdateFileName(body.fileName)) {
    return unavailableInfo();
  }
  const downloadUrl = resolveDownloadUrl(body, feedOrigin);
  if (!downloadUrl) {
    return unavailableInfo();
  }
  return {
    available: true,
    version: typeof body.version === "string" && body.version ? body.version : null,
    fileName: body.fileName,
    downloadUrl,
    sizeBytes: normalizeSizeBytes(body.sizeBytes),
  };
}

function getUpdatesDir(appDataPath) {
  return path.join(appDataPath, LUGO_STUDIO_FOLDER, UPDATES_DIR_NAME);
}

function sanitizeDownloadError(err) {
  if (!err) {
    return "Download failed.";
  }
  if (typeof err === "string") {
    return err.replace(/\s+/g, " ").trim().slice(0, 300) || "Download failed.";
  }
  const message = err.message ? String(err.message) : "Download failed.";
  return message.replace(/\s+/g, " ").trim().slice(0, 300) || "Download failed.";
}

function isAbortError(err) {
  if (!err) {
    return false;
  }
  return err.code === "ABORT_ERR" || err.name === "AbortError";
}

module.exports = {
  buildCheckUrl,
  getUpdatesDir,
  isAbortError,
  isSafeUpdateFileName,
  isSameOrigin,
  mapCheckResponse,
  parseHttpOrigin,
  publicUpdateInfo,
  resolveDownloadUrl,
  sanitizeDownloadError,
  unavailableInfo,
};
