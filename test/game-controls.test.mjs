import test from "node:test";
import assert from "node:assert/strict";
import { initialGameControls, reduceGameControl } from "../src/renderer/shell/game-controls.js";

function stopped(rows) {
  return rows.every((row) => row.running === false && row.logs === false);
}

test("initial game controls are a stopped local match", () => {
  const state = initialGameControls();
  assert.equal(state.serverRunning, false);
  assert.equal(state.home.length, 11);
  assert.equal(state.away.length, 11);
  assert.equal(stopped(state.home), true);
  assert.equal(stopped(state.away), true);
  assert.equal(state.side, "home");
  assert.equal(state.skipGolden, false);
  assert.equal(state.speed, "normal");
  assert.equal(state.opponent, "default");
  assert.deepEqual(state.positions, []);
});

test("controls change only the selected local field", () => {
  const initial = initialGameControls();
  const server = reduceGameControl(initial, { type: "set-server-running", running: true });
  assert.equal(server.serverRunning, true);
  assert.equal(server.speed, initial.speed);
  assert.equal(server.home[0].running, false);

  const apiStop = reduceGameControl(server, { type: "set-server-running", running: false });
  assert.equal(apiStop.serverRunning, false);

  const started = reduceGameControl(server, { type: "set-bot", team: "home", number: 2, control: "start" });
  assert.equal(started.home[1].running, true);
  assert.equal(started.home[0].running, false);
  assert.equal(started.away[1].running, false);
  assert.equal(started.home[1].logs, false);

  const logged = reduceGameControl(started, { type: "set-bot", team: "away", number: 11, control: "logs" });
  assert.equal(logged.away[10].logs, true);
  assert.equal(logged.home[1].running, true);

  const killed = reduceGameControl(logged, { type: "set-bot", team: "home", number: 2, control: "kill" });
  assert.equal(killed.home[1].running, false);
  assert.equal(killed.away[10].logs, true);

  const fast = reduceGameControl(killed, { type: "set-speed", speed: "fast" });
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
