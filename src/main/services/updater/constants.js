"use strict";

/** Dev feed (this slice always uses this origin when the app is not packaged). */
const MOCK_UPDATE_ORIGIN = "http://127.0.0.1:47821";

/**
 * Packaged production JSON feed. Empty until that host speaks this protocol.
 * Do not use https://lugobots.ai — that endpoint is electron-updater YAML, not this API.
 */
const PRODUCTION_UPDATE_ORIGIN = "";

const CHECK_PATH = "/api/studio/check-update";
const UPDATES_DIR_NAME = "updates";
const CHECK_TIMEOUT_MS = 5000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;
const PROGRESS_THROTTLE_MS = 250;
const MAX_JSON_BYTES = 256 * 1024;

module.exports = {
  MOCK_UPDATE_ORIGIN,
  PRODUCTION_UPDATE_ORIGIN,
  CHECK_PATH,
  UPDATES_DIR_NAME,
  CHECK_TIMEOUT_MS,
  DOWNLOAD_TIMEOUT_MS,
  MAX_REDIRECTS,
  PROGRESS_THROTTLE_MS,
  MAX_JSON_BYTES,
};
