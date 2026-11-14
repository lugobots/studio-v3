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
  prepare,
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
  // Save after template checkout so the bot appears in the list even if prepare
  // fails; Workspace entry still waits on prepare below.
  const saved = await remember(folder);
  if (typeof prepare === "function") {
    const prepared = await prepare(language);
    if (!prepared || prepared.ok === false) {
      return {
        ok: false,
        error: (prepared && prepared.error) || "Could not install bot dependencies.",
        route: "/api-error",
        message: (prepared && prepared.error) || "Could not install bot dependencies.",
        prepareFailed: true,
        folder,
        language,
        config: saved,
      };
    }
  }
  watch(folder, "/main");
  return { ok: true, config: saved, route: "/api-loading" };
}

/** Retry dependency prepare for a folder that already has a compatible template. */
async function prepareBotDeps({
  folder,
  language,
  check,
  remember,
  stop,
  start,
  prepare,
  watch,
  onWork,
}) {
  if (!folder) {
    return { ok: false, error: "Choose a bot folder." };
  }
  const compatibility = check(folder);
  if (!compatibility.ok) {
    return { ok: false, error: compatibility.error };
  }
  if (onWork) {
    onWork("prepare");
  }
  await stop();
  const started = await start(folder);
  if (!started || started.ok === false) {
    return { ok: false, error: (started && started.error) || "Could not start the Studio container." };
  }
  const prepared = await prepare(language);
  if (!prepared || prepared.ok === false) {
    return {
      ok: false,
      error: (prepared && prepared.error) || "Could not install bot dependencies.",
      route: "/api-error",
      message: (prepared && prepared.error) || "Could not install bot dependencies.",
      prepareFailed: true,
      folder,
      language,
    };
  }
  const saved = await remember(folder);
  watch(folder, "/main");
  return { ok: true, config: saved, route: "/api-loading" };
}

module.exports = { openBot, createBot, prepareBotDeps, inspectDirectory };
