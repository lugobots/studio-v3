import { AREAS, areaById } from "./model.js";
import { createAreaIcon } from "./area-icons.js";
import { applyAppearance, normalizeAppearance } from "../lib/appearance.js";
import { applyTelemetry } from "../lib/telemetry.js";
import { reportResult } from "../lib/dialogs.js";
import { offerUpgrade } from "../lib/upgrade-flow.js";
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

  const rail = document.createElement("nav");
  rail.className = "area-rail";
  rail.setAttribute("aria-label", "Primary areas");

  const menu = document.createElement("aside");
  menu.className = "side-menu area-lateral";
  const actions = document.createElement("nav");
  actions.className = "tab-actions area-actions";
  const pinned = document.createElement("div");
  pinned.className = "side-menu-pinned area-lateral-footer";
  menu.append(actions, pinned);

  const workspace = document.createElement("div");
  workspace.className = "workspace";
  const windowPane = document.createElement("main");
  windowPane.className = "app-window";
  windowPane.setAttribute("role", "main");
  workspace.append(windowPane);

  frame.append(rail, menu, workspace);

  const statusBar = document.createElement("footer");
  statusBar.className = "app-status-bar";
  statusBar.setAttribute("aria-label", "Studio status");

  const shell = document.createElement("div");
  shell.className = "app-shell";
  shell.append(frame, statusBar);
  outlet.append(shell);

  // Area rail (Workspace / Build / …) can auto-collapse to icons; lateral menu stays fixed.
  const RAIL_MODES = ["auto", "open", "closed"];
  const RAIL_MODE_LABEL = {
    auto: "Area menu auto-collapses; click to keep expanded with names",
    open: "Area menu kept expanded; click to keep icons only",
    closed: "Area menu icons only; click for auto-collapse",
  };
  const RAIL_MODE_GLYPH = {
    auto: "↻",
    open: "⊣",
    closed: "⊢",
  };

  const state = {
    area: "workspace",
    config: null,
    game: initialGameControls(),
    editor: { open: false, starting: false, ready: false, error: "" },
    update: null,
    // auto: expand labels on hover; open/closed: pin permanently.
    rail: { mode: "auto", hovered: true },
  };

  let railLeaveTimer = null;

  function railExpanded() {
    if (state.rail.mode === "open") {
      return true;
    }
    if (state.rail.mode === "closed") {
      return false;
    }
    return Boolean(state.rail.hovered);
  }

  function syncRailChrome() {
    const expanded = railExpanded();
    frame.setAttribute("data-rail-expanded", String(expanded));
    frame.setAttribute("data-rail-mode", state.rail.mode);
    rail.setAttribute("data-rail-expanded", String(expanded));
    for (const label of rail.querySelectorAll(".area-rail-label")) {
      label.hidden = !expanded;
    }
    const fold = rail.querySelector(".area-rail-fold");
    if (fold) {
      fold.setAttribute("aria-label", RAIL_MODE_LABEL[state.rail.mode]);
      fold.title = RAIL_MODE_LABEL[state.rail.mode];
      fold.setAttribute("data-rail-mode", state.rail.mode);
      fold.setAttribute("aria-pressed", state.rail.mode === "open" ? "true" : "false");
      const glyph = fold.querySelector(".area-rail-icon");
      if (glyph) {
        glyph.textContent = RAIL_MODE_GLYPH[state.rail.mode];
      }
    }
  }

  function cycleRailMode() {
    const index = RAIL_MODES.indexOf(state.rail.mode);
    state.rail.mode = RAIL_MODES[(index + 1) % RAIL_MODES.length];
    if (state.rail.mode === "auto") {
      state.rail.hovered = true;
    }
    syncRailChrome();
  }

  function setRailHovered(hovered) {
    if (railLeaveTimer) {
      clearTimeout(railLeaveTimer);
      railLeaveTimer = null;
    }
    state.rail.hovered = Boolean(hovered);
    syncRailChrome();
  }

  function scheduleRailLeave() {
    if (state.rail.mode !== "auto") {
      return;
    }
    if (railLeaveTimer) {
      clearTimeout(railLeaveTimer);
    }
    railLeaveTimer = setTimeout(() => {
      railLeaveTimer = null;
      state.rail.hovered = false;
      syncRailChrome();
    }, 180);
  }

  rail.addEventListener("mouseenter", () => {
    if (state.rail.mode === "auto") {
      setRailHovered(true);
    }
  });
  rail.addEventListener("mouseleave", () => {
    scheduleRailLeave();
  });

  function syncArmUiAfterDrawerClose(source) {
    if (source === "api") {
      void (async () => {
        if (typeof host?.config?.set === "function") {
          state.config = await host.config.set({ debug_mode: false });
        }
        apiDebugApplied = false;
        paintChrome();
      })();
      return;
    }
    if (source === "server") {
      if (state.game.serverLogs) {
        applyGameControlUpdate(reduceGameControl(state.game, { type: "toggle-server-logs" }));
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
      applyGameControlUpdate(reduceGameControl(state.game, {
        type: "set-bot",
        team,
        number,
        control: "logs",
      }));
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
  let editorFrame = null;

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
    applyAppearance(document, state.config?.appearance);
    paint();
    await syncApiDebug(state.config);
    if (state.area === "settings") {
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

  /**
   * Game-control updates that only change menu/control state must not rebuild
   * the Workspace window (reparenting iframes reloads them in Chromium).
   */
  function applyGameControlUpdate(next) {
    const mediaChanged = Boolean(state.game.serverRunning) !== Boolean(next.serverRunning);
    state.game = next;
    if (mediaChanged || state.area !== "workspace") {
      paint();
      return;
    }
    paintChrome();
  }

  function selectArea(areaId) {
    state.area = areaById(areaId).id;
    if (state.rail.mode === "auto") {
      state.rail.hovered = true;
    }
    paint();
  }

  function paintRail() {
    rail.replaceChildren();

    const fold = document.createElement("button");
    fold.type = "button";
    fold.className = "area-rail-item area-rail-fold";
    fold.setAttribute("data-rail-fold", "true");
    const foldGlyph = document.createElement("span");
    foldGlyph.className = "area-rail-icon";
    foldGlyph.setAttribute("aria-hidden", "true");
    foldGlyph.textContent = RAIL_MODE_GLYPH[state.rail.mode];
    fold.append(foldGlyph);
    fold.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      cycleRailMode();
    });

    const items = document.createElement("div");
    items.className = "area-rail-items";
    const main = document.createElement("div");
    main.className = "area-rail-group area-rail-group--main";
    const account = document.createElement("div");
    account.className = "area-rail-group area-rail-group--account";

    for (const area of AREAS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "area-rail-item";
      button.setAttribute("data-area", area.id);
      button.dataset.area = area.id;
      button.title = area.label;
      button.setAttribute("aria-label", area.label);
      const selected = state.area === area.id;
      button.setAttribute("aria-current", selected ? "page" : "false");
      const glyph = document.createElement("span");
      glyph.className = "area-rail-icon";
      glyph.setAttribute("aria-hidden", "true");
      glyph.setAttribute("data-area-icon", area.icon);
      glyph.append(createAreaIcon(area.icon));
      const label = document.createElement("span");
      label.className = "area-rail-label";
      label.textContent = area.label;
      button.append(glyph, label);
      button.addEventListener("click", () => selectArea(area.id));
      if (area.group === "account") {
        account.append(button);
      } else {
        main.append(button);
      }
    }

    items.append(main, account);
    rail.append(fold, items);
    syncRailChrome();
  }

  function paintWorkspaceLateral() {
    actions.setAttribute("aria-label", "Workspace");
    actions.replaceChildren();
    pinned.replaceChildren();

    renderGameControls(actions, {
      state: state.game,
      host,
      dialogs,
      onChange: applyGameControlUpdate,
      onOpenLogs(source) {
        processLogs.noteArmed(source);
        processLogs.openDrawer(source);
      },
      onLogsDisarmed(source) {
        processLogs.noteDisarmed(source);
      },
    });

    const editorToggle = document.createElement("button");
    editorToggle.type = "button";
    editorToggle.className = "menu-item";
    editorToggle.dataset.action = state.editor.open ? "close-editor" : "open-editor";
    editorToggle.disabled = Boolean(state.editor.starting);
    editorToggle.textContent = state.editor.open
      ? state.editor.starting
        ? "Starting editor…"
        : "Close editor"
      : "Open editor";
    editorToggle.addEventListener("click", () => {
      if (state.editor.open) {
        void closeEditor();
      } else {
        void openEditor();
      }
    });
    actions.append(editorToggle);

    const area = areaById("workspace");
    for (const action of area.actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "menu-item";
      button.dataset.action = action.id;
      button.textContent = action.label;
      button.addEventListener("click", () => runAction(action.id));
      actions.append(button);
    }
  }

  function paintSettingsLateral(config) {
    actions.setAttribute("aria-label", "Settings");
    actions.replaceChildren();
    pinned.replaceChildren();

    const themeLabel = document.createElement("label");
    themeLabel.className = "setting-row";
    const themeSelect = document.createElement("select");
    themeSelect.setAttribute("aria-label", "Appearance");
    for (const value of ["dark", "light"]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value === "dark" ? "Dark" : "Light";
      themeSelect.append(option);
    }
    themeSelect.value = normalizeAppearance(config?.appearance);
    themeSelect.addEventListener("change", async () => {
      const appearance = normalizeAppearance(themeSelect.value);
      state.config = await host.config.set({ appearance });
      applyAppearance(document, state.config?.appearance ?? appearance);
      paint();
    });
    themeLabel.append(document.createTextNode("Appearance "), themeSelect);

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

    actions.append(themeLabel, label, debugLabel);
  }

  function paintPlaceholderLateral(area) {
    actions.setAttribute("aria-label", area.label);
    actions.replaceChildren();
    pinned.replaceChildren();
    const note = document.createElement("p");
    note.className = "area-placeholder-note";
    note.textContent = "Coming soon";
    actions.append(note);
  }

  function paintProfileLateral() {
    actions.setAttribute("aria-label", "Profile");
    actions.replaceChildren();
    pinned.replaceChildren();
    const note = document.createElement("p");
    note.className = "area-placeholder-note";
    note.textContent = "Account";
    actions.append(note);
  }

  function paintChrome() {
    paintRail();
    const area = areaById(state.area);
    if (area.id === "workspace") {
      paintWorkspaceLateral();
    } else if (area.id === "settings") {
      paintSettingsLateral(state.config);
    } else if (area.id === "profile") {
      paintProfileLateral();
    } else {
      paintPlaceholderLateral(area);
    }
  }

  function paintWindow() {
    windowPane.replaceChildren();
    if (state.area === "profile") {
      windowPane.append(profileView(state.config));
    } else if (state.area === "settings") {
      windowPane.append(settingsView());
    } else if (state.area === "build" || state.area === "help") {
      windowPane.append(placeholderView(areaById(state.area)));
    } else {
      windowPane.append(workspaceView(state.config));
    }
  }

  function studioBuildVersion(config) {
    return config?.apiVersion || config?.studio_api_version || "dev";
  }

  async function requestUpgrade() {
    const result = await offerUpgrade(host, dialogs);
    if (!result?.ok && !result?.declined) {
      await reportResult(
        dialogs,
        result || { ok: false, error: "The update package was not launched." },
      );
    }
  }

  function paintFooter() {
    statusBar.replaceChildren();
    const version = studioBuildVersion(state.config);
    const versionEl = document.createElement("p");
    versionEl.className = "app-status-version";
    versionEl.dataset.studioVersion = version;
    versionEl.title = "Studio build version";
    versionEl.setAttribute("aria-label", `Studio build version ${version}`);
    versionEl.textContent = version;

    const updateSlot = document.createElement("div");
    updateSlot.className = "app-status-update";
    if (state.update?.state === "newer") {
      const notice = document.createElement("span");
      notice.className = "app-status-update-label";
      notice.textContent = `Update available: ${state.update.version}`;
      const action = document.createElement("button");
      action.type = "button";
      action.className = "app-status-update-action";
      action.textContent = "Upgrade";
      action.addEventListener("click", () => {
        void requestUpgrade();
      });
      updateSlot.append(notice, action);
    }

    statusBar.append(versionEl, updateSlot);
  }

  function paint() {
    paintChrome();
    paintWindow();
    paintFooter();
    syncRailChrome();
  }

  async function refreshUpdateStatus() {
    if (typeof host?.updates?.check !== "function") {
      return;
    }
    try {
      const result = await host.updates.check();
      if (!result || result.unsupported) {
        state.update = null;
      } else {
        state.update = result;
      }
      paintFooter();
    } catch {
      state.update = null;
      paintFooter();
    }
  }

  function profileView(config) {
    const section = document.createElement("section");
    section.setAttribute("data-window", "profile");
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

  function settingsView() {
    const section = document.createElement("section");
    section.setAttribute("data-window", "settings");
    section.dataset.window = "settings";
    const title = document.createElement("h1");
    title.textContent = "Settings";
    const body = document.createElement("p");
    body.textContent = "Use the Settings menu to change appearance, telemetry, and API debug logging.";
    section.append(title, body);
    return section;
  }

  function placeholderView(area) {
    const section = document.createElement("section");
    section.setAttribute("data-window", area.id);
    section.dataset.window = area.id;
    section.className = "area-placeholder";
    const title = document.createElement("h1");
    title.textContent = area.label;
    const body = document.createElement("p");
    body.textContent = "Coming soon";
    section.append(title, body);
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

  function ensureEditorFrame() {
    if (editorFrame) {
      return editorFrame;
    }
    editorFrame = document.createElement("iframe");
    editorFrame.className = "editor-frame";
    editorFrame.id = "editor_frame";
    editorFrame.title = "Editor";
    editorFrame.allow = "clipboard-read; clipboard-write";
    return editorFrame;
  }

  function hideEditorFrame(frame) {
    frame.hidden = true;
    frame.setAttribute("aria-hidden", "true");
    clearGameFrameSrc(frame);
  }

  function showEditorFrame(frame, url) {
    frame.hidden = false;
    if (typeof frame.removeAttribute === "function") {
      frame.removeAttribute("hidden");
      frame.removeAttribute("aria-hidden");
    } else if (frame.attributes) {
      delete frame.attributes.hidden;
      delete frame.attributes["aria-hidden"];
    }
    const currentSrc = frame.getAttribute("src") || frame.src || "";
    if (currentSrc !== url) {
      frame.src = url;
    }
  }

  async function openEditor() {
    if (state.editor.open && (state.editor.ready || state.editor.starting)) {
      return;
    }
    state.editor = { open: true, starting: true, ready: false, error: "" };
    paint();
    if (typeof host?.docker?.ensureEditor !== "function") {
      state.editor = {
        open: true,
        starting: false,
        ready: false,
        error: "Editor controls are only available in the desktop app",
      };
      paint();
      return;
    }
    try {
      const result = await host.docker.ensureEditor();
      if (!result?.ok) {
        state.editor = {
          open: true,
          starting: false,
          ready: false,
          error: result?.error || "Could not start the editor",
        };
        paint();
        return;
      }
      state.editor = {
        open: true,
        starting: false,
        ready: true,
        error: "",
        url: result.url || state.config?.editor_url || editorUrl(),
      };
      paint();
    } catch (error) {
      state.editor = {
        open: true,
        starting: false,
        ready: false,
        error: error?.message || String(error),
      };
      paint();
    }
  }

  async function closeEditor() {
    state.editor = { open: false, starting: false, ready: false, error: "" };
    if (editorFrame) {
      hideEditorFrame(editorFrame);
    }
    paint();
    if (typeof host?.docker?.stopEditor === "function") {
      try {
        await host.docker.stopEditor();
      } catch {
        // Teardown is best-effort; Workspace stays usable without the helper.
      }
    }
  }

  function workspaceView(config) {
    const section = document.createElement("section");
    section.setAttribute("data-window", "workspace");
    section.dataset.window = "workspace";
    section.className = state.editor.open
      ? "workspace-main workspace-main--editor-open"
      : "workspace-main";

    const split = document.createElement("div");
    split.className = state.editor.open ? "workspace-split" : "workspace-split workspace-split--game-only";

    const panel = document.createElement("div");
    panel.className = "game-panel";

    const frameEl = ensureGameFrame();
    const nextUrl = config?.game_frontend_url || gameFrontendUrl();

    if (state.game.serverRunning) {
      showGameFrame(frameEl);
      const currentSrc = frameEl.getAttribute("src") || "";
      if (currentSrc !== nextUrl) {
        frameEl.src = nextUrl;
      }
      panel.append(frameEl);
    } else {
      // Unload the frontend while down so authors are not left on a white/failed document.
      frameEl.hidden = true;
      frameEl.setAttribute("aria-hidden", "true");
      clearGameFrameSrc(frameEl);
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
      panel.append(overlay, frameEl);
    }

    split.append(panel);

    if (state.editor.open) {
      const editorPanel = document.createElement("div");
      editorPanel.className = "editor-panel";
      const url = state.editor.url || config?.editor_url || editorUrl();
      editorPanel.dataset.editorUrl = url;

      if (state.editor.ready) {
        const edFrame = ensureEditorFrame();
        showEditorFrame(edFrame, url);
        editorPanel.append(edFrame);
      } else {
        if (editorFrame) {
          hideEditorFrame(editorFrame);
        }
        const placeholder = document.createElement("div");
        placeholder.className = "editor-placeholder";
        placeholder.textContent = state.editor.starting
          ? "Starting editor…"
          : state.editor.error || "Editor unavailable";
        editorPanel.append(placeholder);
      }
      split.append(editorPanel);
    } else if (editorFrame) {
      hideEditorFrame(editorFrame);
    }

    section.append(split, processLogHost);
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
  refreshUpdateStatus();
  bindServerStatus();
  return shell;
}
