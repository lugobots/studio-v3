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
    home_bots_active: Array.from({ length: store.BOT_ROSTER_SIZE }, () => true),
    away_bots_active: Array.from({ length: store.BOT_ROSTER_SIZE }, () => true),
  });
  assert.equal(store.matchConfig({ skip_to_golden_goal: "yes" }).skip_to_golden_goal, false);
  assert.equal(store.matchConfig({ team_side: "left" }).team_side, "home");
  assert.equal(store.matchConfig({ game_speed: 1 }).game_speed, "normal");
  assert.equal(store.matchConfig({ opponent_team: "level-0" }).opponent_team, "default");
  assert.deepEqual(store.matchConfig({ saved_positions: "opaque" }).saved_positions, []);
  assert.deepEqual(
    store.matchConfig({ home_bots_active: [false], away_bots_active: "nope" }).home_bots_active,
    Array.from({ length: store.BOT_ROSTER_SIZE }, () => true),
  );
  assert.deepEqual(
    store.matchConfig({ home_bots_active: [false], away_bots_active: "nope" }).away_bots_active,
    Array.from({ length: store.BOT_ROSTER_SIZE }, () => true),
  );
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
  const homeActive = Array.from({ length: store.BOT_ROSTER_SIZE }, (_, i) => i !== 2);
  const awayActive = Array.from({ length: store.BOT_ROSTER_SIZE }, (_, i) => i === 10);
  const patched = store.applyPatch(
    store.read(file).data,
    store.matchPatch({
      team_side: "away",
      skip_to_golden_goal: true,
      game_speed: "fast",
      opponent_team: "zombies",
      saved_positions: [preset],
      home_bots_active: homeActive,
      away_bots_active: awayActive,
    }),
  );
  store.write(file, patched);
  const saved = store.matchConfig(store.read(file).data);
  assert.equal(saved.team_side, "away");
  assert.equal(saved.skip_to_golden_goal, true);
  assert.equal(saved.game_speed, "fast");
  assert.equal(saved.opponent_team, "zombies");
  assert.deepEqual(saved.saved_positions, [preset]);
  assert.deepEqual(saved.home_bots_active, homeActive);
  assert.deepEqual(saved.away_bots_active, awayActive);
  assert.ok(store.V1_KEYS.includes("skip_to_golden_goal"));
  assert.deepEqual(store.MATCH_KEYS, [
    "team_side",
    "skip_to_golden_goal",
    "game_speed",
    "opponent_team",
    "saved_positions",
    "home_bots_active",
    "away_bots_active",
  ]);
});

test("match settings for api map opponent_team to opponent_mode", () => {
  const homeActive = Array.from({ length: store.BOT_ROSTER_SIZE }, (_, i) => i < 3);
  assert.deepEqual(
    store.matchSettingsForApi({
      team_side: "away",
      skip_to_golden_goal: true,
      game_speed: "fast",
      opponent_team: "kids",
      saved_positions: [{ name: "x" }],
      home_bots_active: homeActive,
      away_bots_active: homeActive,
    }),
    {
      team_side: "away",
      skip_to_golden_goal: true,
      game_speed: "fast",
      opponent_mode: "kids",
    },
  );
  assert.deepEqual(store.matchSettingsForApi({}), {
    team_side: "home",
    skip_to_golden_goal: false,
    game_speed: "normal",
    opponent_mode: "default",
  });
  assert.equal(Object.hasOwn(store.matchSettingsForApi({ home_bots_active: homeActive }), "home_bots_active"), false);
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
    home_bots_active: Array.from({ length: store.BOT_ROSTER_SIZE }, (_, i) => i !== 2),
    away_bots_active: Array.from({ length: store.BOT_ROSTER_SIZE }, (_, i) => i < 5),
  };
  store.write(file, {
    project_path: "/bots/first",
    bot_paths: ["/bots/first"],
    custom_flag: true,
    ...match,
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
