"use strict";

const fs = require("fs");
const path = require("path");
const {
  CHECK_TIMEOUT_MS,
  DOWNLOAD_TIMEOUT_MS,
  MOCK_UPDATE_ORIGIN,
  PRODUCTION_UPDATE_ORIGIN,
  PROGRESS_THROTTLE_MS,
} = require("./constants");
const {
  buildCheckUrl,
  getUpdatesDir,
  isAbortError,
  isSafeUpdateFileName,
  isSameOrigin,
  mapCheckResponse,
  publicUpdateInfo,
  sanitizeDownloadError,
  unavailableInfo,
} = require("./helpers");
const { httpDownloadToFile, httpGetJson: defaultHttpGetJson, unlinkQuiet } = require("./http");

function resolveFeedOrigin(options) {
  if (typeof options.getFeedOrigin === "function") {
    const origin = options.getFeedOrigin();
    if (typeof origin === "string" && origin.trim()) {
      return origin.trim().replace(/\/+$/, "");
    }
    return null;
  }
  if (typeof options.feedOrigin === "string" && options.feedOrigin.trim()) {
    return options.feedOrigin.trim().replace(/\/+$/, "");
  }
  const packaged = typeof options.isPackaged === "function" ? options.isPackaged() : !!options.isPackaged;
  if (!packaged) {
    return MOCK_UPDATE_ORIGIN;
  }
  if (typeof PRODUCTION_UPDATE_ORIGIN === "string" && PRODUCTION_UPDATE_ORIGIN.trim()) {
    return PRODUCTION_UPDATE_ORIGIN.trim().replace(/\/+$/, "");
  }
  return null;
}

function createUpdaterService(options = {}) {
  const getAppDataPath = options.getAppDataPath;
  const getAppVersion = options.getAppVersion;
  const getPlatform = options.getPlatform || (() => process.platform);
  const log = options.log || ((message) => console.warn(message));
  let progressListener = typeof options.onProgress === "function" ? options.onProgress : null;

  const httpGetJson =
    options.httpGetJson ||
    ((url) =>
      defaultHttpGetJson(url, {
        timeoutMs: CHECK_TIMEOUT_MS,
        feedOrigin: resolveFeedOrigin(options),
      }));
  const httpDownload =
    options.httpDownload ||
    ((url, destPath, downloadOptions) =>
      httpDownloadToFile(url, destPath, {
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        feedOrigin: resolveFeedOrigin(options),
        signal: downloadOptions && downloadOptions.signal,
        onProgress: downloadOptions && downloadOptions.onProgress,
        totalBytes: downloadOptions && downloadOptions.totalBytes,
      }));

  let checkPromise = null;
  let lastCheck = unavailableInfo();
  let activeController = null;

  function warn(message) {
    try {
      log(`[updater] ${message}`);
    } catch {
      // ignore
    }
  }

  function emitProgress(payload) {
    if (typeof progressListener !== "function") {
      return;
    }
    try {
      progressListener(payload);
    } catch {
      // ignore
    }
  }

  function setProgressListener(listener) {
    progressListener = typeof listener === "function" ? listener : null;
  }

  function throttleProgress(fileName, totalBytes) {
    let lastAt = 0;
    return (receivedBytes) => {
      const payload = {
        receivedBytes,
        totalBytes: Number.isFinite(totalBytes) ? totalBytes : null,
        fileName,
      };
      const now = Date.now();
      const isLast = Number.isFinite(totalBytes) && receivedBytes >= totalBytes;
      if (lastAt === 0 || isLast || now - lastAt >= PROGRESS_THROTTLE_MS) {
        lastAt = now;
        emitProgress(payload);
      }
    };
  }

  async function runCheck() {
    const origin = resolveFeedOrigin(options);
    if (!origin) {
      lastCheck = unavailableInfo();
      return publicUpdateInfo(lastCheck);
    }

    let version;
    try {
      version = getAppVersion();
    } catch (err) {
      warn(`could not read app version: ${err && err.message ? err.message : err}`);
      lastCheck = unavailableInfo();
      return publicUpdateInfo(lastCheck);
    }
    if (typeof version !== "string" || !version.trim()) {
      lastCheck = unavailableInfo();
      return publicUpdateInfo(lastCheck);
    }

    const platform = getPlatform();
    const url = buildCheckUrl(origin, version.trim(), platform);
    if (!url) {
      lastCheck = unavailableInfo();
      return publicUpdateInfo(lastCheck);
    }

    try {
      const body = await httpGetJson(url);
      const mapped = mapCheckResponse(body, origin);
      if (body && body.available === true && mapped.available !== true) {
        warn("update server advertised a file that was rejected (unsafe fileName or cross-origin download URL)");
      }
      lastCheck = mapped;
      return publicUpdateInfo(lastCheck);
    } catch (err) {
      lastCheck = unavailableInfo();
      const code = err && err.code ? err.code : "";
      warn(
        `update server unreachable or check failed (${code || "error"}): ${
          err && err.message ? err.message : err
        }`
      );
      return publicUpdateInfo(lastCheck);
    }
  }

  function check() {
    if (!checkPromise) {
      checkPromise = runCheck();
    }
    return checkPromise;
  }

  async function download(request = {}) {
    await check();
    const info = lastCheck;
    if (!info || info.available !== true || !info.fileName || !info.downloadUrl) {
      return { ok: false, error: "No update is available to download." };
    }
    if (!isSafeUpdateFileName(info.fileName)) {
      return { ok: false, error: "Update file name is not allowed." };
    }
    if (request && typeof request.fileName === "string" && request.fileName && request.fileName !== info.fileName) {
      return { ok: false, error: "Update file does not match the latest check." };
    }
    if (!isSameOrigin(info.downloadUrl, resolveFeedOrigin(options))) {
      return { ok: false, error: "Update download URL must be same-origin as the update feed." };
    }
    if (activeController) {
      return { ok: false, error: "An update download is already in progress." };
    }

    const appDataPath = getAppDataPath();
    const updatesDir = getUpdatesDir(appDataPath);
    const destPath = path.join(updatesDir, info.fileName);
    if (path.dirname(destPath) !== updatesDir || path.basename(destPath) !== info.fileName) {
      return { ok: false, error: "Update file name is not allowed." };
    }

    try {
      fs.mkdirSync(updatesDir, { recursive: true });
    } catch (err) {
      return { ok: false, error: sanitizeDownloadError(err) };
    }

    const controller = new AbortController();
    activeController = controller;
    const onBytes = throttleProgress(info.fileName, info.sizeBytes);

    try {
      await httpDownload(info.downloadUrl, destPath, {
        signal: controller.signal,
        onProgress: (payload) => {
          if (payload && Number.isFinite(payload.receivedBytes)) {
            onBytes(payload.receivedBytes);
          }
        },
        totalBytes: info.sizeBytes,
      });

      if (controller.signal.aborted) {
        unlinkQuiet(destPath);
        return { ok: false, cancelled: true };
      }

      emitProgress({
        receivedBytes: Number.isFinite(info.sizeBytes) ? info.sizeBytes : 0,
        totalBytes: Number.isFinite(info.sizeBytes) ? info.sizeBytes : null,
        fileName: info.fileName,
      });

      return { ok: true, path: destPath };
    } catch (err) {
      unlinkQuiet(destPath);
      if (controller.signal.aborted || isAbortError(err)) {
        return { ok: false, cancelled: true };
      }
      return { ok: false, error: sanitizeDownloadError(err) };
    } finally {
      if (activeController === controller) {
        activeController = null;
      }
    }
  }

  function cancel() {
    if (!activeController) {
      return { cancelled: false };
    }
    activeController.abort();
    return { cancelled: true };
  }

  return {
    check,
    download,
    cancel,
    setProgressListener,
    getUpdatesDir: () => getUpdatesDir(getAppDataPath()),
  };
}

let service = null;

function getElectronService() {
  if (!service) {
    const { app } = require("electron");
    service = createUpdaterService({
      getAppDataPath: () => app.getPath("appData"),
      getAppVersion: () => app.getVersion(),
      getPlatform: () => process.platform,
      isPackaged: () => app.isPackaged,
      log: (message) => console.warn(message),
    });
  }
  return service;
}

async function check() {
  return getElectronService().check();
}

async function download(request) {
  return getElectronService().download(request);
}

function cancel() {
  return getElectronService().cancel();
}

function setProgressListener(listener) {
  getElectronService().setProgressListener(listener);
}

module.exports = {
  MOCK_UPDATE_ORIGIN,
  PRODUCTION_UPDATE_ORIGIN,
  cancel,
  check,
  createUpdaterService,
  download,
  setProgressListener,
};
