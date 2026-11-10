import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initialGameControls } from "../src/renderer/shell/game-controls.js";
import { renderGameControls } from "../src/renderer/shell/game-controls-view.js";
import { installDocument, leafText } from "./dom-stub.mjs";

const SECTIONS = ["Server", "Match", "Home", "Away", "Positions", "Config", "Game speed", "Opponent mode"];

function mountPanel({
  serverStart = async () => ({ ok: true }),
  serverStop = async () => ({ ok: true }),
  matchStart = async () => ({ ok: true }),
  matchReset = async () => ({ ok: true }),
  getPositions = async () => ({
    ok: true,
    body: { ball: { x: 0, y: 0 }, homeTeam: {}, awayTeam: {} },
  }),
  applyPositions = async () => ({ ok: true }),
  botStart = async () => ({ ok: true }),
  botStop = async () => ({ ok: true }),
  confirmAnswer = true,
  promptAnswer = null,
  initialState = null,
  initialSavedPositions = [],
} = {}) {
  const installed = installDocument();
  const previousPrompt = globalThis.prompt;
  globalThis.prompt = () => promptAnswer;
  const parent = installed.document.createElement("div");
  let state = initialState || initialGameControls();
  let savedPositions = initialSavedPositions.slice();
  const calls = {
    server: 0,
    stop: 0,
    match: 0,
    reset: 0,
    getPositions: 0,
    applyPositions: 0,
    botStart: 0,
    botStop: 0,
    logArm: 0,
    logDisarm: 0,
  };
  const matchStarts = [];
  const serverStarts = [];
  const botStarts = [];
  const botStops = [];
  const matchSets = [];
  const appliedSnapshots = [];
  const notices = [];
  const confirms = [];
  const logArms = [];
  const logDisarms = [];
  const openLogs = [];
  const host = {
    config: {
      matchGet() {
        return Promise.resolve({
          team_side: state.side,
          skip_to_golden_goal: state.skipGolden,
          game_speed: state.speed,
          opponent_team: state.opponent,
          saved_positions: savedPositions.slice(),
        });
      },
      matchSet(patch) {
        matchSets.push(patch);
        if (Object.prototype.hasOwnProperty.call(patch, "saved_positions")) {
          savedPositions = Array.isArray(patch.saved_positions) ? patch.saved_positions.slice() : [];
        }
        return Promise.resolve({
          team_side: state.side,
          skip_to_golden_goal: state.skipGolden,
          game_speed: state.speed,
          opponent_team: state.opponent,
          saved_positions: savedPositions.slice(),
          ...patch,
        });
      },
    },
    server: {
      start(settings) {
        calls.server += 1;
        serverStarts.push(settings);
        return serverStart(settings);
      },
      stop() {
        calls.stop += 1;
        return serverStop();
      },
    },
    match: {
      start(payload) {
        calls.match += 1;
        matchStarts.push(payload);
        return matchStart(payload);
      },
      reset() {
        calls.reset += 1;
        return matchReset();
      },
      getPositions() {
        calls.getPositions += 1;
        return getPositions();
      },
      applyPositions(snapshot) {
        calls.applyPositions += 1;
        appliedSnapshots.push(snapshot);
        return applyPositions(snapshot);
      },
    },
    bot: {
      start(payload) {
        calls.botStart += 1;
        botStarts.push(payload);
        return botStart(payload);
      },
      stop(payload) {
        calls.botStop += 1;
        botStops.push(payload);
        return botStop(payload);
      },
    },
    logs: {
      arm(source) {
        calls.logArm += 1;
        logArms.push(source);
        return Promise.resolve({ ok: true });
      },
      disarm(source) {
        calls.logDisarm += 1;
        logDisarms.push(source);
        return Promise.resolve({ ok: true });
      },
      subscribe() {
        return () => {};
      },
    },
  };
  const dialogs = {
    notify(payload) {
      notices.push(payload);
    },
    async confirm(payload) {
      confirms.push(payload);
      return confirmAnswer;
    },
  };

  function paint() {
    parent.replaceChildren();
    renderGameControls(parent, {
      state,
      host,
      dialogs,
      onChange(next) {
        state = next;
        paint();
      },
      onOpenLogs(source) {
        openLogs.push(source);
      },
    });
  }

  paint();
  return {
    parent,
    calls,
    matchStarts,
    serverStarts,
    botStarts,
    botStops,
    matchSets,
    appliedSnapshots,
    notices,
    confirms,
    logArms,
    logDisarms,
    openLogs,
    savedPositions: () => savedPositions.slice(),
    state: () => state,
    restore() {
      globalThis.prompt = previousPrompt;
      installed.restore();
    },
    button(title) {
      return parent.querySelector(`button[title="${title}"]`);
    },
  };
}

async function flush() {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

test("workspace game panel shows the v2 sections and local controls", async () => {
  const panel = mountPanel();
  const headings = panel.parent.querySelectorAll("h3").map((node) => node.textContent);
  assert.deepEqual(headings, SECTIONS);
  assert.equal(panel.parent.querySelector(".game-ctrl") !== null, true);

  const labels = leafText(panel.parent);
  assert.equal(labels.includes("Open bot"), false);
  assert.equal(labels.includes("Start match"), false);
  assert.equal(labels.includes("Publish bot"), false);

  assert.equal(panel.button("Starts the Game Server") !== null, true);
  assert.equal(panel.button("Stops the Game Server"), null);
  assert.equal(panel.button("Starts the match") !== null, true);
  assert.equal(panel.button("Resets the match") !== null, true);

  for (const team of panel.parent.querySelectorAll(".bot_actions")) {
    assert.equal(team.querySelectorAll('button[title="Active"]').length, 11);
    assert.equal(team.querySelectorAll('button[title="Start"]').length, 0);
    assert.equal(team.querySelectorAll('button[title="Kill"]').length, 0);
    assert.equal(team.querySelectorAll('button[title="Ver logs"]').length, 11);
    const numbers = team.querySelectorAll(".bot-number").map((node) => node.textContent);
    assert.deepEqual(numbers, ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
  }

  assert.equal(panel.parent.querySelector(".game-ctrl-log-note"), null);
  assert.equal(panel.parent.querySelector("select").querySelectorAll("option").length, 0);
  assert.equal(panel.button("Normal Speed").getAttribute("aria-pressed"), "true");
  assert.equal(panel.button("Slow speed").getAttribute("aria-pressed"), "false");
  assert.equal(panel.button("Normal game").getAttribute("aria-pressed"), "true");
  assert.equal(panel.button("Zombies mode").getAttribute("aria-pressed"), "false");

  assert.equal(panel.button("Starts the match").disabled, true);
  assert.equal(panel.button("Resets the match").disabled, true);
  assert.equal(panel.button("Save positions").disabled, true);
  assert.equal(panel.button("Apply").disabled, true);
  assert.equal(panel.parent.querySelector("select").disabled, true);
  assert.equal(panel.parent.querySelector(".bot_actions").querySelector('button[title="Active"]').disabled, false);
  assert.equal(panel.button("Fast speed").disabled, false);
  assert.equal(panel.button("Zombies mode").disabled, false);
  assert.equal(panel.parent.querySelector("#team-side-switch").getAttribute("aria-disabled"), "false");

  panel.parent.querySelector(".bot_actions").querySelector('button[title="Active"]').click();
  await flush();
  assert.equal(panel.state().home[0].active, false);
  assert.equal(panel.state().home[0].running, false);
  assert.equal(panel.state().serverRunning, false);
  assert.equal(panel.calls.server, 0);
  assert.equal(panel.calls.match, 0);
  assert.equal(panel.calls.botStart, 0);
  assert.equal(panel.matchSets.some((patch) => patch.home_bots_active && patch.home_bots_active[0] === false), true);
  assert.equal(panel.button("Starts the match").disabled, true);

  panel.button("Fast speed").click();
  assert.equal(panel.state().speed, "fast");
  assert.equal(panel.button("Fast speed").getAttribute("aria-pressed"), "true");
  assert.equal(panel.button("Normal Speed").getAttribute("aria-pressed"), "false");
  assert.equal(panel.button("Fast speed").disabled, false);

  panel.button("Zombies mode").click();
  assert.equal(panel.state().opponent, "zombies");
  panel.parent.querySelector("#team-side-switch").click();
  assert.equal(panel.state().side, "away");
  assert.equal(panel.parent.querySelector("#team-side-switch").getAttribute("aria-disabled"), "false");
  assert.equal(panel.calls.server, 0);
  assert.equal(panel.calls.match, 0);

  panel.button("Starts the Game Server").click();
  await flush();
  assert.equal(panel.calls.server, 1);
  assert.deepEqual(panel.serverStarts[0], {
    team_side: "away",
    skip_to_golden_goal: false,
    game_speed: "fast",
    opponent_mode: "zombies",
  });
  assert.equal(panel.button("Stops the Game Server") !== null, true);
  assert.equal(panel.button("Fast speed").disabled, true);
  assert.equal(panel.button("Zombies mode").disabled, true);
  assert.equal(panel.parent.querySelector("#team-side-switch").getAttribute("aria-disabled"), "true");
  assert.equal(panel.parent.querySelector("#extra-time-check input").disabled, true);
  assert.equal(panel.button("Starts the match").disabled, false);
  assert.equal(panel.button("Resets the match").disabled, false);
  assert.equal(panel.button("Save positions").disabled, false);
  assert.equal(panel.button("Apply").disabled, false);
  assert.equal(panel.parent.querySelector("select").disabled, false);

  assert.equal(panel.state().home[0].active, false);
  // Off→on while the server is up starts only that slot.
  panel.parent.querySelectorAll(".bot_actions")[1].querySelector('button[title="Active"]').click();
  await flush();
  assert.equal(panel.state().away[0].active, false);
  assert.equal(panel.calls.botStart, 0);
  assert.equal(panel.calls.botStop, 0);
  panel.parent.querySelectorAll(".bot_actions")[1].querySelector('button[title="Active"]').click();
  await flush();
  assert.equal(panel.state().away[0].active, true);
  assert.equal(panel.calls.botStart, 1);
  assert.deepEqual(panel.botStarts[0], { side: "AWAY", number: 1 });
  assert.equal(panel.state().away[0].running, true);
  assert.equal(panel.calls.server, 1);
  assert.equal(panel.calls.match, 0);
  assert.equal(panel.matchSets.some((patch) => patch.away_bots_active && patch.away_bots_active[0] === true), true);

  panel.parent.querySelectorAll('button[title="Ver logs"]')[0].click();
  await flush();
  assert.equal(panel.parent.querySelector(".game-ctrl-log-note"), null);
  assert.equal(panel.state().home[0].logs, true);
  assert.deepEqual(panel.logArms, ["home/1"]);
  assert.deepEqual(panel.openLogs, ["home/1"]);

  panel.button("Save positions").click();
  panel.button("Apply").click();
  await flush();
  assert.equal(panel.parent.querySelector("select").querySelectorAll("option").length, 0);
  assert.equal(panel.calls.getPositions, 0);
  assert.equal(panel.calls.applyPositions, 0);
  assert.equal(panel.calls.match, 0);

  panel.button("Starts the match").click();
  await flush();
  assert.equal(panel.calls.match, 1);
  assert.equal(panel.matchStarts[0].active.length, 21);
  assert.equal(panel.matchStarts[0].active.some((slot) => slot.side === "HOME" && slot.number === 1), false);
  assert.equal(panel.matchStarts[0].active.some((slot) => slot.side === "AWAY" && slot.number === 1), true);
  assert.equal(panel.state().home[0].running, false);
  assert.equal(panel.state().away[0].running, true);
  assert.equal(panel.notices.length, 1);
  assert.equal(panel.calls.stop, 0);
  panel.restore();
});

test("save adds a list entry; apply and reset call host methods while the server is running", async () => {
  const snapshot = {
    ball: { x: 100, y: 200 },
    homeTeam: { 1: { x: 1, y: 2 } },
    awayTeam: { 1: { x: 3, y: 4 } },
  };
  const panel = mountPanel({
    promptAnswer: "corner",
    getPositions: async () => ({ ok: true, body: snapshot }),
  });

  panel.button("Starts the Game Server").click();
  await flush();
  assert.equal(panel.state().serverRunning, true);

  panel.button("Save positions").click();
  await flush();
  assert.equal(panel.calls.getPositions, 1);
  assert.equal(panel.matchSets.some((patch) => Array.isArray(patch.saved_positions)), true);
  assert.deepEqual(panel.state().positions, ["corner"]);
  assert.deepEqual(panel.savedPositions(), [{ name: "corner", ...snapshot }]);
  assert.equal(panel.parent.querySelector("select").querySelectorAll("option").length, 1);
  assert.equal(panel.parent.querySelector("select").value, "corner");
  assert.equal(panel.notices.some((item) => item.title === "Positions saved"), true);

  panel.button("Apply").click();
  await flush();
  assert.equal(panel.calls.applyPositions, 1);
  assert.deepEqual(panel.appliedSnapshots[0], snapshot);
  assert.equal(panel.notices.some((item) => item.title === "Positions applied"), true);

  panel.button("Resets the match").click();
  await flush();
  assert.equal(panel.calls.reset, 1);
  assert.equal(panel.notices.some((item) => item.title === "Match reset"), true);
  panel.restore();
});

test("config, game speed, and opponent mode stay locked while the server is running", async () => {
  const panel = mountPanel();

  panel.button("Slow speed").click();
  panel.button("Kids mode").click();
  panel.parent.querySelector("#team-side-switch").click();
  panel.parent.querySelector("#extra-time-check input").checked = true;
  panel.parent.querySelector("#extra-time-check input").listeners.change[0]({ preventDefault() {} });
  await flush();
  assert.equal(panel.state().speed, "slow");
  assert.equal(panel.state().opponent, "kids");
  assert.equal(panel.state().side, "away");
  assert.equal(panel.state().skipGolden, true);
  assert.equal(panel.matchSets.length, 4);
  assert.deepEqual(panel.matchSets[0], {
    team_side: "home",
    skip_to_golden_goal: false,
    game_speed: "slow",
    opponent_team: "default",
  });
  assert.deepEqual(panel.matchSets[3], {
    team_side: "away",
    skip_to_golden_goal: true,
    game_speed: "slow",
    opponent_team: "kids",
  });

  panel.button("Starts the Game Server").click();
  await flush();
  assert.equal(panel.state().serverRunning, true);
  assert.equal(panel.button("Normal Speed").disabled, true);
  assert.equal(panel.button("Fast speed").disabled, true);
  assert.equal(panel.button("Zombies mode").disabled, true);
  assert.equal(panel.button("Normal game").disabled, true);
  assert.equal(panel.parent.querySelector("#team-side-switch").getAttribute("aria-disabled"), "true");
  assert.equal(panel.parent.querySelector("#extra-time-check input").disabled, true);

  const writesBeforeLock = panel.matchSets.length;
  panel.button("Fast speed").click();
  panel.button("Zombies mode").click();
  panel.parent.querySelector("#team-side-switch").click();
  panel.parent.querySelector("#extra-time-check input").checked = false;
  panel.parent.querySelector("#extra-time-check input").listeners.change[0]({ preventDefault() {} });
  await flush();

  assert.equal(panel.state().speed, "slow");
  assert.equal(panel.state().opponent, "kids");
  assert.equal(panel.state().side, "away");
  assert.equal(panel.state().skipGolden, true);
  assert.equal(panel.button("Slow speed").getAttribute("aria-pressed"), "true");
  assert.equal(panel.button("Kids mode").getAttribute("aria-pressed"), "true");
  assert.equal(panel.matchSets.length, writesBeforeLock);
  panel.restore();
});

test("toggling side or speed while the server is down writes match settings", async () => {
  const panel = mountPanel();

  panel.parent.querySelector("#team-side-switch").click();
  await flush();
  assert.equal(panel.state().side, "away");
  assert.deepEqual(panel.matchSets.at(-1), {
    team_side: "away",
    skip_to_golden_goal: false,
    game_speed: "normal",
    opponent_team: "default",
  });

  panel.button("Fast speed").click();
  await flush();
  assert.equal(panel.state().speed, "fast");
  assert.deepEqual(panel.matchSets.at(-1), {
    team_side: "away",
    skip_to_golden_goal: false,
    game_speed: "fast",
    opponent_team: "default",
  });
  assert.equal(panel.matchSets.length, 2);
  panel.restore();
});

test("positions and match stay locked while the server is down; active switch persists locally", async () => {
  const panel = mountPanel();

  assert.equal(panel.state().serverRunning, false);
  assert.equal(panel.button("Starts the match").disabled, true);
  assert.equal(panel.button("Resets the match").disabled, true);
  assert.equal(panel.button("Save positions").disabled, true);
  assert.equal(panel.button("Apply").disabled, true);
  assert.equal(panel.parent.querySelector("select").disabled, true);
  assert.equal(panel.parent.querySelector(".bot_actions").querySelector('button[title="Active"]').disabled, false);
  assert.equal(panel.parent.querySelector(".bot_actions").querySelector('button[title="Ver logs"]').disabled, false);

  panel.button("Starts the match").click();
  panel.button("Resets the match").click();
  panel.button("Save positions").click();
  panel.button("Apply").click();
  panel.parent.querySelector(".bot_actions").querySelector('button[title="Active"]').click();
  panel.parent.querySelector(".bot_actions").querySelector('button[title="Ver logs"]').click();
  await flush();

  assert.equal(panel.calls.match, 0);
  assert.equal(panel.calls.reset, 0);
  assert.equal(panel.calls.getPositions, 0);
  assert.equal(panel.calls.applyPositions, 0);
  assert.equal(panel.calls.botStart, 0);
  assert.equal(panel.calls.botStop, 0);
  assert.equal(panel.state().home[0].active, false);
  assert.equal(panel.state().home[0].running, false);
  assert.equal(panel.state().home[0].logs, true);
  assert.equal(panel.matchSets.some((patch) => patch.home_bots_active && patch.home_bots_active[0] === false), true);
  assert.equal(panel.parent.querySelector(".game-ctrl-log-note"), null);
  assert.deepEqual(panel.logArms, ["home/1"]);
  assert.deepEqual(panel.openLogs, ["home/1"]);
  assert.equal(Object.hasOwn(panel.matchSets.find((patch) => patch.home_bots_active) || {}, "home_bots_logs"), false);

  panel.button("Starts the Game Server").click();
  await flush();
  assert.equal(panel.state().serverRunning, true);
  assert.equal(panel.button("Starts the match").disabled, false);
  assert.equal(panel.button("Resets the match").disabled, false);
  assert.equal(panel.button("Save positions").disabled, false);
  assert.equal(panel.button("Apply").disabled, false);
  assert.equal(panel.parent.querySelector("select").disabled, false);

  panel.button("Starts the match").click();
  await flush();
  assert.equal(panel.calls.match, 1);
  assert.equal(panel.matchStarts[0].active.some((slot) => slot.side === "HOME" && slot.number === 1), false);
  assert.equal(panel.matchStarts[0].active.length, 21);
  assert.equal(panel.state().home[0].running, false);
  assert.equal(panel.state().home[1].running, true);
  assert.equal(panel.notices.length, 1);
  panel.restore();
});

test("active switch starts and stops a bot only while the server is up", async () => {
  const panel = mountPanel();

  panel.parent.querySelector(".bot_actions").querySelector('button[title="Active"]').click();
  await flush();
  assert.equal(panel.state().home[0].active, false);
  assert.equal(panel.calls.botStart, 0);
  assert.equal(panel.matchSets.some((patch) => patch.home_bots_active && patch.home_bots_active[0] === false), true);

  panel.button("Starts the Game Server").click();
  await flush();

  // Off→on starts AWAY/3; on→off stops it. Preference persists in both states.
  const awayActive = () => panel.parent
    .querySelectorAll(".bot_actions")[1]
    .querySelectorAll('button[title="Active"]')[2];

  awayActive().click();
  await flush();
  assert.equal(panel.state().away[2].active, false);
  assert.equal(panel.calls.botStart, 0);
  assert.equal(panel.calls.botStop, 0);

  awayActive().click();
  await flush();
  assert.equal(panel.state().away[2].active, true);
  assert.equal(panel.calls.botStart, 1);
  assert.deepEqual(panel.botStarts[0], { side: "AWAY", number: 3 });
  assert.equal(panel.state().away[2].running, true);
  assert.equal(panel.matchSets.some((patch) => patch.away_bots_active && patch.away_bots_active[2] === true), true);

  awayActive().click();
  await flush();
  assert.equal(panel.state().away[2].active, false);
  assert.equal(panel.calls.botStop, 1);
  assert.deepEqual(panel.botStops[0], { side: "AWAY", number: 3 });
  assert.equal(panel.state().away[2].running, false);
  assert.equal(panel.matchSets.some((patch) => patch.away_bots_active && patch.away_bots_active[2] === false), true);

  panel.button("Starts the match").click();
  await flush();
  assert.equal(panel.matchStarts[0].active.some((slot) => slot.side === "HOME" && slot.number === 1), false);
  assert.equal(panel.matchStarts[0].active.some((slot) => slot.side === "AWAY" && slot.number === 3), false);
  assert.equal(panel.state().home[0].running, false);
  assert.equal(panel.state().away[2].running, false);
  panel.restore();
});

test("match-start IPC includes only active rows", async () => {
  const panel = mountPanel();

  function activeButton(teamIndex, playerIndex) {
    return panel.parent
      .querySelectorAll(".bot_actions")[teamIndex]
      .querySelectorAll('button[title="Active"]')[playerIndex];
  }

  // Defaults are all active; turn off every slot except HOME/1, HOME/5, AWAY/11.
  for (let index = 0; index < 11; index += 1) {
    if (index !== 0 && index !== 4) {
      activeButton(0, index).click();
    }
    if (index !== 10) {
      activeButton(1, index).click();
    }
  }
  await flush();
  assert.equal(panel.state().home[0].active, true);
  assert.equal(panel.state().home[4].active, true);
  assert.equal(panel.state().away[10].active, true);
  assert.equal(panel.state().home[1].active, false);

  panel.button("Starts the Game Server").click();
  await flush();
  panel.button("Starts the match").click();
  await flush();

  assert.equal(panel.calls.match, 1);
  assert.deepEqual(panel.matchStarts[0], {
    active: [
      { side: "HOME", number: 1 },
      { side: "HOME", number: 5 },
      { side: "AWAY", number: 11 },
    ],
  });
  panel.restore();
});

test("server start sends current match settings and stop still confirms", async () => {
  const panel = mountPanel();

  panel.button("Slow speed").click();
  panel.button("Kids mode").click();
  panel.parent.querySelector("#team-side-switch").click();
  panel.parent.querySelector("#extra-time-check input").checked = true;
  panel.parent.querySelector("#extra-time-check input").listeners.change[0]({ preventDefault() {} });
  await flush();

  panel.button("Starts the Game Server").click();
  await flush();
  assert.equal(panel.calls.server, 1);
  assert.deepEqual(panel.serverStarts[0], {
    team_side: "away",
    skip_to_golden_goal: true,
    game_speed: "slow",
    opponent_mode: "kids",
  });
  assert.equal(panel.matchSets.length >= 4, true);
  assert.equal(panel.state().serverRunning, true);
  assert.equal(panel.button("Stops the Game Server") !== null, true);
  panel.restore();
});

test("canceling server stop confirmation does not call stop", async () => {
  const panel = mountPanel({ confirmAnswer: false });

  panel.button("Starts the Game Server").click();
  await flush();
  assert.equal(panel.state().serverRunning, true);

  panel.button("Stops the Game Server").click();
  await flush();
  assert.equal(panel.confirms.length, 1);
  assert.equal(panel.confirms[0].title, "Stop the Game Server?");
  assert.equal(panel.calls.stop, 0);
  assert.equal(panel.state().serverRunning, true);
  assert.equal(panel.button("Stops the Game Server") !== null, true);
  panel.restore();
});

test("confirming server stop calls the API and updates the power control", async () => {
  const panel = mountPanel();

  panel.button("Starts the Game Server").click();
  await flush();
  assert.equal(panel.state().serverRunning, true);

  panel.button("Stops the Game Server").click();
  await flush();
  assert.equal(panel.confirms.length, 1);
  assert.equal(panel.confirms[0].confirmLabel, "Stop");
  assert.equal(panel.calls.stop, 1);
  assert.equal(panel.calls.server, 1);
  assert.equal(panel.state().serverRunning, false);
  assert.equal(panel.button("Starts the Game Server") !== null, true);
  panel.restore();
});

test("server and match start failures leave local state unchanged", async () => {
  let serverOk = false;
  const panel = mountPanel({
    serverStart: async () => (serverOk ? { ok: true } : { ok: false, error: "server down" }),
    matchStart: async () => ({ ok: false, error: "match down" }),
  });

  panel.button("Starts the Game Server").click();
  await flush();
  assert.equal(panel.calls.server, 1);
  assert.equal(panel.state().serverRunning, false);
  assert.equal(panel.button("Starts the Game Server") !== null, true);
  assert.equal(panel.confirms.some((item) => item.body === "server down"), true);
  assert.equal(panel.button("Starts the match").disabled, true);

  serverOk = true;
  panel.button("Starts the Game Server").click();
  await flush();
  assert.equal(panel.calls.server, 2);
  assert.equal(panel.state().serverRunning, true);
  assert.equal(panel.button("Starts the match").disabled, false);

  panel.button("Starts the match").click();
  await flush();
  assert.equal(panel.calls.match, 1);
  assert.equal(panel.matchStarts[0].active.length, 22);
  assert.equal(panel.confirms.some((item) => item.body === "match down"), true);
  panel.restore();
});

test("server log control stays interactive while match config is locked and calls the arm API", async () => {
  const panel = mountPanel();
  const logsButton = () => panel.button("Server logs");

  assert.equal(panel.state().serverLogs, false);
  assert.equal(logsButton().disabled, false);
  assert.equal(logsButton().getAttribute("aria-pressed"), "false");

  panel.button("Slow speed").click();
  await flush();
  panel.button("Starts the Game Server").click();
  await flush();
  assert.equal(panel.state().serverRunning, true);
  assert.equal(panel.button("Fast speed").disabled, true);
  assert.equal(panel.parent.querySelector("#team-side-switch").getAttribute("aria-disabled"), "true");
  assert.equal(logsButton().disabled, false);

  const writesWhileLocked = panel.matchSets.length;
  logsButton().click();
  await flush();
  assert.equal(panel.state().serverLogs, true);
  assert.equal(logsButton().disabled, false);
  assert.equal(logsButton().getAttribute("aria-pressed"), "true");
  assert.deepEqual(panel.logArms, ["server"]);
  assert.deepEqual(panel.logDisarms, []);
  assert.equal(panel.matchSets.length, writesWhileLocked);
  assert.equal(panel.state().home.every((row) => row.logs === false), true);

  logsButton().click();
  await flush();
  assert.equal(panel.state().serverLogs, false);
  assert.deepEqual(panel.logDisarms, ["server"]);
  assert.equal(panel.matchSets.length, writesWhileLocked);

  panel.restore();
  const fresh = mountPanel();
  assert.equal(fresh.state().serverLogs, false);
  assert.equal(fresh.button("Server logs").getAttribute("aria-pressed"), "false");
  assert.deepEqual(fresh.logArms, []);
  fresh.restore();
});

test("game control styles are scoped to the side menu", () => {
  const css = readFileSync(new URL("../src/renderer/styles/pages.css", import.meta.url), "utf8");
  assert.match(css, /\.side-menu \.game-ctrl/);
  assert.match(css, /48px 240px/);
  assert.match(css, /168px 240px/);
  assert.match(css, /\.app-status-bar\s*\{/);
  assert.match(css, /\.tab-actions,\s*\n\.area-actions\s*\{[^}]*overflow:\s*auto/s);
  assert.match(css, /\.side-menu-pinned,\s*\n\.area-lateral-footer\s*\{[^}]*margin-top:\s*auto/s);
});
