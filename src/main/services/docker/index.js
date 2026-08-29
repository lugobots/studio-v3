"use strict";

async function getStatus() {
  // TODO: check whether the Docker daemon is running
  return { running: null };
}

module.exports = { getStatus };
