"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Supported major matches maxBotTemplateVersion in studio-v2/initializer/initizalier.go.
const MAX_BOT_TEMPLATE_VERSION = 1;

function checkBotCompatibility(folder, fsImpl = fs) {
  let stat;
  try {
    stat = fsImpl.statSync(folder);
  } catch {
    return { ok: false, error: "That bot folder is missing." };
  }
  if (!stat || typeof stat.isDirectory !== "function" || !stat.isDirectory()) {
    return { ok: false, error: "That bot folder is missing." };
  }

  let raw;
  try {
    raw = fsImpl.readFileSync(path.join(folder, ".lugo", "info.json"), "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { ok: false, error: "That folder is not a Lugo bot (.lugo/info.json is missing)." };
    }
    return { ok: false, error: "That bot folder is missing." };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "`.lugo/info.json` is not valid JSON." };
  }

  const major = parsed && parsed.studio ? parsed.studio.major : undefined;
  if (typeof major !== "number" || Number.isNaN(major)) {
    return { ok: false, error: "`.lugo/info.json` has no numeric studio.major." };
  }
  if (major > MAX_BOT_TEMPLATE_VERSION) {
    return {
      ok: false,
      error: `This bot\u2019s template major is ${major}, and Studio supports up to ${MAX_BOT_TEMPLATE_VERSION}.`,
    };
  }
  return { ok: true };
}

module.exports = {
  MAX_BOT_TEMPLATE_VERSION,
  checkBotCompatibility,
};
