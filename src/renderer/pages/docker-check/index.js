import { createPageHeader } from "../../components/page-header.js";
import { studio } from "../../lib/api.js";
import { continueAfterDocker } from "../../lib/continue-after-docker.js";

/** Gentle poll while this page is visible — not tens of times per second. */
const DOCKER_CHECK_POLL_MS = 4000;

const DOCKER_GET_STARTED_URL = "https://docs.docker.com/get-docker/";

function messageForStatus(status) {
  if (!status || status.running == null) {
    return "Checking whether Docker is running…";
  }
  if (status.running) {
    return "Docker is running.";
  }
  switch (status.reason) {
    case "not_installed":
      return "Docker does not appear to be installed. Install Docker, start it, then check again.";
    case "permission":
      return "Docker is installed but Studio cannot talk to it. On Linux, your user may need to be in the docker group. Then check again.";
    case "timeout":
      return "Docker did not respond in time. If Docker Desktop is still starting, wait a few seconds and check again.";
    default:
      return "Docker is not running. Start Docker Desktop (or the Docker engine), then check again.";
  }
}

function setWaiting(button, statusEl, waiting) {
  button.disabled = waiting;
  statusEl.classList.toggle("is-waiting", waiting);
  if (waiting) {
    statusEl.textContent = "Checking whether Docker is running…";
  }
}

export function renderDockerCheck(outlet) {
  const page = document.createElement("section");
  page.className = "page page-card";

  page.append(
    createPageHeader({
      eyebrow: "Setup",
      title: "Docker is required",
      lede: "Studio needs Docker to run your bot and the game server. Install Docker if you do not have it yet, start it, then check again.",
    }),
  );

  const statusEl = document.createElement("p");
  statusEl.className = "page-status is-waiting";
  statusEl.textContent = "Checking whether Docker is running…";

  const actions = document.createElement("div");
  actions.className = "page-actions";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "button";
  button.textContent = "Re-check now";
  button.disabled = true;

  const docsLink = document.createElement("a");
  docsLink.className = "page-link";
  docsLink.href = DOCKER_GET_STARTED_URL;
  docsLink.target = "_blank";
  docsLink.rel = "noreferrer noopener";
  docsLink.textContent = "Get Docker";

  actions.append(button, docsLink);
  page.append(statusEl, actions);
  outlet.append(page);

  let disposed = false;
  let inFlight = false;
  let pollTimer = null;

  function stopPolling() {
    if (pollTimer != null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function dispose() {
    disposed = true;
    stopPolling();
    window.removeEventListener("hashchange", dispose);
  }

  window.addEventListener("hashchange", dispose);

  function schedulePoll() {
    if (disposed || !page.isConnected) {
      return;
    }
    stopPolling();
    pollTimer = setTimeout(() => {
      void runCheck();
    }, DOCKER_CHECK_POLL_MS);
  }

  async function runCheck() {
    if (disposed || inFlight) {
      return;
    }
    inFlight = true;
    setWaiting(button, statusEl, true);
    try {
      const status = await studio.docker.status();
      if (disposed || !page.isConnected) {
        return;
      }
      if (status && status.running === true) {
        disposed = true;
        stopPolling();
        continueAfterDocker();
        return;
      }
      statusEl.textContent = messageForStatus(status && typeof status.running === "boolean" ? status : { running: false, reason: "not_running" });
    } catch {
      if (disposed || !page.isConnected) {
        return;
      }
      statusEl.textContent = messageForStatus({ running: false, reason: "not_running" });
    } finally {
      inFlight = false;
      if (!disposed && page.isConnected) {
        setWaiting(button, statusEl, false);
        schedulePoll();
      }
    }
  }

  button.addEventListener("click", () => {
    stopPolling();
    void runCheck();
  });

  void runCheck();
}
