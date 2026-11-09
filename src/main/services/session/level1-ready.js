"use strict";

const DEFAULT_FAIL = "Could not prepare the Level-1 opponent binary.";

/**
 * Coordinates background Level-1 pull/extract after the Docker gate and
 * shared await before match start / API container start.
 *
 * @param {object} options
 * @param {() => Promise<object>} options.getResolved - config.getLevel1()
 * @param {(resolved: object) => Promise<{ok:boolean,error?:string}>} options.ensureLevel1
 * @param {(input: object) => void} [options.onProgress]
 * @param {(payload: {mode:string,title:string,body:string}) => void} [options.notify]
 */
function createLevel1Ready({ getResolved, ensureLevel1, onProgress, notify }) {
  let inflight = null;

  function reportFailure(error) {
    const body = error || DEFAULT_FAIL;
    if (typeof notify === "function") {
      notify({ mode: "notify", title: "Level-1 opponent", body });
    }
    if (typeof onProgress === "function") {
      onProgress({
        phase: "image",
        detail: body,
      });
    }
  }

  function begin({ reportProgress = false } = {}) {
    if (inflight) {
      return inflight;
    }
    const run = (async () => {
      if (reportProgress && typeof onProgress === "function") {
        onProgress({
          phase: "image",
          detail: "Preparing the Level-1 opponent binary.",
        });
      }
      try {
        const resolved = await getResolved();
        const result = await ensureLevel1(resolved);
        if (!result || result.ok === false) {
          const error = (result && result.error) || DEFAULT_FAIL;
          reportFailure(error);
          return { ok: false, error };
        }
        return result;
      } catch (error) {
        const message = (error && error.message) || DEFAULT_FAIL;
        reportFailure(message);
        return { ok: false, error: message };
      }
    })();

    inflight = run;
    run.then((result) => {
      if (inflight === run && (!result || result.ok === false)) {
        inflight = null;
      }
    });
    return run;
  }

  /** Fire-and-forget after Docker gate; does not block shell entry. */
  function kick() {
    void begin({ reportProgress: false });
  }

  /** Wait for ensure (joins in-flight work); allows retry after a failure. */
  async function awaitReady() {
    const result = await begin({ reportProgress: true });
    if (!result || result.ok === false) {
      return { ok: false, error: (result && result.error) || DEFAULT_FAIL };
    }
    return result;
  }

  return { kick, awaitReady, begin };
}

module.exports = { createLevel1Ready, DEFAULT_FAIL };
