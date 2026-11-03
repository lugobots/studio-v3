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
  botStart = async () => ({ ok: true }),
  botStop = async () => ({ ok: true }),
  confirmAnswer = true,
  initialState = null,
} = {}) {
  const installed = installDocument();
  const parent = installed.document.createElement("div");
  let state = initialState || initialGameControls();
  const calls = { server: 0, stop: 0, match: 0, botStart: 0, botStop: 0 };
  const matchStarts = [];
  const botStarts = [];
  const botStops = [];
  const matchSets = [];
  const notices = [];
  const confirms = [];
  const host = {
    config: {
      async matchSet(patch) {
        matchSets.push(patch);
        return patch;
      },
    },
    server: {
      async start() {
        calls.server += 1;
        return serverStart();
      },
      async stop() {
        calls.stop += 1;
        return serverStop();
      },
    },
    match: {
      async start(payload) {
        calls.match += 1;
        matchStarts.push(payload);
        return matchStart(payload);
      },
    },
    bot: {
      async start(payload) {
        calls.botStart += 1;
        botStarts.push(payload);
        return botStart(payload);
      },
      async stop(payload) {
        calls.botStop += 1;
        botStops.push(payload);
        return botStop(payload);
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
    });
  }

  paint();
  return {
    parent,
    calls,
    matchStarts,
    botStarts,
    botStops,
    matchSets,
    notices,
    confirms,
    state: () => state,
    restore: installed.restore,
    button(title) {
      return parent.querySelector(`button[title="${title}"]`);
    },
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
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
  assert.equal(panel.state().home[0].active, true);
  assert.equal(panel.state().home[0].running, false);
  assert.equal(panel.state().serverRunning, false);
  assert.equal(panel.calls.server, 0);
  assert.equal(panel.calls.match, 0);
  assert.equal(panel.calls.botStart, 0);
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

  assert.equal(panel.state().home[0].active, true);
  panel.parent.querySelectorAll(".bot_actions")[1].querySelector('button[title="Active"]').click();
  await flush();
  assert.equal(panel.state().away[0].active, true);
  assert.equal(panel.calls.botStart, 1);
  assert.deepEqual(panel.botStarts[0], { side: "AWAY", number: 1 });
  assert.equal(panel.state().away[0].running, true);
  assert.equal(panel.calls.server, 1);
  assert.equal(panel.calls.match, 0);

  panel.parent.querySelectorAll('button[title="Ver logs"]')[0].click();
  const note = panel.parent.querySelector(".game-ctrl-log-note");
  assert.equal(note.textContent.includes("logger"), true);
  assert.equal(note.textContent.includes("Editor tab"), true);

  panel.button("Save positions").click();
  panel.button("Apply").click();
  panel.button("Resets the match").click();
  assert.equal(panel.parent.querySelector("select").querySelectorAll("option").length, 0);
  assert.equal(panel.calls.match, 0);

  panel.button("Starts the match").click();
  await flush();
  assert.equal(panel.calls.match, 1);
  assert.deepEqual(panel.matchStarts[0], {
    active: [
      { side: "HOME", number: 1 },
      { side: "AWAY", number: 1 },
    ],
  });
  assert.equal(panel.state().home[0].running, true);
  assert.equal(panel.state().away[0].running, true);
  assert.equal(panel.notices.length, 1);
  assert.equal(panel.calls.stop, 0);
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

test("positions and match stay locked while the server is down; active switch stays local", async () => {
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
  assert.equal(panel.calls.botStart, 0);
  assert.equal(panel.calls.botStop, 0);
  assert.equal(panel.state().home[0].active, true);
  assert.equal(panel.state().home[0].running, false);
  assert.equal(panel.state().home[0].logs, true);
  assert.equal(panel.parent.querySelector(".game-ctrl-log-note") !== null, true);

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
  assert.deepEqual(panel.matchStarts[0], {
    active: [{ side: "HOME", number: 1 }],
  });
  assert.equal(panel.state().home[0].running, true);
  assert.equal(panel.notices.length, 1);
  panel.restore();
});

test("active switch starts and stops a bot only while the server is up", async () => {
  const panel = mountPanel();

  panel.parent.querySelector(".bot_actions").querySelector('button[title="Active"]').click();
  await flush();
  assert.equal(panel.state().home[0].active, true);
  assert.equal(panel.calls.botStart, 0);

  panel.button("Starts the Game Server").click();
  await flush();

  panel.parent.querySelectorAll(".bot_actions")[1].querySelectorAll('button[title="Active"]')[2].click();
  await flush();
  assert.equal(panel.state().away[2].active, true);
  assert.equal(panel.calls.botStart, 1);
  assert.deepEqual(panel.botStarts[0], { side: "AWAY", number: 3 });
  assert.equal(panel.state().away[2].running, true);

  panel.parent.querySelectorAll(".bot_actions")[1].querySelectorAll('button[title="Active"]')[2].click();
  await flush();
  assert.equal(panel.state().away[2].active, false);
  assert.equal(panel.calls.botStop, 1);
  assert.deepEqual(panel.botStops[0], { side: "AWAY", number: 3 });
  assert.equal(panel.state().away[2].running, false);

  panel.button("Starts the match").click();
  await flush();
  assert.deepEqual(panel.matchStarts[0], {
    active: [{ side: "HOME", number: 1 }],
  });
  assert.equal(panel.state().home[0].running, true);
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

  activeButton(0, 0).click();
  activeButton(0, 4).click();
  activeButton(1, 10).click();
  await flush();
  assert.equal(panel.state().home[0].active, true);
  assert.equal(panel.state().home[4].active, true);
  assert.equal(panel.state().away[10].active, true);

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
  assert.deepEqual(panel.matchStarts[0], { active: [] });
  assert.equal(panel.confirms.some((item) => item.body === "match down"), true);
  panel.restore();
});

test("game control styles are scoped to the side menu", () => {
  const css = readFileSync(new URL("../src/renderer/styles/pages.css", import.meta.url), "utf8");
  assert.match(css, /\.side-menu \.game-ctrl/);
  assert.match(css, /260px/);
  assert.match(css, /\.tab-actions\s*\{[^}]*overflow:\s*auto/s);
  assert.match(css, /\.side-menu-pinned\s*\{[^}]*margin-top:\s*auto/s);
});
