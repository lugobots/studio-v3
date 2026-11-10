"use strict";

/** Flip on in a later change to resume VS Code auto-start after API health. */
const AUTO_START_EDITOR = false;

async function openRuntime({ ensureApi, health, ensureEditor, autoStartEditor = AUTO_START_EDITOR }) {
  const api = await ensureApi();
  if (!api.ok) {
    return { ok: false, error: api.error || "Could not start the Studio API", editorStarted: false };
  }
  const ready = await health();
  if (!ready.ok) {
    return { ok: false, error: ready.error || "Studio API is not ready", editorStarted: false };
  }
  if (!autoStartEditor) {
    return { ok: true, editorStarted: false };
  }
  const editor = await ensureEditor();
  if (!editor.ok) {
    return { ok: true, editorStarted: false, editorError: editor.error || "Could not start the editor" };
  }
  return { ok: true, editorStarted: true };
}

module.exports = { openRuntime, AUTO_START_EDITOR };
