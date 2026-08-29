import { studio } from "../../lib/api.js";
import { navigate } from "../../lib/router.js";
import { projectPathFromConfig } from "../../layout/shell-mode.mjs";
import { PATHS, guardStartupRoute } from "../../lib/startup-sequencer.mjs";

function renderPlaceholder(page, projectPath) {
  const title = document.createElement("h2");
  title.className = "page-main-title";
  title.textContent = "Game run comes later";

  const lede = document.createElement("p");
  lede.className = "lede";
  lede.textContent =
    "This is the main workspace after startup. Match controls, the game view, players, formations, and publish will land in a later slice. Use the header for the open project and the footer for Docker and image status.";

  const pathEl = document.createElement("p");
  pathEl.className = "page-main-path";
  const path = typeof projectPath === "string" ? projectPath : "";
  if (path) {
    pathEl.textContent = `Open project: ${path}`;
    pathEl.setAttribute("title", path);
  } else {
    pathEl.textContent = "Open project: (none)";
  }

  page.replaceChildren(title, lede, pathEl);
}

export function renderMain(outlet) {
  const page = document.createElement("section");
  page.className = "page page-main";
  const statusEl = document.createElement("p");
  statusEl.className = "page-status is-waiting";
  statusEl.textContent = "Checking project…";
  page.append(statusEl);
  outlet.append(page);

  let disposed = false;

  function dispose() {
    disposed = true;
    window.removeEventListener("hashchange", dispose);
  }

  window.addEventListener("hashchange", dispose);

  void guardStartupRoute({
    path: PATHS.main,
    studio,
    navigate,
    isCancelled: () => disposed,
  }).then(async (result) => {
    if (disposed || !page.isConnected || (result && result.redirected)) {
      return;
    }

    let projectPath = "";
    try {
      const config = await studio.config.get();
      if (disposed || !page.isConnected) {
        return;
      }
      projectPath = projectPathFromConfig(config);
    } catch {
      if (disposed || !page.isConnected) {
        return;
      }
    }

    renderPlaceholder(page, projectPath);
  });
}
