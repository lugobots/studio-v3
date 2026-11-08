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
    return { state: "error", message: error.message || "Doorway could not be reached" };
  }
}

async function downloadAsset(asset, options = {}) {
  if (!asset || !asset.url || !asset.name || !asset.sha256) {
    throw new Error("Update asset metadata is incomplete");
  }
  trust.assertAllowlistedDownloadUrl(asset.url);

  const fetchImpl = options.fetchImpl || global.fetch;
  const directory =
    options.directory ||
    path.join(electronApp().getPath("appData"), ".LugoStudio", "updates");
  const { bytes, finalUrl } = await trust.downloadAllowlisted(asset.url, fetchImpl);
  trust.assertAllowlistedFinalUrl(finalUrl);

  const destination = trust.writeUpdateFile(directory, asset.name, bytes);
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
    const sig = await trust.downloadAllowlisted(asset.signatureUrl, fetchImpl);
    signaturePath = trust.writeUpdateFile(directory, `${asset.name}.asc`, sig.bytes);
  }

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

  return destination;
}

/** @deprecated Doorway-hosted artifact names are no longer downloadable. */
async function download(artifactOrAsset, fetchImpl = global.fetch, options = {}) {
  if (artifactOrAsset && typeof artifactOrAsset === "object" && artifactOrAsset.url) {
    return downloadAsset(artifactOrAsset, { ...options, fetchImpl });
  }
  throw new Error(
    "Studio updates must download from allowlisted GitHub Release asset URLs (Doorway/S3 hosts are rejected)",
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
