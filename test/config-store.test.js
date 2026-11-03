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
  });
  assert.equal(store.matchConfig({ skip_to_golden_goal: "yes" }).skip_to_golden_goal, false);
  assert.equal(store.matchConfig({ team_side: "left" }).team_side, "home");
  assert.equal(store.matchConfig({ game_speed: 1 }).game_speed, "normal");
  assert.equal(store.matchConfig({ opponent_team: "level-0" }).opponent_team, "default");
  assert.deepEqual(store.matchConfig({ saved_positions: "opaque" }).saved_positions, []);
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
    }),
  );
  store.write(file, patched);
  const saved = store.matchConfig(store.read(file).data);
  assert.equal(saved.team_side, "away");
  assert.equal(saved.skip_to_golden_goal, true);
  assert.equal(saved.game_speed, "fast");
  assert.equal(saved.opponent_team, "zombies");
  assert.deepEqual(saved.saved_positions, [preset]);
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
      team_side: "away",
      skip_to_golden_goal: true,
      game_speed: "fast",
      opponent_team: "kids",
      saved_positions: [{ name: "x" }],
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
  });
  const afterOpen = store.rememberBot(store.read(file).data, "/bots/second");
  store.write(file, afterOpen);
  const saved = store.read(file).data;
  assert.equal(saved.project_path, "/bots/second");
  assert.deepEqual(saved.bot_paths, ["/bots/first", "/bots/second"]);
  assert.equal(saved.custom_flag, true);
  assert.deepEqual(store.matchConfig(saved), match);
});
