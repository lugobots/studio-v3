import {
  DIALOG_KIND,
  FOCUSABLE_SELECTOR,
  asDialogText,
  isDeterminateProgress,
  nextFocusIndex,
} from "../lib/dialog-policy.mjs";

function applyProgress(el, value) {
  if (!el) {
    return;
  }
  el.max = 1;
  if (isDeterminateProgress(value)) {
    el.value = value;
  } else {
    el.removeAttribute("value");
  }
}

function focusableIn(card) {
  return [...card.querySelectorAll(FOCUSABLE_SELECTOR)].filter((el) => {
    if (el.disabled || el.getAttribute("aria-hidden") === "true") {
      return false;
    }
    return el.tabIndex !== -1;
  });
}

/**
 * One overlay, one dialog at a time. Callers pass the session handlers.
 */
export function createDialogLayer(host) {
  let renderedId = null;
  let lastFocus = null;
  let currentHandlers = null;
  let parts = null;

  function restoreFocus() {
    const target = lastFocus;
    lastFocus = null;
    if (target && typeof target.focus === "function" && document.contains(target)) {
      try {
        target.focus();
      } catch {
        // ignore
      }
    }
  }

  function onDocumentKeyDown(event) {
    if (!renderedId) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (currentHandlers && typeof currentHandlers.onEscape === "function") {
        currentHandlers.onEscape();
      }
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const card = host.querySelector(".dialog-card");
    if (!card) {
      return;
    }
    const nodes = focusableIn(card);
    event.preventDefault();
    if (nodes.length === 0) {
      card.focus();
      return;
    }
    const currentIndex = nodes.indexOf(document.activeElement);
    const nextIndex = nextFocusIndex(currentIndex, nodes.length, event.shiftKey === true);
    nodes[nextIndex].focus();
  }

  function buildOverlay(model) {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";

    const card = document.createElement("div");
    card.className = `dialog-card is-${model.kind}`;
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "studio-dialog-title");
    card.tabIndex = -1;

    const title = document.createElement("h2");
    title.className = "dialog-title";
    title.id = "studio-dialog-title";
    title.textContent = asDialogText(model.title);

    const body = document.createElement("p");
    body.className = "dialog-body";
    body.id = "studio-dialog-body";
    body.textContent = asDialogText(model.body);

    const detail = document.createElement("p");
    detail.className = "dialog-detail";
    detail.id = "studio-dialog-detail";
    detail.textContent = asDialogText(model.detail);

    const meter = document.createElement("progress");
    meter.className = "dialog-meter";
    meter.max = 1;
    applyProgress(meter, model.progress);

    const actions = document.createElement("div");
    actions.className = "dialog-actions";

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay && currentHandlers && typeof currentHandlers.onBackdrop === "function") {
        currentHandlers.onBackdrop();
      }
    });

    card.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    if (model.kind === DIALOG_KIND.CONFIRM) {
      card.setAttribute("aria-describedby", "studio-dialog-body");
      card.append(title, body, actions);
      const secondary = document.createElement("button");
      secondary.type = "button";
      secondary.className = "button";
      secondary.textContent = asDialogText(model.secondaryLabel, "Cancel") || "Cancel";
      secondary.addEventListener("click", () => {
        if (currentHandlers && typeof currentHandlers.onSecondary === "function") {
          currentHandlers.onSecondary();
        }
      });
      const primary = document.createElement("button");
      primary.type = "button";
      primary.className = "button button-primary";
      primary.textContent = asDialogText(model.primaryLabel, "OK") || "OK";
      primary.addEventListener("click", () => {
        if (currentHandlers && typeof currentHandlers.onPrimary === "function") {
          currentHandlers.onPrimary();
        }
      });
      actions.append(secondary, primary);
      parts = { title, body, detail: null, progress: null };
    } else if (model.kind === DIALOG_KIND.ERROR) {
      card.setAttribute("aria-describedby", "studio-dialog-body");
      card.append(title, body, actions);
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "button button-primary";
      dismiss.textContent = asDialogText(model.dismissLabel, "OK") || "OK";
      dismiss.addEventListener("click", () => {
        if (currentHandlers && typeof currentHandlers.onSecondary === "function") {
          currentHandlers.onSecondary();
        }
      });
      actions.append(dismiss);
      parts = { title, body, detail: null, progress: null };
    } else {
      card.setAttribute("aria-describedby", "studio-dialog-detail");
      meter.setAttribute("aria-label", asDialogText(model.title, "Progress"));
      card.append(title, detail, meter, actions);
      if (model.hasCancelHandler) {
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "button";
        cancel.textContent = asDialogText(model.cancelLabel, "Cancel") || "Cancel";
        cancel.addEventListener("click", () => {
          if (currentHandlers && typeof currentHandlers.onSecondary === "function") {
            currentHandlers.onSecondary();
          }
        });
        actions.append(cancel);
      }
      parts = { title, body: null, detail, progress: meter };
    }

    overlay.append(card);
    host.append(overlay);
    card.focus();
  }

  function render(model, handlers) {
    currentHandlers = handlers || null;
    if (!model) {
      const wasOpen = renderedId != null;
      document.removeEventListener("keydown", onDocumentKeyDown, true);
      host.replaceChildren();
      renderedId = null;
      parts = null;
      if (wasOpen) {
        restoreFocus();
      }
      return;
    }

    const opening = renderedId == null;
    const switching = renderedId != null && renderedId !== model.id;

    if (opening) {
      lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      document.addEventListener("keydown", onDocumentKeyDown, true);
    }

    if (opening || switching) {
      host.replaceChildren();
      buildOverlay(model);
      renderedId = model.id;
      return;
    }

    if (!parts) {
      return;
    }
    if (parts.title) {
      parts.title.textContent = asDialogText(model.title);
    }
    if (parts.body) {
      parts.body.textContent = asDialogText(model.body);
    }
    if (parts.detail) {
      parts.detail.textContent = asDialogText(model.detail);
    }
    if (parts.progress) {
      applyProgress(parts.progress, model.progress);
    }
  }

  return { render };
}
