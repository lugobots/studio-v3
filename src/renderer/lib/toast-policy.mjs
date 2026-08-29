/** In-app toast stack policy. Toasts never take focus from a dialog. */

export const TOAST_MAX_VISIBLE = 3;
export const TOAST_DURATION_MS = 4500;

export function capToastList(existing, incoming, max = TOAST_MAX_VISIBLE) {
  const base = Array.isArray(existing) ? existing.slice() : [];
  base.push(incoming);
  const limit = Number.isFinite(max) && max > 0 ? max : TOAST_MAX_VISIBLE;
  if (base.length <= limit) {
    return base;
  }
  return base.slice(base.length - limit);
}
