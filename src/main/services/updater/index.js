"use strict";

/**
 * Studio V3 updater trust path
 * ----------------------------
 * Discovery: unauthenticated GET to Doorway `/api/studio-v3/check-update`.
 * Download: GitHub Release asset URLs only (allowlisted); never Doorway/S3 bytes.
 * Auth: updater traffic MUST NOT require website OAuth cookies or sessions.
 * Future website OAuth for Studio must use a separate origin/flow and must not
 * share a cookie jar requirement with this update path.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const logic = require("./logic");
const trust = require("./trust");
const pkg = require("../../../../package.json");

function electronApp() {
  return require("electron").app;
}

function doorwayBase() {
  return (process.env.LUGO_DOORWAY_URL || "https://lugobots.ai").replace(/\/$/, "");
}

async function check(fetchImpl = global.fetch, platform = process.platform) {
  const version = pkg.version;
  try {
    const response = await fetchImpl(
      `${doorwayBase()}/api/studio-v3/check-update?version=${encodeURIComponent(version)}`,
    );
    if (!response.ok) {
      return { state: "error", message: `Update check failed (${response.status})` };
    }
    const body = await response.json();
    return logic.interpret(body, version, platform);
  } catch (error) {
    return { state: "error", message: error.message || "The official website could not be reached" };
  }
}

function emitProgress(onProgress, payload) {
  if (typeof onProgress === "function") {
    onProgress(payload);
  }
}

function mapDownloadPercent(percent, start, end) {
  if (percent == null || !Number.isFinite(percent)) {
    return start;
  }
  return Math.round(start + ((end - start) * Math.min(100, Math.max(0, percent))) / 100);
}

async function downloadAsset(asset, options = {}) {
  if (!asset || !asset.url || !asset.name || !asset.sha256) {
    throw new Error("Update asset metadata is incomplete");
  }
  trust.assertAllowlistedDownloadUrl(asset.url);

  const fetchImpl = options.fetchImpl || global.fetch;
  const onProgress = options.onProgress;
  const directory =
    options.directory ||
    path.join(electronApp().getPath("appData"), ".LugoStudio", "updates");
  emitProgress(onProgress, {
    phase: "download",
    percent: 0,
    label: "Downloading update",
    detail: `Downloading ${asset.name}…`,
  });
  const { bytes, finalUrl } = await trust.downloadAllowlisted(asset.url, fetchImpl, {
    onProgress: (progress) => {
      emitProgress(onProgress, {
        phase: "download",
        percent: mapDownloadPercent(progress.percent, 0, 80),
        label: "Downloading update",
        detail:
          progress.total > 0
            ? `Downloaded ${progress.received} of ${progress.total} bytes`
            : `Downloaded ${progress.received} bytes`,
      });
    },
  });
  trust.assertAllowlistedFinalUrl(finalUrl);

  const destination = trust.writeUpdateFile(directory, asset.name, bytes);
  emitProgress(onProgress, {
    phase: "verify",
    percent: 82,
    label: "Verifying update",
    detail: "Checking SHA-256 integrity…",
  });
  const digest = trust.verifySha256(destination, asset.sha256);
  if (!digest.ok) {
    try {
      fs.unlinkSync(destination);
    } catch {
      // ignore cleanup errors
    }
    const error = new Error(digest.error);
    error.code = "UPDATE_INTEGRITY";
    throw error;
  }

  let signaturePath = options.signaturePath || null;
  if (!signaturePath && asset.signatureUrl) {
    trust.assertAllowlistedDownloadUrl(asset.signatureUrl);
    emitProgress(onProgress, {
      phase: "download",
      percent: 86,
      label: "Downloading update",
      detail: "Downloading signature…",
    });
    const sig = await trust.downloadAllowlisted(asset.signatureUrl, fetchImpl);
    signaturePath = trust.writeUpdateFile(directory, `${asset.name}.asc`, sig.bytes);
  }

  emitProgress(onProgress, {
    phase: "verify",
    percent: 92,
    label: "Verifying update",
    detail: "Checking publisher signature…",
  });
  const signature = await trust.verifyPublisherSignature(destination, options.platform || process.platform, {
    verifyImpl: options.verifyImpl,
    expectedPublisher: options.expectedPublisher,
    signaturePath,
  });
  if (!signature.ok) {
    try {
      fs.unlinkSync(destination);
    } catch {
      // ignore cleanup errors
    }
    const error = new Error(signature.error || "Publisher signature verification failed");
    error.code = "UPDATE_SIGNATURE";
    throw error;
  }

  emitProgress(onProgress, {
    phase: "verify",
    percent: 96,
    label: "Verifying update",
    detail: "Update package verified.",
  });
  return destination;
}

/** @deprecated Doorway-hosted artifact names are no longer downloadable. */
async function download(artifactOrAsset, fetchImpl = global.fetch, options = {}) {
  if (artifactOrAsset && typeof artifactOrAsset === "object" && artifactOrAsset.url) {
    return downloadAsset(artifactOrAsset, { ...options, fetchImpl });
  }
  throw new Error(
    "Studio updates must download from allowlisted GitHub Release asset URLs",
  );
}

function launch(file, platform = process.platform, spawnImpl = spawn) {
  return logic.launch(file, platform, spawnImpl);
}

function watch(win) {
  win.webContents.once("did-finish-load", () => {
    check().then((result) => {
      const notice = logic.noticeFor(result);
      if (!notice) {
        return;
      }
      win.webContents.send("notifications:event", notice);
    });
  });
}

module.exports = {
  check,
  download,
  downloadAsset,
  launch,
  watch,
  doorwayBase,
};
