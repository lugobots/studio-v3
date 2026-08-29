/**
 * Renderer-only dialog API (confirm / error / progress).
 *
 * Mount from the shell so dialogs survive page unmount. Not on
 * `window.studio` and not IPC — pages import `{ dialogs }` from this module.
 */

import { createDialogLayer } from "../components/dialog.js";
import { createDialogSession } from "./dialog-policy.mjs";

let host = null;
let session = null;
let layer = null;

function ensureMounted() {
  if (!session || !layer || !host) {
    throw new Error("dialogs.mountDialogs() must run from the shell before opening a dialog");
  }
}

export function mountDialogs(overlayHost) {
  host = overlayHost;
  session = createDialogSession();
  layer = createDialogLayer(host);
  const handlers = {
    onEscape: () => session.handleEscape(),
    onBackdrop: () => session.handleBackdrop(),
    onPrimary: () => session.handlePrimary(),
    onSecondary: () => session.handleSecondary(),
  };
  session.subscribe((current) => {
    layer.render(current, handlers);
  });
}

export function confirm(options) {
  ensureMounted();
  return session.requestConfirm(options);
}

export function error(options) {
  ensureMounted();
  return session.requestError(options);
}

export function progress(options) {
  ensureMounted();
  return session.requestProgress(options);
}

export const dialogs = { confirm, error, progress };
