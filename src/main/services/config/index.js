"use strict";

async function get() {
  // TODO: read user config from app.getPath("userData")
  return { projectCreated: false };
}

async function set(_patch) {
  // TODO: persist user config
  return { projectCreated: false };
}

module.exports = { get, set };
