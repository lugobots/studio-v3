import { navigate } from "./router.js";

/**
 * Called when `/docker-check` sees `running: true`.
 *
 * Until step 05 wires loading → Docker → Q1 → Q2, this navigates to
 * `/start-project` as a temporary stand-in. Step 05 should change this helper
 * (not the docker-check page) so the real next gate wins.
 */
export const INTERIM_AFTER_DOCKER_PATH = "/start-project";

export function continueAfterDocker() {
  navigate(INTERIM_AFTER_DOCKER_PATH);
}
