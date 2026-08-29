import { studio } from "./api.js";
import { navigate } from "./router.js";
import { runStartupSequencer } from "./startup-sequencer.mjs";

/**
 * Called when `/docker-check` sees `running: true`.
 * Resumes the same sequencer at Q1 (ensure image) then Q2 — not a hardcoded jump to welcome.
 *
 * @param {{ isCancelled?: () => boolean }} [options]
 */
export function continueAfterDocker(options = {}) {
  return runStartupSequencer({
    studio,
    navigate,
    dockerAlreadyRunning: true,
    isCancelled: options.isCancelled,
  });
}
