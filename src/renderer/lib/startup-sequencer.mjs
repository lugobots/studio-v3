/**
 * Single startup sequencer for the renderer. Pages call this; hash routing stays
 * in `router.js`. Inject `studio` and `navigate` so the decision path can run in Node.
 */

export const PATHS = Object.freeze({
  loading: "/loading",
  dockerCheck: "/docker-check",
  startProject: "/start-project",
  main: "/main",
});

/** Splash floor when checks finish instantly. Not a multi-second fake delay. */
export const MIN_LOADING_DISPLAY_MS = 400;

export const STARTUP_ERRORS = Object.freeze({
  dockerStatus: "Could not check whether Docker is running.",
  config: "Could not read project settings.",
  unknownProject: "Could not determine whether a project exists.",
  generic: "Startup checks failed.",
});

/**
 * @param {boolean} dockerRunning
 * @returns {"docker-check" | "q1-then-q2"}
 */
export function nextStepAfterDockerStatus(dockerRunning) {
  return dockerRunning === true ? "q1-then-q2" : "docker-check";
}

/**
 * @param {boolean} projectCreated
 * @returns {typeof PATHS.startProject | typeof PATHS.main}
 */
export function destinationForProjectCreated(projectCreated) {
  return projectCreated === true ? PATHS.main : PATHS.startProject;
}

/**
 * Hash back/forward: Q2 still wins. Returns a path to navigate to, or `null` to stay.
 *
 * @param {string} path
 * @param {{ projectCreated: boolean }} state
 * @returns {string | null}
 */
export function hashGuard(path, state) {
  const projectCreated = state && state.projectCreated === true;
  if (path === PATHS.main && !projectCreated) {
    return PATHS.startProject;
  }
  if (path === PATHS.startProject && projectCreated) {
    return PATHS.main;
  }
  return null;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isCancelled(options) {
  return !!(options && typeof options.isCancelled === "function" && options.isCancelled());
}

async function waitForMinDisplay(startedAt, minDisplayMs) {
  const remaining = minDisplayMs - (Date.now() - startedAt);
  if (remaining > 0) {
    await delay(remaining);
  }
}

function finishOk(path) {
  return { ok: true, path, error: null };
}

function finishError(error) {
  return { ok: false, path: null, error };
}

/**
 * Docker → Q1 (ensure image, do not wait for pull) → Q2 (`projectCreated`).
 *
 * @param {object} options
 * @param {{ docker: { status: Function, ensureImage: Function }, config: { get: Function } }} options.studio
 * @param {(path: string) => void} options.navigate
 * @param {boolean} [options.dockerAlreadyRunning] Skip the daemon check (resume from `/docker-check`).
 * @param {number} [options.minDisplayMs]
 * @param {() => boolean} [options.isCancelled]
 */
export async function runStartupSequencer(options) {
  const studio = options && options.studio;
  const navigate = options && options.navigate;
  const minDisplayMs = Number.isFinite(options && options.minDisplayMs) ? options.minDisplayMs : 0;
  const startedAt = Date.now();

  async function settle() {
    await waitForMinDisplay(startedAt, minDisplayMs);
  }

  async function go(path) {
    await settle();
    if (isCancelled(options)) {
      return finishOk(path);
    }
    navigate(path);
    return finishOk(path);
  }

  try {
    let dockerRunning = options && options.dockerAlreadyRunning === true;

    if (!dockerRunning) {
      let status;
      try {
        status = await studio.docker.status();
      } catch {
        await settle();
        if (isCancelled(options)) {
          return finishError(STARTUP_ERRORS.dockerStatus);
        }
        return finishError(STARTUP_ERRORS.dockerStatus);
      }

      dockerRunning = status && status.running === true;
    }

    if (nextStepAfterDockerStatus(dockerRunning) === "docker-check") {
      return go(PATHS.dockerCheck);
    }

    try {
      // ensureImage resolves after a short local lookup / starting pull, never after pull completion.
      await studio.docker.ensureImage();
    } catch {
      // Q1 must not block Q2.
    }

    if (isCancelled(options)) {
      await settle();
      return finishOk(null);
    }

    let config;
    try {
      config = await studio.config.get();
    } catch {
      await settle();
      if (isCancelled(options)) {
        return finishError(STARTUP_ERRORS.config);
      }
      return finishError(STARTUP_ERRORS.config);
    }

    if (!config || typeof config.projectCreated !== "boolean") {
      await settle();
      if (isCancelled(options)) {
        return finishError(STARTUP_ERRORS.unknownProject);
      }
      return finishError(STARTUP_ERRORS.unknownProject);
    }

    return go(destinationForProjectCreated(config.projectCreated));
  } catch {
    await settle();
    if (isCancelled(options)) {
      return finishError(STARTUP_ERRORS.generic);
    }
    return finishError(STARTUP_ERRORS.generic);
  }
}

/**
 * Enforce Q2 on `#/main` and `#/start-project` after a manual hash change.
 *
 * @param {object} options
 * @param {string} options.path
 * @param {{ config: { get: Function } }} options.studio
 * @param {(path: string) => void} options.navigate
 * @param {() => boolean} [options.isCancelled]
 */
export async function guardStartupRoute(options) {
  const path = options.path;
  const studio = options.studio;
  const navigate = options.navigate;

  let projectCreated = false;
  try {
    const config = await studio.config.get();
    projectCreated = !!(config && config.projectCreated === true);
  } catch {
    if (path === PATHS.main) {
      if (!isCancelled(options)) {
        navigate(PATHS.startProject);
      }
      return { redirected: true, path: PATHS.startProject };
    }
    return { redirected: false, path };
  }

  const next = hashGuard(path, { projectCreated });
  if (next) {
    if (!isCancelled(options)) {
      navigate(next);
    }
    return { redirected: true, path: next };
  }
  return { redirected: false, path };
}
