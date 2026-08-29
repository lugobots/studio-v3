/**
 * Route → shell chrome. Pure helpers so Node can unit-test without Electron.
 * `/main` uses the full sidebar/header/status chrome; startup screens stay simple.
 */

import { PATHS } from "../lib/startup-sequencer.mjs";

export const SHELL_MODE = Object.freeze({
  MAIN: "main",
  SIMPLE: "simple",
});

const IMAGE_STATES = new Set(["idle", "pulling", "ready", "error"]);

const DEFAULT_PATH_MAX = 48;

/**
 * @param {string} path
 * @returns {typeof SHELL_MODE.MAIN | typeof SHELL_MODE.SIMPLE}
 */
export function shellModeForRoute(path) {
  return path === PATHS.main ? SHELL_MODE.MAIN : SHELL_MODE.SIMPLE;
}

/**
 * Shorten a filesystem path for the header. The full string belongs in `title`.
 * Middle ellipsis keeps a drive/UNC prefix and the leaf folder.
 *
 * @param {unknown} path
 * @param {number} [maxLength]
 * @returns {string}
 */
export function truncatePath(path, maxLength = DEFAULT_PATH_MAX) {
  if (typeof path !== "string") {
    return "";
  }
  const value = path.trim();
  if (!value) {
    return "";
  }
  const limit = Number.isFinite(maxLength) && maxLength >= 8 ? maxLength : DEFAULT_PATH_MAX;
  if (value.length <= limit) {
    return value;
  }
  const ellipsis = "…";
  const budget = limit - ellipsis.length;
  const head = Math.max(4, Math.ceil(budget * 0.4));
  const tail = Math.max(4, budget - head);
  return `${value.slice(0, head)}${ellipsis}${value.slice(value.length - tail)}`;
}

/**
 * @param {unknown} running
 * @returns {string}
 */
export function dockerStatusText(running) {
  if (running === true) {
    return "Docker: yes";
  }
  if (running === false) {
    return "Docker: no";
  }
  return "Docker: unknown";
}

/**
 * Map `imageStatus()` or `onImageProgress` payloads to idle/pulling/ready/error.
 * Missing snapshots are `null` so the UI can say "unknown" instead of "ready".
 *
 * @param {unknown} snapshot
 * @returns {"idle" | "pulling" | "ready" | "error" | null}
 */
export function imageStateFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }
  const state = snapshot.state;
  if (IMAGE_STATES.has(state)) {
    return state;
  }
  if (snapshot.pulling === true) {
    return "pulling";
  }
  if (typeof snapshot.error === "string" && snapshot.error.length > 0) {
    return "error";
  }
  if (snapshot.present === true) {
    return "ready";
  }
  return "idle";
}

/**
 * @param {"idle" | "pulling" | "ready" | "error" | null | undefined} state
 * @param {unknown} [percent]
 * @returns {string}
 */
export function imageStatusText(state, percent) {
  let label = "Image: unknown";
  if (state === "idle") {
    label = "Image: idle";
  } else if (state === "pulling") {
    label = "Image: pulling";
  } else if (state === "ready") {
    label = "Image: ready";
  } else if (state === "error") {
    label = "Image: error";
  }
  if (state === "pulling" && Number.isFinite(percent)) {
    const n = Math.round(percent);
    if (n >= 0 && n <= 100) {
      return `${label} (${n}%)`;
    }
  }
  return label;
}

/**
 * @param {unknown} version
 * @returns {string}
 */
export function studioVersionText(version) {
  const text = typeof version === "string" ? version.trim() : "";
  if (!text) {
    return "Studio version pending";
  }
  return `Studio ${text}`;
}

/**
 * Open-project path from `config.get()`. Prefer the derived `projectPath`.
 *
 * @param {unknown} config
 * @returns {string}
 */
export function projectPathFromConfig(config) {
  if (!config || typeof config !== "object") {
    return "";
  }
  const derived = config.projectPath;
  if (typeof derived === "string" && derived.trim() && derived.trim() !== ".") {
    return derived.trim();
  }
  const stored = config.project_path;
  if (typeof stored === "string" && stored.trim() && stored.trim() !== ".") {
    return stored.trim();
  }
  return "";
}
