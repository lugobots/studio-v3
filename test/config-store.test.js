const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const store = require("../src/main/services/config/store");

test("windows appData path uses the V1 settings file", () => {
  const file = store.settingsFile("C:\\Users\\me\\AppData\\Roaming", "win32");
  assert.equal(file, "C:\\Users\\me\\AppData\\Roaming\\.LugoStudio\\user.json");
});

test("round-trip keeps unknown keys and defaults telemetry on", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-config-"));
  const file = store.settingsFile(dir, "linux");
  store.write(file, { custom_flag: true, project_path: "/bots/demo" });
  const next = store.applyPatch(store.read(file).data, { telemetry_enabled: false });
  store.write(file, next);
  const saved = store.read(file).data;
  assert.equal(saved.custom_flag, true);
  assert.equal(saved.project_path, "/bots/demo");
  assert.equal(saved.telemetry_enabled, false);
  assert.equal(store.telemetryEnabled({}), true);
  assert.equal(store.telemetryEnabled(saved), false);
});

test("appearance defaults to dark and remembers light", () => {
  assert.equal(store.appearance({}), "dark");
  assert.equal(store.appearance({ appearance: "weird" }), "dark");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-appearance-"));
  const file = store.settingsFile(dir, "linux");
  store.write(file, store.applyPatch({}, { appearance: "light" }));
  const saved = store.read(file).data;
  assert.equal(saved.appearance, "light");
  assert.equal(store.appearance(saved), "light");
  store.write(file, store.applyPatch(saved, { appearance: "dark" }));
  assert.equal(store.appearance(store.read(file).data), "dark");
});

test("workspace editor open defaults true and remembers closed", () => {
  assert.equal(store.workspaceEditorOpen({}), true);
  assert.equal(store.workspaceEditorOpen(undefined), true);
  assert.equal(store.workspaceEditorOpen({ workspace_editor_open: "nope" }), true);
  assert.equal(store.workspaceEditorOpen({ workspace_editor_open: true }), true);
  assert.equal(store.workspaceEditorOpen({ workspace_editor_open: false }), false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-editor-pref-"));
  const file = store.settingsFile(dir, "linux");
  store.write(file, store.applyPatch({}, { workspace_editor_open: false }));
  const closed = store.read(file).data;
  assert.equal(closed.workspace_editor_open, false);
  assert.equal(store.workspaceEditorOpen(closed), false);

  store.write(file, store.applyPatch(closed, { workspace_editor_open: true }));
  const opened = store.read(file).data;
  assert.equal(opened.workspace_editor_open, true);
  assert.equal(store.workspaceEditorOpen(opened), true);
});

test("workspace split fractions default and clamp on patch", () => {
  const split = require("../src/shared/workspace-split");
  assert.equal(store.workspaceSplitHorizontal({}), split.DEFAULT_HORIZONTAL);
  assert.equal(store.workspaceSplitLogs({}), split.DEFAULT_LOGS);
  assert.equal(store.workspaceSplitHorizontal({ workspace_split_horizontal: "nope" }), split.DEFAULT_HORIZONTAL);
  assert.equal(store.workspaceSplitLogs({ workspace_split_logs: Number.NaN }), split.DEFAULT_LOGS);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-split-pref-"));
  const file = store.settingsFile(dir, "linux");
  store.write(
    file,
    store.applyPatch({}, {
      workspace_split_horizontal: 0.01,
      workspace_split_logs: 0.9,
    }),
  );
  const saved = store.read(file).data;
  assert.equal(saved.workspace_split_horizontal, split.HORIZONTAL_MIN);
  assert.equal(saved.workspace_split_logs, split.LOGS_MAX);
  assert.equal(store.workspaceSplitHorizontal(saved), split.HORIZONTAL_MIN);
  assert.equal(store.workspaceSplitLogs(saved), split.LOGS_MAX);

  store.write(
    file,
    store.applyPatch(saved, {
      workspace_split_horizontal: 0.7,
      workspace_split_logs: 0.25,
    }),
  );
  const mid = store.read(file).data;
  assert.equal(mid.workspace_split_horizontal, 0.7);
  assert.equal(mid.workspace_split_logs, 0.25);
});

test("a missing bot list is seeded from project_path", () => {
  assert.deepEqual(store.botPaths({ project_path: "/bots/demo" }), ["/bots/demo"]);
  assert.deepEqual(store.botPaths({ project_path: "" }), []);
  assert.deepEqual(store.botPaths({ bot_paths: [], project_path: "/bots/demo" }), []);
});

test("adding a listed path does not duplicate it and still writes project_path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-config-"));
  const file = store.settingsFile(dir, "linux");
  store.write(file, { custom_flag: true, project_path: "/bots/demo" });
  const seeded = store.rememberBot(store.read(file).data, "/bots/demo");
  assert.deepEqual(seeded.bot_paths, ["/bots/demo"]);
  assert.equal(seeded.project_path, "/bots/demo");
  const added = store.rememberBot(seeded, "/bots/other");
  assert.deepEqual(added.bot_paths, ["/bots/demo", "/bots/other"]);
  store.write(file, added);
  const saved = store.read(file).data;
  assert.equal(saved.custom_flag, true);
  assert.equal(saved.project_path, "/bots/other");
  assert.deepEqual(store.rememberBot(saved, "/bots/other").bot_paths, ["/bots/demo", "/bots/other"]);
});

test("removing a bot drops it from the list and leaves the folder", () => {
  const bot = fs.mkdtempSync(path.join(os.tmpdir(), "studio-forget-bot-"));
  fs.writeFileSync(path.join(bot, "keep.txt"), "stay");
  const next = store.forgetBot(
    {
      custom_flag: true,
      project_path: bot,
      bot_paths: [bot, "/bots/other"],
      compose_file: path.join(bot, "docker-compose.yml"),
    },
    bot,
  );
  assert.deepEqual(next.bot_paths, ["/bots/other"]);
  assert.equal(next.project_path, "");
  assert.equal(next.compose_file, "");
  assert.equal(next.custom_flag, true);
  assert.equal(fs.readFileSync(path.join(bot, "keep.txt"), "utf8"), "stay");

  const kept = store.forgetBot(
    { project_path: "/bots/other", bot_paths: [bot, "/bots/other"] },
    bot,
  );
  assert.deepEqual(kept.bot_paths, ["/bots/other"]);
  assert.equal(kept.project_path, "/bots/other");

  const seeded = store.forgetBot({ project_path: "/bots/demo" }, "/bots/demo");
  assert.deepEqual(seeded.bot_paths, []);
  assert.equal(seeded.project_path, "");
});

test("project readiness requires info.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-bot-"));
  assert.equal(store.projectReady({ project_path: dir }, fs.existsSync), false);
  fs.mkdirSync(path.join(dir, ".lugo"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".lugo", "info.json"), "{}");
  assert.equal(store.projectReady({ project_path: dir }, fs.existsSync), true);
});

test("match config defaults when keys are unset", () => {
  assert.deepEqual(store.matchConfig({}), store.MATCH_DEFAULTS);
  assert.deepEqual(store.matchConfig(undefined), store.MATCH_DEFAULTS);
  assert.deepEqual(store.matchConfig({ project_path: "/bots/demo" }), {
    team_side: "home",
    skip_to_golden_goal: false,
    game_speed: "normal",
    opponent_team: "default",
    saved_positions: [],
  });
  assert.equal(store.matchConfig({ skip_to_golden_goal: "yes" }).skip_to_golden_goal, false);
  assert.equal(store.matchConfig({ team_side: "left" }).team_side, "home");
  assert.equal(store.matchConfig({ game_speed: 1 }).game_speed, "normal");
  assert.equal(store.matchConfig({ opponent_team: "level-0" }).opponent_team, "default");
  assert.deepEqual(store.matchConfig({ saved_positions: "opaque" }).saved_positions, []);
  const withLegacy = store.matchConfig({
    home_bots_active: Array.from({ length: store.BOT_ROSTER_SIZE }, () => false),
    away_bots_active: Array.from({ length: store.BOT_ROSTER_SIZE }, () => false),
  });
  assert.equal(Object.hasOwn(withLegacy, "home_bots_active"), false);
  assert.equal(Object.hasOwn(withLegacy, "away_bots_active"), false);
});

test("match keys patch round-trips through user.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-match-"));
  const file = store.settingsFile(dir, "linux");
  const preset = {
    name: "kickoff",
    ball: { x: 0, y: 0 },
    homeTeam: { 1: { x: 1, y: 2 } },
    awayTeam: { 1: { x: 3, y: 4 } },
  };
  const patched = store.applyPatch(
    store.read(file).data,
    store.matchPatch({
      team_side: "away",
      skip_to_golden_goal: true,
      game_speed: "fast",
      opponent_team: "zombies",
      saved_positions: [preset],
      home_bots_active: Array.from({ length: store.BOT_ROSTER_SIZE }, () => false),
      away_bots_active: Array.from({ length: store.BOT_ROSTER_SIZE }, () => false),
    }),
  );
  store.write(file, patched);
  const saved = store.matchConfig(store.read(file).data);
  assert.equal(saved.team_side, "away");
  assert.equal(saved.skip_to_golden_goal, true);
  assert.equal(saved.game_speed, "fast");
  assert.equal(saved.opponent_team, "zombies");
  assert.deepEqual(saved.saved_positions, [preset]);
  assert.equal(Object.hasOwn(saved, "home_bots_active"), false);
  assert.equal(Object.hasOwn(store.matchPatch({ home_bots_active: [false] }), "home_bots_active"), false);
  assert.ok(store.V1_KEYS.includes("skip_to_golden_goal"));
  assert.deepEqual(store.MATCH_KEYS, [
    "team_side",
    "skip_to_golden_goal",
    "game_speed",
    "opponent_team",
    "saved_positions",
  ]);
});

test("match settings for api map opponent_team to opponent_mode", () => {
  assert.deepEqual(
    store.matchSettingsForApi({
      project_path: "/bots/MyBots",
      team_side: "away",
      skip_to_golden_goal: true,
      game_speed: "fast",
      opponent_team: "kids",
      opponent_source: "local",
      opponent_projects: [{ label: "Rivals", path: "/bots/rival" }],
      opponent_project_path: "/bots/rival",
      saved_positions: [{ name: "x" }],
      home_bots_active: Array.from({ length: store.BOT_ROSTER_SIZE }, () => false),
    }),
    {
      team_side: "away",
      skip_to_golden_goal: true,
      game_speed: "fast",
      opponent_mode: "kids",
      player_team_name: "MyBots",
      opponent_team_name: "Rivals",
    },
  );
  assert.deepEqual(store.matchSettingsForApi({}), {
    team_side: "home",
    skip_to_golden_goal: false,
    game_speed: "normal",
    opponent_mode: "default",
    player_team_name: "",
    opponent_team_name: "Level-1",
  });
  assert.equal(Object.hasOwn(store.matchSettingsForApi({ home_bots_active: [false] }), "home_bots_active"), false);
});

test("opening a different bot does not rewrite match preferences", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-match-bot-"));
  const file = store.settingsFile(dir, "linux");
  const match = {
    team_side: "away",
    skip_to_golden_goal: true,
    game_speed: "slow",
    opponent_team: "kids",
    saved_positions: [{ name: "corner", ball: { x: 10, y: 20 }, homeTeam: {}, awayTeam: {} }],
  };
  store.write(file, {
    project_path: "/bots/first",
    bot_paths: ["/bots/first"],
    custom_flag: true,
    ...match,
    home_bots_active: Array.from({ length: store.BOT_ROSTER_SIZE }, () => false),
  });
  const afterOpen = store.rememberBot(store.read(file).data, "/bots/second");
  store.write(file, afterOpen);
  const saved = store.read(file).data;
  assert.equal(saved.project_path, "/bots/second");
  assert.deepEqual(saved.bot_paths, ["/bots/first", "/bots/second"]);
  assert.equal(saved.custom_flag, true);
  assert.deepEqual(store.matchConfig(saved), match);
});

test("unset user.json resolves runtime image settings to documented defaults", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-image-defaults-"));
  const file = store.settingsFile(dir, "linux");
  const missing = store.read(file);
  assert.equal(missing.exists, false);
  assert.deepEqual(store.imageConfig(missing.data), store.IMAGE_DEFAULTS);
  assert.deepEqual(store.imageConfig({}), store.IMAGE_DEFAULTS);
  assert.deepEqual(store.imageConfig(undefined), store.IMAGE_DEFAULTS);
  assert.equal(store.IMAGE_DEFAULTS.bot_level_1_image, "lugobots/level-1");
  assert.equal(store.IMAGE_DEFAULTS.bot_level_1_version, "v4");
  assert.equal(store.IMAGE_DEFAULTS.game_server_image, "lugobots/server");
  assert.equal(store.IMAGE_DEFAULTS.game_server_version, "v2");
  assert.equal(store.IMAGE_DEFAULTS.bot_level_0_image, "lugobots/level-0");
  assert.equal(store.IMAGE_DEFAULTS.bot_level_0_version, "v2");
  assert.equal(store.IMAGE_DEFAULTS.bot_setup_image, "lugobots/bot-setup");
  assert.equal(store.IMAGE_DEFAULTS.bot_setup_version, "latest");
  assert.ok(store.V1_KEYS.includes("bot_setup_image"));
  assert.ok(store.V1_KEYS.includes("bot_setup_version"));
  assert.deepEqual(store.IMAGE_KEYS, [
    "game_server_image",
    "game_server_version",
    "bot_level_0_image",
    "bot_level_0_version",
    "bot_level_1_image",
    "bot_level_1_version",
    "bot_setup_image",
    "bot_setup_version",
  ]);

  store.write(file, { project_path: "/bots/demo", custom_flag: true });
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(store.imageConfig(raw), store.IMAGE_DEFAULTS);
  assert.equal(raw.project_path, "/bots/demo");
  assert.equal(raw.custom_flag, true);
  for (const key of store.IMAGE_KEYS) {
    assert.equal(raw[key], store.IMAGE_DEFAULTS[key]);
  }
});

test("existing Level-1 image keys are preserved on read and write", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-image-preserve-"));
  const file = store.settingsFile(dir, "linux");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify(
      {
        project_path: "/bots/demo",
        bot_level_1_image: "custom/level-1",
        bot_level_1_version: "v99",
      },
      null,
      2,
    )}\n`,
  );
  const loaded = store.read(file).data;
  assert.equal(loaded.bot_level_1_image, "custom/level-1");
  assert.equal(loaded.bot_level_1_version, "v99");
  assert.equal(loaded.game_server_image, store.IMAGE_DEFAULTS.game_server_image);
  assert.equal(loaded.bot_setup_version, store.IMAGE_DEFAULTS.bot_setup_version);

  store.write(file, {
    project_path: "/bots/demo",
    bot_level_1_image: "custom/level-1",
    bot_level_1_version: "v99",
  });
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(saved.bot_level_1_image, "custom/level-1");
  assert.equal(saved.bot_level_1_version, "v99");
  assert.equal(saved.game_server_image, "lugobots/server");
  assert.equal(saved.bot_setup_image, "lugobots/bot-setup");
});

test("api debug preference round-trips in user.json and stays out of match settings", () => {
  assert.equal(store.apiDebugEnabled({}), false);
  assert.equal(store.apiDebugEnabled({ debug_mode: false }), false);
  assert.equal(store.apiDebugEnabled({ debug_mode: "true" }), false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-api-debug-"));
  const file = store.settingsFile(dir, "linux");
  store.write(file, { project_path: "/bots/demo", debug_mode: true, custom_flag: true });
  const saved = store.read(file).data;
  assert.equal(saved.debug_mode, true);
  assert.equal(saved.custom_flag, true);
  assert.equal(store.apiDebugEnabled(saved), true);

  const off = store.applyPatch(saved, { debug_mode: false });
  store.write(file, off);
  const reread = store.read(file).data;
  assert.equal(reread.debug_mode, false);
  assert.equal(store.apiDebugEnabled(reread), false);
  assert.equal(reread.project_path, "/bots/demo");

  const match = store.matchSettingsForApi({ ...saved, debug_mode: true });
  assert.deepEqual(match, {
    team_side: "home",
    skip_to_golden_goal: false,
    game_speed: "normal",
    opponent_mode: "default",
    player_team_name: "demo",
    opponent_team_name: "Level-1",
  });
  assert.equal(Object.prototype.hasOwnProperty.call(match, "debug_mode"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(match, "server_logs"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(match, "home_bots_active"), false);
});

test("opponent source defaults to Level-1 and keeps labeled list on invalid local path", () => {
  assert.deepEqual(store.opponentSourceConfig({}), {
    opponent_source: "level1",
    opponent_projects: [],
    opponent_project_path: "",
    effective_source: "level1",
    effective_project_path: "",
  });
  assert.equal(store.OPPONENT_SOURCE_DEFAULTS.opponent_source, "level1");
  assert.deepEqual(store.OPPONENT_SOURCES, ["level1", "local"]);
  assert.equal(store.OPPONENT_PROJECT_CONTAINER_PATH, "/bot-opponent");

  const projects = [
    { label: "  Alpha  ", path: " /bots/alpha " },
    { label: "", path: "/bots/skip" },
    { label: "Beta", path: "/bots/beta" },
    { label: "Alpha2", path: "/bots/alpha" },
  ];
  const normalized = store.normalizeOpponentProjects(projects);
  assert.deepEqual(normalized, [
    { label: "Alpha2", path: "/bots/alpha" },
    { label: "Beta", path: "/bots/beta" },
  ]);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-opponent-source-"));
  const file = store.settingsFile(dir, "linux");
  const ready = new Set(["/bots/alpha"]);
  const written = store.applyPatch(
    {},
    {
      opponent_source: "local",
      opponent_projects: [
        { label: "Alpha", path: "/bots/alpha" },
        { label: "Gone", path: "/bots/missing" },
      ],
      opponent_project_path: "/bots/missing",
      custom_flag: true,
    },
  );
  store.write(file, written);
  const saved = store.read(file).data;
  assert.equal(saved.custom_flag, true);
  const cfg = store.opponentSourceConfig(saved, (folder) => ready.has(folder));
  assert.equal(cfg.opponent_source, "local");
  assert.equal(cfg.opponent_project_path, "/bots/missing");
  assert.deepEqual(cfg.opponent_projects, [
    { label: "Alpha", path: "/bots/alpha" },
    { label: "Gone", path: "/bots/missing" },
  ]);
  assert.equal(cfg.effective_source, "level1");
  assert.equal(cfg.effective_project_path, "");

  const valid = store.opponentSourceConfig(
    {
      opponent_source: "local",
      opponent_projects: [{ label: "Alpha", path: "/bots/alpha" }],
      opponent_project_path: "/bots/alpha",
    },
    (folder) => ready.has(folder),
  );
  assert.equal(valid.effective_source, "local");
  assert.equal(valid.effective_project_path, "/bots/alpha");
});

test("rememberOpponentProject rejects incompatible folders and selects compatible ones", () => {
  const { checkBotCompatibility } = require("../src/main/services/bots/compatibility");
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-opponent-bad-"));
  const realReject = store.rememberOpponentProject(
    {},
    { label: "Bad", path: emptyDir },
    checkBotCompatibility(emptyDir),
  );
  assert.equal(realReject.ok, false);
  assert.match(realReject.error, /info\.json/);

  const base = {
    opponent_source: "level1",
    opponent_projects: [{ label: "Keep", path: "/bots/keep" }],
  };
  const rejected = store.rememberOpponentProject(
    base,
    { label: "Bad", path: "/bots/bad" },
    { ok: false, error: "That folder is not a Lugo bot (.lugo/info.json is missing)." },
  );
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /info\.json/);
  assert.deepEqual(rejected.data, base);

  const added = store.rememberOpponentProject(
    base,
    { label: "  New  ", path: " /bots/new " },
    { ok: true },
  );
  assert.equal(added.ok, true);
  assert.equal(added.data.opponent_source, "local");
  assert.equal(added.data.opponent_project_path, "/bots/new");
  assert.deepEqual(added.data.opponent_projects, [
    { label: "Keep", path: "/bots/keep" },
    { label: "New", path: "/bots/new" },
  ]);

  const updated = store.rememberOpponentProject(
    added.data,
    { label: "Renamed", path: "/bots/keep" },
    { ok: true },
  );
  assert.equal(updated.ok, true);
  assert.deepEqual(updated.data.opponent_projects, [
    { label: "New", path: "/bots/new" },
    { label: "Renamed", path: "/bots/keep" },
  ]);
  assert.equal(updated.data.opponent_project_path, "/bots/keep");

  const maxLabel = "A".repeat(store.OPPONENT_LABEL_MAX);
  const atMax = store.rememberOpponentProject(
    base,
    { label: maxLabel, path: "/bots/max" },
    { ok: true },
  );
  assert.equal(atMax.ok, true);
  assert.equal(atMax.data.opponent_projects.at(-1).label, maxLabel);

  const oversized = store.rememberOpponentProject(
    base,
    { label: `${maxLabel}X`, path: "/bots/too-long" },
    { ok: true },
  );
  assert.equal(oversized.ok, false);
  assert.match(oversized.error, /20 characters/);
  assert.deepEqual(oversized.data, base);
});

test("setOpponentSource and forgetOpponentProject switch Level-1 without wiping the list", () => {
  const data = {
    opponent_source: "local",
    opponent_projects: [
      { label: "Alpha", path: "/bots/alpha" },
      { label: "Beta", path: "/bots/beta" },
    ],
    opponent_project_path: "/bots/alpha",
  };
  const level1 = store.setOpponentSource(data, "level1");
  assert.equal(level1.ok, true);
  assert.equal(level1.data.opponent_source, "level1");
  assert.deepEqual(level1.data.opponent_projects, data.opponent_projects);
  assert.equal(level1.data.opponent_project_path, "/bots/alpha");

  const local = store.setOpponentSource(level1.data, "local", "/bots/beta");
  assert.equal(local.ok, true);
  assert.equal(local.data.opponent_source, "local");
  assert.equal(local.data.opponent_project_path, "/bots/beta");

  const unknown = store.setOpponentSource(data, "local", "/bots/missing");
  assert.equal(unknown.ok, false);
  assert.deepEqual(unknown.data, data);

  const forgot = store.forgetOpponentProject(local.data, "/bots/beta");
  assert.equal(forgot.opponent_source, "level1");
  assert.equal(forgot.opponent_project_path, "");
  assert.deepEqual(forgot.opponent_projects, [{ label: "Alpha", path: "/bots/alpha" }]);
});

test("opening a different player bot leaves labeled opponents intact", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-opponent-keep-"));
  const file = store.settingsFile(dir, "linux");
  store.write(file, {
    project_path: "/bots/first",
    bot_paths: ["/bots/first"],
    opponent_source: "local",
    opponent_projects: [{ label: "Rival", path: "/bots/rival" }],
    opponent_project_path: "/bots/rival",
  });
  const afterOpen = store.rememberBot(store.read(file).data, "/bots/second");
  store.write(file, afterOpen);
  const saved = store.read(file).data;
  assert.equal(saved.project_path, "/bots/second");
  assert.equal(saved.opponent_source, "local");
  assert.equal(saved.opponent_project_path, "/bots/rival");
  assert.deepEqual(saved.opponent_projects, [{ label: "Rival", path: "/bots/rival" }]);
});

test("resolved Level-1 image:tag uses bot_level_1_version from user.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-level1-resolved-"));
  const file = store.settingsFile(dir, "linux");
  store.write(file, {
    project_path: "/bots/demo",
    bot_level_1_image: "custom/level-1",
    bot_level_1_version: "v99",
  });
  const resolved = store.level1Resolved(store.read(file).data, dir, "linux");
  assert.equal(resolved.image, "custom/level-1");
  assert.equal(resolved.tag, "v99");
  assert.equal(resolved.ref, "custom/level-1:v99");
  assert.equal(resolved.cacheKey, store.level1CacheKey("custom/level-1:v99"));
  assert.equal(
    resolved.cacheDir,
    path.join(dir, ".LugoStudio", "cache", "level-1", resolved.cacheKey),
  );
  assert.equal(resolved.hostBinaryPath, path.join(resolved.cacheDir, "my-bot"));
  assert.equal(resolved.imageBinaryPath, store.LEVEL1_IMAGE_BINARY_PATH);
  assert.equal(resolved.containerBinaryPath, store.LEVEL1_CONTAINER_BINARY_PATH);
  assert.equal(store.LEVEL1_IMAGE_BINARY_PATH, "/bin/my-bot");
  assert.equal(store.LEVEL1_CONTAINER_BINARY_PATH, "/usr/local/lib/lugo/bot-level-1");

  const defaults = store.level1Resolved({}, dir, "linux");
  assert.equal(defaults.ref, `${store.IMAGE_DEFAULTS.bot_level_1_image}:${store.IMAGE_DEFAULTS.bot_level_1_version}`);
  assert.notEqual(defaults.cacheKey, resolved.cacheKey);
});
