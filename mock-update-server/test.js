"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const {
  HOST,
  PORT,
  compareSemver,
  createServer,
  isSafeBasename,
  mapPlatform,
  parseReleaseFileName,
  parseSemver,
  pickLatest,
} = require("./server");

const BASE = `http://${HOST}:${PORT}`;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`ok  ${message}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${message}`);
  }
}

function deepEqual(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

async function request(pathname, options = {}) {
  const res = await fetch(`${BASE}${pathname}`, options);
  const buffer = Buffer.from(await res.arrayBuffer());
  let json = null;
  const type = res.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    json = JSON.parse(buffer.toString("utf8"));
  }
  return { status: res.status, buffer, json, headers: res.headers };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    server.once("error", onError);
    server.listen(PORT, HOST, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function spawnMain() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("spawned server did not exit (port should have been taken)"));
    }, 8000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function runUnitTests() {
  console.log("\n== unit ==");

  const windows = parseReleaseFileName("Lugo-Studio-Windows-0.2.0.exe");
  assert(windows && windows.platform === "Windows" && windows.version.raw === "0.2.0", "parse Windows 0.2.0.exe");

  const mac = parseReleaseFileName("Lugo-Studio-Mac-1.0.0.dmg");
  assert(mac && mac.platform === "Mac", "parse Mac dmg");

  const linux = parseReleaseFileName("Lugo-Studio-Linux-0.2.0.AppImage");
  assert(linux && linux.platform === "Linux" && linux.version.raw === "0.2.0", "parse Linux AppImage");

  const beta = parseReleaseFileName("Lugo-Studio-Windows-0.2.0-beta.1.exe");
  assert(beta && beta.version.raw === "0.2.0-beta.1", "parse prerelease version");

  assert(parseReleaseFileName("notes.txt") === null, "reject unparseable name");
  assert(parseReleaseFileName("Lugo-Studio-Windows-v0.2.0.exe") === null, "reject v-prefix version");
  assert(parseReleaseFileName("Lugo-Studio-Win-0.2.0.exe") === null, "reject unknown platform token");

  assert(mapPlatform("win32") === "Windows", "map win32");
  assert(mapPlatform("darwin") === "Mac", "map darwin");
  assert(mapPlatform("linux") === "Linux", "map linux");
  assert(mapPlatform("freebsd") === null, "reject unknown platform");

  const a = parseSemver("0.1.0");
  const b = parseSemver("0.2.0");
  const c = parseSemver("0.2.0-beta.1");
  const d = parseSemver("0.0.1");
  assert(a && b && compareSemver(b, a) > 0, "0.2.0 > 0.1.0");
  assert(c && b && compareSemver(b, c) > 0, "0.2.0 > 0.2.0-beta.1");
  assert(d && a && compareSemver(d, a) < 0, "0.0.1 < 0.1.0");
  assert(parseSemver("nope") === null, "reject invalid semver");

  const sameVersion = [
    parseReleaseFileName("Lugo-Studio-Windows-0.2.0.exe"),
    parseReleaseFileName("Lugo-Studio-Windows-0.2.0.zip"),
  ];
  const picked = pickLatest(sameVersion, "Windows", parseSemver("0.1.0"));
  assert(picked && picked.fileName === "Lugo-Studio-Windows-0.2.0.zip", "same version picks lexicographically last name");

  const mixed = [
    parseReleaseFileName("Lugo-Studio-Windows-0.3.0.exe"),
    parseReleaseFileName("Lugo-Studio-Windows-0.2.0.zip"),
    parseReleaseFileName("Lugo-Studio-Mac-9.9.9.dmg"),
  ];
  const highest = pickLatest(mixed, "Windows", parseSemver("0.1.0"));
  assert(highest && highest.fileName === "Lugo-Studio-Windows-0.3.0.exe", "highest semver for platform wins");

  const none = pickLatest(mixed, "Windows", parseSemver("0.3.0"));
  assert(none === null, "equal version is not advertised");

  assert(isSafeBasename("Lugo-Studio-Windows-9.9.9.exe") === true, "safe basename allowed");
  assert(isSafeBasename("../package.json") === false, "reject ../ traversal");
  assert(isSafeBasename("..\\package.json") === false, "reject ..\\ traversal");
  assert(isSafeBasename("a/b") === false, "reject nested path");
  assert(isSafeBasename("..") === false, "reject ..");
}

async function runHttpTests() {
  console.log("\n== http ==");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mock-update-server-"));
  const canaryPath = path.join(path.dirname(tmpDir), `canary-${path.basename(tmpDir)}.txt`);
  const canaryBody = Buffer.from("should-not-be-served");
  fs.writeFileSync(canaryPath, canaryBody);

  const server = createServer(tmpDir);
  try {
    await listen(server);
    const addr = server.address();
    assert(
      addr && addr.address === HOST && addr.port === PORT,
      `listens only on ${HOST}:${PORT}`
    );
  } catch (err) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(canaryPath, { force: true });
    throw new Error(
      `Could not bind ${HOST}:${PORT} (${err.message}). Stop the other process using that port and re-run.`
    );
  }

  try {
    const health = await request("/health");
    assert(health.status === 200 && health.json && health.json.ok === true, "GET /health returns success");

    const empty = await request("/api/studio/check-update?currentVersion=0.1.0&platform=win32");
    assert(empty.status === 200, "empty releases still HTTP 200");
    assert(
      deepEqual(empty.json, {
        available: false,
        version: null,
        fileName: null,
        downloadPath: null,
        sizeBytes: null,
      }),
      "empty releases → available:false with nulls"
    );

    const missingVersion = await request("/api/studio/check-update?platform=win32");
    assert(missingVersion.status === 400 && typeof missingVersion.json.error === "string", "missing currentVersion → 400");

    const badVersion = await request("/api/studio/check-update?currentVersion=not-a-version&platform=win32");
    assert(badVersion.status === 400, "invalid currentVersion → 400");

    const missingPlatform = await request("/api/studio/check-update?currentVersion=0.1.0");
    assert(missingPlatform.status === 400, "missing platform → 400");

    const badPlatform = await request("/api/studio/check-update?currentVersion=0.1.0&platform=solaris");
    assert(badPlatform.status === 400, "unknown platform → 400");

    const dummyName = "Lugo-Studio-Windows-9.9.9.exe";
    const dummyBytes = Buffer.from([0x4c, 0x75, 0x67, 0x6f, 0x00, 0xff, 0x0a, 0x39]);
    fs.writeFileSync(path.join(tmpDir, dummyName), dummyBytes);

    const newer = await request("/api/studio/check-update?currentVersion=0.1.0&platform=win32");
    assert(newer.status === 200 && newer.json.available === true, "9.9.9 advertised for win32 from 0.1.0");
    assert(newer.json.version === "9.9.9", "advertised version is 9.9.9");
    assert(newer.json.fileName === dummyName, "advertised fileName matches drop file");
    assert(newer.json.downloadPath === `/api/studio/download/${dummyName}`, "downloadPath is the download route");
    assert(newer.json.sizeBytes === dummyBytes.length, "sizeBytes matches file size");

    const oldName = "Lugo-Studio-Windows-0.0.1.exe";
    fs.writeFileSync(path.join(tmpDir, oldName), Buffer.from("old"));
    const stillNewer = await request("/api/studio/check-update?currentVersion=0.1.0&platform=win32");
    assert(stillNewer.json.available === true && stillNewer.json.version === "9.9.9", "0.0.1 does not replace 9.9.9");

    fs.unlinkSync(path.join(tmpDir, dummyName));
    const onlyOld = await request("/api/studio/check-update?currentVersion=0.1.0&platform=win32");
    assert(onlyOld.status === 200 && onlyOld.json.available === false, "file with version 0.0.1 is not advertised");

    fs.writeFileSync(path.join(tmpDir, dummyName), dummyBytes);
    const download = await request(`/api/studio/download/${dummyName}`);
    assert(download.status === 200, "download returns 200");
    assert((download.headers.get("content-type") || "").includes("octet-stream"), "download Content-Type is octet-stream");
    assert(download.buffer.equals(dummyBytes), "download returns exact bytes");

    const traversalPaths = [
      "/api/studio/download/../package.json",
      "/api/studio/download/..%2Fpackage.json",
      "/api/studio/download/%2e%2e%2fpackage.json",
      "/api/studio/download/..%5Cpackage.json",
      `/api/studio/download/${encodeURIComponent(path.basename(canaryPath))}`,
    ];
    for (const traversalPath of traversalPaths) {
      const traversal = await request(traversalPath);
      const leaked = traversal.buffer.equals(canaryBody);
      assert(traversal.status === 404 && !leaked, `path traversal 404: ${traversalPath}`);
    }

    const outside = await request("/api/studio/download/..%2F..%2F..%2FWindows%2Fwin.ini");
    assert(outside.status === 404, "download of an outside path is 404");

    fs.unlinkSync(path.join(tmpDir, dummyName));
    const duplicateA = "Lugo-Studio-Windows-2.0.0.exe";
    const duplicateB = "Lugo-Studio-Windows-2.0.0.zip";
    fs.writeFileSync(path.join(tmpDir, duplicateA), Buffer.from("exe"));
    fs.writeFileSync(path.join(tmpDir, duplicateB), Buffer.from("zip"));
    const duplicate = await request("/api/studio/check-update?currentVersion=0.1.0&platform=win32");
    assert(
      duplicate.json.fileName === duplicateB,
      "two files same platform+version → lexicographically last name"
    );

    console.log("\n== port already in use ==");
    const spawned = await spawnMain();
    assert(spawned.code === 1, "second process exits with code 1 when port is taken");
    assert(
      /already in use/.test(spawned.stderr) || /already in use/.test(spawned.stdout),
      "second process prints a clear port-in-use error"
    );
  } finally {
    await closeServer(server);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(canaryPath, { force: true });
  }
}

async function main() {
  runUnitTests();
  await runHttpTests();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
