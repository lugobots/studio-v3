"use strict";

const { artifactNameForPlatform } = require("../../../shared/artifact");
const {
  isAllowlistedReleaseAssetUrl,
  normalizeSha256,
} = require("./trust");

function parseSemver(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(version || ""));
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(latest, current) {
  const left = parseSemver(latest);
  const right = parseSemver(current);
  if (!left || !right) {
    return 0;
  }
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) {
      return 1;
    }
    if (left[index] < right[index]) {
      return -1;
    }
  }
  return 0;
}

function platformAssetKey(platform) {
  switch (platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    default:
      return null;
  }
}

function normalizeAsset(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const name = String(entry.name || entry.artifact || "").trim();
  const url = String(entry.url || "").trim();
  const sha256 = normalizeSha256(entry.sha256 || entry.digest || "");
  const signatureUrl = String(entry.signatureUrl || entry.signature_url || "").trim() || null;
  if (!name || !url || !sha256) {
    return null;
  }
  if (!isAllowlistedReleaseAssetUrl(url)) {
    return null;
  }
  return { name, url, sha256, signatureUrl };
}

/**
 * Pick the GitHub Release asset for the running platform from a Doorway payload.
 * Legacy artifact-only (Doorway/S3) payloads do not qualify.
 */
function selectPlatformAsset(body, platform = process.platform, options = {}) {
  if (!body || typeof body !== "object") {
    return null;
  }
  const key = platformAssetKey(platform);
  const table = body.platformAssets || body.assets || null;
  if (table && key) {
    const selected =
      normalizeAsset(table[key]) ||
      normalizeAsset(table[platform]) ||
      null;
    if (selected) {
      return selected;
    }
  }

  const single = normalizeAsset({
    name: body.artifact || body.name,
    url: body.url,
    sha256: body.sha256 || body.digest,
    signatureUrl: body.signatureUrl || body.signature_url,
  });
  if (!single) {
    return null;
  }

  const label = platformLabel(platform);
  const expected = artifactNameForPlatform(platform, body.version, {
    arch: options.arch || process.arch,
    ext: options.ext,
  });
  if (expected && single.name === expected) {
    return single;
  }
  if (label && single.name.includes(label)) {
    return single;
  }
  return null;
}

function platformLabel(platform) {
  switch (platform) {
    case "win32":
      return "Windows";
    case "darwin":
      return "macOS";
    case "linux":
      return "Linux";
    default:
      return "";
  }
}

function interpret(body, current, platform = process.platform, options = {}) {
  if (!body || typeof body.version !== "string") {
    return { state: "error", message: "Doorway returned an unusable version check" };
  }
  if (!(body.newer === true && compareSemver(body.version, current) === 1)) {
    return { state: "current", version: body.version };
  }

  const asset = selectPlatformAsset(body, platform, options);
  if (!asset) {
    const key = platformAssetKey(platform);
    const table = body.platformAssets || body.assets;
    if (table && key && !table[key] && !table[platform]) {
      return {
        state: "unavailable",
        version: body.version,
        message: `No update package is available for ${platformLabel(platform) || "this system"}`,
      };
    }
    return {
      state: "error",
      version: body.version,
      message:
        "Doorway did not provide an allowlisted GitHub Release asset with SHA-256 for this platform",
    };
  }

  return {
    state: "newer",
    version: body.version,
    artifact: asset.name,
    asset,
  };
}

function noticeFor(result) {
  if (result.state === "newer") {
    return {
      mode: "notify",
      title: "Update available",
      body: `Version ${result.version} is ready to download.`,
      action: "upgrade",
    };
  }
  if (result.state === "unavailable") {
    return {
      mode: "notify",
      title: "Update not available for this system",
      body: result.message || "No update package is available for this system",
    };
  }
  if (result.state === "rejected") {
    return {
      mode: "notify",
      title: "Update rejected",
      body: result.message || "The update failed integrity or signature checks",
    };
  }
  if (result.state === "error") {
    return {
      mode: "notify",
      title: "Update check failed",
      body: result.message || "Doorway could not be reached",
    };
  }
  return null;
}

function launch(file, platform, spawnImpl) {
  if (platform === "win32") {
    return spawnDetached(file, [], spawnImpl);
  }
  if (platform === "darwin") {
    // Prefer opening a .dmg / .app / zip via Launch Services.
    return spawnDetached("open", [file], spawnImpl);
  }
  if (platform === "linux") {
    return spawnDetached(file, [], spawnImpl, { chmod: true });
  }
  return Promise.resolve({
    ok: false,
    error: `Updates are not supported on platform ${platform}`,
  });
}

function spawnDetached(command, args, spawnImpl, options = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      if (options.chmod) {
        try {
          const fs = require("node:fs");
          fs.chmodSync(command, 0o755);
        } catch {
          // Best-effort executable bit for AppImage; launch may still fail clearly.
        }
      }
      child = spawnImpl(command, args, { detached: true, stdio: "ignore" });
    } catch (error) {
      resolve({ ok: false, error: error.message });
      return;
    }
    child.once("error", (error) => {
      resolve({ ok: false, error: error.message || "The update launcher did not start" });
    });
    child.once("spawn", () => {
      child.unref();
      resolve({ ok: true, file: command === "open" ? args[0] : command });
    });
  });
}

function confirmCopy(platform = process.platform) {
  const label = platformLabel(platform) || "this system";
  return {
    title: "Upgrade Studio?",
    body: `Studio will close after the ${label} update package starts.`,
    confirmLabel: "Upgrade",
    cancelLabel: "Not now",
  };
}

async function confirmUpgrade(confirm, apply, platform = process.platform) {
  const accepted = await confirm(confirmCopy(platform));
  if (!accepted) {
    return { ok: false, declined: true };
  }
  return apply();
}

module.exports = {
  parseSemver,
  compareSemver,
  platformAssetKey,
  selectPlatformAsset,
  interpret,
  noticeFor,
  confirmUpgrade,
  confirmCopy,
  launch,
  platformLabel,
};
