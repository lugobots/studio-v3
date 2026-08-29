"use strict";

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { createServer } = require("../../../../mock-update-server/server");
const {
  CHECK_PATH,
  MOCK_UPDATE_ORIGIN,
  PRODUCTION_UPDATE_ORIGIN,
} = require("./constants");
const {
  buildCheckUrl,
  getUpdatesDir,
  isSafeUpdateFileName,
  isSameOrigin,
  mapCheckResponse,
  resolveDownloadUrl,
} = require("./helpers");
const { createUpdaterService } = require("./index");

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

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function makeTemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function listenEphemeral(server) {
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      const addr = server.address();
      resolve(`http://127.0.0.1:${addr.port}`);
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

async function unusedOrigin() {
  const server = http.createServer();
  const origin = await listenEphemeral(server);
  await closeServer(server);
  return origin;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function makeService(appDataPath, extra = {}) {
  const logs = [];
  const service = createUpdaterService({
    getAppDataPath: () => appDataPath,
    getAppVersion: () => extra.appVersion || "0.1.0",
    getPlatform: () => extra.platform || "win32",
    getFeedOrigin: extra.getFeedOrigin || (typeof extra.feedOrigin === "string" ? () => extra.feedOrigin : undefined),
    isPackaged: extra.isPackaged,
    httpGetJson: extra.httpGetJson,
    httpDownload: extra.httpDownload,
    log: (message) => logs.push(String(message)),
    onProgress: extra.onProgress,
  });
  return { service, logs };
}

async function runTests() {
  console.log("== helpers ==");
  assert(isSafeUpdateFileName("Lugo-Studio-Windows-9.9.9.exe") === true, "release basename is allowed");
  assert(isSafeUpdateFileName("../evil.exe") === false, "relative parent fileName is rejected");
  assert(isSafeUpdateFileName("..\\evil.exe") === false, "backslash parent fileName is rejected");
  assert(isSafeUpdateFileName("foo/bar.exe") === false, "slashed fileName is rejected");
  assert(isSafeUpdateFileName("foo\\bar.exe") === false, "backslash fileName is rejected");
  assert(isSafeUpdateFileName("..") === false, "'..' is rejected");
  assert(isSameOrigin("http://127.0.0.1:47821/api/studio/download/x", "http://127.0.0.1:47821") === true, "same origin matches");
  assert(
    isSameOrigin("http://example.com/Lugo-Studio-Windows-9.9.9.exe", "http://127.0.0.1:47821") === false,
    "different host is not same-origin"
  );
  assert(
    resolveDownloadUrl(
      { fileName: "Lugo-Studio-Windows-9.9.9.exe", downloadPath: "http://example.com/x.exe" },
      MOCK_UPDATE_ORIGIN
    ) == null,
    "absolute cross-origin downloadPath is rejected"
  );
  assert(
    mapCheckResponse(
      {
        available: true,
        version: "9.9.9",
        fileName: "Lugo-Studio-Windows-9.9.9.exe",
        downloadPath: "/api/studio/download/Lugo-Studio-Windows-9.9.9.exe",
        sizeBytes: 12,
      },
      MOCK_UPDATE_ORIGIN
    ).available === true,
    "safe mock payload maps to available"
  );
  assert(
    mapCheckResponse(
      {
        available: true,
        version: "9.9.9",
        fileName: "../evil.exe",
        downloadPath: "/api/studio/download/../evil.exe",
        sizeBytes: 10,
      },
      MOCK_UPDATE_ORIGIN
    ).available === false,
    "path-traversal fileName maps to unavailable"
  );
  assert(
    mapCheckResponse(
      {
        available: true,
        version: "9.9.9",
        fileName: "Lugo-Studio-Windows-9.9.9.exe",
        downloadPath: "https://evil.example/Lugo-Studio-Windows-9.9.9.exe",
        sizeBytes: 10,
      },
      MOCK_UPDATE_ORIGIN
    ).available === false,
    "cross-origin download URL maps to unavailable"
  );
  assert(CHECK_PATH === "/api/studio/check-update", "check path matches the mock");
  assert(PRODUCTION_UPDATE_ORIGIN === "", "production feed origin is an empty TBD placeholder");
  assert(
    buildCheckUrl(MOCK_UPDATE_ORIGIN, "0.1.0", "win32").includes("currentVersion=0.1.0") &&
      buildCheckUrl(MOCK_UPDATE_ORIGIN, "0.1.0", "win32").includes("platform=win32"),
    "check URL includes currentVersion and platform"
  );

  console.log("\n== mock not running ==");
  const downDir = makeTemp("studio-v3-updater-down-");
  try {
    const origin = await unusedOrigin();
    const { service, logs } = makeService(downDir, { feedOrigin: origin });
    const info = await service.check();
    assert(info.available === false, "unreachable feed returns available false");
    assert(info.fileName == null, "unreachable feed has no fileName");
    assert(
      logs.some((line) => line.includes("unreachable") || line.includes("failed")),
      "unreachable feed logs a warning"
    );
  } finally {
    fs.rmSync(downDir, { recursive: true, force: true });
  }

  console.log("\n== newer file advertised + download writes bytes ==");
  const releaseDir = makeTemp("studio-v3-updater-rel-");
  const appDataDir = makeTemp("studio-v3-updater-app-");
  const fileName = "Lugo-Studio-Windows-9.9.9.exe";
  const payload = "dummy-update-bytes";
  fs.writeFileSync(path.join(releaseDir, fileName), payload);
  const mock = createServer(releaseDir);
  try {
    const origin = await listenEphemeral(mock);
    const { service } = makeService(appDataDir, { feedOrigin: origin });
    const info = await service.check();
    assert(info.available === true, "newer drop file is advertised");
    assert(info.fileName === fileName, "advertised fileName matches the drop file");
    assert(info.version === "9.9.9", "advertised version is 9.9.9");
    assert(info.sizeBytes === payload.length, "sizeBytes matches the drop file");

    const result = await service.download();
    assert(result.ok === true, "download reports ok");
    const dest = path.join(getUpdatesDir(appDataDir), fileName);
    assert(result.path === dest, "download returns the destination path");
    assert(fs.existsSync(dest), "downloaded file exists under updates/");
    assert(fs.readFileSync(dest, "utf8") === payload, "downloaded bytes match the advertised file");

    const again = await service.download();
    assert(again.ok === true, "re-download overwrites the same file");
    assert(fs.readFileSync(dest, "utf8") === payload, "overwritten file still matches");
  } finally {
    await closeServer(mock).catch(() => {});
    fs.rmSync(releaseDir, { recursive: true, force: true });
    fs.rmSync(appDataDir, { recursive: true, force: true });
  }

  console.log("\n== path traversal fileName rejected ==");
  const traverseDir = makeTemp("studio-v3-updater-trav-");
  try {
    const { service } = makeService(traverseDir, {
      feedOrigin: MOCK_UPDATE_ORIGIN,
      httpGetJson: async () => ({
        available: true,
        version: "9.9.9",
        fileName: "../evil.exe",
        downloadPath: "/api/studio/download/../evil.exe",
        sizeBytes: 4,
      }),
    });
    const info = await service.check();
    assert(info.available === false, "traversal fileName is not advertised");
    const result = await service.download();
    assert(result.ok !== true, "download refuses when check did not advertise a file");
    const updatesDir = getUpdatesDir(traverseDir);
    const leaked = path.join(path.dirname(updatesDir), "evil.exe");
    assert(fs.existsSync(leaked) === false, "parent-folder file was not written");
  } finally {
    fs.rmSync(traverseDir, { recursive: true, force: true });
  }

  console.log("\n== same-origin download URL required ==");
  const originDir = makeTemp("studio-v3-updater-origin-");
  try {
    const { service } = makeService(originDir, {
      feedOrigin: MOCK_UPDATE_ORIGIN,
      httpGetJson: async () => ({
        available: true,
        version: "9.9.9",
        fileName: "Lugo-Studio-Windows-9.9.9.exe",
        downloadPath: "http://example.com/Lugo-Studio-Windows-9.9.9.exe",
        sizeBytes: 8,
      }),
      httpDownload: async () => {
        throw new Error("httpDownload should not run for a cross-origin URL");
      },
    });
    const info = await service.check();
    assert(info.available === false, "cross-origin downloadPath is treated as no update");
    const result = await service.download();
    assert(result.ok !== true, "download does not start for a cross-origin advertisement");
  } finally {
    fs.rmSync(originDir, { recursive: true, force: true });
  }

  const redirectAppData = makeTemp("studio-v3-updater-redir-");
  const redirectServer = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/api/studio/check-update") {
      sendJson(res, 200, {
        available: true,
        version: "9.9.9",
        fileName: "Lugo-Studio-Windows-9.9.9.exe",
        downloadPath: "/api/studio/download/Lugo-Studio-Windows-9.9.9.exe",
        sizeBytes: 4,
      });
      return;
    }
    if (url.pathname === "/api/studio/download/Lugo-Studio-Windows-9.9.9.exe") {
      res.writeHead(302, { Location: "http://example.com/malware.exe" });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  try {
    const origin = await listenEphemeral(redirectServer);
    const { service } = makeService(redirectAppData, { feedOrigin: origin });
    const info = await service.check();
    assert(info.available === true, "check succeeds before a cross-origin redirect");
    const result = await service.download();
    assert(result.ok !== true, "redirect to another host fails the download");
    assert(
      typeof result.error === "string" && /same-origin/i.test(result.error),
      "cross-origin redirect error mentions same-origin"
    );
    assert(
      fs.existsSync(path.join(getUpdatesDir(redirectAppData), "Lugo-Studio-Windows-9.9.9.exe")) === false,
      "failed cross-origin download does not leave a file"
    );
  } finally {
    await closeServer(redirectServer).catch(() => {});
    fs.rmSync(redirectAppData, { recursive: true, force: true });
  }

  console.log("\n== cancel deletes partial ==");
  const cancelAppData = makeTemp("studio-v3-updater-cancel-");
  const cancelName = "Lugo-Studio-Windows-9.9.9.exe";
  const cancelServer = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/api/studio/check-update") {
      sendJson(res, 200, {
        available: true,
        version: "9.9.9",
        fileName: cancelName,
        downloadPath: `/api/studio/download/${cancelName}`,
        sizeBytes: 1024 * 1024,
      });
      return;
    }
    if (url.pathname === `/api/studio/download/${cancelName}`) {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": 1024 * 1024,
      });
      const chunk = Buffer.alloc(16 * 1024, 1);
      const writeMore = () => {
        if (res.writableEnded || res.destroyed) {
          return;
        }
        res.write(chunk, () => {
          setTimeout(writeMore, 25);
        });
      };
      writeMore();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  try {
    const origin = await listenEphemeral(cancelServer);
    const progress = [];
    const { service } = makeService(cancelAppData, {
      feedOrigin: origin,
      onProgress: (payload) => progress.push(payload),
    });
    const info = await service.check();
    assert(info.available === true, "slow download is advertised");
    const dest = path.join(getUpdatesDir(cancelAppData), cancelName);
    const downloadPromise = service.download();
    const started = Date.now();
    while (progress.length === 0 && Date.now() - started < 5000) {
      await delay(20);
    }
    assert(progress.length > 0, "progress events fire before cancel");
    const cancelResult = service.cancel();
    assert(cancelResult.cancelled === true, "cancel reports cancelled");
    const result = await downloadPromise;
    assert(result.cancelled === true, "download result is cancelled");
    assert(result.ok !== true, "cancelled download is not ok");
    await delay(50);
    assert(fs.existsSync(dest) === false, "partial file is deleted after cancel");
  } finally {
    await closeServer(cancelServer).catch(() => {});
    fs.rmSync(cancelAppData, { recursive: true, force: true });
  }

  console.log("\n== packaged production placeholder does not hit the network ==");
  const packagedDir = makeTemp("studio-v3-updater-prod-");
  try {
    let jsonCalls = 0;
    const { service } = makeService(packagedDir, {
      isPackaged: true,
      httpGetJson: async () => {
        jsonCalls += 1;
        throw new Error("should not be called when production origin is TBD");
      },
    });
    const info = await service.check();
    assert(info.available === false, "packaged build with TBD origin has no update");
    assert(jsonCalls === 0, "packaged TBD origin does not call the feed");
  } finally {
    fs.rmSync(packagedDir, { recursive: true, force: true });
  }
}

runTests()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) {
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
