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
  fetchMe,
  mintRegistryOtp,
  mintRegistryOtpForSession,
  mintRegistryLoginCredentials,
  resolveRegistryEmail,
  fetchBots,
  fetchBotTags,
  botTags,
  _setStoreForTests,
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

test("fetchBots calls Studio bots API with Bearer and normalizes rows", async () => {
  let seenAuth = null;
  const fetchImpl = async (url, init) => {
    assert.equal(url, "https://doorway.test/api/studio/bots");
    seenAuth = init.headers.Authorization;
    return {
      ok: true,
      async json() {
        return {
          bots: [
            {
              name: "Alpha",
              uri: "me/alpha",
              avatar_url: "/avatars/a.png",
              category: "Sandbox",
              page_url: "https://doorway.test/bots/me/alpha",
              manage_url: "https://doorway.test/bots/me/alpha",
              badge: "official",
              star: true,
              star_tooltip: "Tournament winner",
            },
            {
              name: "Beta",
              uri: "me/beta",
              avatar_url: "https://cdn.example/b.png",
              category: "Production",
              page_url: "https://doorway.test/bots/me/beta",
              manage_url: "https://doorway.test/bots/me/beta",
            },
          ],
        };
      },
    };
  };

  const bots = await fetchBots({
    base: "https://doorway.test",
    accessToken: "tok",
    fetchImpl,
  });
  assert.equal(seenAuth, "Bearer tok");
  assert.equal(bots.length, 2);
  assert.equal(bots[0].avatarUrl, "https://doorway.test/avatars/a.png");
  assert.equal(bots[0].badge, "official");
  assert.equal(bots[0].star, true);
  assert.equal(bots[0].starTooltip, "Tournament winner");
  assert.equal(bots[1].badge, undefined);
  assert.equal(bots[1].star, undefined);
  assert.equal(bots[1].avatarUrl, "https://cdn.example/b.png");
});

function tagsFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const { status = 200, body = {} } = handler(url, init, calls.length);
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return body;
      },
    };
  };
  return { fetchImpl, calls };
}

test("fetchBotTags calls Doorway with Bearer, encodes the uri and caps tags at three", async () => {
  const { fetchImpl, calls } = tagsFetch(() => ({
    body: { uri: "me/alpha bot", tags: ["v4", "v3", "", 7, "v2", "v1"] },
  }));
  const result = await fetchBotTags({
    base: "https://doorway.test",
    accessToken: "tok",
    uri: "me/alpha bot",
    fetchImpl,
  });
  assert.equal(
    calls[0].url,
    "https://doorway.test/api/studio/bots/tags?uri=me%2Falpha%20bot",
  );
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  assert.deepEqual(result, { uri: "me/alpha bot", tags: ["v4", "v3", "v2"] });
});

test("fetchBotTags returns an empty list when Doorway sends no tags", async () => {
  const { fetchImpl } = tagsFetch(() => ({ body: { uri: "me/alpha", tags: [] } }));
  const result = await fetchBotTags({
    base: "https://doorway.test",
    accessToken: "tok",
    uri: "me/alpha",
    fetchImpl,
  });
  assert.deepEqual(result, { uri: "me/alpha", tags: [] });
  const missing = tagsFetch(() => ({ body: { uri: "me/alpha" } }));
  const fallback = await fetchBotTags({
    base: "https://doorway.test",
    accessToken: "tok",
    uri: "me/alpha",
    fetchImpl: missing.fetchImpl,
  });
  assert.deepEqual(fallback.tags, []);
});

test("fetchBotTags rejects with the Doorway error and HTTP status for 400/401/403", async () => {
  for (const [status, body, message] of [
    [401, { error: "unauthenticated" }, "unauthenticated"],
    [403, { error: "not_owner" }, "not_owner"],
    [400, {}, "bot_tags_failed_400"],
  ]) {
    const { fetchImpl } = tagsFetch(() => ({ status, body }));
    await assert.rejects(
      fetchBotTags({
        base: "https://doorway.test",
        accessToken: "tok",
        uri: "me/alpha",
        fetchImpl,
      }),
      (error) => {
        assert.equal(error.message, message);
        assert.equal(error.status, status);
        return true;
      },
    );
  }
});

function signedInStore(overrides = {}) {
  let session = {
    access_token: "access-1",
    refresh_token: "refresh-1",
    access_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    profile: { id: "1", name: "Ada", username: "ada" },
    ...overrides,
  };
  return {
    read: () => session,
    write: (next) => {
      session = next;
    },
    clear: () => {
      session = null;
    },
  };
}

test("account.botTags uses the stored access token and never returns it", async () => {
  _setStoreForTests(signedInStore());
  const { fetchImpl, calls } = tagsFetch(() => ({
    body: { uri: "ada/bot", tags: ["v2", "v1"] },
  }));
  const result = await botTags({ uri: " ada/bot " }, fetchImpl);
  assert.deepEqual(result, { ok: true, uri: "ada/bot", tags: ["v2", "v1"] });
  assert.match(calls[0].url, /\/api\/studio\/bots\/tags\?uri=ada%2Fbot$/);
  assert.equal(calls[0].init.headers.Authorization, "Bearer access-1");
  assert.equal(JSON.stringify(result).includes("access-1"), false);
  _setStoreForTests(null);
});

test("account.botTags reports not signed in, invalid uri and Doorway rejections", async () => {
  _setStoreForTests(signedInStore());
  const never = tagsFetch(() => ({ body: {} }));
  assert.deepEqual(await botTags({}, never.fetchImpl), {
    ok: false,
    error: "invalid_uri",
    tags: [],
  });
  assert.deepEqual(await botTags({ uri: 42 }, never.fetchImpl), {
    ok: false,
    error: "invalid_uri",
    tags: [],
  });
  assert.equal(never.calls.length, 0);

  const denied = tagsFetch(() => ({ status: 403, body: { error: "not_owner" } }));
  assert.deepEqual(await botTags({ uri: "other/bot" }, denied.fetchImpl), {
    ok: false,
    error: "not_owner",
    status: 403,
    tags: [],
  });

  const unauthorized = tagsFetch(() => ({ status: 401, body: {} }));
  const rejected = await botTags({ uri: "ada/bot" }, unauthorized.fetchImpl);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 401);
  assert.equal(rejected.error, "bot_tags_failed_401");

  _setStoreForTests({ read: () => null, write() {}, clear() {} });
  const signedOut = await botTags({ uri: "ada/bot" }, never.fetchImpl);
  assert.deepEqual(signedOut, { ok: false, error: "not_signed_in", tags: [] });
  assert.equal(never.calls.length, 0);
  _setStoreForTests(null);
});

function otpFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const { status = 200, body = {} } = handler(url, init, calls.length);
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return body;
      },
    };
  };
  return { fetchImpl, calls };
}

test("fetchMe maps email from Doorway account snapshot", async () => {
  const { fetchImpl, calls } = otpFetch(() => ({
    body: {
      id: "9",
      name: "Ada",
      username: "ada",
      email: " ada@example.com ",
      avatar_url: "/avatars/a.png",
    },
  }));
  const profile = await fetchMe({
    base: "https://doorway.test",
    accessToken: "tok",
    fetchImpl,
  });
  assert.equal(calls[0].url, "https://doorway.test/api/studio/me");
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  assert.equal(profile.email, "ada@example.com");
  assert.equal(profile.avatar_url, "https://doorway.test/avatars/a.png");
});

test("mintRegistryOtp POSTs with Bearer and parses otp expiry fields", async () => {
  const { fetchImpl, calls } = otpFetch(() => ({
    body: {
      otp: "plain-otp-value",
      expires_in: 60,
      expires_at: "2026-11-18T12:01:00+00:00",
    },
  }));
  const minted = await mintRegistryOtp({
    base: "https://doorway.test",
    accessToken: "tok",
    fetchImpl,
  });
  assert.equal(calls[0].url, "https://doorway.test/api/studio/registry/otp");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
  assert.deepEqual(minted, {
    otp: "plain-otp-value",
    expires_in: 60,
    expires_at: "2026-11-18T12:01:00+00:00",
  });
});

test("mintRegistryOtp rejects with Doorway error and HTTP status shapes", async () => {
  for (const [status, body, message] of [
    [401, { error: "Unauthorized" }, "Unauthorized"],
    [401, { error: "unauthenticated" }, "unauthenticated"],
    [403, { message: "forbidden" }, "forbidden"],
    [500, {}, "registry_otp_failed_500"],
  ]) {
    const { fetchImpl } = otpFetch(() => ({ status, body }));
    await assert.rejects(
      mintRegistryOtp({
        base: "https://doorway.test",
        accessToken: "tok",
        fetchImpl,
      }),
      (error) => {
        assert.equal(error.message, message);
        assert.equal(error.status, status);
        return true;
      },
    );
  }

  const missing = otpFetch(() => ({ body: { expires_in: 60, expires_at: "x" } }));
  await assert.rejects(
    mintRegistryOtp({
      base: "https://doorway.test",
      accessToken: "tok",
      fetchImpl: missing.fetchImpl,
    }),
    (error) => {
      assert.equal(error.message, "registry_otp_missing");
      return true;
    },
  );
});

test("account.mintRegistryOtpForSession uses ensureAccessToken Bearer and never returns tokens", async () => {
  _setStoreForTests(signedInStore());
  const { fetchImpl, calls } = otpFetch(() => ({
    body: { otp: "otp-1", expires_in: 60, expires_at: "2026-11-18T12:01:00Z" },
  }));
  const result = await mintRegistryOtpForSession(fetchImpl);
  assert.deepEqual(result, {
    ok: true,
    otp: "otp-1",
    expires_in: 60,
    expires_at: "2026-11-18T12:01:00Z",
  });
  assert.equal(calls[0].init.headers.Authorization, "Bearer access-1");
  assert.equal(JSON.stringify(result).includes("access-1"), false);

  const denied = otpFetch(() => ({ status: 401, body: { error: "Unauthorized" } }));
  assert.deepEqual(await mintRegistryOtpForSession(denied.fetchImpl), {
    ok: false,
    error: "Unauthorized",
    status: 401,
  });

  _setStoreForTests({ read: () => null, write() {}, clear() {} });
  assert.deepEqual(await mintRegistryOtpForSession(fetchImpl), {
    ok: false,
    error: "not_signed_in",
  });
  _setStoreForTests(null);
});

test("mintRegistryLoginCredentials pairs account email with minted OTP", async () => {
  _setStoreForTests(
    signedInStore({
      profile: { id: "1", name: "Ada", username: "ada", email: "ada@example.com" },
    }),
  );
  const { fetchImpl, calls } = otpFetch(() => ({
    body: { otp: "otp-login", expires_in: 60, expires_at: "2026-11-18T12:01:00Z" },
  }));
  const result = await mintRegistryLoginCredentials(fetchImpl);
  assert.deepEqual(result, {
    ok: true,
    email: "ada@example.com",
    otp: "otp-login",
    expires_in: 60,
    expires_at: "2026-11-18T12:01:00Z",
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/studio\/registry\/otp$/);

  _setStoreForTests(
    signedInStore({
      profile: { id: "1", name: "Ada", username: "ada" },
    }),
  );
  const refresh = otpFetch((url) => {
    if (String(url).endsWith("/api/studio/me")) {
      return {
        body: {
          id: "1",
          name: "Ada",
          username: "ada",
          email: "ada@example.com",
          avatar_url: null,
        },
      };
    }
    return { body: { otp: "otp-2", expires_in: 60, expires_at: "t" } };
  });
  const refreshed = await mintRegistryLoginCredentials(refresh.fetchImpl);
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.email, "ada@example.com");
  assert.equal(refreshed.otp, "otp-2");
  assert.equal(await resolveRegistryEmail(async () => {
    throw new Error("should use cached email");
  }).then((r) => r.email), "ada@example.com");

  _setStoreForTests(null);
});
