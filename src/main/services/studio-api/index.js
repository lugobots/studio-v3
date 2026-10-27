"use strict";

// studio-v2/api/router.go already exposes GET /studio/status, POST /game/start,
// POST /init/setup-new-bot, and POST /bot/publish under /api. entrypoint.sh runs
// `app run` with the bot mounted at /home/coder/project. lugobots/studio:latest
// was not present on this machine, so a live image smoke belongs to the image publisher.

function apiBase() {
  const port = process.env.LUGO_STUDIO_API_PORT || "8081";
  return `http://127.0.0.1:${port}/api`;
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

async function startMatch(fetchImpl) {
  return request("/game/start", { method: "POST" }, fetchImpl);
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

module.exports = { apiBase, request, healthy, waitUntilReady, status, startMatch, setupBot, publishBot };
