import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initialGameControls } from "../src/renderer/shell/game-controls.js";
import { renderGameControls } from "../src/renderer/shell/game-controls-view.js";
import { installDocument, leafText } from "./dom-stub.mjs";

const SECTIONS = ["Server", "Match", "Home", "Away", "Positions", "Config", "Game speed", "Opponent mode"];

function mountPanel({
  serverStart = async () => ({ ok: true }),
  matchStart = async () => ({ ok: true }),
} = {}) {
  const installed = installDocument();
  const parent = installed.document.createElement("div");
  let state = initialGameControls();
  const calls = { server: 0, match: 0 };
  const notices = [];
  const confirms = [];
  const host = {
    server: {
      async start() {
        calls.server += 1;
        return serverStart();
      },
    },
    match: {
      async start() {
        calls.match += 1;
        return matchStart();
      },
    },
  };
  const dialogs = {
    notify(payload) {
      notices.push(payload);
    },
    async confirm(payload) {
      confirms.push(payload);
      return true;
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
    assert.equal(team.querySelectorAll('button[title="Start"]').length, 11);
    assert.equal(team.querySelectorAll('button[title="Kill"]').length, 11);
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

  const play = panel.parent.querySelector(".game-ctrl-play");
  const settings = panel.parent.querySelector(".game-ctrl-settings");
  assert.equal(play.style.opacity, "0.3");
  assert.equal(settings.style.opacity, "1");

  panel.parent.querySelector(".bot_actions").querySelector('button[title="Start"]').click();
  assert.equal(panel.state().home[0].running, true);
  assert.equal(panel.state().serverRunning, false);
  assert.equal(panel.calls.server, 0);
  assert.equal(panel.calls.match, 0);
  assert.equal(panel.parent.querySelector(".game-ctrl-play").style.opacity, "0.3");

  panel.button("Starts the Game Server").click();
  await flush();
  assert.equal(panel.calls.server, 1);
  assert.equal(panel.button("Stops the Game Server") !== null, true);
  assert.equal(panel.parent.querySelector(".game-ctrl-play").style.opacity, "1");
  assert.equal(panel.parent.querySelector(".game-ctrl-settings").style.opacity, "0.2");

  panel.button("Fast speed").click();
  assert.equal(panel.state().speed, "fast");
  assert.equal(panel.button("Fast speed").getAttribute("aria-pressed"), "true");
  assert.equal(panel.button("Normal Speed").getAttribute("aria-pressed"), "false");
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
  assert.equal(panel.notices.length, 1);

  panel.button("Stops the Game Server").click();
  assert.equal(panel.state().serverRunning, false);
  assert.equal(panel.calls.server, 1);
  assert.equal(panel.button("Starts the Game Server") !== null, true);
  panel.restore();
});

test("server and match start failures leave local state unchanged", async () => {
  const panel = mountPanel({
    serverStart: async () => ({ ok: false, error: "server down" }),
    matchStart: async () => ({ ok: false, error: "match down" }),
  });

  panel.button("Starts the Game Server").click();
  await flush();
  assert.equal(panel.calls.server, 1);
  assert.equal(panel.state().serverRunning, false);
  assert.equal(panel.button("Starts the Game Server") !== null, true);
  assert.equal(panel.confirms.some((item) => item.body === "server down"), true);

  panel.button("Starts the match").click();
  await flush();
  assert.equal(panel.calls.match, 1);
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
