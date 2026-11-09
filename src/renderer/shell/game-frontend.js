/** Default game-frontend port — keep in sync with `src/shared/ports.js` DEFAULTS.gameFrontendPort. */
export const DEFAULT_GAME_FRONTEND_PORT = "8080";

/**
 * Build the game-frontend URL for the Workspace Game panel iframe (V2 GamePanel role).
 * @param {{ port?: string, host?: string }} [options]
 */
export function gameFrontendUrl({ port = DEFAULT_GAME_FRONTEND_PORT, host = "localhost" } = {}) {
  return `http://${host}:${port}`;
}
