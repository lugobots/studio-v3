import { mountDialogs, dialogs } from "./lib/dialogs.js";
import { getHost } from "./lib/api.js";
import { registerRoute, startRouter, navigate } from "./lib/router.js";
import { applyTelemetry } from "./lib/telemetry.js";
import { renderLoading } from "./pages/loading/index.js";
import { renderDockerCheck } from "./pages/docker-check/index.js";
import { renderStartProject } from "./pages/start-project/index.js";
import { renderBots } from "./pages/bots/index.js";
import { renderMain } from "./pages/main/index.js";
import { renderApiLoading } from "./pages/api-loading/index.js";
import { renderApiError } from "./pages/api-error/index.js";
import { setGateMessage } from "./lib/gate-message.js";

registerRoute("/loading", renderLoading);
registerRoute("/docker-check", renderDockerCheck);
registerRoute("/start-project", renderStartProject);
registerRoute("/bots", renderBots);
registerRoute("/api-loading", renderApiLoading);
registerRoute("/api-error", renderApiError);
registerRoute("/main", renderMain);

const outlet = document.createElement("div");
outlet.className = "shell-outlet";
outlet.id = "outlet";
const shell = document.createElement("div");
shell.className = "shell shell-gate";
shell.append(outlet);
document.body.append(shell);

const host = getHost();

function syncShell() {
  shell.className = window.location.hash.includes("/main")
    ? "shell shell-app"
    : "shell shell-gate";
}

mountDialogs(document, dialogs, async (action) => {
  if (action !== "upgrade") {
    return;
  }
  const accepted = await dialogs.confirm({
    title: "Upgrade Studio?",
    body: "Studio will close after the Windows installer starts.",
    confirmLabel: "Upgrade",
    cancelLabel: "Not now",
  });
  if (!accepted) {
    return;
  }
  const result = await host.updates.apply();
  if (!result.ok) {
    await dialogs.confirm({
      title: "Upgrade did not start",
      body: result.error || "The Windows installer was not launched.",
      confirmLabel: "Close",
      cancelLabel: "Close",
    });
  }
});

window.addEventListener("hashchange", syncShell);

host.notifications.onEvent((payload) => {
  if (payload.mode === "blocking") {
    dialogs.confirm(payload);
    return;
  }
  dialogs.notify(payload);
});

startRouter(outlet);
syncShell();

if (host.startup.onRoute) {
  host.startup.onRoute((payload) => {
    setGateMessage(payload.message);
    navigate(payload.route);
  });
}

host.startup.next().then(async (next) => {
  setGateMessage(next.message);
  navigate(next.route || "/loading");
  const config = await host.config.get();
  applyTelemetry(document, config);
});
