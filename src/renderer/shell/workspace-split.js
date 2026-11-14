/**
 * Workspace pane split math (mirrors src/shared/workspace-split.js for the renderer).
 * Keep constants and clamp rules aligned with the shared CJS module.
 */

/** Game share of the horizontal split when unset (equal panes). */
export const DEFAULT_HORIZONTAL = 0.5;

/**
 * Default logs share of Workspace main height when unset.
 * ~0.2 approximates the previous fixed 180px body on a typical window.
 */
export const DEFAULT_LOGS = 0.2;

/** Max wider:narrower for game↔editor (10:1) ⇒ each side ∈ [1/11, 10/11]. */
export const HORIZONTAL_MAX_RATIO = 10;
export const HORIZONTAL_MIN = 1 / (HORIZONTAL_MAX_RATIO + 1);
export const HORIZONTAL_MAX = HORIZONTAL_MAX_RATIO / (HORIZONTAL_MAX_RATIO + 1);

/** Max logs : upper = 1:2 ⇒ logs ≤ 1/3 of Workspace main height. */
export const LOGS_MAX = 1 / 3;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Normalize a stored or live horizontal game-share fraction.
 * Missing/invalid → DEFAULT_HORIZONTAL; otherwise clamped to the 10:1 band.
 */
export function clampHorizontal(value) {
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
export function clampLogs(value) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return DEFAULT_LOGS;
  }
  return clamp(n, 0, LOGS_MAX);
}

/**
 * Game share from a pointer x within a split width (pixels).
 */
export function horizontalFromPointer(clientX, splitLeft, splitWidth) {
  if (!(splitWidth > 0)) {
    return DEFAULT_HORIZONTAL;
  }
  return clampHorizontal((clientX - splitLeft) / splitWidth);
}

/**
 * Logs share from pointer y within Workspace main height (pixels).
 * Drawer grows upward from the bottom as y approaches mainBottom.
 */
export function logsFromPointer(clientY, mainTop, mainHeight) {
  if (!(mainHeight > 0)) {
    return DEFAULT_LOGS;
  }
  const fromBottom = mainTop + mainHeight - clientY;
  return clampLogs(fromBottom / mainHeight);
}

/**
 * Apply horizontal game/editor fractions to flex panes.
 * @param {HTMLElement|null} gamePanel
 * @param {HTMLElement|null} editorPanel
 * @param {number} gameShare
 */
export function applyHorizontalSplit(gamePanel, editorPanel, gameShare) {
  const game = clampHorizontal(gameShare);
  const editor = 1 - game;
  if (gamePanel) {
    gamePanel.style.flex = `1 1 ${game * 100}%`;
  }
  if (editorPanel) {
    editorPanel.style.flex = `1 1 ${editor * 100}%`;
  }
}

/**
 * Apply logs share as a CSS variable on the Workspace main element.
 * @param {HTMLElement|null} workspaceMain
 * @param {number} logsShare
 * @param {{ expanded?: boolean }} [options]
 */
export function applyLogsSplit(workspaceMain, logsShare, { expanded = true } = {}) {
  const style = workspaceMain?.style;
  if (!style) {
    return;
  }
  if (!expanded) {
    if (typeof style.removeProperty === "function") {
      style.removeProperty("--workspace-logs-share");
    } else {
      delete style["--workspace-logs-share"];
    }
    return;
  }
  const value = String(clampLogs(logsShare));
  if (typeof style.setProperty === "function") {
    style.setProperty("--workspace-logs-share", value);
  } else {
    style["--workspace-logs-share"] = value;
  }
}

/**
 * Toggle iframe hit-testing while a splitter drag is active.
 * @param {Iterable<HTMLElement|null|undefined>} frames
 * @param {boolean} enabled
 */
export function setFramesPointerEvents(frames, enabled) {
  const value = enabled ? "" : "none";
  for (const frame of frames) {
    if (frame && frame.style) {
      frame.style.pointerEvents = value;
    }
  }
}
