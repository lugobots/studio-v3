import { studio } from "../lib/api.js";
import {
  SHELL_MODE,
  dockerStatusText,
  imageStateFromSnapshot,
  imageStatusText,
  projectPathFromConfig,
  shellModeForRoute,
  studioVersionText,
  truncatePath,
} from "./shell-mode.mjs";

const DOCKER_STATUS_POLL_MS = 4000;

function asPlainText(value) {
  return typeof value === "string" ? value : "";
}

function createSoonNavItem(label) {
  const item = document.createElement("span");
  item.className = "shell-nav-item is-soon";
  item.setAttribute("aria-disabled", "true");
  item.textContent = `${label} (soon)`;
  return item;
}

export function createShell() {
  const root = document.createElement("div");
  root.className = "shell shell-simple";

  const sidebar = document.createElement("aside");
  sidebar.className = "shell-sidebar";
  sidebar.hidden = true;

  const brand = document.createElement("p");
  brand.className = "shell-brand";
  brand.textContent = "Lugo Studio";

  const nav = document.createElement("nav");
  nav.className = "shell-nav";
  nav.setAttribute("aria-label", "Workspace");

  const mainItem = document.createElement("span");
  mainItem.className = "shell-nav-item is-current";
  mainItem.setAttribute("aria-current", "page");
  mainItem.textContent = "Main";

  nav.append(mainItem, createSoonNavItem("Settings"), createSoonNavItem("Images"));
  sidebar.append(brand, nav);

  const header = document.createElement("header");
  header.className = "shell-header";
  header.hidden = true;

  const title = document.createElement("h1");
  title.className = "shell-title";
  title.textContent = "Main";

  const projectEl = document.createElement("p");
  projectEl.className = "shell-project";
  projectEl.textContent = "Loading project…";

  header.append(title, projectEl);

  const outlet = document.createElement("div");
  outlet.className = "shell-outlet";
  outlet.id = "outlet";

  const statusBar = document.createElement("footer");
  statusBar.className = "shell-status";
  statusBar.hidden = true;
  statusBar.setAttribute("role", "status");
  statusBar.setAttribute("aria-live", "polite");

  const versionEl = document.createElement("span");
  versionEl.className = "shell-status-item";
  versionEl.textContent = studioVersionText(studio && studio.versions && studio.versions.studio);

  const dockerEl = document.createElement("span");
  dockerEl.className = "shell-status-item";
  dockerEl.textContent = dockerStatusText(null);

  const imageEl = document.createElement("span");
  imageEl.className = "shell-status-item shell-status-image";
  imageEl.textContent = imageStatusText(null);

  statusBar.append(versionEl, dockerEl, imageEl);

  const frame = document.createElement("div");
  frame.className = "shell-frame";
  frame.append(sidebar, header, outlet, statusBar);

  const overlayHost = document.createElement("div");
  overlayHost.className = "dialog-host";
  overlayHost.id = "dialog-host";

  const toastHost = document.createElement("div");
  toastHost.className = "toast-host";
  toastHost.id = "toast-host";
  toastHost.setAttribute("aria-live", "polite");
  toastHost.setAttribute("aria-relevant", "additions");
  toastHost.setAttribute("aria-atomic", "false");

  root.append(frame, overlayHost, toastHost);

  let currentMode = SHELL_MODE.SIMPLE;
  let dockerPollTimer = null;
  let dockerPollInFlight = false;

  function setProjectLabel(fullPath) {
    const path = asPlainText(fullPath);
    if (!path) {
      projectEl.textContent = "No project path";
      projectEl.removeAttribute("title");
      return;
    }
    projectEl.textContent = truncatePath(path);
    projectEl.setAttribute("title", path);
  }

  function setDockerLabel(running) {
    dockerEl.textContent = dockerStatusText(running);
  }

  function setImageLabel(snapshot) {
    const state = imageStateFromSnapshot(snapshot);
    const percent = snapshot && Number.isFinite(snapshot.percent) ? snapshot.percent : null;
    imageEl.textContent = imageStatusText(state, percent);
    imageEl.classList.toggle("is-error", state === "error");
  }

  async function refreshProjectPath() {
    if (!studio || !studio.config || typeof studio.config.get !== "function") {
      setProjectLabel("");
      return;
    }
    try {
      const config = await studio.config.get();
      if (!projectEl.isConnected) {
        return;
      }
      setProjectLabel(projectPathFromConfig(config));
    } catch {
      if (projectEl.isConnected) {
        setProjectLabel("");
      }
    }
  }

  async function refreshDockerStatus() {
    if (dockerPollInFlight) {
      return;
    }
    if (!studio || !studio.docker || typeof studio.docker.status !== "function") {
      setDockerLabel(null);
      return;
    }
    dockerPollInFlight = true;
    try {
      const status = await studio.docker.status();
      if (dockerEl.isConnected) {
        setDockerLabel(status && status.running);
      }
    } catch {
      if (dockerEl.isConnected) {
        setDockerLabel(null);
      }
    } finally {
      dockerPollInFlight = false;
      if (currentMode === SHELL_MODE.MAIN && statusBar.isConnected) {
        scheduleDockerPoll();
      }
    }
  }

  function stopDockerPoll() {
    if (dockerPollTimer != null) {
      clearTimeout(dockerPollTimer);
      dockerPollTimer = null;
    }
  }

  function scheduleDockerPoll() {
    stopDockerPoll();
    dockerPollTimer = setTimeout(() => {
      void refreshDockerStatus();
    }, DOCKER_STATUS_POLL_MS);
  }

  function startDockerPolling() {
    stopDockerPoll();
    void refreshDockerStatus();
  }

  async function refreshImageStatus() {
    if (!studio || !studio.docker || typeof studio.docker.imageStatus !== "function") {
      setImageLabel(null);
      return;
    }
    try {
      const status = await studio.docker.imageStatus();
      if (imageEl.isConnected) {
        setImageLabel(status);
      }
    } catch {
      if (imageEl.isConnected) {
        setImageLabel(null);
      }
    }
  }

  if (studio && studio.docker && typeof studio.docker.onImageProgress === "function") {
    studio.docker.onImageProgress((payload) => {
      if (!imageEl.isConnected) {
        return;
      }
      setImageLabel(payload);
    });
  }

  void refreshImageStatus();

  function applyRoute(path) {
    const mode = shellModeForRoute(path);
    root.classList.toggle("shell-main", mode === SHELL_MODE.MAIN);
    root.classList.toggle("shell-simple", mode === SHELL_MODE.SIMPLE);

    const showChrome = mode === SHELL_MODE.MAIN;
    sidebar.hidden = !showChrome;
    header.hidden = !showChrome;
    statusBar.hidden = !showChrome;

    const previousMode = currentMode;
    currentMode = mode;

    if (mode === SHELL_MODE.MAIN) {
      void refreshProjectPath();
      void refreshImageStatus();
      if (previousMode !== SHELL_MODE.MAIN) {
        startDockerPolling();
      }
    } else {
      stopDockerPoll();
    }
  }

  return { root, outlet, overlayHost, toastHost, applyRoute };
}
