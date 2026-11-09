"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const { LEVEL1_IMAGE_BINARY_PATH } = require("../config/store");

/**
 * True when the host cache already has a non-empty Level-1 binary file.
 */
function isCachedBinary(hostBinaryPath, fsImpl = fs) {
  try {
    const stat = fsImpl.statSync(hostBinaryPath);
    return stat.isFile() && stat.size > 0;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function markExecutable(hostBinaryPath, fsImpl = fs) {
  try {
    fsImpl.chmodSync(hostBinaryPath, 0o755);
  } catch (error) {
    // Windows may ignore mode bits; still require the file to exist for callers.
    if (process.platform !== "win32") {
      throw error;
    }
  }
}

function isExecutableFile(hostBinaryPath, fsImpl = fs) {
  const stat = fsImpl.statSync(hostBinaryPath);
  if (!stat.isFile() || stat.size === 0) {
    return false;
  }
  if (process.platform === "win32") {
    return true;
  }
  // Owner/group/other execute bit after chmod +x.
  return (stat.mode & 0o111) !== 0;
}

function tempContainerName() {
  return `lugo-studio-level1-${crypto.randomBytes(6).toString("hex")}`;
}

function dockerError(result, fallback) {
  return (result?.stderr || result?.stdout || fallback).trim() || fallback;
}

/**
 * Ensure the configured Level-1 image is local and extract `/bin/my-bot` into the
 * host cache path from `level1Resolved`. Reuses a non-empty cache file when present.
 *
 * @param {object} options
 * @param {{ ref: string, hostBinaryPath: string, cacheDir: string, imageBinaryPath?: string }} options.resolved
 * @param {(args: string[], timeout?: number) => Promise<{ok:boolean,stdout:string,stderr:string}>} options.execDocker
 * @param {typeof fs} [options.fsImpl]
 * @param {() => string} [options.createTempName]
 */
async function ensureLevel1Binary({
  resolved,
  execDocker,
  fsImpl = fs,
  createTempName = tempContainerName,
}) {
  if (!resolved || typeof resolved.ref !== "string" || !resolved.ref) {
    return { ok: false, error: "Level-1 image:tag is not configured" };
  }
  if (!resolved.hostBinaryPath || !resolved.cacheDir) {
    return { ok: false, error: "Level-1 cache path is not configured" };
  }

  const imageBinaryPath = resolved.imageBinaryPath || LEVEL1_IMAGE_BINARY_PATH;
  const hostBinaryPath = resolved.hostBinaryPath;

  if (isCachedBinary(hostBinaryPath, fsImpl)) {
    markExecutable(hostBinaryPath, fsImpl);
    if (!isExecutableFile(hostBinaryPath, fsImpl)) {
      return {
        ok: false,
        error: `Level-1 cache file is not executable: ${hostBinaryPath}`,
        hostBinaryPath,
        cached: true,
      };
    }
    return {
      ok: true,
      hostBinaryPath,
      containerBinaryPath: resolved.containerBinaryPath,
      ref: resolved.ref,
      cached: true,
      pulled: false,
    };
  }

  const inspected = await execDocker(["image", "inspect", resolved.ref], 15000);
  let pulled = false;
  if (!inspected.ok) {
    const pulledResult = await execDocker(["pull", resolved.ref], 600000);
    if (!pulledResult.ok) {
      return {
        ok: false,
        error: `Could not pull Level-1 image ${resolved.ref}: ${dockerError(pulledResult, "pull failed")}`,
        ref: resolved.ref,
        pulled: false,
      };
    }
    pulled = true;
  }

  fsImpl.mkdirSync(resolved.cacheDir, { recursive: true });

  const containerName = createTempName();
  const created = await execDocker(["create", "--name", containerName, resolved.ref], 60000);
  if (!created.ok) {
    return {
      ok: false,
      error: `Could not create Level-1 extract container from ${resolved.ref}: ${dockerError(created, "create failed")}`,
      ref: resolved.ref,
      pulled,
    };
  }

  try {
    const copied = await execDocker(
      ["cp", `${containerName}:${imageBinaryPath}`, hostBinaryPath],
      60000,
    );
    if (!copied.ok) {
      return {
        ok: false,
        error: `Could not extract Level-1 binary from ${resolved.ref}:${imageBinaryPath}: ${dockerError(copied, "docker cp failed")}`,
        ref: resolved.ref,
        pulled,
      };
    }
  } finally {
    await execDocker(["rm", "-f", containerName], 20000);
  }

  if (!isCachedBinary(hostBinaryPath, fsImpl)) {
    return {
      ok: false,
      error: `Level-1 extract did not produce a binary at ${hostBinaryPath}`,
      ref: resolved.ref,
      pulled,
    };
  }

  markExecutable(hostBinaryPath, fsImpl);
  if (!isExecutableFile(hostBinaryPath, fsImpl)) {
    return {
      ok: false,
      error: `Level-1 binary is not executable: ${hostBinaryPath}`,
      hostBinaryPath,
      ref: resolved.ref,
      pulled,
    };
  }

  return {
    ok: true,
    hostBinaryPath,
    containerBinaryPath: resolved.containerBinaryPath,
    ref: resolved.ref,
    cached: false,
    pulled,
  };
}

module.exports = {
  ensureLevel1Binary,
  isCachedBinary,
  isExecutableFile,
  markExecutable,
  tempContainerName,
};
