/** Entry context for the Welcome / start-project screen. */

let fromShell = false;

/** Mark the next start-project visit as coming from an active shell session. */
export function markStartProjectFromShell() {
  fromShell = true;
}

/**
 * Read and clear the from-shell flag.
 * @returns {boolean}
 */
export function consumeStartProjectFromShell() {
  const value = fromShell;
  fromShell = false;
  return value;
}
