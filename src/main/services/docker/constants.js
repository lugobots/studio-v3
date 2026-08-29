"use strict";

/**
 * How long main waits for a fixed `docker info` (and `docker images`) before
 * treating Docker as not running / not listable. Fail closed: a hang becomes
 * `running: false`. `/docker-check` polls every few seconds instead of
 * stretching this timeout. Image pull has no such timeout — it runs in the
 * background until Docker finishes or fails.
 */
const DOCKER_INFO_TIMEOUT_MS = 5000;

/** Fixed CLI only — never interpolate user or renderer input into these. */
const DOCKER_COMMAND = "docker";
const DOCKER_INFO_COMMAND = DOCKER_COMMAND;
const DOCKER_INFO_ARGS = Object.freeze(["info"]);

/**
 * Q1 Studio image. Placeholder tag — change here (and DEVELOPMENT.md) when
 * the real image is published. Not renderer-supplied.
 */
const STUDIO_IMAGE_NAME = "lugobots/studio";
const STUDIO_IMAGE_TAG = "latest";
const STUDIO_IMAGE_REF = `${STUDIO_IMAGE_NAME}:${STUDIO_IMAGE_TAG}`;

const DOCKER_IMAGES_ARGS = Object.freeze([
  "images",
  "--format",
  "{{.Repository}}\t{{.Tag}}",
  STUDIO_IMAGE_REF,
]);

const DOCKER_PULL_ARGS = Object.freeze(["pull", STUDIO_IMAGE_REF]);

const DOCKER_STATUS_REASON = Object.freeze({
  OK: "ok",
  NOT_INSTALLED: "not_installed",
  NOT_RUNNING: "not_running",
  TIMEOUT: "timeout",
  PERMISSION: "permission",
});

const IMAGE_PROGRESS_STATE = Object.freeze({
  IDLE: "idle",
  PULLING: "pulling",
  READY: "ready",
  ERROR: "error",
});

module.exports = {
  DOCKER_COMMAND,
  DOCKER_IMAGES_ARGS,
  DOCKER_INFO_ARGS,
  DOCKER_INFO_COMMAND,
  DOCKER_INFO_TIMEOUT_MS,
  DOCKER_PULL_ARGS,
  DOCKER_STATUS_REASON,
  IMAGE_PROGRESS_STATE,
  STUDIO_IMAGE_NAME,
  STUDIO_IMAGE_REF,
  STUDIO_IMAGE_TAG,
};
