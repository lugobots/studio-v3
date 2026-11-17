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
  fetchBots,
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
  openExternalUrl,
  ensureAccessToken,
  doorwayBase,
  normalizeAvatarUrl,
  isAccessExpired,
  fetchBots,
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
