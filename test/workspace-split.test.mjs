import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import {
  DEFAULT_HORIZONTAL,
  DEFAULT_LOGS,
  HORIZONTAL_MIN,
  HORIZONTAL_MAX,
  LOGS_MAX,
  clampHorizontal,
  clampLogs,
  horizontalFromPointer,
  logsFromPointer,
  applyHorizontalSplit,
  applyLogsSplit,
  setFramesPointerEvents,
} from "../src/renderer/shell/workspace-split.js";

const require = createRequire(import.meta.url);
const shared = require("../src/shared/workspace-split.js");

test("renderer and shared clamp constants stay aligned", () => {
  assert.equal(DEFAULT_HORIZONTAL, shared.DEFAULT_HORIZONTAL);
  assert.equal(DEFAULT_LOGS, shared.DEFAULT_LOGS);
  assert.equal(HORIZONTAL_MIN, shared.HORIZONTAL_MIN);
  assert.equal(HORIZONTAL_MAX, shared.HORIZONTAL_MAX);
  assert.equal(LOGS_MAX, shared.LOGS_MAX);
});

test("clampHorizontal enforces 10:1 band and defaults invalid input", () => {
  assert.equal(clampHorizontal(undefined), DEFAULT_HORIZONTAL);
  assert.equal(clampHorizontal("nope"), DEFAULT_HORIZONTAL);
  assert.equal(clampHorizontal(Number.NaN), DEFAULT_HORIZONTAL);
  assert.equal(clampHorizontal(0), HORIZONTAL_MIN);
  assert.equal(clampHorizontal(1), HORIZONTAL_MAX);
  assert.equal(clampHorizontal(0.5), 0.5);
  assert.equal(clampHorizontal(HORIZONTAL_MIN), HORIZONTAL_MIN);
  assert.equal(clampHorizontal(HORIZONTAL_MAX), HORIZONTAL_MAX);
});

test("clampLogs enforces max one-third and defaults invalid input", () => {
  assert.equal(clampLogs(undefined), DEFAULT_LOGS);
  assert.equal(clampLogs("x"), DEFAULT_LOGS);
  assert.equal(clampLogs(-1), 0);
  assert.equal(clampLogs(0.9), LOGS_MAX);
  assert.equal(clampLogs(0.25), 0.25);
});

test("pointer helpers map coordinates into clamped fractions", () => {
  assert.equal(horizontalFromPointer(100, 0, 0), DEFAULT_HORIZONTAL);
  assert.equal(horizontalFromPointer(50, 0, 100), 0.5);
  assert.equal(horizontalFromPointer(-10, 0, 100), HORIZONTAL_MIN);
  assert.equal(horizontalFromPointer(200, 0, 100), HORIZONTAL_MAX);

  assert.equal(logsFromPointer(0, 0, 0), DEFAULT_LOGS);
  // y at top of main → almost full height from bottom → clamped to LOGS_MAX
  assert.equal(logsFromPointer(0, 0, 300), LOGS_MAX);
  // y at bottom → zero logs share
  assert.equal(logsFromPointer(300, 0, 300), 0);
  // y such that fromBottom / height = 0.2
  assert.equal(logsFromPointer(240, 0, 300), 0.2);
});

test("apply helpers set flex and CSS variables without throwing on null", () => {
  applyHorizontalSplit(null, null, 0.6);
  applyLogsSplit(null, 0.2);

  const game = { style: {} };
  const editor = { style: {} };
  applyHorizontalSplit(game, editor, 0.6);
  assert.equal(game.style.flex, "1 1 60%");
  assert.equal(editor.style.flex, "1 1 40%");

  const main = { style: {} };
  applyLogsSplit(main, 0.9, { expanded: true });
  assert.equal(main.style["--workspace-logs-share"], String(LOGS_MAX));
  applyLogsSplit(main, 0.2, { expanded: false });
  assert.equal(Object.hasOwn(main.style, "--workspace-logs-share"), false);

  const frame = { style: { pointerEvents: "" } };
  setFramesPointerEvents([frame, null], false);
  assert.equal(frame.style.pointerEvents, "none");
  setFramesPointerEvents([frame], true);
  assert.equal(frame.style.pointerEvents, "");
});
