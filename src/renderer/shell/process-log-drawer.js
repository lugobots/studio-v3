const MAX_DRAWER_LINES = 2000;

const FILTER_ALL = "all";

const WAITING_FOR_LOGS = "Waiting for logs…";

const NEAR_BOTTOM_PX = 40;

const PERF_ALERT_TEXT =
  "Multiple log streams are open. Watching more than two at once can hurt Studio performance.";

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

function sourceSortKey(source) {
  if (source === "api") {
    return "0:api";
  }
  if (source === "server") {
    return "1:server";
  }
  const match = /^(home|away)\/(\d+)$/.exec(source || "");
  if (match) {
    const side = match[1] === "home" ? "2" : "3";
    return `${side}:${Number(match[2]).toString().padStart(2, "0")}`;
  }
  return `9:${source || ""}`;
}

function compareSources(a, b) {
  return sourceSortKey(a).localeCompare(sourceSortKey(b));
}

/**
 * Collapsible multiplexed process-log drawer under the Workspace game panel.
 * Opening starts a host subscription; closing unsubscribes.
 */
export function createProcessLogDrawer({ host, onSourceDisarmed } = {}) {
  let open = false;
  let filter = FILTER_ALL;
  let lines = [];
  let armedSources = new Set();
  let followTail = true;
  let unsubscribe = null;
  let listeners = new Set();

  function snapshot() {
    return {
      open,
      filter,
      lines: lines.slice(),
      armedSources: [...armedSources].sort(compareSources),
      followTail,
    };
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

  function noteArmed(source) {
    if (!source || source === FILTER_ALL) {
      return;
    }
    if (armedSources.has(source)) {
      return;
    }
    armedSources.add(source);
    notify();
  }

  function noteDisarmed(source) {
    if (!source || !armedSources.has(source)) {
      return;
    }
    armedSources.delete(source);
    if (filter === source) {
      filter = FILTER_ALL;
      followTail = true;
    }
    notify();
  }

  function openDrawer(focusSource) {
    open = true;
    followTail = true;
    if (focusSource) {
      filter = focusSource;
      if (focusSource !== FILTER_ALL) {
        armedSources.add(focusSource);
      }
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
    followTail = true;
    notify();
  }

  function clear() {
    lines = [];
    notify();
  }

  async function closeSource(source) {
    if (!source || source === FILTER_ALL) {
      return;
    }
    if (typeof host?.logs?.disarm === "function") {
      const result = await host.logs.disarm(source);
      if (result && result.ok === false) {
        return;
      }
    }
    armedSources.delete(source);
    if (filter === source) {
      filter = FILTER_ALL;
      followTail = true;
    }
    notify();
    try {
      onSourceDisarmed?.(source);
    } catch {
      // ignore listener errors
    }
  }

  function visibleLines() {
    if (filter === FILTER_ALL) {
      return lines;
    }
    return lines.filter((line) => line.source === filter);
  }

  function filterOptions() {
    const options = [{ id: FILTER_ALL, label: "All" }];
    const ordered = [...armedSources].sort(compareSources);
    for (const id of ordered) {
      options.push({ id, label: sourceLabel(id) });
    }
    if (filter !== FILTER_ALL && !armedSources.has(filter)) {
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
    // Real DOM scrollHeight/clientHeight are read-only; only scrollTop is writable.
    body.scrollTop = 0;
    body.addEventListener("scroll", () => {
      const remaining = body.scrollHeight - body.scrollTop - body.clientHeight;
      followTail = remaining <= NEAR_BOTTOM_PX;
    });

    const alert = document.createElement("div");
    alert.className = "process-log-perf-alert";
    alert.setAttribute("role", "status");
    alert.textContent = PERF_ALERT_TEXT;
    alert.hidden = true;

    root.append(header, body, alert);

    let lastFilterIds = null;

    function optionIdsKey(options) {
      return options.map((option) => option.id).join("\0");
    }

    function paintFilters() {
      const options = filterOptions();
      const key = optionIdsKey(options);
      if (key !== lastFilterIds) {
        lastFilterIds = key;
        filters.replaceChildren();
        for (const option of options) {
          const chip = document.createElement("div");
          chip.className = "process-log-filter-chip";
          chip.dataset.source = option.id;
          chip.setAttribute("aria-pressed", String(option.id === filter));
          chip.setAttribute("role", "button");
          chip.tabIndex = 0;

          const label = document.createElement("span");
          label.className = "process-log-filter-label";
          label.textContent = option.label;
          chip.append(label);

          if (option.id !== FILTER_ALL) {
            const closeBtn = document.createElement("button");
            closeBtn.type = "button";
            closeBtn.className = "process-log-filter-close";
            closeBtn.setAttribute("aria-label", `Close ${option.label} logs`);
            closeBtn.textContent = "×";
            closeBtn.addEventListener("click", (event) => {
              event?.stopPropagation?.();
              event?.preventDefault?.();
              void closeSource(option.id);
            });
            chip.append(closeBtn);
          }

          chip.addEventListener("click", (event) => {
            if (event?.target?.className === "process-log-filter-close") {
              return;
            }
            setFilter(option.id);
          });
          filters.append(chip);
        }
        return;
      }

      for (const chip of filters.querySelectorAll(".process-log-filter-chip")) {
        chip.setAttribute("aria-pressed", String(chip.dataset.source === filter));
      }
    }

    function paintBody() {
      const previousScrollTop = Number(body.scrollTop) || 0;
      body.replaceChildren();
      const visible = visibleLines();
      if (!visible.length) {
        const empty = document.createElement("div");
        empty.className = "process-log-waiting";
        empty.textContent = WAITING_FOR_LOGS;
        body.append(empty);
        if (followTail) {
          body.scrollTop = 0;
        } else {
          body.scrollTop = previousScrollTop;
        }
        return;
      }
      for (const line of visible) {
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
      if (followTail) {
        body.scrollTop = body.scrollHeight;
      } else {
        body.scrollTop = previousScrollTop;
      }
    }

    function paintAlert() {
      alert.hidden = !(open && armedSources.size > 2);
    }

    function paint() {
      root.dataset.open = String(open);
      toggleBtn.textContent = open ? "Hide logs" : "Show logs";
      filters.hidden = !open;
      clearBtn.hidden = !open;
      body.hidden = !open;
      paintFilters();
      paintBody();
      paintAlert();
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
    closeSource,
    noteArmed,
    noteDisarmed,
    mount,
    onChange,
    snapshot,
    sourceLabel,
    FILTER_ALL,
  };
}

export {
  sourceLabel,
  FILTER_ALL,
  MAX_DRAWER_LINES,
  WAITING_FOR_LOGS,
  PERF_ALERT_TEXT,
  NEAR_BOTTOM_PX,
};
