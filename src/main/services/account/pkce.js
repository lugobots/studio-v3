"use strict";

const crypto = require("node:crypto");

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createPkcePair() {
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge, method: "S256" };
}

function randomState() {
  return base64Url(crypto.randomBytes(24));
}

module.exports = {
  base64Url,
  createPkcePair,
  randomState,
};
