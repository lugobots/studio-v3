"use strict";

const { createDockerService, getStatus } = require("./status");
const { createImageService } = require("./images");

const defaultImages = createImageService({
  getStatus,
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
