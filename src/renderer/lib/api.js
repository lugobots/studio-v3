import { createHttpStudio } from "./http-studio.js";

let webHost = null;

export function getHost() {
  if (globalThis.window?.studio) {
    return globalThis.window.studio;
  }
  if (!webHost) {
    webHost = createHttpStudio();
  }
  return webHost;
}
