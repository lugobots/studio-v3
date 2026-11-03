"use strict";

const { DEFAULTS } = require("../../../shared/ports");

function isMissingContainer(stderr) {
  return /No such container/i.test(stderr || "");
}

function removeOk(result) {
  return Boolean(result?.ok) || isMissingContainer(result?.stderr);
}

/**
 * Force-remove the Studio API container and any leftover editor container.
 * Missing containers count as success so quit/switch stay idempotent.
 */
async function stopStudioContainers(rmForce) {
  const editor = await rmForce(DEFAULTS.editorContainerName);
  const studio = await rmForce(DEFAULTS.containerName);
  return { ok: removeOk(editor) && removeOk(studio) };
}

module.exports = {
  isMissingContainer,
  removeOk,
  stopStudioContainers,
  API_CONTAINER_NAME: DEFAULTS.containerName,
  EDITOR_CONTAINER_NAME: DEFAULTS.editorContainerName,
};
