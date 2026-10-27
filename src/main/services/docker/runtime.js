"use strict";

async function openRuntime({ ensureApi, health, ensureEditor }) {
  const api = await ensureApi();
  if (!api.ok) {
    return { ok: false, error: api.error || "Could not start the Studio API", editorStarted: false };
  }
  const ready = await health();
  if (!ready.ok) {
    return { ok: false, error: ready.error || "Studio API is not ready", editorStarted: false };
  }
  const editor = await ensureEditor();
  if (!editor.ok) {
    return { ok: true, editorError: editor.error || "Could not start the editor" };
  }
  return { ok: true };
}

module.exports = { openRuntime };
