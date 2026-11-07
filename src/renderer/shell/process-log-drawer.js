const MAX_DRAWER_LINES = 2000;

const FILTER_ALL = "all";

function sourceLabel(source) {
  if (source === "api") {
    return "API";
  }
  if (source === "server") {
    return "Server";
  }
  const match = /^(home|away)\/(\d+)$/.exec(source || "");
  if (match) {
    const side = match[1] === "home" ? "Home" : "Away";
    return `${side} ${match[2]}`;
  }
  return source || "unknown";
}

/**
 * Collapsible multiplexed process-log drawer under the Workspace game panel.
 * Opening starts a host subscription; closing unsubscribes.
 */
export function createProcessLogDrawer({ host } = {}) {
  let open = false;
  let filter = FILTER_ALL;
  let lines = [];
  let unsubscribe = null;
  let listeners = new Set();

  function snapshot() {
    return { open, filter, lines: lines.slice() };
  }

  function notify() {
    const state = snapshot();
    for (const listener of listeners) {
      listener(state);
    }
  }

  function onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function ensureSubscribe() {
    if (unsubscribe || typeof host?.logs?.subscribe !== "function") {
      return;
    }
    unsubscribe = host.logs.subscribe((payload) => {
      const batch = Array.isArray(payload?.lines) ? payload.lines : [];
      if (!batch.length) {
        return;
      }
      lines = lines.concat(batch);
      if (lines.length > MAX_DRAWER_LINES) {
        lines = lines.slice(-MAX_DRAWER_LINES);
      }
      notify();
    });
  }

  function tearSubscribe() {
    if (!unsubscribe) {
      return;
    }
    try {
      unsubscribe();
    } catch {
      // ignore unsubscribe errors
    }
    unsubscribe = null;
  }

  function openDrawer(focusSource) {
    open = true;
    if (focusSource) {
      filter = focusSource;
    }
    ensureSubscribe();
    notify();
  }

  function closeDrawer() {
    open = false;
    tearSubscribe();
    notify();
  }

  function toggle() {
    if (open) {
      closeDrawer();
    } else {
      openDrawer();
    }
  }

  function setFilter(next) {
    filter = next || FILTER_ALL;
    notify();
  }

  function clear() {
    lines = [];
    notify();
  }

  function visibleLines() {
    if (filter === FILTER_ALL) {
      return lines;
    }
    return lines.filter((line) => line.source === filter);
  }

  function filterOptions() {
    const seen = new Set();
    const options = [{ id: FILTER_ALL, label: "All" }];
    for (const line of lines) {
      if (!line?.source || seen.has(line.source)) {
        continue;
      }
      seen.add(line.source);
      options.push({ id: line.source, label: sourceLabel(line.source) });
    }
    if (filter !== FILTER_ALL && !seen.has(filter)) {
      options.push({ id: filter, label: sourceLabel(filter) });
    }
    return options;
  }

  function mount(parent) {
    const root = document.createElement("div");
    root.className = "process-log-drawer";
    root.dataset.open = String(open);

    const header = document.createElement("div");
    header.className = "process-log-drawer-header";

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "process-log-drawer-toggle";
    toggleBtn.textContent = open ? "Hide logs" : "Show logs";
    toggleBtn.addEventListener("click", () => toggle());

    const filters = document.createElement("div");
    filters.className = "process-log-drawer-filters";
    filters.hidden = !open;

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "process-log-drawer-clear";
    clearBtn.textContent = "Clear";
    clearBtn.hidden = !open;
    clearBtn.addEventListener("click", () => clear());

    header.append(toggleBtn, filters, clearBtn);

    const body = document.createElement("div");
    body.className = "process-log-drawer-body";
    body.hidden = !open;
    root.append(header, body);

    function paintFilters() {
      filters.replaceChildren();
      for (const option of filterOptions()) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "process-log-filter-chip";
        chip.dataset.source = option.id;
        chip.setAttribute("aria-pressed", String(option.id === filter));
        chip.textContent = option.label;
        chip.addEventListener("click", () => setFilter(option.id));
        filters.append(chip);
      }
    }

    function paintBody() {
      body.replaceChildren();
      for (const line of visibleLines()) {
        const row = document.createElement("div");
        row.className = "process-log-line";
        row.dataset.source = line.source || "";
        const tag = document.createElement("span");
        tag.className = "process-log-line-source";
        tag.textContent = sourceLabel(line.source);
        const text = document.createElement("span");
        text.className = "process-log-line-text";
        text.textContent = line.text || "";
        row.append(tag, text);
        body.append(row);
      }
    }

    function paint() {
      root.dataset.open = String(open);
      toggleBtn.textContent = open ? "Hide logs" : "Show logs";
      filters.hidden = !open;
      clearBtn.hidden = !open;
      body.hidden = !open;
      paintFilters();
      paintBody();
    }

    paint();
    const stop = onChange(paint);
    parent.append(root);
    return () => {
      stop();
      root.remove();
    };
  }

  return {
    openDrawer,
    closeDrawer,
    toggle,
    setFilter,
    clear,
    mount,
    onChange,
    snapshot,
    sourceLabel,
    FILTER_ALL,
  };
}

export { sourceLabel, FILTER_ALL, MAX_DRAWER_LINES };
