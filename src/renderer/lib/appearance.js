/** Allowed Studio shell appearance values. */
export const APPEARANCES = ["dark", "light"];

/** Default color palette id (pitch green). Future palettes keep the same semantic tokens. */
export const DEFAULT_PALETTE = "default";

const STORAGE_KEY = "studio-v3-appearance";

/**
 * Normalize a stored or requested appearance. Missing/invalid → dark.
 * @param {unknown} value
 * @returns {"dark" | "light"}
 */
export function normalizeAppearance(value) {
  return value === "light" ? "light" : "dark";
}

/**
 * CSS hex for BrowserWindow / first-paint background (--bg-base).
 * @param {"dark" | "light"} appearance
 * @returns {string}
 */
export function backgroundColorForAppearance(appearance) {
  return normalizeAppearance(appearance) === "light" ? "#F4F7F5" : "#0F1412";
}

/**
 * Apply appearance + default palette tokens on the document root.
 * @param {Document} documentRef
 * @param {unknown} appearance
 * @returns {"dark" | "light"}
 */
export function applyAppearance(documentRef, appearance) {
  const next = normalizeAppearance(appearance);
  const root = documentRef?.documentElement;
  if (root) {
    root.setAttribute("data-palette", DEFAULT_PALETTE);
    root.setAttribute("data-theme", next);
    root.style.colorScheme = next;
  }
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore quota / private mode */
  }
  return next;
}

/**
 * Read a previously persisted appearance for first paint (defaults dark).
 * @returns {"dark" | "light"}
 */
export function readCachedAppearance() {
  try {
    return normalizeAppearance(globalThis.localStorage?.getItem(STORAGE_KEY));
  } catch {
    return "dark";
  }
}
