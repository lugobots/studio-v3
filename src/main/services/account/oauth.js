"use strict";

const http = require("node:http");
const { URL } = require("node:url");
const { createPkcePair, randomState } = require("./pkce");

const CLIENT_ID = "studio-v3";
const ACCESS_SKEW_MS = 60_000;

function doorwayBase(env = process.env) {
  return (env.LUGO_DOORWAY_URL || "https://lugobots.ai").replace(/\/$/, "");
}

function normalizeAvatarUrl(avatarUrl, base = doorwayBase()) {
  if (!avatarUrl || typeof avatarUrl !== "string") {
    return null;
  }
  const trimmed = avatarUrl.trim();
  if (!trimmed) {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  if (trimmed.startsWith("/")) {
    return `${base}${trimmed}`;
  }
  return `${base}/${trimmed}`;
}

function isAccessExpired(session, now = Date.now()) {
  if (!session || !session.access_expires_at) {
    return true;
  }
  const expires = Date.parse(session.access_expires_at);
  if (!Number.isFinite(expires)) {
    return true;
  }
  return expires <= now + ACCESS_SKEW_MS;
}

/**
 * Start a loopback callback server and return { port, redirectUri, wait, close }.
 */
function startCallbackServer({ timeoutMs = 120_000 } = {}) {
  let settle;
  const wait = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end("Not found");
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        "<!doctype html><html><body><p>You can close this window and return to Lugo Studio.</p></body></html>",
      );
      close();
      if (error) {
        settle.reject(new Error(error));
        return;
      }
      if (!code) {
        settle.reject(new Error("missing_code"));
        return;
      }
      settle.resolve({ code, state });
    } catch (err) {
      close();
      settle.reject(err);
    }
  });

  let timer = null;
  function close() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    try {
      server.close();
    } catch {
      // ignore
    }
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      timer = setTimeout(() => {
        close();
        settle.reject(new Error("oauth_timeout"));
      }, timeoutMs);
      const addr = server.address();
      resolve({
        port: addr.port,
        redirectUri: `http://127.0.0.1:${addr.port}/callback`,
        wait,
        close,
      });
    });
  });
}

function buildAuthorizeUrl({ base, redirectUri, challenge, state }) {
  const url = new URL(`${base}/oauth/studio/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeCode({
  base,
  code,
  redirectUri,
  verifier,
  fetchImpl = global.fetch,
}) {
  const response = await fetchImpl(`${base}/api/oauth/studio/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `token_exchange_failed_${response.status}`);
  }
  return body;
}

async function refreshTokens({
  base,
  refreshToken,
  fetchImpl = global.fetch,
}) {
  const response = await fetchImpl(`${base}/api/oauth/studio/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `refresh_failed_${response.status}`);
  }
  return body;
}

async function revokeToken({
  base,
  token,
  fetchImpl = global.fetch,
}) {
  try {
    await fetchImpl(`${base}/api/oauth/studio/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ token }),
    });
  } catch {
    // best-effort
  }
}

async function fetchMe({
  base,
  accessToken,
  fetchImpl = global.fetch,
}) {
  const response = await fetchImpl(`${base}/api/studio/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `me_failed_${response.status}`);
  }
  return {
    id: body.id,
    name: body.name,
    username: body.username,
    avatar_url: normalizeAvatarUrl(body.avatar_url, base),
  };
}

/**
 * @returns {Promise<Array<{
 *   name: string,
 *   uri: string,
 *   avatarUrl: string | null,
 *   category: string,
 *   pageUrl: string,
 *   manageUrl: string,
 *   badge?: string,
 *   star?: true,
 *   starTooltip?: string,
 * }>>}
 */
async function fetchBots({
  base,
  accessToken,
  fetchImpl = global.fetch,
}) {
  const response = await fetchImpl(`${base}/api/studio/bots`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `bots_failed_${response.status}`);
  }
  const raw = Array.isArray(body.bots) ? body.bots : [];
  return raw.map((bot) => {
    const item = {
      name: String(bot?.name || ""),
      uri: String(bot?.uri || ""),
      avatarUrl: normalizeAvatarUrl(bot?.avatar_url, base),
      category: String(bot?.category || ""),
      pageUrl: String(bot?.page_url || ""),
      manageUrl: String(bot?.manage_url || ""),
    };
    if (typeof bot?.badge === "string" && bot.badge) {
      item.badge = bot.badge;
    }
    if (bot?.star === true) {
      item.star = true;
      if (typeof bot?.star_tooltip === "string" && bot.star_tooltip) {
        item.starTooltip = bot.star_tooltip;
      }
    }
    return item;
  });
}

function sessionFromTokenResponse(tokens, profile = null, now = Date.now()) {
  const expiresIn = Number(tokens.expires_in) || 3600;
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    access_expires_at: new Date(now + expiresIn * 1000).toISOString(),
    profile: profile || null,
  };
}

module.exports = {
  CLIENT_ID,
  ACCESS_SKEW_MS,
  doorwayBase,
  normalizeAvatarUrl,
  isAccessExpired,
  startCallbackServer,
  buildAuthorizeUrl,
  exchangeCode,
  refreshTokens,
  revokeToken,
  fetchMe,
  fetchBots,
  sessionFromTokenResponse,
  createPkcePair,
  randomState,
};
