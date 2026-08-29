"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createConfigService } = require("../config/store");
const { getUserDataFilePath } = require("../config/helpers");
const {
  COMPOSE_FILE_NAME,
  DIALOG_PROPERTIES,
  EMPTY_SELECTION_ERROR,
} = require("./constants");
const { createProjectService } = require("./index");

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

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeValidBot(parentDir, name = "bot") {
  const folder = path.join(parentDir, name);
  fs.mkdirSync(path.join(folder, ".lugo"), { recursive: true });
  fs.writeFileSync(path.join(folder, ".lugo", "info.json"), JSON.stringify({ language: "js" }, null, 2));
  return folder;
}

function makeInvalidBot(parentDir, name = "not-a-bot") {
  const folder = path.join(parentDir, name);
  fs.mkdirSync(path.join(folder, ".lugo"), { recursive: true });
  return folder;
}

function writeUserJson(appDataPath, data) {
  const filePath = getUserDataFilePath(appDataPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  return filePath;
}

function v1LikeData(overrides = {}) {
  return {
    install_unique_id: "v1-install-id",
    debug_mode: false,
    project_path: ".",
    team_side: "home",
    opponent_team: "level-0",
    game_speed: 3,
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

function wrapConfig(inner) {
  const calls = [];
  return {
    calls,
    config: {
      get: () => inner.get(),
      set: async (patch) => {
        calls.push(patch);
        return inner.set(patch);
      },
    },
  };
}

function makeService(options) {
  const inner = createConfigService({
    getAppDataPath: () => options.appDataPath,
    getAppVersion: () => options.appVersion || "0.1.0",
    generateInstallId: () => options.installId || "test-install-id",
    log: () => {},
  });
  const wrapped = wrapConfig(inner);
  const dialogCalls = [];
  const service = createProjectService({
    showOpenDialog: async (win, dialogOptions) => {
      dialogCalls.push({ win, dialogOptions });
      return options.showOpenDialog(win, dialogOptions);
    },
    getAppPath: () => options.appPath || "/injected/app",
    config: wrapped.config,
    log: () => {},
  });
  return { service, setCalls: wrapped.calls, dialogCalls };
}

async function withTempDirs(run) {
  const workDir = makeTempDir("studio-v3-project-work-");
  const appDataPath = makeTempDir("studio-v3-project-app-");
  try {
    await run({ workDir, appDataPath });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
}

async function runTests() {
  console.log("== valid bot folder writes user.json with project_path, compose_file, keeps extra keys ==");
  await withTempDirs(async ({ workDir, appDataPath }) => {
    const botFolder = makeValidBot(workDir);
    const infoPath = path.join(botFolder, ".lugo", "info.json");
    const infoBefore = fs.readFileSync(infoPath, "utf8");
    writeUserJson(appDataPath, v1LikeData());
    const { service, setCalls, dialogCalls } = makeService({
      appDataPath,
      installId: "should-not-replace",
      showOpenDialog: async () => ({ canceled: false, filePaths: [botFolder] }),
    });
    const result = await service.openExisting();
    assert(result && result.ok === true, "valid bot → ok");
    assert(result.cancelled !== true, "valid bot is not cancelled");
    assert(setCalls.length === 1, "valid bot writes settings once");
    const written = JSON.parse(fs.readFileSync(getUserDataFilePath(appDataPath), "utf8"));
    assert(written.project_path === botFolder, "project_path is the chosen folder");
    assert(written.compose_file === path.join(botFolder, COMPOSE_FILE_NAME), "compose_file is {folder}/docker-compose.yml");
    assert(fs.existsSync(path.join(botFolder, COMPOSE_FILE_NAME)) === false, "compose_file is set even when docker-compose.yml is missing");
    assert(written.extra_from_v1 === "keep-me", "unknown extra keys are preserved");
    assert(written.game_speed === 3, "existing game_speed is preserved");
    assert(written.install_unique_id === "v1-install-id", "existing install_unique_id is left alone");
    assert(written.app_path === "/injected/app", "app_path comes from app.getAppPath()");
    assert(written.app_version === "0.1.0", "app_version is the running version");
    assert(!Object.prototype.hasOwnProperty.call(written, "projectCreated"), "projectCreated is not persisted");
    assert(fs.readFileSync(infoPath, "utf8") === infoBefore, ".lugo/info.json is not rewritten");
    assert(fs.existsSync(path.join(botFolder, ".studio.env")) === false, "does not write .studio.env");
    assert(fs.existsSync(path.join(botFolder, ".studio")) === false, "does not copy compose into .studio/");
    const dialogOptions = dialogCalls[0] && dialogCalls[0].dialogOptions;
    assert(
      dialogCalls.length === 1 &&
        dialogOptions &&
        Array.isArray(dialogOptions.properties) &&
        dialogOptions.properties.length === 1 &&
        dialogOptions.properties[0] === "openDirectory",
      "folder picker is directory-only"
    );
  });

  console.log("\n== missing .lugo/info.json does not write a misleading project_path ==");
  await withTempDirs(async ({ workDir, appDataPath }) => {
    const invalidFolder = makeInvalidBot(workDir);
    const previousPath = path.join(workDir, "previous-dead-bot");
    const filePath = writeUserJson(appDataPath, v1LikeData({ project_path: previousPath }));
    const before = fs.readFileSync(filePath, "utf8");
    const { service, setCalls } = makeService({
      appDataPath,
      installId: "should-not-write",
      showOpenDialog: async () => ({ canceled: false, filePaths: [invalidFolder] }),
    });
    const result = await service.openExisting();
    assert(result && result.ok !== true, "invalid bot is not ok");
    assert(result.reason === "invalid", "invalid bot uses the invalid reason");
    assert(typeof result.error === "string" && result.error.includes(invalidFolder), "invalid bot error names the folder");
    assert(setCalls.length === 0, "invalid bot does not call config.set");
    assert(fs.readFileSync(filePath, "utf8") === before, "user.json is left intact when the folder is not a bot");
    const onDisk = JSON.parse(before);
    assert(onDisk.project_path === previousPath, "project_path is not replaced with the invalid folder");
  });

  await withTempDirs(async ({ workDir, appDataPath }) => {
    const invalidFolder = makeInvalidBot(workDir);
    const { service, setCalls } = makeService({
      appDataPath,
      installId: "should-not-write",
      showOpenDialog: async () => ({ canceled: false, filePaths: [invalidFolder] }),
    });
    const result = await service.openExisting();
    assert(result && result.reason === "invalid", "missing info.json → invalid");
    assert(setCalls.length === 0, "missing info.json does not call config.set");
    assert(fs.existsSync(getUserDataFilePath(appDataPath)) === false, "missing info.json does not create user.json");
  });

  console.log("\n== cancelled picker returns cancelled, no write ==");
  await withTempDirs(async ({ appDataPath }) => {
    const filePath = writeUserJson(appDataPath, v1LikeData());
    const before = fs.readFileSync(filePath, "utf8");
    const { service, setCalls } = makeService({
      appDataPath,
      installId: "should-not-write",
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    });
    const result = await service.openExisting();
    assert(result && result.cancelled === true, "cancelled picker → cancelled");
    assert(result.ok !== true, "cancelled picker is not ok");
    assert(result.error === undefined, "cancelled picker has no error string");
    assert(setCalls.length === 0, "cancelled picker does not call config.set");
    assert(fs.readFileSync(filePath, "utf8") === before, "cancelled picker does not write user.json");
  });

  console.log("\n== new file gets defaults then project fields ==");
  await withTempDirs(async ({ workDir, appDataPath }) => {
    const botFolder = makeValidBot(workDir);
    assert(fs.existsSync(getUserDataFilePath(appDataPath)) === false, "user.json does not exist yet");
    const { service } = makeService({
      appDataPath,
      installId: "created-install-id",
      showOpenDialog: async () => ({ canceled: false, filePaths: [botFolder] }),
    });
    const result = await service.openExisting();
    assert(result && result.ok === true, "new file + valid bot → ok");
    const written = JSON.parse(fs.readFileSync(getUserDataFilePath(appDataPath), "utf8"));
    assert(written.install_unique_id === "created-install-id", "new file generates install_unique_id");
    assert(written.debug_mode === false, "new file includes debug_mode default");
    assert(written.team_side === "home", "new file includes team_side default");
    assert(written.opponent_team === "level-0", "new file includes opponent_team default");
    assert(written.game_speed === 1, "new file includes game_speed default");
    assert(Array.isArray(written.saved_positions) && written.saved_positions.length === 0, "new file includes saved_positions default");
    assert(written.game_server_image === "lugobots/server", "new file includes game_server_image default");
    assert(written.game_server_version === "v2", "new file includes game_server_version default");
    assert(written.bot_level_0_image === "lugobots/level-0", "new file includes bot_level_0_image default");
    assert(written.bot_level_0_version === "v2", "new file includes bot_level_0_version default");
    assert(written.bot_level_1_image === "lugobots/level-1", "new file includes bot_level_1_image default");
    assert(written.bot_level_1_version === "v4", "new file includes bot_level_1_version default");
    assert(written.project_path === botFolder, "new file then sets project_path");
    assert(written.compose_file === path.join(botFolder, COMPOSE_FILE_NAME), "new file then sets compose_file");
    assert(written.app_path === "/injected/app", "new file then sets app_path");
    assert(written.app_version === "0.1.0", "new file then sets app_version");
  });

  console.log("\n== empty selection and write failure ==");
  await withTempDirs(async ({ appDataPath }) => {
    const { service, setCalls } = makeService({
      appDataPath,
      showOpenDialog: async () => ({ canceled: false, filePaths: [] }),
    });
    const result = await service.openExisting();
    assert(result && result.ok !== true, "empty selection is not ok");
    assert(result.cancelled !== true, "empty selection is not cancelled");
    assert(result.reason === "empty", "empty selection uses the empty reason");
    assert(result.error === EMPTY_SELECTION_ERROR, "empty selection has a stable error string");
    assert(setCalls.length === 0, "empty selection does not call config.set");
    assert(fs.existsSync(getUserDataFilePath(appDataPath)) === false, "empty selection does not create user.json");
  });

  await withTempDirs(async ({ workDir, appDataPath }) => {
    const botFolder = makeValidBot(workDir);
    fs.mkdirSync(getUserDataFilePath(appDataPath), { recursive: true });
    const { service, setCalls } = makeService({
      appDataPath,
      showOpenDialog: async () => ({ canceled: false, filePaths: [botFolder] }),
    });
    const result = await service.openExisting();
    assert(result && result.ok !== true, "write failure is not ok");
    assert(result.reason === "write", "write failure uses the write reason");
    assert(typeof result.error === "string" && result.error.length > 0, "write failure returns an error string");
    assert(setCalls.length === 1, "write failure still attempted config.set");
  });

  console.log("\n== dialog properties constant ==");
  assert(DIALOG_PROPERTIES.length === 1 && DIALOG_PROPERTIES[0] === "openDirectory", "picker properties are ['openDirectory']");
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
