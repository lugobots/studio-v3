import { createPageHeader } from "../../components/page-header.js";
import { getHost } from "../../lib/api.js";
import { dialogs, reportResult } from "../../lib/dialogs.js";
import { navigate } from "../../lib/router.js";

const LEDE_NOT_INSTALLED =
  "Docker is not installed. Install it from the Docker website, then check again. Studio stays here until Docker is available.";
const LEDE_NOT_RUNNING =
  "Docker is installed but not running. Start Docker Desktop (or the Docker daemon), then check again. Studio stays here until the daemon is running.";
const LEDE_DEFAULT =
  "Start or install Docker, then check again. Studio stays here until the daemon is running.";

export function ledeForStatus(status) {
  if (!status || status.unsupported) {
    return LEDE_DEFAULT;
  }
  if (status.installed === false || status.reason === "not_installed") {
    return LEDE_NOT_INSTALLED;
  }
  if (status.running === false) {
    return LEDE_NOT_RUNNING;
  }
  return LEDE_DEFAULT;
}

export function isDockerNotInstalled(status) {
  if (!status || status.unsupported) {
    return false;
  }
  return status.installed === false || status.reason === "not_installed";
}

export function renderDockerCheck(outlet, documentRef = globalThis.document, deps = {}) {
  const host = deps.host || getHost();
  const prompt = deps.dialogs || dialogs;
  const report = deps.reportResult || reportResult;
  const navigateTo = deps.navigate || navigate;

  const page = documentRef.createElement("section");
  page.className = "page page-card";
  const headerHost = documentRef.createElement("div");
  headerHost.className = "docker-check-header";
  const actions = documentRef.createElement("div");
  actions.className = "docker-check-actions";
  page.append(headerHost, actions);
  outlet.append(page);

  function paint(status) {
    headerHost.replaceChildren(
      createPageHeader({
        eyebrow: "Setup",
        title: "Docker",
        lede: ledeForStatus(status),
      }),
    );
    actions.replaceChildren();

    if (isDockerNotInstalled(status)) {
      const openSite = documentRef.createElement("button");
      openSite.type = "button";
      openSite.className = "button";
      openSite.textContent = "Open Docker website";
      openSite.addEventListener("click", async () => {
        if (typeof host.docker.openInstallPage !== "function") {
          await report(prompt, {
            ok: false,
            error: "Cannot open the Docker website from this host.",
          });
          return;
        }
        const opened = await host.docker.openInstallPage();
        if (!opened?.ok) {
          await report(prompt, opened || { ok: false, error: "Could not open the Docker website." });
        }
      });
      actions.append(openSite);
    }

    const retry = documentRef.createElement("button");
    retry.type = "button";
    retry.className = "button button-primary";
    retry.textContent = "Check again";
    retry.addEventListener("click", async () => {
      prompt.busy({
        title: "Checking for Docker",
        body: "Please wait while Studio checks whether Docker is available.",
        percent: 0,
      });
      try {
        const nextStatus = await host.docker.status();
        paint(nextStatus);
        if (nextStatus.unsupported) {
          prompt.clearBusy();
          await report(prompt, nextStatus);
          navigateTo("/main");
          return;
        }
        if (!nextStatus.running) {
          return;
        }
        const next = await host.startup.next();
        navigateTo(next.route);
      } finally {
        prompt.clearBusy();
      }
    });
    actions.append(retry);
  }

  paint({ running: false, installed: true, reason: "not_running" });

  if (typeof host.docker?.status === "function") {
    void host.docker.status().then((status) => {
      paint(status);
    });
  }

  return { paint };
}
