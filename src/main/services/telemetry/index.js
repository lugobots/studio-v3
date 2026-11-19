"use strict";

const DEFAULT_MAX_MESSAGE = 200;

let state = {
  enabled: false,
  appKey: "",
  appVersion: "",
  initialized: false,
};

/** @type {{ initialize: Function, trackEvent: Function } | null} */
let injectedSdk = null;

function useSdk(next) {
  injectedSdk = next || null;
}

function resetForTests() {
  state = {
    enabled: false,
    appKey: "",
    appVersion: "",
    initialized: false,
  };
  injectedSdk = null;
}

function resolveSdk() {
  if (injectedSdk) {
    return injectedSdk;
  }
  try {
    const main = require("@aptabase/electron/main");
    return {
      initialize: main.initialize,
      trackEvent: main.trackEvent,
    };
  } catch {
    return {
      initialize: () => {},
      trackEvent: () => {},
    };
  }
}

function hasAppKey(appKey = state.appKey) {
  return typeof appKey === "string" && appKey.length > 0;
}

function shouldCollect({ enabled = state.enabled, appKey = state.appKey } = {}) {
  return Boolean(enabled) && hasAppKey(appKey);
}

function truncateMessage(value, max = DEFAULT_MAX_MESSAGE) {
  const text = value == null ? "" : String(value);
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max);
}

function sanitizeProps(props) {
  if (!props || typeof props !== "object") {
    return undefined;
  }
  const out = {};
  for (const [key, value] of Object.entries(props)) {
    if (value == null) {
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
      continue;
    }
    if (typeof value === "boolean") {
      out[key] = value ? 1 : 0;
      continue;
    }
    if (typeof value === "string") {
      let text = value;
      text = text.replace(/\/home\/[^/\s]+/g, "~");
      text = text.replace(/\\Users\\[^\\\s]+/gi, "~");
      out[key] = truncateMessage(text);
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function configure({ appKey, enabled, appVersion } = {}) {
  if (typeof appKey === "string") {
    state.appKey = appKey;
  }
  if (enabled !== undefined) {
    state.enabled = enabled !== false;
  }
  if (typeof appVersion === "string" && appVersion) {
    state.appVersion = appVersion;
  }
}

/**
 * Must run before Electron `app.whenReady()`. Aptabase disables tracking if
 * initialize is called after ready. Init whenever an App Key is present;
 * Privacy opt-out is enforced in `track`, not by skipping initialize.
 */
function init() {
  if (state.initialized) {
    return true;
  }
  if (!hasAppKey()) {
    return false;
  }
  const sdk = resolveSdk();
  try {
    sdk.initialize(state.appKey);
    state.initialized = true;
    return true;
  } catch {
    state.initialized = false;
    return false;
  }
}

function setEnabled(enabled) {
  state.enabled = enabled !== false;
}

function track(name, props) {
  if (!name || typeof name !== "string") {
    return false;
  }
  if (!shouldCollect() || !state.initialized) {
    return false;
  }
  const sdk = resolveSdk();
  const enriched = { ...(sanitizeProps(props) || {}) };
  if (state.appVersion && enriched.app_version == null) {
    enriched.app_version = state.appVersion;
  }
  try {
    if (Object.keys(enriched).length) {
      sdk.trackEvent(name, enriched);
    } else {
      sdk.trackEvent(name);
    }
    return true;
  } catch {
    return false;
  }
}

function trackError({ source, type, message } = {}) {
  return track("app_error", {
    source: source || "unknown",
    type: type || "error",
    message: truncateMessage(message || ""),
  });
}

function snapshot() {
  return {
    enabled: state.enabled,
    appKey: state.appKey,
    appVersion: state.appVersion,
    initialized: state.initialized,
    collecting: shouldCollect() && state.initialized,
  };
}

module.exports = {
  shouldCollect,
  hasAppKey,
  truncateMessage,
  sanitizeProps,
  configure,
  init,
  setEnabled,
  track,
  trackError,
  snapshot,
  useSdk,
  resetForTests,
};
