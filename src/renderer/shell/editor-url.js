/** Default VS Code / code-server port — keep in sync with `src/shared/ports.js` DEFAULTS.vsCodePort. */
export const DEFAULT_EDITOR_PORT = "8082";

/**
 * Build the editor URL for the Editor tab placement (V2 Editor panel role).
 * The shell reserves this target; it does not start code-server or load the iframe yet.
 * @param {{ port?: string, host?: string }} [options]
 */
export function editorUrl({ port = DEFAULT_EDITOR_PORT, host = "localhost" } = {}) {
  return `http://${host}:${port}`;
}
