import { PINNED, TABS, tabById } from "./model.js";
import { applyTelemetry } from "../lib/telemetry.js";
import { reportResult } from "../lib/dialogs.js";
import { initialGameControls } from "./game-controls.js";
import { renderGameControls } from "./game-controls-view.js";
import { gameFrontendUrl } from "./game-frontend.js";
import { editorUrl } from "./editor-url.js";

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

  async function refreshConfig() {
    state.config = await host.config.get();
    paint();
    if (state.view === "settings") {
      applyTelemetry(document, {
        telemetryEnabled: state.config.telemetryEnabled,
        measurementId: state.config.measurementId,
      });
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
    section.append(title, label);
    return section;
  }

  function workspaceView(config) {
    const section = document.createElement("section");
    section.dataset.window = "workspace";
    section.className = "workspace-main";

    const frame = document.createElement("iframe");
    frame.className = "game-frame";
    frame.id = "game_frame";
    frame.title = "Game";
    frame.src = config?.game_frontend_url || gameFrontendUrl();

    const meta = document.createElement("div");
    meta.className = "workspace-meta";
    const path = document.createElement("p");
    path.textContent = config?.project_path || "No bot open";
    const form = document.createElement("form");
    form.className = "publish-form";
    const uri = document.createElement("input");
    uri.name = "botUri";
    uri.placeholder = "repo.lugobots.ai/team/bot";
    uri.setAttribute("aria-label", "Bot URI");
    const tag = document.createElement("input");
    tag.name = "tag";
    tag.placeholder = "latest";
    tag.setAttribute("aria-label", "Image tag");
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "button";
    submit.textContent = "Publish";
    form.append(uri, tag, submit);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = await host.publish.bot({ botUri: uri.value, tag: tag.value });
      if (result.ok) {
        dialogs.notify({ title: "Publish finished", body: "The bot image was published." });
      } else {
        await reportResult(dialogs, result);
      }
    });
    meta.append(path, form);
    section.append(frame, meta);
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
  return frame;
}
