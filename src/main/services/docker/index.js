"use strict";

const { createDockerService, getStatus } = require("./status");
const { createImageService } = require("./images");

function notifyImageFailure(payload) {
  try {
    require("../notifications").show(payload);
  } catch {
    // Tests that load this module should not fail if native notifications cannot run.
  }
}

const defaultImages = createImageService({
  getStatus,
  notify: notifyImageFailure,
});

async function getImageStatus() {
  return defaultImages.getImageStatus();
}

async function ensureStudioImage() {
  return defaultImages.ensureStudioImage();
}

function setImageProgressListener(listener) {
  defaultImages.setProgressListener(listener);
}

function detachActivePull() {
  defaultImages.detachActivePull();
}

module.exports = {
  createDockerService,
  createImageService,
  detachActivePull,
  ensureStudioImage,
  getImageStatus,
  getStatus,
  setImageProgressListener,
};
