"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const {
  createPkcePair,
  buildAuthorizeUrl,
  exchangeCode,
  refreshTokens,
  isAccessExpired,
  sessionFromTokenResponse,
  normalizeAvatarUrl,
  startCallbackServer,
  createTokenStore,
  doorwayBase,
} = require("../src/main/services/account");

test("pkce pair produces S256 challenge", () => {
  const pair = createPkcePair();
  assert.equal(pair.method, "S256");
  assert.ok(pair.verifier.length >= 43);
  assert.ok(pair.challenge.length >= 43);
});

test("authorize URL includes PKCE and loopback redirect", () => {
  const url = buildAuthorizeUrl({
    base: "https://lugobots.ai",
    redirectUri: "http://127.0.0.1:5555/callback",
    challenge: "abc",
    state: "st",
  });
  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/oauth/studio/authorize");
  assert.equal(parsed.searchParams.get("client_id"), "studio-v3");
  assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
  assert.equal(parsed.searchParams.get("redirect_uri"), "http://127.0.0.1:5555/callback");
});

test("token store encrypts envelope and restores session", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-oauth-"));
  const filePath = path.join(dir, "creds.bin");
  const store = createTokenStore({
    filePath,
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(`ENC:${plain}`, "utf8"),
    decryptString: (buf) => {
      const text = Buffer.from(buf).toString("utf8");
      assert.ok(text.startsWith("ENC:"));
      return text.slice(4);
    },
  });
  store.write({
    access_token: "a",
    refresh_token: "r",
    access_expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.equal(raw.enc, true);
  const restored = store.read();
  assert.equal(restored.access_token, "a");
  assert.equal(restored.refresh_token, "r");
  store.clear();
  assert.equal(store.read(), null);
});

test("access expiry skew treats near-expiry as expired", () => {
  const soon = sessionFromTokenResponse({ access_token: "a", refresh_token: "r", expires_in: 30 });
  assert.equal(isAccessExpired(soon), true);
  const later = sessionFromTokenResponse({ access_token: "a", refresh_token: "r", expires_in: 3600 });
  assert.equal(isAccessExpired(later), false);
});

test("normalizeAvatarUrl resolves relative Doorway paths", () => {
  assert.equal(
    normalizeAvatarUrl("/avatars/x.png", "https://lugobots.ai"),
    "https://lugobots.ai/avatars/x.png",
  );
  assert.equal(
    normalizeAvatarUrl("https://cdn.example/a.png", "https://lugobots.ai"),
    "https://cdn.example/a.png",
  );
});

test("exchangeCode and refreshTokens call Doorway token endpoint", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      async json() {
        return {
          access_token: "access",
          refresh_token: "refresh",
          token_type: "Bearer",
          expires_in: 3600,
        };
      },
    };
  };
  const tokens = await exchangeCode({
    base: "https://doorway.test",
    code: "c",
    redirectUri: "http://127.0.0.1:9/callback",
    verifier: "v".repeat(43),
    fetchImpl,
  });
  assert.equal(tokens.access_token, "access");
  assert.equal(calls[0].body.grant_type, "authorization_code");
  assert.equal(calls[0].body.code_verifier, "v".repeat(43));

  await refreshTokens({
    base: "https://doorway.test",
    refreshToken: "refresh",
    fetchImpl,
  });
  assert.equal(calls[1].body.grant_type, "refresh_token");
});

test("callback server returns code and rejects error", async () => {
  const server = await startCallbackServer({ timeoutMs: 5_000 });
  const ok = fetch(`http://127.0.0.1:${server.port}/callback?code=abc&state=s`);
  const result = await server.wait;
  await ok;
  assert.equal(result.code, "abc");
  assert.equal(result.state, "s");

  const server2 = await startCallbackServer({ timeoutMs: 5_000 });
  const bad = fetch(`http://127.0.0.1:${server2.port}/callback?error=access_denied&state=s`);
  await assert.rejects(() => server2.wait, /access_denied/);
  await bad.catch(() => {});
});

test("doorwayBase strips trailing slash and defaults", () => {
  assert.equal(doorwayBase({ LUGO_DOORWAY_URL: "https://example.test/" }), "https://example.test");
  assert.equal(doorwayBase({}), "https://lugobots.ai");
});

test("updater-style check-update URLs never include Authorization from account helpers", async () => {
  // Guard: account token exchange posts to /api/oauth/studio/token only.
  const fetchImpl = async (url) => {
    assert.equal(url.includes("/api/studio-v3/check-update"), false);
    return {
      ok: true,
      async json() {
        return { access_token: "a", refresh_token: "r", expires_in: 10 };
      },
    };
  };
  await exchangeCode({
    base: "https://doorway.test",
    code: "c",
    redirectUri: "http://127.0.0.1:1/callback",
    verifier: "v".repeat(43),
    fetchImpl,
  });
});
