import test from "node:test";
import assert from "node:assert/strict";
import { createDialogController } from "../src/renderer/lib/dialog-controller.js";
import { menuFor } from "../src/renderer/shell/model.js";
import { renderAppFrame } from "../src/renderer/shell/frame.js";
import { installDocument } from "./dom-stub.mjs";
import { applyTelemetry, shouldLoadTelemetry } from "../src/renderer/lib/telemetry.js";
import { createHttpStudio } from "../src/renderer/lib/http-studio.js";
import http from "node:http";

test("a confirm dialog stays open until it is answered", async () => {
  const dialogs = createDialogController();
  let settled = false;
  const pending = dialogs.confirm({ title: "Upgrade?" }).then((answer) => {
    settled = true;
    return answer;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.ok(dialogs.snapshot().blocking);
  dialogs.notify({ title: "Pulling" });
  assert.equal(dialogs.snapshot().notices.length, 1);
  assert.ok(dialogs.snapshot().blocking);
  dialogs.answer(true);
  assert.equal(await pending, true);
  assert.equal(dialogs.snapshot().blocking, null);
});

test("areas expose workspace menu without image action or pinned profile or settings", () => {
  const workspace = menuFor("workspace");
  const settings = menuFor("settings");
  const build = menuFor("build");
  assert.deepEqual(workspace.actions, []);
  assert.deepEqual(workspace.pinned, []);
  assert.equal(workspace.areaId, "workspace");
  assert.deepEqual(settings.actions, []);
  assert.deepEqual(build.actions, []);
  assert.equal(menuFor("runtime").areaId, "workspace");
  assert.equal(menuFor("editor").tabId, "workspace");
});

test("area rail shows labels when open and icons only when closed; lateral stays fixed", async () => {
  const installed = installDocument();
  const outlet = installed.document.createElement("div");
  const host = {
    config: {
      async get() {
        return {
          project_path: "/tmp/bot",
          telemetryEnabled: false,
          game_frontend_url: "http://localhost:8080",
          editor_url: "http://localhost:8082",
          workspace_editor_open: false,
          workspaceEditorOpen: false,
        };
      },
    },
    server: {
      async start() { return { ok: true }; },
      async status() { return { ok: true, body: { running: false } }; },
      onStatus() { return () => {}; },
    },
    match: { async start() { return { ok: true }; } },
    publish: { async bot() { return { ok: true }; } },
    docker: {
      async status() { return { imagePresent: false, image: "studio" }; },
      async pull() { return { ok: true }; },
    },
  };
  renderAppFrame(outlet, {
    host,
    dialogs: { notify() {}, confirm() { return Promise.resolve(false); } },
  });
  await Promise.resolve();
  await Promise.resolve();

  const frame = outlet.querySelector(".app-frame");
  const fold = outlet.querySelector(".area-rail-fold");
  const workspaceLabel = outlet.querySelector('[data-area="workspace"] .area-rail-label');
  assert.ok(frame);
  assert.ok(fold);
  assert.ok(workspaceLabel);
  assert.equal(frame.getAttribute("data-rail-mode"), "auto");
  assert.equal(frame.getAttribute("data-rail-expanded"), "true");
  assert.equal(workspaceLabel.hidden, false);
  assert.equal(workspaceLabel.textContent, "Workspace");
  assert.ok(outlet.querySelector(".game-ctrl"));
  assert.equal(outlet.querySelector(".side-menu").hidden, false);

  fold.click();
  assert.equal(frame.getAttribute("data-rail-mode"), "open");
  assert.equal(frame.getAttribute("data-rail-expanded"), "true");
  assert.equal(workspaceLabel.hidden, false);

  fold.click();
  assert.equal(frame.getAttribute("data-rail-mode"), "closed");
  assert.equal(frame.getAttribute("data-rail-expanded"), "false");
  assert.equal(workspaceLabel.hidden, true);
  assert.ok(outlet.querySelector('[data-area="workspace"] .area-rail-icon'));
  assert.equal(
    outlet.querySelector('[data-area="workspace"] .area-rail-icon').getAttribute("data-area-icon"),
    "code",
  );
  assert.equal(
    outlet.querySelector('[data-area="build"] .area-rail-icon').getAttribute("data-area-icon"),
    "rocket",
  );
  assert.equal(
    outlet.querySelector('[data-area="help"] .area-rail-icon').getAttribute("data-area-icon"),
    "circle-help",
  );
  assert.equal(
    outlet.querySelector('[data-area="profile"] .area-rail-icon').getAttribute("data-area-icon"),
    "user",
  );
  assert.equal(
    outlet.querySelector('[data-area="settings"] .area-rail-icon').getAttribute("data-area-icon"),
    "settings",
  );
  assert.ok(outlet.querySelector('[data-area="workspace"] .area-rail-svg'));
  assert.equal(outlet.querySelector(".side-menu").hidden, false);
  assert.ok(outlet.querySelector(".game-ctrl"));

  fold.click();
  assert.equal(frame.getAttribute("data-rail-mode"), "auto");
  assert.equal(frame.getAttribute("data-rail-expanded"), "true");
  assert.equal(workspaceLabel.hidden, false);
  installed.restore();
});

test("telemetry loads only with an id and an on switch", () => {
  assert.equal(shouldLoadTelemetry({ enabled: true, measurementId: "" }), false);
  assert.equal(shouldLoadTelemetry({ enabled: false, measurementId: "G-TEST" }), false);
  const view = {};
  const nodes = new Map();
  const documentRef = {
    defaultView: view,
    head: { append(node) { nodes.set(node.id, node); } },
    getElementById(id) { return nodes.get(id) || null; },
    createElement() {
      return { remove() { nodes.delete(this.id); } };
    },
  };
  assert.equal(applyTelemetry(documentRef, { telemetryEnabled: true, measurementId: "G-TEST" }), true);
  assert.equal(view.dataLayer.length > 0, true);
  assert.equal(applyTelemetry(documentRef, { telemetryEnabled: false, measurementId: "G-TEST" }), false);
  assert.equal(view["ga-disable-G-TEST"], true);
  assert.equal(nodes.size, 0);
});

test("web adapter reaches server, match and publish and refuses local upgrade", async () => {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (req.url === "/api/server/start" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "OK" }));
      return;
    }
    if (req.url === "/api/game/start" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "OK" }));
      return;
    }
    if (req.url === "/api/bot/publish" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "OK" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const studio = createHttpStudio({ baseUrl: `http://127.0.0.1:${port}/api` });
  const serverStarted = await studio.server.start();
  assert.equal(serverStarted.ok, true);
  const started = await studio.match.start();
  assert.equal(started.ok, true);
  const published = await studio.publish.bot({ botUri: "repo/bot", tag: "latest" });
  assert.equal(published.ok, true);
  assert.deepEqual(hits, [
    "POST /api/server/start",
    "POST /api/game/start",
    "POST /api/bot/publish",
  ]);
  const upgrade = await studio.updates.apply();
  assert.equal(upgrade.unsupported, true);
  const docker = await studio.docker.status();
  assert.equal(docker.unsupported, true);
  server.close();
});

test("the shell shows the game panel, area rail, workspace image, and publish", async () => {
  const installed = installDocument();
  const outlet = installed.document.createElement("div");
  let started = 0;
  let serverStarts = 0;
  let editorStarts = 0;
  let editorStops = 0;
  let editorPref = false;
  const host = {
    config: {
      async get() {
        return {
          project_path: "/tmp/bot",
          telemetryEnabled: false,
          game_frontend_url: "http://localhost:8080",
          editor_url: "http://localhost:8082",
          workspace_editor_open: editorPref,
          workspaceEditorOpen: editorPref,
        };
      },
      async set(patch) {
        if (Object.prototype.hasOwnProperty.call(patch, "workspace_editor_open")) {
          editorPref = patch.workspace_editor_open !== false;
        }
        return this.get();
      },
    },
    server: {
      async start() {
        serverStarts += 1;
        return { ok: true };
      },
    },
    match: {
      async start() {
        started += 1;
        return { ok: true };
      },
    },
    publish: { async bot() { return { ok: true }; } },
    docker: {
      async status() { return { imagePresent: false, image: "studio" }; },
      async pull() { return { ok: true }; },
      async ensureEditor() {
        editorStarts += 1;
        return { ok: true, url: "http://localhost:8082" };
      },
      async stopEditor() {
        editorStops += 1;
        return { ok: true };
      },
    },
  };
  renderAppFrame(outlet, {
    host,
    dialogs: { notify() {}, confirm() { return Promise.resolve(false); } },
  });
  await Promise.resolve();
  await Promise.resolve();

  const labels = () => outlet.querySelectorAll("button").map((button) => button.textContent);
  const rail = outlet.querySelector(".area-rail");
  assert.ok(rail);
  assert.equal(outlet.querySelector(".tab-bar"), null);
  assert.ok(outlet.querySelector('[data-area="workspace"]'));
  assert.ok(outlet.querySelector('[data-area="build"]'));
  assert.ok(outlet.querySelector('[data-area="help"]'));
  assert.ok(outlet.querySelector('[data-area="profile"]'));
  assert.ok(outlet.querySelector('[data-area="settings"]'));
  assert.equal(labels().includes("Editor"), false);
  assert.equal(labels().includes("Open editor"), false);
  assert.equal(labels().includes("Studio image"), false);
  assert.equal(outlet.querySelector('button[title="Open editor"]') !== null, true);
  assert.equal(labels().includes("Open bot"), false);
  assert.equal(labels().includes("Start match"), false);
  assert.equal(labels().includes("Publish bot"), false);
  assert.equal(outlet.querySelector(".workspace-meta"), null);
  assert.equal(outlet.querySelector(".publish-form"), null);
  assert.equal(outlet.querySelector('[aria-label="Bot URI"]'), null);
  assert.equal(outlet.querySelector(".game-ctrl") !== null, true);
  assert.equal(
    outlet.querySelectorAll("h3").some((node) => node.textContent === "Session"),
    true,
  );
  const overlay = outlet.querySelector(".game-start-overlay");
  assert.ok(overlay);
  const panelStart = outlet.querySelector(".game-start-control");
  assert.ok(panelStart);
  assert.equal(panelStart.getAttribute("title"), "Starts the Game Server");
  const gameFrame = outlet.querySelector("#game_frame");
  assert.ok(gameFrame);
  assert.equal(gameFrame.tagName, "IFRAME");
  assert.equal(gameFrame.src, undefined);
  assert.equal(gameFrame.getAttribute("src"), null);
  assert.equal(gameFrame.hidden, true);
  assert.equal(gameFrame.title, "Game");
  assert.equal(outlet.querySelector("#editor_frame"), null);
  assert.equal(editorStarts, 0);

  panelStart.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(serverStarts, 1);
  assert.equal(outlet.querySelector(".game-start-overlay"), null);
  const runningFrame = outlet.querySelector("#game_frame");
  assert.ok(runningFrame);
  assert.equal(runningFrame.src, "http://localhost:8080");
  assert.equal(Boolean(runningFrame.hidden), false);

  outlet.querySelector('button[title="Open editor"]').click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(editorStarts, 1);
  assert.ok(outlet.querySelector(".workspace-main--editor-open"));
  assert.ok(outlet.querySelector(".editor-panel"));
  assert.equal(outlet.querySelector(".game-panel") !== null, true);
  const editorFrame = outlet.querySelector("#editor_frame");
  assert.ok(editorFrame);
  assert.equal(editorFrame.tagName, "IFRAME");
  assert.equal(editorFrame.src, "http://localhost:8082");
  assert.equal(Boolean(editorFrame.hidden), false);
  assert.equal(outlet.querySelector("#game_frame").src, "http://localhost:8080");

  outlet.querySelector('button[title="Close editor"]').click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(editorStops, 1);
  assert.equal(outlet.querySelector(".workspace-main--editor-open"), null);
  assert.equal(outlet.querySelector(".editor-panel"), null);
  assert.equal(outlet.querySelector("#editor_frame")?.src, undefined);
  assert.equal(outlet.querySelector("#game_frame").src, "http://localhost:8080");

  outlet.querySelector('[data-area="settings"]').click();
  assert.equal(outlet.querySelector(".game-ctrl"), null);
  assert.equal(outlet.querySelector('button[title="Open editor"]'), null);
  assert.equal(labels().includes("Studio image"), false);
  assert.ok(outlet.querySelector(".app-status-version"));

  outlet.querySelector('[data-area="workspace"]').click();
  assert.ok(outlet.querySelector(".game-ctrl"));
  assert.equal(labels().includes("Studio image"), false);
  assert.equal(outlet.querySelector('button[title="Open editor"]') !== null, true);
  assert.ok(outlet.querySelector(".app-status-version"));
  assert.equal(started, 0);
  assert.equal(serverStarts, 1);

  outlet.querySelector('[data-area="build"]').click();
  assert.equal(outlet.querySelector(".game-ctrl"), null);
  assert.ok(outlet.querySelector('[data-window="build"]'));
  assert.equal(
    outlet.querySelectorAll("p").some((node) => node.textContent === "Coming soon"),
    true,
  );

  outlet.querySelector('[data-area="help"]').click();
  assert.equal(outlet.querySelector(".game-ctrl"), null);
  assert.ok(outlet.querySelector('[data-window="help"]'));
  assert.equal(
    outlet.querySelectorAll("p").some((node) => node.textContent === "Coming soon"),
    true,
  );
  installed.restore();
});

test("workspace opens the editor by default and remembers closed across reload", async () => {
  async function flush() {
    for (let i = 0; i < 12; i += 1) {
      await Promise.resolve();
    }
  }

  const installed = installDocument();
  let editorStarts = 0;
  let editorStops = 0;
  let pref = undefined;
  const host = {
    config: {
      async get() {
        const open = pref === undefined ? true : pref !== false;
        return {
          project_path: "/tmp/bot",
          telemetryEnabled: false,
          game_frontend_url: "http://localhost:8080",
          editor_url: "http://localhost:8082",
          workspace_editor_open: open,
          workspaceEditorOpen: open,
        };
      },
      async set(patch) {
        if (Object.prototype.hasOwnProperty.call(patch, "workspace_editor_open")) {
          pref = patch.workspace_editor_open !== false;
        }
        return this.get();
      },
    },
    server: {
      async start() { return { ok: true }; },
      async status() { return { ok: true, running: false }; },
    },
    docker: {
      async ensureEditor() {
        editorStarts += 1;
        return { ok: true, url: "http://localhost:8082" };
      },
      async stopEditor() {
        editorStops += 1;
        return { ok: true };
      },
    },
  };

  const outlet = installed.document.createElement("div");
  renderAppFrame(outlet, {
    host,
    dialogs: { notify() {}, confirm() { return Promise.resolve(false); } },
  });
  await flush();
  assert.equal(editorStarts, 1);
  assert.ok(outlet.querySelector(".workspace-main--editor-open"));
  assert.ok(outlet.querySelector("#editor_frame"));
  assert.equal(outlet.querySelector('button[title="Close editor"]') !== null, true);

  outlet.querySelector('button[title="Close editor"]').click();
  await flush();
  assert.equal(editorStops, 1);
  assert.equal(pref, false);
  assert.equal(outlet.querySelector('button[title="Open editor"]') !== null, true);
  installed.restore();

  const reloaded = installDocument();
  const reloadedOutlet = reloaded.document.createElement("div");
  const startsBeforeReload = editorStarts;
  renderAppFrame(reloadedOutlet, {
    host,
    dialogs: { notify() {}, confirm() { return Promise.resolve(false); } },
  });
  await flush();
  assert.equal(editorStarts, startsBeforeReload);
  assert.equal(reloadedOutlet.querySelector(".workspace-main--editor-open"), null);
  assert.equal(reloadedOutlet.querySelector('button[title="Open editor"]') !== null, true);
  reloaded.restore();
});

test("status footer shows build version on every area and update notice when newer", async () => {
  const installed = installDocument();
  const outlet = installed.document.createElement("div");
  const host = {
    config: {
      async get() {
        return {
          project_path: "/tmp/bot",
          telemetryEnabled: false,
          apiVersion: "v1.0.1",
          game_frontend_url: "http://localhost:8080",
          editor_url: "http://localhost:8082",
          workspace_editor_open: false,
          workspaceEditorOpen: false,
        };
      },
    },
    updates: {
      async check() {
        return { state: "newer", version: "v1.2.0" };
      },
      async apply() {
        return { ok: true };
      },
    },
    server: {
      async start() { return { ok: true }; },
      async status() { return { ok: true, body: { running: false } }; },
      onStatus() { return () => {}; },
    },
    match: { async start() { return { ok: true }; } },
    publish: { async bot() { return { ok: true }; } },
    docker: {
      async status() { return { imagePresent: false, image: "studio" }; },
      async pull() { return { ok: true }; },
    },
  };
  renderAppFrame(outlet, {
    host,
    dialogs: { notify() {}, confirm() { return Promise.resolve(false); } },
  });
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }

  assert.ok(outlet.querySelector(".app-shell"));
  assert.ok(outlet.querySelector(".app-status-bar"));
  assert.equal(outlet.querySelector(".side-menu-version"), null);
  const version = outlet.querySelector(".app-status-version");
  assert.ok(version);
  assert.equal(version.textContent, "v1.0.1");
  assert.equal(version.title, "Studio build version");
  assert.equal(version.dataset.studioVersion || version.getAttribute("data-studio-version"), "v1.0.1");
  assert.ok(outlet.querySelector(".game-ctrl"));

  const updateLabel = outlet.querySelector(".app-status-update-label");
  assert.ok(updateLabel);
  assert.equal(updateLabel.textContent, "Update available: v1.2.0");
  assert.ok(outlet.querySelector(".app-status-update-action"));

  outlet.querySelector('[data-area="settings"]').click();
  assert.equal(outlet.querySelector(".game-ctrl"), null);
  assert.equal(outlet.querySelector(".app-status-version").textContent, "v1.0.1");
  assert.equal(outlet.querySelector(".app-status-update-label").textContent, "Update available: v1.2.0");

  outlet.querySelector('[data-area="workspace"]').click();
  assert.ok(outlet.querySelector(".game-ctrl"));
  assert.equal(outlet.querySelector(".app-status-version").textContent, "v1.0.1");
  installed.restore();
});

test("status footer defaults build version to dev when config omits it", async () => {
  const installed = installDocument();
  const outlet = installed.document.createElement("div");
  const host = {
    config: {
      async get() {
        return {
          project_path: "/tmp/bot",
          telemetryEnabled: false,
          game_frontend_url: "http://localhost:8080",
          editor_url: "http://localhost:8082",
          workspace_editor_open: false,
          workspaceEditorOpen: false,
        };
      },
    },
    server: {
      async start() { return { ok: true }; },
      async status() { return { ok: true, body: { running: false } }; },
      onStatus() { return () => {}; },
    },
    match: { async start() { return { ok: true }; } },
    publish: { async bot() { return { ok: true }; } },
    docker: {
      async status() { return { imagePresent: false, image: "studio" }; },
      async pull() { return { ok: true }; },
    },
  };
  renderAppFrame(outlet, {
    host,
    dialogs: { notify() {}, confirm() { return Promise.resolve(false); } },
  });
  await Promise.resolve();
  await Promise.resolve();

  const version = outlet.querySelector(".app-status-version");
  assert.ok(version);
  assert.equal(version.textContent, "dev");
  installed.restore();
});

test("workspace loads match config from app settings into game controls", async () => {
  const installed = installDocument();
  const outlet = installed.document.createElement("div");
  let matchGets = 0;
  const host = {
    config: {
      async get() {
        return {
          project_path: "/tmp/bot",
          telemetryEnabled: false,
          game_frontend_url: "http://localhost:8080",
          editor_url: "http://localhost:8082",
          workspace_editor_open: false,
          workspaceEditorOpen: false,
        };
      },
      async matchGet() {
        matchGets += 1;
        return {
          team_side: "away",
          skip_to_golden_goal: true,
          game_speed: "fast",
          opponent_team: "zombies",
          saved_positions: [{ name: "corner" }, { name: "kickoff" }],
        };
      },
    },
    server: {
      async start() {
        return { ok: true };
      },
      async status() {
        return { ok: true, body: { running: false } };
      },
      onStatus() {
        return () => {};
      },
    },
    match: {
      async start() {
        return { ok: true };
      },
    },
    publish: { async bot() { return { ok: true }; } },
    docker: {
      async status() { return { imagePresent: false, image: "studio" }; },
      async pull() { return { ok: true }; },
    },
  };

  renderAppFrame(outlet, {
    host,
    dialogs: { notify() {}, confirm() { return Promise.resolve(false); } },
  });
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }

  assert.equal(matchGets, 1);
  assert.equal(outlet.querySelector("#team-side-switch").getAttribute("aria-checked"), "true");
  assert.equal(outlet.querySelector("#extra-time-check input").checked, true);
  assert.equal(
    outlet.querySelectorAll("button").find((button) => button.getAttribute("title") === "Fast speed")
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    outlet.querySelectorAll("button").find((button) => button.getAttribute("title") === "Zombies mode")
      .getAttribute("aria-pressed"),
    "true",
  );
  const options = outlet.querySelector("select").querySelectorAll("option").map((node) => node.textContent);
  assert.deepEqual(options, ["corner", "kickoff"]);
  installed.restore();
});

test("workspace hydrates power control from already-running API/live status", async () => {
  const installed = installDocument();
  const outlet = installed.document.createElement("div");
  const statusListeners = new Set();
  let statusReads = 0;
  const host = {
    config: {
      async get() {
        return {
          project_path: "/tmp/bot",
          telemetryEnabled: false,
          game_frontend_url: "http://localhost:8080",
          editor_url: "http://localhost:8082",
          workspace_editor_open: false,
          workspaceEditorOpen: false,
        };
      },
    },
    server: {
      async start() {
        return { ok: true };
      },
      async status() {
        statusReads += 1;
        return { ok: true, body: { running: true } };
      },
      onStatus(callback) {
        statusListeners.add(callback);
        callback({ running: true });
        return () => statusListeners.delete(callback);
      },
    },
    match: {
      async start() {
        return { ok: true };
      },
    },
    publish: { async bot() { return { ok: true }; } },
    docker: {
      async status() { return { imagePresent: false, image: "studio" }; },
      async pull() { return { ok: true }; },
    },
  };

  renderAppFrame(outlet, {
    host,
    dialogs: { notify() {}, confirm() { return Promise.resolve(false); } },
  });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  const runningPower = () => outlet.querySelector('.server-power[title="Stops the Game Server"]');
  const stoppedPower = () => outlet.querySelector('.server-power[title="Starts the Game Server"]');
  assert.equal(statusListeners.size, 1);
  assert.equal(statusReads, 1);
  assert.ok(runningPower());
  assert.equal(runningPower().className.includes("is-running"), true);
  assert.equal(stoppedPower(), null);
  assert.equal(outlet.querySelector(".game-start-overlay"), null);
  const upFrame = outlet.querySelector("#game_frame");
  assert.ok(upFrame);
  assert.equal(upFrame.src, "http://localhost:8080");
  assert.equal(Boolean(upFrame.hidden), false);

  for (const listener of statusListeners) {
    listener({ running: false });
  }
  await Promise.resolve();
  assert.ok(stoppedPower());
  assert.equal(stoppedPower().className.includes("is-running"), false);
  assert.equal(runningPower(), null);
  assert.ok(outlet.querySelector(".game-start-overlay"));
  assert.ok(outlet.querySelector(".game-start-control"));
  const downFrame = outlet.querySelector("#game_frame");
  assert.ok(downFrame);
  assert.equal(downFrame.src, undefined);
  assert.equal(downFrame.hidden, true);

  for (const listener of statusListeners) {
    listener({ running: true });
  }
  await Promise.resolve();
  assert.ok(runningPower());
  assert.equal(runningPower().className.includes("is-running"), true);
  assert.equal(stoppedPower(), null);
  assert.equal(outlet.querySelector(".game-start-overlay"), null);
  assert.equal(outlet.querySelector("#game_frame").src, "http://localhost:8080");
  installed.restore();
});

async function flushSettings() {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

test("settings API debug preference persists and arms only the api source", async () => {
  const installed = installDocument();
  const outlet = installed.document.createElement("div");
  const sets = [];
  const arms = [];
  const disarms = [];
  let saved = {
    project_path: "/tmp/bot",
    telemetryEnabled: false,
    debug_mode: false,
    debugMode: false,
    game_frontend_url: "http://localhost:8080",
    editor_url: "http://localhost:8082",
    workspace_editor_open: false,
    workspaceEditorOpen: false,
  };
  const host = {
    config: {
      async get() {
        return { ...saved };
      },
      async set(patch) {
        sets.push(patch);
        saved = {
          ...saved,
          ...patch,
          debugMode: patch.debug_mode === true,
        };
        return { ...saved };
      },
      async matchGet() {
        return { team_side: "home", game_speed: "normal", opponent_team: "default" };
      },
      async matchSet() {
        throw new Error("API debug must not write match settings");
      },
    },
    logs: {
      async arm(source) {
        arms.push(source);
        return { ok: true };
      },
      async disarm(source) {
        disarms.push(source);
        return { ok: true };
      },
    },
    server: {
      async status() {
        return { ok: true, running: false };
      },
    },
  };
  renderAppFrame(outlet, {
    host,
    dialogs: { notify() {}, confirm() { return Promise.resolve(false); } },
  });
  await flushSettings();
  assert.deepEqual(arms, []);
  assert.deepEqual(disarms, []);

  outlet.querySelector('[data-area="settings"]').click();
  const box = outlet.querySelector('input[aria-label="Studio API debug logging"]');
  assert.ok(box);
  assert.equal(box.checked, false);

  box.checked = true;
  await box.listeners.change[0]();
  await flushSettings();
  assert.deepEqual(sets, [{ debug_mode: true }]);
  assert.deepEqual(arms, ["api"]);
  assert.deepEqual(disarms, []);

  box.checked = false;
  await box.listeners.change[0]();
  await flushSettings();
  assert.deepEqual(sets[1], { debug_mode: false });
  assert.deepEqual(disarms, ["api"]);
  assert.equal(arms.some((source) => source !== "api"), false);
  installed.restore();
});

test("a saved API debug preference arms only the api source on load", async () => {
  const installed = installDocument();
  const outlet = installed.document.createElement("div");
  const arms = [];
  const host = {
    config: {
      async get() {
        return {
          project_path: "/tmp/bot",
          telemetryEnabled: false,
          debug_mode: true,
          debugMode: true,
          workspace_editor_open: false,
          workspaceEditorOpen: false,
        };
      },
    },
    logs: {
      async arm(source) {
        arms.push(source);
        return { ok: true };
      },
      async disarm() {
        throw new Error("load must not disarm other sources");
      },
    },
  };
  renderAppFrame(outlet, {
    host,
    dialogs: { notify() {}, confirm() { return Promise.resolve(false); } },
  });
  await flushSettings();
  assert.deepEqual(arms, ["api"]);
  installed.restore();
});
