import { createPageHeader } from "../../components/page-header.js";
import { studio } from "../../lib/api.js";
import { navigate } from "../../lib/router.js";
import { MIN_LOADING_DISPLAY_MS, runStartupSequencer } from "../../lib/startup-sequencer.mjs";

export function renderLoading(outlet) {
  const page = document.createElement("section");
  page.className = "page page-card";

  page.append(
    createPageHeader({
      eyebrow: "Studio v3",
      title: "Loading",
      lede: "Checking Docker and your project…",
    }),
  );

  const statusEl = document.createElement("p");
  statusEl.className = "page-status is-waiting";
  statusEl.textContent = "Starting Studio…";
  page.append(statusEl);
  outlet.append(page);

  let disposed = false;

  function dispose() {
    disposed = true;
    window.removeEventListener("hashchange", dispose);
  }

  window.addEventListener("hashchange", dispose);

  void runStartupSequencer({
    studio,
    navigate,
    minDisplayMs: MIN_LOADING_DISPLAY_MS,
    isCancelled: () => disposed || !page.isConnected,
  }).then((result) => {
    if (disposed || !page.isConnected) {
      return;
    }
    if (!result || result.ok) {
      return;
    }
    statusEl.classList.remove("is-waiting");
    statusEl.textContent = result.error || "Startup checks failed.";
  }).catch(() => {
    if (disposed || !page.isConnected) {
      return;
    }
    statusEl.classList.remove("is-waiting");
    statusEl.textContent = "Startup checks failed.";
  });
}
