import test from "node:test";
import assert from "node:assert/strict";
import {
  activeBotSlots,
  applyMatchConfig,
  botActiveSettingsPatch,
  findPositionPreset,
  initialGameControls,
  markActiveBotsRunning,
  matchSettingsPatch,
  matchSettingsForApi,
  persistBotActiveSettings,
  persistMatchSettings,
  reduceGameControl,
  upsertPositionPreset,
} from "../src/renderer/shell/game-controls.js";

function idleActive(rows) {
  return rows.every((row) => row.active === true && row.running === false && row.logs === false);
}

test("initial game controls are a stopped local match with all bots active", () => {
  const state = initialGameControls();
  assert.equal(state.serverRunning, false);
  assert.equal(state.home.length, 11);
  assert.equal(state.away.length, 11);
  assert.equal(idleActive(state.home), true);
  assert.equal(idleActive(state.away), true);
  assert.equal(state.side, "home");
  assert.equal(state.skipGolden, false);
  assert.equal(state.speed, "normal");
  assert.equal(state.opponent, "default");
  assert.deepEqual(state.positions, []);
  assert.equal(activeBotSlots(state).length, 22);
});

test("active switch is desired-active; running is separate process state", () => {
  const initial = initialGameControls();
  const server = reduceGameControl(initial, { type: "set-server-running", running: true });
  assert.equal(server.serverRunning, true);
  assert.equal(server.speed, initial.speed);
  assert.equal(server.home[0].active, true);
  assert.equal(server.home[0].running, false);

  const apiStop = reduceGameControl(server, { type: "set-server-running", running: false });
  assert.equal(apiStop.serverRunning, false);

  const deactivatedOne = reduceGameControl(server, {
    type: "set-bot",
    team: "home",
    number: 2,
    control: "active",
  });
  assert.equal(deactivatedOne.home[1].active, false);
  assert.equal(deactivatedOne.home[1].running, false);
  assert.equal(deactivatedOne.home[0].active, true);
  assert.equal(deactivatedOne.away[1].active, true);
  assert.equal(deactivatedOne.home[1].logs, false);

  const activated = reduceGameControl(deactivatedOne, {
    type: "set-bot",
    team: "home",
    number: 2,
    control: "active",
    active: true,
  });
  assert.equal(activated.home[1].active, true);

  const running = reduceGameControl(activated, {
    type: "set-bot",
    team: "home",
    number: 2,
    control: "running",
    running: true,
  });
  assert.equal(running.home[1].active, true);
  assert.equal(running.home[1].running, true);

  const logged = reduceGameControl(running, { type: "set-bot", team: "away", number: 11, control: "logs" });
  assert.equal(logged.away[10].logs, true);
  assert.equal(logged.home[1].running, true);

  const deactivated = reduceGameControl(logged, {
    type: "set-bot",
    team: "home",
    number: 2,
    control: "active",
    active: false,
  });
  assert.equal(deactivated.home[1].active, false);
  assert.equal(deactivated.home[1].running, true);
  assert.equal(deactivated.away[10].logs, true);

  const fast = reduceGameControl(deactivated, { type: "set-speed", speed: "fast" });
  const slow = reduceGameControl(fast, { type: "set-speed", speed: "slow" });
  assert.equal(slow.speed, "slow");
  assert.equal(slow.opponent, "default");

  const zombies = reduceGameControl(slow, { type: "set-opponent", opponent: "zombies" });
  const kids = reduceGameControl(zombies, { type: "set-opponent", opponent: "kids" });
  assert.equal(kids.opponent, "kids");
  assert.equal(kids.speed, "slow");
  assert.equal(Object.hasOwn(kids, "request"), false);
  assert.equal(Object.hasOwn(kids, "url"), false);
  assert.equal(JSON.stringify(kids).includes("http"), false);
});

test("activeBotSlots lists only desired-active rows as HOME/AWAY slots", () => {
  let state = initialGameControls();
  // Start from all-active defaults, then leave only HOME/1, HOME/5, AWAY/11 on.
  for (let number = 1; number <= 11; number += 1) {
    state = reduceGameControl(state, {
      type: "set-bot",
      team: "home",
      number,
      control: "active",
      active: number === 1 || number === 5,
    });
    state = reduceGameControl(state, {
      type: "set-bot",
      team: "away",
      number,
      control: "active",
      active: number === 11,
    });
  }
  state = reduceGameControl(state, {
    type: "set-bot",
    team: "home",
    number: 5,
    control: "running",
    running: true,
  });
  assert.deepEqual(activeBotSlots(state), [
    { side: "HOME", number: 1 },
    { side: "HOME", number: 5 },
    { side: "AWAY", number: 11 },
  ]);

  const afterStart = markActiveBotsRunning(state);
  assert.equal(afterStart.home[0].running, true);
  assert.equal(afterStart.home[4].running, true);
  assert.equal(afterStart.away[10].running, true);
  assert.equal(afterStart.home[1].running, false);
});

test("match and position actions do not invent a request", () => {
  const initial = initialGameControls();
  for (const type of ["start-match", "reset-match", "save-positions", "apply-positions"]) {
    const next = reduceGameControl(initial, { type });
    assert.deepEqual(next.positions, []);
    assert.equal(next.serverRunning, false);
    assert.equal(Object.hasOwn(next, "request"), false);
    assert.equal(Object.hasOwn(next, "url"), false);
  }
  const away = reduceGameControl(initial, { type: "toggle-side" });
  const home = reduceGameControl(away, { type: "toggle-side" });
  assert.equal(home.side, "home");
  const golden = reduceGameControl(initial, { type: "toggle-golden" });
  assert.equal(golden.skipGolden, true);
});

test("applyMatchConfig loads side, speed, opponent, golden skip, positions, and bot active", () => {
  const homeActive = Array.from({ length: 11 }, (_, i) => i !== 2);
  const awayActive = Array.from({ length: 11 }, (_, i) => i === 10);
  const loaded = applyMatchConfig(initialGameControls(), {
    team_side: "away",
    skip_to_golden_goal: true,
    game_speed: "fast",
    opponent_team: "kids",
    saved_positions: [
      { name: "corner", ball: { x: 1, y: 2 } },
      { name: "kickoff" },
      "legacy-string",
      { ball: {} },
    ],
    home_bots_active: homeActive,
    away_bots_active: awayActive,
  });
  assert.equal(loaded.side, "away");
  assert.equal(loaded.skipGolden, true);
  assert.equal(loaded.speed, "fast");
  assert.equal(loaded.opponent, "kids");
  assert.deepEqual(loaded.positions, ["corner", "kickoff", "legacy-string"]);
  assert.equal(loaded.serverRunning, false);
  assert.equal(loaded.home[2].active, false);
  assert.equal(loaded.home[0].active, true);
  assert.equal(loaded.away[10].active, true);
  assert.equal(loaded.away[0].active, false);
  assert.deepEqual(matchSettingsPatch(loaded), {
    team_side: "away",
    skip_to_golden_goal: true,
    game_speed: "fast",
    opponent_team: "kids",
  });
  assert.deepEqual(botActiveSettingsPatch(loaded), {
    home_bots_active: homeActive,
    away_bots_active: awayActive,
  });
  assert.deepEqual(matchSettingsForApi(loaded), {
    team_side: "away",
    skip_to_golden_goal: true,
    game_speed: "fast",
    opponent_mode: "kids",
  });

  const invalid = applyMatchConfig(initialGameControls(), {
    home_bots_active: [false],
    away_bots_active: "nope",
  });
  assert.equal(invalid.home.every((row) => row.active), true);
  assert.equal(invalid.away.every((row) => row.active), true);
});

test("upsertPositionPreset adds or replaces a named snapshot", () => {
  const snapshot = {
    ball: { x: 1, y: 2 },
    homeTeam: { 1: { x: 3, y: 4 } },
    awayTeam: {},
  };
  const first = upsertPositionPreset([], "corner", snapshot);
  assert.deepEqual(first, [{ name: "corner", ...snapshot }]);
  const replaced = upsertPositionPreset(first, "corner", {
    ball: { x: 9, y: 9 },
    homeTeam: {},
    awayTeam: {},
  });
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].ball.x, 9);
  assert.deepEqual(findPositionPreset(replaced, "corner"), {
    ball: { x: 9, y: 9 },
    homeTeam: {},
    awayTeam: {},
  });
  assert.equal(findPositionPreset(replaced, "missing"), null);
  assert.deepEqual(upsertPositionPreset(first, "  ", snapshot), first);
});

test("persistMatchSettings writes while stopped and skips while the server is running", async () => {
  const patches = [];
  const host = {
    config: {
      async matchSet(patch) {
        patches.push(patch);
        return patch;
      },
    },
  };
  const stopped = reduceGameControl(initialGameControls(), { type: "set-speed", speed: "slow" });
  await persistMatchSettings(host, stopped);
  assert.deepEqual(patches, [{
    team_side: "home",
    skip_to_golden_goal: false,
    game_speed: "slow",
    opponent_team: "default",
  }]);

  const running = reduceGameControl(stopped, { type: "set-server-running", running: true });
  await persistMatchSettings(host, running);
  assert.equal(patches.length, 1);
});

test("persistBotActiveSettings writes while the server is up or down", async () => {
  const patches = [];
  const host = {
    config: {
      async matchSet(patch) {
        patches.push(patch);
        return patch;
      },
    },
  };
  let state = reduceGameControl(initialGameControls(), {
    type: "set-bot",
    team: "home",
    number: 3,
    control: "active",
    active: false,
  });
  await persistBotActiveSettings(host, state);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].home_bots_active[2], false);
  assert.equal(patches[0].home_bots_active[0], true);
  assert.equal(patches[0].away_bots_active.every(Boolean), true);

  state = reduceGameControl(state, { type: "set-server-running", running: true });
  state = reduceGameControl(state, {
    type: "set-bot",
    team: "away",
    number: 11,
    control: "active",
    active: false,
  });
  await persistBotActiveSettings(host, state);
  assert.equal(patches.length, 2);
  assert.equal(patches[1].away_bots_active[10], false);
  assert.equal(Object.hasOwn(patches[1], "game_speed"), false);
});
