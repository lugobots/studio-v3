import { createPageHeader } from "../../components/page-header.js";
import { studio } from "../../lib/api.js";
import { navigate } from "../../lib/router.js";
import { PATHS, guardStartupRoute } from "../../lib/startup-sequencer.mjs";

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

    page.replaceChildren(
      createPageHeader({
        eyebrow: "Setup",
        title: "Start project",
        lede: "Shown when a project has not been created yet.",
      }),
    );
  });
}
