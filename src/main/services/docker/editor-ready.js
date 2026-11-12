"use strict";

const { sessionEditorUrl } = require("../session-urls");

const EDITOR_READY_DEADLINE_MS = 45000;
const EDITOR_READY_INTERVAL_MS = 500;

/**
 * Poll the published code-server URL until it answers or the deadline elapses.
 * Does not start the container — call ensureEditor first.
 */
async function waitEditorReady({
  url = sessionEditorUrl(),
  deadlineMs = EDITOR_READY_DEADLINE_MS,
  intervalMs = EDITOR_READY_INTERVAL_MS,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") {
    return { ok: false, error: "fetch is not available to probe the editor", url };
  }
  const deadline = Date.now() + deadlineMs;
  let lastError = "Editor did not become reachable";
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(url, { method: "GET", redirect: "manual" });
      // code-server may redirect; any HTTP response means the port is serving.
      if (response && typeof response.status === "number") {
        return { ok: true, url, status: response.status };
      }
    } catch (error) {
      lastError = error?.message || String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { ok: false, error: lastError, url };
}

module.exports = {
  waitEditorReady,
  EDITOR_READY_DEADLINE_MS,
  EDITOR_READY_INTERVAL_MS,
};
