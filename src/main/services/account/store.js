"use strict";

const fs = require("node:fs");
const path = require("node:path");

function defaultCredentialsPath(appDataPath) {
  return path.join(appDataPath, ".LugoStudio", "doorway-oauth.bin");
}

/**
 * Persist Doorway OAuth tokens outside renderer localStorage.
 * Prefer Electron safeStorage; fall back to base64 envelope when encryption is unavailable (tests/CI).
 */
function createTokenStore({ filePath, encryptString, decryptString, isEncryptionAvailable }) {
  function read() {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath);
    let envelope;
    try {
      envelope = JSON.parse(raw.toString("utf8"));
    } catch {
      return null;
    }
    if (!envelope || typeof envelope !== "object" || typeof envelope.payload !== "string") {
      return null;
    }
    try {
      let json;
      if (envelope.enc) {
        const buf = Buffer.from(envelope.payload, "base64");
        json = decryptString(buf);
      } else {
        json = Buffer.from(envelope.payload, "base64").toString("utf8");
      }
      const data = JSON.parse(json);
      if (!data || typeof data !== "object") {
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  function write(session) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const json = JSON.stringify(session);
    const useEnc = typeof isEncryptionAvailable === "function" ? isEncryptionAvailable() : false;
    let envelope;
    if (useEnc) {
      const encrypted = encryptString(json);
      envelope = {
        enc: true,
        payload: Buffer.from(encrypted).toString("base64"),
      };
    } else {
      envelope = {
        enc: false,
        payload: Buffer.from(json, "utf8").toString("base64"),
      };
    }
    fs.writeFileSync(filePath, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
  }

  function clear() {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  return { read, write, clear, filePath };
}

module.exports = {
  defaultCredentialsPath,
  createTokenStore,
};
