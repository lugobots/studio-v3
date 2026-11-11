"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

/** Canonical public repo for Studio V3 release assets. */
const CANONICAL_REPO = {
  owner: "lugobots",
  name: "studio-v3",
};

const RELEASE_DOWNLOAD_HOST = "github.com";
const RELEASE_CDN_HOSTS = new Set([
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);

/** Enrolled Linux release-key fingerprint (docs/signing.md). Env overrides for rotation drills. */
const LINUX_GPG_FINGERPRINT = "31E53F0DC46B2CC0A64AA08A511EB233AE342775";

/** Publisher identity pins — Win/macOS stay empty until paid signing is enrolled. */
const EXPECTED_PUBLISHER = {
  win32: process.env.LUGO_STUDIO_WIN_PUBLISHER || "",
  darwin: process.env.LUGO_STUDIO_MAC_TEAM_ID || "",
  linux: process.env.LUGO_STUDIO_GPG_FINGERPRINT || LINUX_GPG_FINGERPRINT,
};

function expectedPublisherFor(platform) {
  if (platform === "linux") {
    return process.env.LUGO_STUDIO_GPG_FINGERPRINT || LINUX_GPG_FINGERPRINT;
  }
  if (platform === "win32") {
    return process.env.LUGO_STUDIO_WIN_PUBLISHER || "";
  }
  if (platform === "darwin") {
    return process.env.LUGO_STUDIO_MAC_TEAM_ID || "";
  }
  return "";
}

function bundledPublicKeyPath() {
  return path.join(__dirname, "../../../../docs/keys/studio-v3-release.asc");
}

/**
 * gpg is an external process and cannot read files inside Electron's asar archive.
 * Node fs can, so copy the bundled key to a real temp path before --import.
 */
function materializeBundledPublicKey(sourcePath) {
  const bytes = fs.readFileSync(sourcePath);
  const dest = path.join(
    os.tmpdir(),
    `lugo-studio-release-${process.pid}-${Date.now()}.asc`,
  );
  fs.writeFileSync(dest, bytes);
  return dest;
}

function releaseDownloadPrefix() {
  return `https://${RELEASE_DOWNLOAD_HOST}/${CANONICAL_REPO.owner}/${CANONICAL_REPO.name}/releases/download/`;
}

function parseUrl(value) {
  try {
    return new URL(String(value || ""));
  } catch {
    return null;
  }
}

function isHttps(url) {
  return Boolean(url && url.protocol === "https:");
}

/**
 * Initial download URLs MUST be GitHub Release asset links for this repo.
 * Doorway/S3/website hosts are rejected.
 */
function isAllowlistedReleaseAssetUrl(value) {
  const url = parseUrl(value);
  if (!isHttps(url)) {
    return false;
  }
  if (url.hostname.toLowerCase() !== RELEASE_DOWNLOAD_HOST) {
    return false;
  }
  const prefix = `/${CANONICAL_REPO.owner}/${CANONICAL_REPO.name}/releases/download/`;
  return url.pathname.startsWith(prefix) && url.pathname.length > prefix.length;
}

/**
 * After GitHub redirects, the final URL may be on GitHub's release CDN.
 * Arbitrary hosts (including Doorway) remain rejected.
 */
function isAllowlistedRedirectTarget(value) {
  if (isAllowlistedReleaseAssetUrl(value)) {
    return true;
  }
  const url = parseUrl(value);
  if (!isHttps(url)) {
    return false;
  }
  return RELEASE_CDN_HOSTS.has(url.hostname.toLowerCase());
}

function assertAllowlistedDownloadUrl(value) {
  if (!isAllowlistedReleaseAssetUrl(value)) {
    throw new Error(
      "Update download URL is not an allowlisted GitHub Release asset for lugobots/studio-v3",
    );
  }
}

function assertAllowlistedFinalUrl(value) {
  if (!isAllowlistedRedirectTarget(value)) {
    throw new Error("Update download redirected off the GitHub Releases allowlist");
  }
}

function normalizeSha256(value) {
  const hex = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^sha256:/, "");
  if (!/^[a-f0-9]{64}$/.test(hex)) {
    return null;
  }
  return hex;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function verifySha256(filePath, expected) {
  const want = normalizeSha256(expected);
  if (!want) {
    return { ok: false, error: "Update metadata is missing a valid SHA-256 digest" };
  }
  const got = sha256File(filePath);
  if (got !== want) {
    return {
      ok: false,
      error: "Downloaded update failed SHA-256 verification",
      expected: want,
      actual: got,
    };
  }
  return { ok: true, sha256: got };
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error,
  };
}

function verifyWindowsSignature(filePath, expectedPublisher) {
  const ps = [
    "$ErrorActionPreference = 'Stop'",
    `$sig = Get-AuthenticodeSignature -FilePath '${String(filePath).replace(/'/g, "''")}'`,
    "if ($sig.Status -ne 'Valid') { Write-Output ('STATUS=' + $sig.Status); exit 2 }",
    "Write-Output ('SUBJECT=' + $sig.SignerCertificate.Subject)",
  ].join("; ");
  const result = runCommand("powershell.exe", ["-NoProfile", "-Command", ps]);
  if (result.error) {
    return { ok: false, error: result.error.message };
  }
  if (result.status !== 0) {
    return { ok: false, error: "Windows Authenticode signature is missing or invalid" };
  }
  const subjectLine = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("SUBJECT="));
  const subject = subjectLine ? subjectLine.slice("SUBJECT=".length) : "";
  if (expectedPublisher && !subject.includes(expectedPublisher)) {
    return {
      ok: false,
      error: "Windows publisher identity does not match the pinned Studio identity",
    };
  }
  if (!expectedPublisher) {
    return {
      ok: false,
      error: "Windows publisher pin is not configured; refusing unsigned trust path",
    };
  }
  return { ok: true, publisher: subject };
}

function verifyMacSignature(filePath, expectedTeamId) {
  const verify = runCommand("codesign", ["--verify", "--deep", "--strict", filePath]);
  if (verify.error) {
    return { ok: false, error: verify.error.message };
  }
  if (verify.status !== 0) {
    return { ok: false, error: "macOS codesign verification failed" };
  }
  if (!expectedTeamId) {
    return {
      ok: false,
      error: "macOS Team ID pin is not configured; refusing unsigned trust path",
    };
  }
  const info = runCommand("codesign", ["--display", "--verbose=2", filePath]);
  const blob = `${info.stdout}\n${info.stderr}`;
  if (!blob.includes(expectedTeamId)) {
    return {
      ok: false,
      error: "macOS Team ID does not match the pinned Studio identity",
    };
  }
  return { ok: true, teamId: expectedTeamId };
}

function verifyLinuxSignature(filePath, expectedFingerprint, signaturePath, options = {}) {
  const sigFile = signaturePath || `${filePath}.asc`;
  if (!fs.existsSync(sigFile)) {
    return { ok: false, error: "Linux update is missing a detached GPG signature (.asc)" };
  }
  if (!expectedFingerprint) {
    return {
      ok: false,
      error: "Linux GPG fingerprint pin is not configured; refusing unsigned trust path",
    };
  }
  const bundledKeyPath = options.publicKeyPath || bundledPublicKeyPath();
  if (!fs.existsSync(bundledKeyPath)) {
    return { ok: false, error: "Bundled Linux release public key is missing" };
  }

  const gnupgHome = fs.mkdtempSync(path.join(os.tmpdir(), "lugo-studio-gpg-"));
  let materializedKeyPath = null;
  try {
    materializedKeyPath = materializeBundledPublicKey(bundledKeyPath);
    const imported = runCommand("gpg", [
      "--batch",
      "--homedir",
      gnupgHome,
      "--import",
      materializedKeyPath,
    ]);
    if (imported.error) {
      return { ok: false, error: imported.error.message };
    }
    if (imported.status !== 0) {
      return { ok: false, error: "Failed to import bundled Linux release public key" };
    }

    const result = runCommand("gpg", [
      "--batch",
      "--homedir",
      gnupgHome,
      "--status-fd",
      "1",
      "--verify",
      sigFile,
      filePath,
    ]);
    if (result.error) {
      return { ok: false, error: result.error.message };
    }
    if (result.status !== 0) {
      return { ok: false, error: "Linux GPG signature verification failed" };
    }
    const normalized = expectedFingerprint.replace(/\s+/g, "").toUpperCase();
    const statusBlob = `${result.stdout}\n${result.stderr}`.toUpperCase();
    const good =
      /\[GNUPG:\]\s+GOODSIG\b/.test(statusBlob) || /\[GNUPG:\]\s+VALIDSIG\b/.test(statusBlob);
    if (!good) {
      return { ok: false, error: "Linux GPG signature verification failed" };
    }
    if (!statusBlob.includes(normalized)) {
      return {
        ok: false,
        error: "Linux GPG fingerprint does not match the pinned Studio identity",
      };
    }
    return { ok: true, fingerprint: expectedFingerprint };
  } finally {
    try {
      fs.rmSync(gnupgHome, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    if (materializedKeyPath) {
      try {
        fs.unlinkSync(materializedKeyPath);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

async function verifyPublisherSignature(filePath, platform = process.platform, options = {}) {
  if (typeof options.verifyImpl === "function") {
    return options.verifyImpl(filePath, platform, options);
  }
  const expected = options.expectedPublisher || expectedPublisherFor(platform);
  if (platform === "win32") {
    return verifyWindowsSignature(filePath, expected);
  }
  if (platform === "darwin") {
    return verifyMacSignature(filePath, expected);
  }
  if (platform === "linux") {
    return verifyLinuxSignature(filePath, expected, options.signaturePath, options);
  }
  return { ok: false, error: `Unsupported platform for signature verification: ${platform}` };
}

async function readResponseBytes(response, onProgress) {
  const totalHeader = Number(response.headers?.get?.("content-length") || 0);
  const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : 0;
  const report = (received, done = false) => {
    if (typeof onProgress !== "function") {
      return;
    }
    const percent =
      total > 0
        ? Math.min(done ? 100 : 99, Math.round((received / total) * 100))
        : done
          ? 100
          : null;
    onProgress({ received, total, percent });
  };

  const body = response.body;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      received += chunk.length;
      report(received, false);
    }
    report(received, true);
    return Buffer.concat(chunks);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  report(bytes.length, true);
  return bytes;
}

/**
 * Follow redirects manually so every hop stays on the allowlist.
 */
async function downloadAllowlisted(url, fetchImpl = global.fetch, options = {}) {
  assertAllowlistedDownloadUrl(url);
  const maxRedirects = options.maxRedirects ?? 5;
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const response = await fetchImpl(current, { redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("Update download redirect was missing a Location header");
      }
      current = new URL(location, current).toString();
      assertAllowlistedFinalUrl(current);
      // After the first hop, CDN URLs are allowed; still forbid Doorway/etc.
      continue;
    }
    if (!response.ok) {
      throw new Error(`Download failed (${response.status})`);
    }
    assertAllowlistedFinalUrl(response.url || current);
    const bytes = await readResponseBytes(response, options.onProgress);
    return { bytes, finalUrl: response.url || current };
  }
  throw new Error("Update download exceeded redirect limit");
}

function writeUpdateFile(directory, name, bytes) {
  const safeName = path.basename(String(name || ""));
  if (!safeName || safeName === "." || safeName === "..") {
    throw new Error("Update asset name is missing");
  }
  fs.mkdirSync(directory, { recursive: true });
  const destination = path.join(directory, safeName);
  fs.writeFileSync(destination, bytes);
  return destination;
}

module.exports = {
  CANONICAL_REPO,
  EXPECTED_PUBLISHER,
  LINUX_GPG_FINGERPRINT,
  expectedPublisherFor,
  bundledPublicKeyPath,
  materializeBundledPublicKey,
  releaseDownloadPrefix,
  isAllowlistedReleaseAssetUrl,
  isAllowlistedRedirectTarget,
  assertAllowlistedDownloadUrl,
  assertAllowlistedFinalUrl,
  normalizeSha256,
  sha256File,
  verifySha256,
  verifyLinuxSignature,
  verifyPublisherSignature,
  downloadAllowlisted,
  writeUpdateFile,
};
