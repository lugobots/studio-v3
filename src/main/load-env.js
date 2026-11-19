"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Load KEY=VALUE pairs from studio-v3/.env into process.env when unset.
 * Does not override existing environment variables.
 */
function loadLocalEnv(filePath = path.join(__dirname, "../../.env")) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return false;
  }
  for (const line of raw.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return true;
}

module.exports = { loadLocalEnv };
