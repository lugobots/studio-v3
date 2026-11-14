"use strict";

/** Game share of the horizontal split when unset (equal panes). */
const DEFAULT_HORIZONTAL = 0.5;

/**
 * Default logs share of Workspace main height when unset.
 * ~0.2 approximates the previous fixed 180px body on a typical window.
 */
const DEFAULT_LOGS = 0.2;

/** Max wider:narrower for game↔editor (10:1) ⇒ each side ∈ [1/11, 10/11]. */
const HORIZONTAL_MAX_RATIO = 10;
const HORIZONTAL_MIN = 1 / (HORIZONTAL_MAX_RATIO + 1);
const HORIZONTAL_MAX = HORIZONTAL_MAX_RATIO / (HORIZONTAL_MAX_RATIO + 1);

/** Max logs : upper = 1:2 ⇒ logs ≤ 1/3 of Workspace main height. */
const LOGS_MAX = 1 / 3;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Normalize a stored or live horizontal game-share fraction.
 * Missing/invalid → DEFAULT_HORIZONTAL; otherwise clamped to the 10:1 band.
 */
function clampHorizontal(value) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return DEFAULT_HORIZONTAL;
  }
  return clamp(n, HORIZONTAL_MIN, HORIZONTAL_MAX);
}

/**
 * Normalize a stored or live logs share of Workspace main height.
 * Missing/invalid → DEFAULT_LOGS; otherwise clamped to [0, LOGS_MAX].
 */
function clampLogs(value) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return DEFAULT_LOGS;
  }
  return clamp(n, 0, LOGS_MAX);
}

/**
 * Game share from a pointer x within a split width (pixels).
 */
function horizontalFromPointer(clientX, splitLeft, splitWidth) {
  if (!(splitWidth > 0)) {
    return DEFAULT_HORIZONTAL;
  }
  return clampHorizontal((clientX - splitLeft) / splitWidth);
}

/**
 * Logs share from pointer y within Workspace main height (pixels).
 * Drawer grows upward from the bottom as y approaches mainBottom.
 */
function logsFromPointer(clientY, mainTop, mainHeight) {
  if (!(mainHeight > 0)) {
    return DEFAULT_LOGS;
  }
  const fromBottom = mainTop + mainHeight - clientY;
  return clampLogs(fromBottom / mainHeight);
}

module.exports = {
  DEFAULT_HORIZONTAL,
  DEFAULT_LOGS,
  HORIZONTAL_MAX_RATIO,
  HORIZONTAL_MIN,
  HORIZONTAL_MAX,
  LOGS_MAX,
  clampHorizontal,
  clampLogs,
  horizontalFromPointer,
  logsFromPointer,
};
