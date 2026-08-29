import { createShell } from "./layout/shell.js";
import { studio } from "./lib/api.js";
import { mountDialogs } from "./lib/dialogs.js";
import { registerRoute, startRouter } from "./lib/router.js";
import { mountToasts } from "./lib/toasts.js";
import { renderLoading } from "./pages/loading/index.js";
import { renderDockerCheck } from "./pages/docker-check/index.js";
import { renderStartProject } from "./pages/start-project/index.js";
import { renderMain } from "./pages/main/index.js";

registerRoute("/loading", renderLoading);
registerRoute("/docker-check", renderDockerCheck);
registerRoute("/start-project", renderStartProject);
registerRoute("/main", renderMain);

const { root, outlet, overlayHost, toastHost } = createShell();
mountDialogs(overlayHost);
const toasts = mountToasts(toastHost);

if (studio && studio.notifications && typeof studio.notifications.onShow === "function") {
  studio.notifications.onShow((payload) => {
    toasts.show(payload);
  });
}

document.body.append(root);
startRouter(outlet);
