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
      const fromStore = typeof matchSettings === "function" ? await matchSettings() : undefined;
      let settings = overrideSettings;
      if (!settings || typeof settings !== "object") {
        settings = fromStore;
      } else if (fromStore && typeof fromStore === "object") {
        // UI may send live prefs without team names; keep store-derived display names.
        settings = {
          ...fromStore,
          ...settings,
          player_team_name: settings.player_team_name || fromStore.player_team_name,
          opponent_team_name: settings.opponent_team_name || fromStore.opponent_team_name,
        };
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
