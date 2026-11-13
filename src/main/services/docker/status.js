"use strict";

/**
 * Classify a failed `docker info` (or equivalent) into install vs daemon state.
 * @param {NodeJS.ErrnoException | Error | null | undefined} error
 * @returns {{ running: false, installed: boolean, reason: "not_installed" | "not_running" }}
 */
function classifyDockerInfoFailure(error) {
  if (error && error.code === "ENOENT") {
    return { running: false, installed: false, reason: "not_installed" };
  }
  return { running: false, installed: true, reason: "not_running" };
}

/**
 * Build the DockerStatus payload from a `docker info` result and image inspect.
 * @param {{
 *   info: { ok: boolean, error?: NodeJS.ErrnoException | Error | null },
 *   image: string,
 *   imagePresent?: boolean,
 *   pull?: { status?: string, message?: string },
 * }} options
 */
function buildDockerStatus({ info, image, imagePresent = false, pull = { status: "idle", message: "" } }) {
  if (!info.ok) {
    return {
      ...classifyDockerInfoFailure(info.error),
      image,
      imagePresent: false,
      pull,
    };
  }
  return {
    running: true,
    installed: true,
    reason: null,
    image,
    imagePresent: Boolean(imagePresent),
    pull,
  };
}

module.exports = {
  buildDockerStatus,
  classifyDockerInfoFailure,
};
