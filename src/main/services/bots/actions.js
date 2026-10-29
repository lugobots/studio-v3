"use strict";

const fs = require("node:fs");

function inspectDirectory(folder, fsImpl = fs) {
  try {
    const stat = fsImpl.statSync(folder);
    if (!stat || typeof stat.isDirectory !== "function" || !stat.isDirectory()) {
      return { exists: false, entries: [] };
    }
    return { exists: true, entries: fsImpl.readdirSync(folder) };
  } catch {
    return { exists: false, entries: [] };
  }
}

async function openBot({ folder, check, remember, stop, start, watch, onWork }) {
  const compatibility = check(folder);
  if (!compatibility.ok) {
    return { ok: false, error: compatibility.error };
  }
  if (onWork) {
    onWork("open");
  }
  const saved = await remember(folder);
  await stop();
  const started = await start(folder);
  if (!started || started.ok === false) {
    return { ok: false, error: (started && started.error) || "Could not start the Studio container." };
  }
  watch(folder, "/main");
  return { ok: true, config: saved, route: "/api-loading" };
}

async function createBot({
  folder,
  language,
  overwrite = false,
  check,
  listEntries = inspectDirectory,
  remember,
  stop,
  start,
  setup,
  watch,
  onWork,
}) {
  if (!folder || !language) {
    return { ok: false, error: "Choose a language and a folder." };
  }
  const compatibility = check(folder);
  if (compatibility.ok) {
    return openBot({ folder, check, remember, stop, start, watch, onWork });
  }
  const directory = listEntries(folder);
  if (!directory.exists) {
    return { ok: false, error: "That bot folder is missing." };
  }
  if (directory.entries.length > 0 && !overwrite) {
    return {
      ok: false,
      confirmOverwrite: true,
      error: "Existing files may be overwritten.",
    };
  }
  if (onWork) {
    onWork("create");
  }
  await stop();
  const started = await start(folder);
  if (!started || started.ok === false) {
    return { ok: false, error: (started && started.error) || "Could not start the Studio container." };
  }
  const setupResult = await setup(language);
  if (!setupResult || setupResult.ok === false) {
    return { ok: false, error: (setupResult && setupResult.error) || "Could not create the bot." };
  }
  const created = check(folder);
  if (!created.ok) {
    return { ok: false, error: created.error };
  }
  const saved = await remember(folder);
  watch(folder, "/main");
  return { ok: true, config: saved, route: "/api-loading" };
}

module.exports = { openBot, createBot, inspectDirectory };
