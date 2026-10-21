import { renderAppFrame } from "../../shell/frame.js";
import { dialogs } from "../../lib/dialogs.js";
import { getHost } from "../../lib/api.js";

export function renderMain(outlet) {
  renderAppFrame(outlet, { host: getHost(), dialogs });
}
