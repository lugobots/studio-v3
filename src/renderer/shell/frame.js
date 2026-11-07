import { PINNED, TABS, tabById } from "./model.js";
import { applyTelemetry } from "../lib/telemetry.js";
import { reportResult } from "../lib/dialogs.js";
import { applyMatchConfig, initialGameControls, reduceGameControl } from "./game-controls.js";
import { renderGameControls, startServerFromApi } from "./game-controls-view.js";
import { createProcessLogDrawer } from "./process-log-drawer.js";
import { gameFrontendUrl } from "./game-frontend.js";
import { editorUrl } from "./editor-url.js";

function statusRunning(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (typeof payload.running === "boolean") {
    return payload.running;
  }
  if (payload.body && typeof payload.body.running === "boolean") {
    return payload.body.running;
  }
  return null;
}

export function renderAppFrame(outlet, { host, dialogs }) {
  const frame = document.createElement("div");
  frame.className = "app-frame";

  const menu = document.createElement("aside");
  menu.className = "side-menu";
  const actions = document.createElement("nav");
  actions.className = "tab-actions";
  const pinned = document.createElement("div");
  pinned.className = "side-menu-pinned";
  menu.append(actions, pinned);

  const workspace = document.createElement("div");
  workspace.className = "workspace";
  const tabs = document.createElement("div");
  tabs.className = "tab-bar";
  tabs.setAttribute("role", "tablist");
  const windowPane = document.createElement("main");
  windowPane.className = "app-window";
  windowPane.setAttribute("role", "tabpanel");
  workspace.append(tabs, windowPane);

  frame.append(menu, workspace);
  outlet.append(frame);

  const state = { tab: "workspace", view: "tab", config: null, game: initialGameControls() };

  function syncArmUiAfterDrawerClose(source) {
    if (source === "api") {
      void (async () => {
        if (typeof host?.config?.set === "function") {
          state.config = await host.config.set({ debug_mode: false });
        }
        apiDebugApplied = false;
        paint();
      })();
      return;
    }
    if (source === "server") {
      if (state.game.serverLogs) {
        state.game = reduceGameControl(state.game, { type: "toggle-server-logs" });
        paint();
      }
      return;
    }
    const match = /^(home|away)\/(\d+)$/.exec(source || "");
    if (!match) {
      return;
    }
    const team = match[1];
    const number = match[2];
    const index = Number(number) - 1;
    if (state.game[team]?.[index]?.logs) {
      state.game = reduceGameControl(state.game, {
        type: "set-bot",
        team,
        number,
        control: "logs",
      });
      paint();
    }
  }

  // Mount once; the drawer redraws itself on subscribe/filter/clear without a full frame paint.
  const processLogs = createProcessLogDrawer({
    host,
    onSourceDisarmed: syncArmUiAfterDrawerClose,
  });
  const processLogHost = document.createElement("div");
  processLogHost.className = "process-log-drawer-host";
  processLogs.mount(processLogHost);
  // Reuse across paint() so log toggles / control refreshes do not reload the match frontend.
  let gameFrame = null;

  function applyServerStatus(payload) {
    const running = statusRunning(payload);
    if (running === null || running === state.game.serverRunning) {
      return;
    }
    state.game = reduceGameControl(state.game, { type: "set-server-running", running });
    paint();
  }

  function bindServerStatus() {
    // Push-first: live connect/reconnect snapshots own the truth. HTTP status is only a
    // bootstrap fallback when the live channel has not delivered yet.
    let sawLiveStatus = false;
    if (typeof host?.server?.onStatus === "function") {
      try {
        host.server.onStatus((status) => {
          sawLiveStatus = true;
          applyServerStatus(status);
        });
      } catch {
        // Live channel may be unavailable (missing WebSocket); HTTP status still hydrates.
      }
    }
    if (typeof host?.server?.status === "function") {
      void Promise.resolve()
        .then(() => host.server.status())
        .then((result) => {
          if (sawLiveStatus || !result?.ok) {
            return;
          }
          applyServerStatus(result);
        })
        .catch(() => {});
    }
  }

  let apiDebugApplied = null;

  function apiDebugOn(config) {
    return Boolean(config && (config.debugMode === true || config.debug_mode === true));
  }

  async function syncApiDebug(config) {
    const on = apiDebugOn(config);
    if (apiDebugApplied === on) {
      return;
    }
    if (on) {
      if (typeof host?.logs?.arm === "function") {
        const result = await host.logs.arm("api");
        if (result && result.ok === false) {
          return;
        }
      }
      apiDebugApplied = true;
      processLogs.noteArmed("api");
      return;
    }
    if (apiDebugApplied === true && typeof host?.logs?.disarm === "function") {
      const result = await host.logs.disarm("api");
      if (result && result.ok === false) {
        return;
      }
    }
    apiDebugApplied = false;
    processLogs.noteDisarmed("api");
  }

  async function refreshConfig() {
    state.config = await host.config.get();
    paint();
    await syncApiDebug(state.config);
    if (state.view === "settings") {
      applyTelemetry(document, {
        telemetryEnabled: state.config.telemetryEnabled,
        measurementId: state.config.measurementId,
      });
    }
  }

  async function refreshMatchConfig() {
    if (typeof host?.config?.matchGet !== "function") {
      return;
    }
    try {
      const match = await host.config.matchGet();
      state.game = applyMatchConfig(state.game, match);
      paint();
    } catch {
      // Keep defaults when match prefs are unavailable.
    }
  }

  function paint() {
    tabs.replaceChildren();
    for (const tab of TABS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tab";
      button.setAttribute("role", "tab");
      const selected = state.tab === tab.id;
      button.setAttribute("aria-selected", String(selected));
      button.id = `tab-${tab.id}`;
      if (selected) {
        windowPane.setAttribute("aria-labelledby", button.id);
      }
      button.textContent = tab.label;
      button.addEventListener("click", () => {
        state.tab = tab.id;
        state.view = "tab";
        paint();
      });
      tabs.append(button);
    }

    const tab = tabById(state.tab);
    actions.setAttribute("aria-label", tab.label);
    actions.replaceChildren();
    if (state.tab === "workspace") {
      renderGameControls(actions, {
        state: state.game,
        host,
        dialogs,
        onChange(next) {
          state.game = next;
          paint();
        },
        onOpenLogs(source) {
          processLogs.noteArmed(source);
          processLogs.openDrawer(source);
        },
        onLogsDisarmed(source) {
          processLogs.noteDisarmed(source);
        },
      });
    }
    for (const action of tab.actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "menu-item";
      button.dataset.action = action.id;
      button.textContent = action.label;
      button.addEventListener("click", () => runAction(action.id));
      actions.append(button);
    }

    pinned.replaceChildren();
    for (const item of PINNED) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "menu-item";
      button.dataset.view = item.id;
      if (state.view === item.id) {
        button.setAttribute("aria-current", "page");
      }
      button.textContent = item.label;
      button.addEventListener("click", () => {
        state.view = item.id;
        paint();
      });
      pinned.append(button);
    }

    windowPane.replaceChildren();
    if (state.view === "profile") {
      windowPane.append(profileView(state.config));
    } else if (state.view === "settings") {
      windowPane.append(settingsView(state.config));
    } else if (state.tab === "runtime") {
      windowPane.append(runtimeView());
    } else if (state.tab === "editor") {
      windowPane.append(editorView(state.config));
    } else {
      windowPane.append(workspaceView(state.config));
    }
  }

  function profileView(config) {
    const section = document.createElement("section");
    section.dataset.window = "profile";
    const title = document.createElement("h1");
    title.textContent = "Profile";
    const version = document.createElement("p");
    version.textContent = `Version ${config?.appVersion || config?.app_version || "unknown"}`;
    const install = document.createElement("p");
    install.textContent = `Install ${config?.install_unique_id || "assigned on first save"}`;
    section.append(title, version, install);
    return section;
  }

  function settingsView(config) {
    const section = document.createElement("section");
    section.dataset.window = "settings";
    const title = document.createElement("h1");
    title.textContent = "Settings";
    const label = document.createElement("label");
    label.className = "setting-row";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = config ? config.telemetryEnabled !== false : true;
    input.addEventListener("change", async () => {
      state.config = await host.config.set({ telemetry_enabled: input.checked });
      applyTelemetry(document, {
        telemetryEnabled: state.config.telemetryEnabled,
        measurementId: state.config.measurementId,
      });
    });
    label.append(input, document.createTextNode(" Send usage data to Google Analytics"));
    const debugLabel = document.createElement("label");
    debugLabel.className = "setting-row";
    const debugInput = document.createElement("input");
    debugInput.type = "checkbox";
    debugInput.setAttribute("aria-label", "Studio API debug logging");
    debugInput.checked = apiDebugOn(config);
    debugInput.addEventListener("change", async () => {
      state.config = await host.config.set({ debug_mode: debugInput.checked });
      await syncApiDebug(state.config);
      if (debugInput.checked) {
        processLogs.noteArmed("api");
        processLogs.openDrawer("api");
      } else {
        processLogs.noteDisarmed("api");
      }
    });
    debugLabel.append(debugInput, document.createTextNode(" Studio API debug logging"));
    section.append(title, label, debugLabel);
    return section;
  }

  function ensureGameFrame() {
    if (gameFrame) {
      return gameFrame;
    }
    gameFrame = document.createElement("iframe");
    gameFrame.className = "game-frame";
    gameFrame.id = "game_frame";
    gameFrame.title = "Game";
    return gameFrame;
  }

  function clearGameFrameSrc(frame) {
    // Real DOM NamedNodeMap props are not deletable in strict mode; use removeAttribute.
    if (typeof frame.removeAttribute === "function") {
      frame.removeAttribute("src");
    } else if (frame.attributes && Object.prototype.hasOwnProperty.call(frame.attributes, "src")) {
      delete frame.attributes.src;
    }
    if (Object.prototype.hasOwnProperty.call(frame, "src")) {
      delete frame.src;
    }
  }

  function showGameFrame(frame) {
    frame.hidden = false;
    if (typeof frame.removeAttribute === "function") {
      frame.removeAttribute("hidden");
      frame.removeAttribute("aria-hidden");
    } else if (frame.attributes) {
      delete frame.attributes.hidden;
      delete frame.attributes["aria-hidden"];
    }
  }

  function workspaceView(config) {
    const section = document.createElement("section");
    section.dataset.window = "workspace";
    section.className = "workspace-main";

    const panel = document.createElement("div");
    panel.className = "game-panel";

    const frame = ensureGameFrame();
    const nextUrl = config?.game_frontend_url || gameFrontendUrl();

    if (state.game.serverRunning) {
      showGameFrame(frame);
      const currentSrc = frame.getAttribute("src") || "";
      if (currentSrc !== nextUrl) {
        frame.src = nextUrl;
      }
      panel.append(frame);
    } else {
      // Unload the frontend while down so authors are not left on a white/failed document.
      frame.hidden = true;
      frame.setAttribute("aria-hidden", "true");
      clearGameFrameSrc(frame);
      const overlay = document.createElement("div");
      overlay.className = "game-start-overlay";
      const start = document.createElement("button");
      start.type = "button";
      start.className = "button game-start-control";
      start.title = "Starts the Game Server";
      start.setAttribute("title", "Starts the Game Server");
      start.textContent = "Starts the Game Server";
      start.addEventListener("click", () => {
        startServerFromApi(state.game, (next) => {
          state.game = next;
          paint();
        }, host, dialogs);
      });
      overlay.append(start);
      panel.append(overlay, frame);
    }

    section.append(panel, processLogHost);
    return section;
  }

  function editorView(config) {
    const section = document.createElement("section");
    section.dataset.window = "editor";
    section.className = "editor-main";
    const url = config?.editor_url || editorUrl();
    section.dataset.editorUrl = url;

    const placeholder = document.createElement("div");
    placeholder.className = "editor-placeholder";
    placeholder.textContent = "editor not started";

    // Reserve the iframe placement for a later change. Do not set src — that would
    // load code-server and imply the editor container is running.
    const frame = document.createElement("iframe");
    frame.className = "editor-frame";
    frame.id = "editor_frame";
    frame.title = "Editor";
    frame.hidden = true;
    frame.setAttribute("aria-hidden", "true");
    frame.dataset.src = url;

    section.append(placeholder, frame);
    return section;
  }

  function runtimeView() {
    const section = document.createElement("section");
    section.dataset.window = "runtime";
    const title = document.createElement("h1");
    title.textContent = "Runtime";
    const status = document.createElement("p");
    status.textContent = "Image status appears after a check.";
    const check = document.createElement("button");
    check.type = "button";
    check.className = "button";
    check.textContent = "Check image";
    check.addEventListener("click", async () => {
      const result = await host.docker.status();
      if (result.unsupported) {
        await reportResult(dialogs, result);
        return;
      }
      status.textContent = result.imagePresent
        ? `${result.image} is present`
        : `${result.image || "Studio image"} is not present`;
    });
    section.append(title, status, check);
    return section;
  }

  async function runAction(id) {
    if (id === "image") {
      const result = await host.docker.pull();
      if (result.unsupported || result.ok === false) {
        await reportResult(dialogs, result);
        return;
      }
      dialogs.notify({ title: "Studio image", body: "Pull started. Progress stays in notifications." });
    }
  }

  refreshConfig();
  refreshMatchConfig();
  bindServerStatus();
  return frame;
}
