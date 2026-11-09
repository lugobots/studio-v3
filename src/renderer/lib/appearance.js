/** Allowed Studio shell appearance values. */
export const APPEARANCES = ["dark", "light"];

/**
 * Normalize a stored or requested appearance. Missing/invalid → dark.
 * @param {unknown} value
 * @returns {"dark" | "light"}
 */
export function normalizeAppearance(value) {
  return value === "light" ? "light" : "dark";
}

/**
 * Apply appearance tokens on the document root.
 * @param {Document} documentRef
 * @param {unknown} appearance
 * @returns {"dark" | "light"}
 */
export function applyAppearance(documentRef, appearance) {
  const next = normalizeAppearance(appearance);
  const root = documentRef?.documentElement;
  if (root) {
    root.setAttribute("data-theme", next);
    root.style.colorScheme = next;
  }
  return next;
}
