"use strict";

// Client talks to the V3-owned API in lugobots/studio-v3-api:latest (command `api`).
// Routes under /api include health, studio/status, init/setup-new-bot, server/start,
// server/status, server/stop, server/status/ws, game/start, and bot/publish.

function apiBase() {
  const port = process.env.LUGO_STUDIO_API_PORT || "8081";
  return `http://127.0.0.1:${port}/api`;
}

function statusWsUrl(base = apiBase()) {
  return `${base.replace(/^http/, "ws")}/server/status/ws`;
}

function logsWsUrl(base = apiBase()) {
  return `${base.replace(/^http/, "ws")}/logs/ws`;
}

async function request(pathname, options, fetchImpl = global.fetch) {
  const response = await fetchImpl(`${apiBase()}${pathname}`, options);
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text };
    }
  }
  if (!response.ok) {
    const message = (body && (body.message || body.error)) || `Studio API ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return body;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function healthy(fetchImpl) {
  try {
    const body = await request("/health", { method: "GET" }, fetchImpl);
    return Boolean(body && body.status === "OK");
  } catch {
    return false;
  }
}

async function waitUntilReady(fetchImpl, attempts = 20) {
  let last = "Studio API is not ready";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await request("/health", { method: "GET" }, fetchImpl);
      return { ok: true };
    } catch (error) {
      last = error.message;
      await delay(500);
    }
  }
  return { ok: false, error: last };
}

async function status(fetchImpl) {
  return request("/studio/status", { method: "GET" }, fetchImpl);
}

function jsonPostBody(body) {
  if (!body || typeof body !== "object") {
    return { method: "POST" };
  }
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function startServer(settings, fetchImpl = global.fetch) {
  if (typeof settings === "function") {
    return request("/server/start", jsonPostBody(undefined), settings);
  }
  return request("/server/start", jsonPostBody(settings), fetchImpl);
}

async function serverStatus(fetchImpl) {
  return request("/server/status", { method: "GET" }, fetchImpl);
}

async function stopServer(fetchImpl) {
  return request("/server/stop", { method: "POST" }, fetchImpl);
}

function parseStatusPayload(raw) {
  let data = raw;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") {
    return null;
  }
  return { running: Boolean(data.running) };
}

function subscribeServerStatus(onStatus, { WebSocketImpl = globalThis.WebSocket, url } = {}) {
  if (typeof onStatus !== "function") {
    throw new TypeError("subscribeServerStatus requires an onStatus callback");
  }
  if (typeof WebSocketImpl !== "function") {
    throw new Error("WebSocket is not available");
  }
  const ws = new WebSocketImpl(url || statusWsUrl());
  const handleMessage = (event) => {
    const status = parseStatusPayload(event && event.data);
    if (status) {
      onStatus(status);
    }
  };
  if (typeof ws.addEventListener === "function") {
    ws.addEventListener("message", handleMessage);
  } else {
    ws.onmessage = handleMessage;
  }
  return () => {
    if (typeof ws.removeEventListener === "function") {
      ws.removeEventListener("message", handleMessage);
    } else if (ws.onmessage === handleMessage) {
      ws.onmessage = null;
    }
    if (typeof ws.close === "function") {
      try {
        ws.close();
      } catch {
        // ignore close errors on teardown
      }
    }
  };
}

async function startMatch(payload, fetchImpl = global.fetch) {
  if (typeof payload === "function") {
    return request("/game/start", jsonPostBody(undefined), payload);
  }
  return request("/game/start", jsonPostBody(payload), fetchImpl);
}

async function resetMatch(fetchImpl = global.fetch) {
  return request("/game/reset", { method: "POST" }, fetchImpl);
}

async function getPositions(fetchImpl = global.fetch) {
  return request("/game/positions", { method: "GET" }, fetchImpl);
}

async function applyPositions(snapshot, fetchImpl = global.fetch) {
  return request("/game/positions", jsonPostBody(snapshot), fetchImpl);
}

function botPath(side, number) {
  return `/team/${encodeURIComponent(side)}/bots/${encodeURIComponent(String(number))}`;
}

async function startBot({ side, number, settings }, fetchImpl = global.fetch) {
  // Settings are applied on server/match start (API session lastSettings). The
  // body is still sent so main always forwards current prefs on bot calls.
  return request(botPath(side, number), jsonPostBody(settings), fetchImpl);
}

async function stopBot({ side, number }, fetchImpl = global.fetch) {
  return request(botPath(side, number), { method: "DELETE" }, fetchImpl);
}

async function botStatus({ side, number }, fetchImpl = global.fetch) {
  return request(botPath(side, number), { method: "GET" }, fetchImpl);
}

async function setupBot(language, fetchImpl) {
  const body = new URLSearchParams({ lang: language });
  return request(
    "/init/setup-new-bot",
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
    fetchImpl,
  );
}

async function publishBot({ botUri, tag }, fetchImpl) {
  const body = new URLSearchParams({ bot_uri: botUri, tag });
  return request(
    "/bot/publish",
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
    fetchImpl,
  );
}

async function armLogSource(source, fetchImpl = global.fetch) {
  return request("/logs/arm", jsonPostBody({ source }), fetchImpl);
}

async function disarmLogSource(source, fetchImpl = global.fetch) {
  return request("/logs/disarm", jsonPostBody({ source }), fetchImpl);
}

function parseProcessLogPayload(raw) {
  let data = raw;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.lines)) {
    return null;
  }
  return { lines: data.lines };
}

function subscribeProcessLogs(onLines, { WebSocketImpl = globalThis.WebSocket, url } = {}) {
  if (typeof onLines !== "function") {
    throw new TypeError("subscribeProcessLogs requires an onLines callback");
  }
  if (typeof WebSocketImpl !== "function") {
    throw new Error("WebSocket is not available");
  }
  const ws = new WebSocketImpl(url || logsWsUrl());
  const handleMessage = (event) => {
    const payload = parseProcessLogPayload(event && event.data);
    if (payload) {
      onLines(payload);
    }
  };
  if (typeof ws.addEventListener === "function") {
    ws.addEventListener("message", handleMessage);
  } else {
    ws.onmessage = handleMessage;
  }
  return () => {
    if (typeof ws.removeEventListener === "function") {
      ws.removeEventListener("message", handleMessage);
    } else if (ws.onmessage === handleMessage) {
      ws.onmessage = null;
    }
    if (typeof ws.close === "function") {
      try {
        ws.close();
      } catch {
        // ignore close errors on teardown
      }
    }
  };
}

module.exports = {
  apiBase,
  statusWsUrl,
  logsWsUrl,
  request,
  healthy,
  waitUntilReady,
  status,
  startServer,
  serverStatus,
  stopServer,
  subscribeServerStatus,
  startMatch,
  resetMatch,
  getPositions,
  applyPositions,
  startBot,
  stopBot,
  botStatus,
  setupBot,
  publishBot,
  armLogSource,
  disarmLogSource,
  subscribeProcessLogs,
};
