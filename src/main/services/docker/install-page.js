"use strict";

const DOCKER_INSTALL_URL = "https://www.docker.com/products/docker-desktop/";

/**
 * Open the Docker Desktop install page in the system browser.
 * @param {(url: string) => Promise<void> | void} openExternal
 * @returns {Promise<{ ok: boolean, url?: string, error?: string }>}
 */
async function openDockerInstallPage(openExternal) {
  if (typeof openExternal !== "function") {
    return { ok: false, error: "Cannot open the Docker website from this host." };
  }
  try {
    await openExternal(DOCKER_INSTALL_URL);
    return { ok: true, url: DOCKER_INSTALL_URL };
  } catch (error) {
    return {
      ok: false,
      error: (error && error.message) || "Could not open the Docker website.",
    };
  }
}

module.exports = {
  DOCKER_INSTALL_URL,
  openDockerInstallPage,
};
