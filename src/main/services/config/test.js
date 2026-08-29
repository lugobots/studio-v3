"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createConfigService } = require("./store");
const {
  getUserDataFilePath,
  isBotValid,
  isUsableProjectPath,
} = require("./helpers");

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

function makeTempAppData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "studio-v3-config-"));
}

function makeService(appDataPath, options = {}) {
  const logs = [];
  const service = createConfigService({
    getAppDataPath: () => appDataPath,
    getAppVersion: () => options.appVersion || "0.1.0",
    generateInstallId: () => options.installId || "test-install-id",
    log: (message) => logs.push(message),
  });
  return { service, logs };
}

function writeUserJson(appDataPath, data) {
  const filePath = getUserDataFilePath(appDataPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  return filePath;
}

function makeValidBot(parentDir, name = "bot") {
  const folder = path.join(parentDir, name);
  fs.mkdirSync(path.join(folder, ".lugo"), { recursive: true });
  fs.writeFileSync(path.join(folder, ".lugo", "info.json"), JSON.stringify({ language: "js" }, null, 2));
  return folder;
}

function v1LikeData(overrides = {}) {
  return {
    install_unique_id: "v1-install-id",
    debug_mode: false,
    project_path: ".",
    team_side: "home",
    opponent_team: "level-0",
    game_speed: 1,
    saved_positions: [],
    compose_file: "",
    game_server_image: "lugobots/server",
    game_server_version: "v2",
    bot_level_0_image: "lugobots/level-0",
    bot_level_0_version: "v2",
    bot_level_1_image: "lugobots/level-1",
    bot_level_1_version: "v4",
    app_path: ".",
    app_version: "1.2.3",
    extra_from_v1: "keep-me",
    ...overrides,
  };
}

async function runTests() {
  console.log("== helpers ==");
  assert(isUsableProjectPath(".") === false, "'.' is not a usable project path");
  assert(isUsableProjectPath("") === false, "empty string is not a usable project path");
  assert(isUsableProjectPath("relative/bot") === false, "relative path is not usable");
  assert(isBotValid(".") === false, "isBotValid rejects '.'");

  console.log("\n== no user.json → projectCreated false ==");
  const missingDir = makeTempAppData();
  try {
    const { service } = makeService(missingDir);
    const result = await service.get();
    assert(result.projectCreated === false, "missing file → projectCreated false");
    assert(result.projectPath === null, "missing file → projectPath null");
    assert(fs.existsSync(getUserDataFilePath(missingDir)) === false, "get() does not create user.json");
  } finally {
    fs.rmSync(missingDir, { recursive: true, force: true });
  }

  console.log("\n== valid V1-like file + .lugo/info.json → projectCreated true ==");
  const validDir = makeTempAppData();
  try {
    const botFolder = makeValidBot(validDir);
    writeUserJson(validDir, v1LikeData({ project_path: botFolder }));
    const { service } = makeService(validDir, { appVersion: "0.1.0" });
    const result = await service.get();
    assert(result.projectCreated === true, "valid bot → projectCreated true");
    assert(result.projectPath === botFolder, "projectPath matches stored project_path");
    assert(result.project_path === botFolder, "stored project_path is returned");
    assert(result.extra_from_v1 === "keep-me", "unknown extra keys are preserved on get");
    assert(result.app_version === "0.1.0", "in-memory app_version is the running version");
    const onDisk = JSON.parse(fs.readFileSync(getUserDataFilePath(validDir), "utf8"));
    assert(onDisk.app_version === "1.2.3", "app_version refresh is not written until save");
  } finally {
    fs.rmSync(validDir, { recursive: true, force: true });
  }

  console.log("\n== missing .lugo/info.json → projectCreated false, file left intact ==");
  const invalidBotDir = makeTempAppData();
  try {
    const botFolder = path.join(invalidBotDir, "bot");
    fs.mkdirSync(botFolder, { recursive: true });
    const original = v1LikeData({ project_path: botFolder, debug_mode: true });
    const filePath = writeUserJson(invalidBotDir, original);
    const before = fs.readFileSync(filePath, "utf8");
    const { service } = makeService(invalidBotDir);
    const result = await service.get();
    assert(result.projectCreated === false, "missing .lugo/info.json → projectCreated false");
    assert(result.projectPath === null, "missing .lugo/info.json → projectPath null");
    assert(fs.readFileSync(filePath, "utf8") === before, "user.json left intact when bot is invalid");
  } finally {
    fs.rmSync(invalidBotDir, { recursive: true, force: true });
  }

  console.log("\n== config.set partial patch does not drop other keys ==");
  const patchDir = makeTempAppData();
  try {
    const botFolder = makeValidBot(patchDir);
    writeUserJson(
      patchDir,
      v1LikeData({
        project_path: botFolder,
        debug_mode: false,
        team_side: "away",
        extra_from_v1: "keep-me",
      })
    );
    const { service } = makeService(patchDir, { appVersion: "0.1.0" });
    const result = await service.set({ debug_mode: true, projectCreated: true });
    assert(result.projectCreated === true, "set keeps Q2 true when bot is still valid");
    const written = JSON.parse(fs.readFileSync(getUserDataFilePath(patchDir), "utf8"));
    assert(written.debug_mode === true, "patch applies debug_mode");
    assert(written.team_side === "away", "set does not drop team_side");
    assert(written.install_unique_id === "v1-install-id", "set does not drop install_unique_id");
    assert(written.project_path === botFolder, "set does not drop project_path");
    assert(written.extra_from_v1 === "keep-me", "set does not drop unknown extra keys");
    assert(!Object.prototype.hasOwnProperty.call(written, "projectCreated"), "projectCreated is not persisted");
    assert(written.app_version === "0.1.0", "save persists the refreshed app_version");
    assert(Object.keys(written).includes("game_server_image"), "known keys remain after partial set");
  } finally {
    fs.rmSync(patchDir, { recursive: true, force: true });
  }

  console.log("\n== invalid JSON does not crash ==");
  const corruptDir = makeTempAppData();
  try {
    const filePath = getUserDataFilePath(corruptDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const corruptBody = "{not json";
    fs.writeFileSync(filePath, corruptBody, "utf8");
    const { service, logs } = makeService(corruptDir);
    const result = await service.get();
    assert(result.projectCreated === false, "invalid JSON → projectCreated false");
    assert(result.projectPath === null, "invalid JSON → projectPath null");
    assert(fs.readFileSync(filePath, "utf8") === corruptBody, "corrupt file is not overwritten on get");
    assert(logs.some((line) => /Invalid JSON/.test(line)), "invalid JSON logs a line");
    const saved = await service.set({ debug_mode: true });
    assert(saved.error === undefined, "explicit save after invalid JSON does not return an error");
    const afterSave = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert(afterSave.debug_mode === true, "explicit save overwrites the corrupt file");
    assert(typeof afterSave.install_unique_id === "string", "explicit save writes a full V1 default object");
  } finally {
    fs.rmSync(corruptDir, { recursive: true, force: true });
  }

  console.log("\n== '.' project_path is Q2 no ==");
  const dotDir = makeTempAppData();
  try {
    makeValidBot(dotDir);
    writeUserJson(dotDir, v1LikeData({ project_path: "." }));
    const { service } = makeService(dotDir);
    const result = await service.get();
    assert(result.projectCreated === false, "'.' project_path → projectCreated false");
    assert(result.projectPath === null, "'.' project_path → projectPath null");
  } finally {
    fs.rmSync(dotDir, { recursive: true, force: true });
  }

  console.log("\n== extra coverage ==");
  const extraDir = makeTempAppData();
  try {
    const { service } = makeService(extraDir, { appVersion: "0.1.0", installId: "created-id" });
    const created = await service.set({ debugMode: true });
    const filePath = getUserDataFilePath(extraDir);
    assert(created.debug_mode === true, "renderer-friendly debugMode maps to debug_mode");
    assert(fs.existsSync(filePath), "set creates .LugoStudio/user.json under appData");
    assert(path.basename(path.dirname(filePath)) === ".LugoStudio", "writes into .LugoStudio, not Electron userData");
    const createdFile = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert(createdFile.install_unique_id === "created-id", "new file uses generated install_unique_id");
    assert(createdFile.game_speed === 1, "new file includes V1 defaults");
    assert(createdFile.project_path === ".", "new file default project_path is '.'");

    const relativeDir = makeTempAppData();
    try {
      writeUserJson(relativeDir, v1LikeData({ project_path: "relative/bot" }));
      const relativeService = makeService(relativeDir).service;
      const relativeResult = await relativeService.get();
      assert(relativeResult.projectCreated === false, "non-absolute project_path → Q2 no");
    } finally {
      fs.rmSync(relativeDir, { recursive: true, force: true });
    }

    const missingKeyDir = makeTempAppData();
    try {
      writeUserJson(missingKeyDir, {
        install_unique_id: "existing-id",
        project_path: ".",
        leftover_future_key: true,
      });
      const missingService = makeService(missingKeyDir).service;
      await missingService.set({ team_side: "away" });
      const merged = JSON.parse(fs.readFileSync(getUserDataFilePath(missingKeyDir), "utf8"));
      assert(merged.debug_mode === false, "missing known keys are filled from V1 defaults on save");
      assert(merged.leftover_future_key === true, "unknown extra keys survive fill-from-defaults");
      assert(merged.install_unique_id === "existing-id", "existing install_unique_id is left alone");
    } finally {
      fs.rmSync(missingKeyDir, { recursive: true, force: true });
    }

    const writeFailDir = makeTempAppData();
    try {
      const blockedPath = getUserDataFilePath(writeFailDir);
      fs.mkdirSync(blockedPath, { recursive: true });
      const failService = makeService(writeFailDir).service;
      const failResult = await failService.set({ debug_mode: true });
      assert(typeof failResult.error === "string" && failResult.error.length > 0, "write failure returns error through the set result");
      assert(failResult.projectCreated === false, "failed write still returns a config payload");
    } finally {
      fs.rmSync(writeFailDir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(extraDir, { recursive: true, force: true });
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
