"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const HOST = "127.0.0.1";
const PORT = 47821;

const PLATFORM_BY_NODE = Object.freeze({
  win32: "Windows",
  darwin: "Mac",
  linux: "Linux",
});

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const RELEASE_NAME_RE = /^Lugo-Studio-(Windows|Mac|Linux)-(.+)\.([^./\\]+)$/;

function parseSemver(input) {
  if (typeof input !== "string") {
    return null;
  }
  const match = input.match(SEMVER_RE);
  if (!match) {
    return null;
  }
  return {
    raw: input,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function comparePrereleaseIdentifiers(a, b) {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) {
    return Number(a) - Number(b);
  }
  if (aNumeric) {
    return -1;
  }
  if (bNumeric) {
    return 1;
  }
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function compareSemver(left, right) {
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  if (left.patch !== right.patch) {
    return left.patch - right.patch;
  }

  const leftPre = left.prerelease;
  const rightPre = right.prerelease;
  if (leftPre.length === 0 && rightPre.length === 0) {
    return 0;
  }
  if (leftPre.length === 0) {
    return 1;
  }
  if (rightPre.length === 0) {
    return -1;
  }

  const length = Math.max(leftPre.length, rightPre.length);
  for (let i = 0; i < length; i += 1) {
    const a = leftPre[i];
    const b = rightPre[i];
    if (a === undefined) {
      return -1;
    }
    if (b === undefined) {
      return 1;
    }
    const diff = comparePrereleaseIdentifiers(a, b);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function parseReleaseFileName(fileName) {
  if (typeof fileName !== "string") {
    return null;
  }
  const match = fileName.match(RELEASE_NAME_RE);
  if (!match) {
    return null;
  }
  const version = parseSemver(match[2]);
  if (!version) {
    return null;
  }
  return {
    fileName,
    platform: match[1],
    version,
    ext: match[3],
  };
}

function mapPlatform(platform) {
  if (typeof platform !== "string") {
    return null;
  }
  return PLATFORM_BY_NODE[platform] || null;
}

function isSafeBasename(fileName) {
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

function pickLatest(parsedFiles, platformToken, currentVersion) {
  const winners = parsedFiles.filter((entry) => {
    if (entry.platform !== platformToken) {
      return false;
    }
    return compareSemver(entry.version, currentVersion) > 0;
  });

  winners.sort((a, b) => {
    const versionDiff = compareSemver(a.version, b.version);
    if (versionDiff !== 0) {
      return versionDiff;
    }
    if (a.fileName < b.fileName) {
      return -1;
    }
    if (a.fileName > b.fileName) {
      return 1;
    }
    return 0;
  });

  return winners.length > 0 ? winners[winners.length - 1] : null;
}

function listReleaseEntries(releasesDir) {
  let names;
  try {
    names = fs.readdirSync(releasesDir);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return [];
    }
    throw err;
  }

  const parsedFiles = [];
  for (const name of names) {
    if (name.startsWith(".")) {
      continue;
    }
    const fullPath = path.join(releasesDir, name);
    let stats;
    try {
      stats = fs.statSync(fullPath);
    } catch {
      continue;
    }
    if (!stats.isFile()) {
      continue;
    }
    const parsed = parseReleaseFileName(name);
    if (!parsed) {
      console.log(`ignored unparseable release name: ${name}`);
      continue;
    }
    parsedFiles.push(parsed);
  }
  return parsedFiles;
}

function findUpdate(releasesDir, currentVersion, platformToken) {
  const parsedFiles = listReleaseEntries(releasesDir);
  const winner = pickLatest(parsedFiles, platformToken, currentVersion);
  if (!winner) {
    return null;
  }
  const fullPath = path.join(releasesDir, winner.fileName);
  const stats = fs.statSync(fullPath);
  return {
    version: winner.version.raw,
    fileName: winner.fileName,
    sizeBytes: stats.size,
  };
}

function unavailableBody() {
  return {
    available: false,
    version: null,
    fileName: null,
    downloadPath: null,
    sizeBytes: null,
  };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendNotFound(res) {
  sendJson(res, 404, { error: "not found" });
}

function resolveDownloadTarget(releasesDir, fileName) {
  if (!isSafeBasename(fileName)) {
    return null;
  }

  const releasesRoot = path.resolve(releasesDir);
  const candidate = path.resolve(releasesRoot, fileName);
  if (path.dirname(candidate) !== releasesRoot) {
    return null;
  }

  let realRoot;
  let realFile;
  try {
    realRoot = fs.realpathSync(releasesRoot);
    realFile = fs.realpathSync(candidate);
  } catch {
    return null;
  }

  const rootPrefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
  if (realFile !== realRoot && !realFile.startsWith(rootPrefix)) {
    return null;
  }

  let stats;
  try {
    stats = fs.statSync(realFile);
  } catch {
    return null;
  }
  if (!stats.isFile()) {
    return null;
  }

  return { filePath: realFile, fileName, sizeBytes: stats.size };
}

function handleCheckUpdate(url, res, releasesDir) {
  const currentVersionRaw = url.searchParams.get("currentVersion");
  const platformRaw = url.searchParams.get("platform");

  if (currentVersionRaw === null || currentVersionRaw.trim() === "") {
    sendJson(res, 400, { error: "missing or invalid currentVersion" });
    return;
  }
  const currentVersion = parseSemver(currentVersionRaw.trim());
  if (!currentVersion) {
    sendJson(res, 400, { error: "missing or invalid currentVersion" });
    return;
  }

  if (platformRaw === null || platformRaw.trim() === "") {
    sendJson(res, 400, { error: "missing or unknown platform" });
    return;
  }
  const platformToken = mapPlatform(platformRaw.trim());
  if (!platformToken) {
    sendJson(res, 400, { error: "missing or unknown platform" });
    return;
  }

  const update = findUpdate(releasesDir, currentVersion, platformToken);
  if (!update) {
    console.log(
      `[check-update] platform=${platformRaw.trim()} currentVersion=${currentVersion.raw} available=false`
    );
    sendJson(res, 200, unavailableBody());
    return;
  }

  const downloadPath = `/api/studio/download/${update.fileName}`;
  console.log(
    `[check-update] platform=${platformRaw.trim()} currentVersion=${currentVersion.raw} available=true version=${update.version} fileName=${update.fileName}`
  );
  sendJson(res, 200, {
    available: true,
    version: update.version,
    fileName: update.fileName,
    downloadPath,
    sizeBytes: update.sizeBytes,
  });
}

function handleDownload(reqUrl, res, releasesDir) {
  const prefix = "/api/studio/download/";
  const rest = reqUrl.pathname.slice(prefix.length);
  let fileName = rest;
  try {
    fileName = decodeURIComponent(rest);
  } catch {
    console.log("[download] fileName=<invalid encoding> status=404");
    sendNotFound(res);
    return;
  }

  const target = resolveDownloadTarget(releasesDir, fileName);
  if (!target) {
    console.log(`[download] fileName=${fileName} status=404`);
    sendNotFound(res);
    return;
  }

  console.log(`[download] fileName=${target.fileName} status=200`);
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Length": target.sizeBytes,
    "Content-Disposition": `attachment; filename="${target.fileName}"`,
  });
  const stream = fs.createReadStream(target.filePath);
  stream.on("error", (err) => {
    console.log(`[download] fileName=${target.fileName} status=error ${err.message}`);
    res.destroy();
  });
  stream.pipe(res);
}

function handleRequest(req, res, releasesDir) {
  if (req.method !== "GET") {
    sendNotFound(res);
    return;
  }

  let reqUrl;
  try {
    reqUrl = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  } catch {
    sendNotFound(res);
    return;
  }

  if (reqUrl.pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (reqUrl.pathname === "/api/studio/check-update") {
    handleCheckUpdate(reqUrl, res, releasesDir);
    return;
  }

  if (reqUrl.pathname.startsWith("/api/studio/download/")) {
    handleDownload(reqUrl, res, releasesDir);
    return;
  }

  sendNotFound(res);
}

function defaultReleasesDir() {
  return path.join(__dirname, "releases");
}

function createServer(releasesDir) {
  const resolvedReleases = path.resolve(releasesDir);
  return http.createServer((req, res) => {
    try {
      handleRequest(req, res, resolvedReleases);
    } catch (err) {
      console.error(`request failed: ${err.message}`);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal error" });
      } else {
        res.destroy();
      }
    }
  });
}

function startServer(releasesDir = defaultReleasesDir()) {
  fs.mkdirSync(releasesDir, { recursive: true });
  const server = createServer(releasesDir);
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Failed to start: ${HOST}:${PORT} is already in use. This mock must bind that address and will not pick another port.`
      );
    } else {
      console.error(`Failed to start mock update server: ${err.message}`);
    }
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    console.log(`Mock update server listening on http://${HOST}:${PORT}`);
    console.log(`Release drop folder: ${path.resolve(releasesDir)}`);
  });
  return server;
}

if (require.main === module) {
  const server = startServer();
  const stop = () => {
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

module.exports = {
  HOST,
  PORT,
  compareSemver,
  createServer,
  defaultReleasesDir,
  isSafeBasename,
  mapPlatform,
  parseReleaseFileName,
  parseSemver,
  pickLatest,
  startServer,
};
