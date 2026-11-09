"use strict";

const { actionResult } = require("./gate");

function createServerControls({ ensureReady, api, sendStatus, matchSettings }) {
  let unsubscribe = null;

  function watch(options) {
    if (unsubscribe) {
      return { ok: true };
    }
    try {
      unsubscribe = api.subscribeServerStatus((status) => {
        sendStatus(status);
      }, options);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async function start(overrideSettings) {
    const ready = await ensureReady("Open a bot before starting the game server.");
    if (!ready.ok) {
      return ready;
    }
    try {
      let settings = overrideSettings;
      if (!settings || typeof settings !== "object") {
        settings = typeof matchSettings === "function" ? await matchSettings() : undefined;
      }
      return actionResult(await api.startServer(settings));
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async function stop() {
    const ready = await ensureReady("Open a bot before stopping the game server.");
    if (!ready.ok) {
      return ready;
    }
    try {
      return actionResult(await api.stopServer());
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async function status() {
    const ready = await ensureReady("Open a bot before reading game server status.");
    if (!ready.ok) {
      return ready;
    }
    try {
      const body = await api.serverStatus();
      return { ok: true, body };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  function dispose() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  }

  return { start, stop, status, watch, dispose };
}

module.exports = { createServerControls };
