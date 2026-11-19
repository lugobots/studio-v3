"use strict";

const path = require("node:path");
const {
  doorwayBase,
  normalizeAvatarUrl,
  isAccessExpired,
  startCallbackServer,
  buildAuthorizeUrl,
  exchangeCode,
  refreshTokens,
  revokeToken,
  fetchMe,
  mintRegistryOtp,
  fetchBots,
  fetchBotTags,
  sessionFromTokenResponse,
  createPkcePair,
  randomState,
} = require("./oauth");
const { createTokenStore, defaultCredentialsPath } = require("./store");

let store = null;
let memorySession = null;
let signInInFlight = null;

function electronSafeStorage() {
  try {
    return require("electron").safeStorage;
  } catch {
    return null;
  }
}

function electronApp() {
  return require("electron").app;
}

function getStore() {
  if (store) {
    return store;
  }
  const safe = electronSafeStorage();
  const appData = electronApp().getPath("appData");
  store = createTokenStore({
    filePath: defaultCredentialsPath(appData),
    isEncryptionAvailable: () => Boolean(safe && safe.isEncryptionAvailable()),
    encryptString: (plain) => safe.encryptString(plain),
    decryptString: (buf) => safe.decryptString(buf),
  });
  return store;
}

/** Test seam */
function _setStoreForTests(next) {
  store = next;
  memorySession = null;
}

function loadSession() {
  if (memorySession) {
    return memorySession;
  }
  memorySession = getStore().read();
  return memorySession;
}

function saveSession(session) {
  memorySession = session;
  getStore().write(session);
}

function clearSession() {
  memorySession = null;
  getStore().clear();
}

function publicStatus(session) {
  if (!session || !session.refresh_token) {
    return { signedIn: false, profile: null };
  }
  const profile = session.profile
    ? {
        id: session.profile.id,
        name: session.profile.name,
        username: session.profile.username,
        avatarUrl: normalizeAvatarUrl(session.profile.avatar_url || session.profile.avatarUrl),
      }
    : null;
  return { signedIn: true, profile };
}

async function ensureAccessToken(fetchImpl = global.fetch) {
  const session = loadSession();
  if (!session || !session.refresh_token) {
    return null;
  }
  if (!isAccessExpired(session) && session.access_token) {
    return session.access_token;
  }
  try {
    const tokens = await refreshTokens({
      base: doorwayBase(),
      refreshToken: session.refresh_token,
      fetchImpl,
    });
    const next = sessionFromTokenResponse(tokens, session.profile);
    saveSession(next);
    return next.access_token;
  } catch {
    clearSession();
    return null;
  }
}

async function status(fetchImpl = global.fetch) {
  const session = loadSession();
  if (!session || !session.refresh_token) {
    return { signedIn: false, profile: null };
  }
  try {
    const access = await ensureAccessToken(fetchImpl);
    if (!access) {
      return { signedIn: false, profile: null };
    }
    const profile = await fetchMe({
      base: doorwayBase(),
      accessToken: access,
      fetchImpl,
    });
    const next = { ...loadSession(), profile };
    saveSession(next);
    return publicStatus(next);
  } catch {
    return publicStatus(loadSession());
  }
}

async function signIn({
  fetchImpl = global.fetch,
  openExternal = null,
  startServer = startCallbackServer,
} = {}) {
  if (signInInFlight) {
    return signInInFlight;
  }

  signInInFlight = (async () => {
    const { shell } = require("electron");
    const open = openExternal || ((url) => shell.openExternal(url));
    const pkce = createPkcePair();
    const state = randomState();
    const callback = await startServer();
    try {
      const authorizeUrl = buildAuthorizeUrl({
        base: doorwayBase(),
        redirectUri: callback.redirectUri,
        challenge: pkce.challenge,
        state,
      });
      await open(authorizeUrl);
      const result = await callback.wait;
      if (result.state !== state) {
        throw new Error("state_mismatch");
      }
      const tokens = await exchangeCode({
        base: doorwayBase(),
        code: result.code,
        redirectUri: callback.redirectUri,
        verifier: pkce.verifier,
        fetchImpl,
      });
      let profile = null;
      try {
        profile = await fetchMe({
          base: doorwayBase(),
          accessToken: tokens.access_token,
          fetchImpl,
        });
      } catch {
        profile = null;
      }
      const session = sessionFromTokenResponse(tokens, profile);
      saveSession(session);
      try {
        require("../telemetry").track("login");
      } catch {
        // Telemetry must not block sign-in.
      }
      return { ok: true, ...publicStatus(session) };
    } catch (error) {
      callback.close();
      return { ok: false, error: error.message || "sign_in_failed" };
    } finally {
      signInInFlight = null;
    }
  })();

  return signInInFlight;
}

async function signOut({ fetchImpl = global.fetch } = {}) {
  const session = loadSession();
  if (session) {
    const token = session.refresh_token || session.access_token;
    if (token) {
      await revokeToken({ base: doorwayBase(), token, fetchImpl });
    }
  }
  clearSession();
  try {
    require("../telemetry").track("logout");
  } catch {
    // Telemetry must not block sign-out.
  }
  return { ok: true, signedIn: false, profile: null };
}

async function profile(fetchImpl = global.fetch) {
  const current = await status(fetchImpl);
  return current;
}

async function bots(fetchImpl = global.fetch) {
  const access = await ensureAccessToken(fetchImpl);
  if (!access) {
    return { ok: false, error: "not_signed_in", bots: [] };
  }
  try {
    const items = await fetchBots({
      base: doorwayBase(),
      accessToken: access,
      fetchImpl,
    });
    return { ok: true, bots: items };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "bots_failed",
      bots: [],
    };
  }
}

/**
 * Latest Doorway release tags for an owned bot URI. Tokens stay in the main process.
 * @returns {Promise<{ ok: true, uri: string, tags: string[] } | { ok: false, error: string, status?: number, tags: string[] }>}
 */
async function botTags({ uri } = {}, fetchImpl = global.fetch) {
  const trimmed = typeof uri === "string" ? uri.trim() : "";
  if (!trimmed) {
    return { ok: false, error: "invalid_uri", tags: [] };
  }
  const access = await ensureAccessToken(fetchImpl);
  if (!access) {
    return { ok: false, error: "not_signed_in", tags: [] };
  }
  try {
    const result = await fetchBotTags({
      base: doorwayBase(),
      accessToken: access,
      uri: trimmed,
      fetchImpl,
    });
    return { ok: true, uri: result.uri, tags: result.tags };
  } catch (error) {
    const failure = {
      ok: false,
      error: error?.message || "bot_tags_failed",
      tags: [],
    };
    if (Number.isInteger(error?.status)) {
      failure.status = error.status;
    }
    return failure;
  }
}

/**
 * Mint a Doorway registry OTP using the signed-in Studio access token.
 * @returns {Promise<
 *   | { ok: true, otp: string, expires_in: number, expires_at: string }
 *   | { ok: false, error: string, status?: number }
 * >}
 */
async function mintRegistryOtpForSession(fetchImpl = global.fetch) {
  const access = await ensureAccessToken(fetchImpl);
  if (!access) {
    return { ok: false, error: "not_signed_in" };
  }
  try {
    const minted = await mintRegistryOtp({
      base: doorwayBase(),
      accessToken: access,
      fetchImpl,
    });
    return {
      ok: true,
      otp: minted.otp,
      expires_in: minted.expires_in,
      expires_at: minted.expires_at,
    };
  } catch (error) {
    const failure = {
      ok: false,
      error: error?.message || "registry_otp_failed",
    };
    if (Number.isInteger(error?.status)) {
      failure.status = error.status;
    }
    return failure;
  }
}

/**
 * Resolve the account email for registry docker login (Porteiro username).
 * Prefers the cached Doorway profile; refreshes /api/studio/me when missing.
 */
async function resolveRegistryEmail(fetchImpl = global.fetch) {
  const session = loadSession();
  const cached =
    session &&
    session.profile &&
    typeof session.profile.email === "string" &&
    session.profile.email.trim()
      ? session.profile.email.trim()
      : "";
  if (cached) {
    return { ok: true, email: cached };
  }
  const access = await ensureAccessToken(fetchImpl);
  if (!access) {
    return { ok: false, error: "not_signed_in" };
  }
  try {
    const profile = await fetchMe({
      base: doorwayBase(),
      accessToken: access,
      fetchImpl,
    });
    const next = { ...loadSession(), profile };
    saveSession(next);
    const email =
      typeof profile.email === "string" && profile.email.trim()
        ? profile.email.trim()
        : "";
    if (!email) {
      return { ok: false, error: "missing_email" };
    }
    return { ok: true, email };
  } catch (error) {
    return { ok: false, error: error?.message || "me_failed" };
  }
}

/**
 * Mint a registry OTP bound to the signed-in user and return email + OTP for docker login.
 * Caller must discard the OTP after use; it is not stored in the Doorway session.
 * @returns {Promise<
 *   | { ok: true, email: string, otp: string, expires_in: number, expires_at: string }
 *   | { ok: false, error: string, status?: number }
 * >}
 */
async function mintRegistryLoginCredentials(fetchImpl = global.fetch) {
  const emailResult = await resolveRegistryEmail(fetchImpl);
  if (!emailResult.ok) {
    const failure = { ok: false, error: emailResult.error || "missing_email" };
    if (emailResult.error === "not_signed_in") {
      failure.status = 401;
    }
    return failure;
  }
  const minted = await mintRegistryOtpForSession(fetchImpl);
  if (!minted.ok) {
    return minted;
  }
  return {
    ok: true,
    email: emailResult.email,
    otp: minted.otp,
    expires_in: minted.expires_in,
    expires_at: minted.expires_at,
  };
}

async function openExternalUrl(url) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: "invalid_url" };
  }
  const { shell } = require("electron");
  await shell.openExternal(url);
  return { ok: true };
}

module.exports = {
  status,
  signIn,
  signOut,
  profile,
  bots,
  botTags,
  mintRegistryOtpForSession,
  resolveRegistryEmail,
  mintRegistryLoginCredentials,
  openExternalUrl,
  ensureAccessToken,
  doorwayBase,
  normalizeAvatarUrl,
  isAccessExpired,
  fetchMe,
  mintRegistryOtp,
  fetchBots,
  fetchBotTags,
  _setStoreForTests,
  // re-export pure helpers for tests
  createPkcePair,
  buildAuthorizeUrl,
  exchangeCode,
  refreshTokens,
  sessionFromTokenResponse,
  startCallbackServer,
  defaultCredentialsPath: require("./store").defaultCredentialsPath,
  createTokenStore: require("./store").createTokenStore,
};
