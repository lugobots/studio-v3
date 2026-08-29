import { createPageHeader } from "../../components/page-header.js";
import { studio } from "../../lib/api.js";
import { dialogs } from "../../lib/dialogs.js";
import { navigate } from "../../lib/router.js";
import { PATHS, guardStartupRoute } from "../../lib/startup-sequencer.mjs";

function errorTitle(reason) {
  if (reason === "empty") {
    return "No folder selected";
  }
  if (reason === "invalid") {
    return "Not a valid bot";
  }
  if (reason === "write") {
    return "Could not save settings";
  }
  return "Could not open bot";
}

function setOpening(button, statusEl, opening) {
  button.disabled = opening;
  button.setAttribute("aria-busy", opening ? "true" : "false");
  statusEl.hidden = !opening;
  statusEl.classList.toggle("is-waiting", opening);
  if (opening) {
    statusEl.textContent = "Opening bot…";
  } else {
    statusEl.textContent = "";
  }
}

function renderWelcome(page) {
  const header = createPageHeader({
    eyebrow: "Setup",
    title: "Welcome",
    lede: "Studio needs a bot project to continue. Open an existing Lugo bot folder to get started.",
    version: studio && studio.versions && studio.versions.studio,
  });

  const statusEl = document.createElement("p");
  statusEl.className = "page-status";
  statusEl.hidden = true;

  const actions = document.createElement("div");
  actions.className = "page-actions";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-primary";
  button.textContent = "Open existing bot";

  actions.append(button);
  page.replaceChildren(header, statusEl, actions);

  button.addEventListener("click", async () => {
    if (button.disabled) {
      return;
    }
    setOpening(button, statusEl, true);
    try {
      const result = await studio.project.openExisting();
      if (!page.isConnected) {
        return;
      }
      if (result && result.cancelled === true) {
        return;
      }
      if (!result || result.ok !== true) {
        await dialogs.error({
          title: errorTitle(result && result.reason),
          body: (result && result.error) || "Could not open the bot folder.",
        });
        return;
      }
      navigate(PATHS.main);
    } catch (err) {
      if (!page.isConnected) {
        return;
      }
      await dialogs.error({
        title: "Could not open bot",
        body: err && err.message ? String(err.message) : "Could not open the bot folder.",
      });
    } finally {
      if (page.isConnected) {
        setOpening(button, statusEl, false);
      }
    }
  });
}

export function renderStartProject(outlet) {
  const page = document.createElement("section");
  page.className = "page page-card";
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
    path: PATHS.startProject,
    studio,
    navigate,
    isCancelled: () => disposed,
  }).then((result) => {
    if (disposed || !page.isConnected || (result && result.redirected)) {
      return;
    }

    renderWelcome(page);
  });
}
