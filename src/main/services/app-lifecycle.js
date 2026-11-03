"use strict";

/**
 * Stop Studio Docker containers when the Electron app quits.
 * Uses before-quit + preventDefault so async docker rm can finish before exit.
 */
function registerContainerCleanupOnQuit(app, stopContainers) {
  let cleaning = false;
  app.on("before-quit", (event) => {
    if (cleaning) {
      return;
    }
    event.preventDefault();
    cleaning = true;
    Promise.resolve()
      .then(() => stopContainers())
      .catch(() => {})
      .finally(() => {
        app.quit();
      });
  });
}

module.exports = { registerContainerCleanupOnQuit };
