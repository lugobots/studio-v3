"use strict";

const { actionResult } = require("./gate");

function createLogControls({ ensureReady, api, sendLines }) {
  let unsubscribe = null;
  let watchers = 0;

  async function arm(source) {
    const ready = await ensureReady("Open a bot before arming process logs.");
    if (!ready.ok) {
      return ready;
    }
    try {
      return actionResult(await api.armLogSource(source));
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async function disarm(source) {
    const ready = await ensureReady("Open a bot before disarming process logs.");
    if (!ready.ok) {
      return ready;
    }
    try {
      return actionResult(await api.disarmLogSource(source));
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  function watch(options) {
    watchers += 1;
    if (unsubscribe) {
      return { ok: true };
    }
    try {
      unsubscribe = api.subscribeProcessLogs((payload) => {
        sendLines(payload);
      }, options);
      return { ok: true };
    } catch (error) {
      watchers = Math.max(0, watchers - 1);
      return { ok: false, error: error.message };
    }
  }

  function unwatch() {
    watchers = Math.max(0, watchers - 1);
    if (watchers > 0 || !unsubscribe) {
      return { ok: true };
    }
    unsubscribe();
    unsubscribe = null;
    return { ok: true };
  }

  function dispose() {
    watchers = 0;
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  }

  return { arm, disarm, watch, unwatch, dispose };
}

module.exports = { createLogControls };
