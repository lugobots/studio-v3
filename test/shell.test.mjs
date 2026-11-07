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

test("tabs change the menu and keep profile and settings", () => {
  const workspace = menuFor("workspace");
  const runtime = menuFor("runtime");
  assert.deepEqual(workspace.actions, []);
  assert.deepEqual(runtime.actions, ["image"]);
  assert.deepEqual(workspace.pinned, ["profile", "settings"]);
  assert.deepEqual(runtime.pinned, ["profile", "settings"]);
  assert.equal(menuFor("editor").tabId, "workspace");
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

test("the shell shows the game panel, pinned items, runtime, and publish", async () => {
  const installed = installDocument();
  const outlet = installed.document.createElement("div");
  let started = 0;
  let serverStarts = 0;
  let editorStarts = 0;
  let editorStops = 0;
  const host = {
    config: {
      async get() {
        return {
          project_path: "/tmp/bot",
          telemetryEnabled: false,
          game_frontend_url: "http://localhost:8080",
          editor_url: "http://localhost:8082",
        };
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
  assert.equal(labels().includes("Profile"), true);
  assert.equal(labels().includes("Settings"), true);
  assert.equal(labels().includes("Editor"), false);
  assert.equal(labels().includes("Open editor"), true);
  assert.equal(labels().includes("Open bot"), false);
  assert.equal(labels().includes("Start match"), false);
  assert.equal(labels().includes("Publish bot"), false);
  assert.equal(outlet.querySelector(".workspace-meta"), null);
  assert.equal(outlet.querySelector(".publish-form"), null);
  assert.equal(outlet.querySelector('[aria-label="Bot URI"]'), null);
  assert.equal(outlet.querySelector(".game-ctrl") !== null, true);
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

  outlet.querySelectorAll("button").find((button) => button.textContent === "Open editor").click();
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

  outlet.querySelectorAll("button").find((button) => button.textContent === "Close editor").click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(editorStops, 1);
  assert.equal(outlet.querySelector(".workspace-main--editor-open"), null);
  assert.equal(outlet.querySelector(".editor-panel"), null);
  assert.equal(outlet.querySelector("#editor_frame")?.src, undefined);
  assert.equal(outlet.querySelector("#game_frame").src, "http://localhost:8080");

  outlet.querySelectorAll("button").find((button) => button.textContent === "Runtime").click();
  assert.equal(labels().includes("Studio image"), true);
  assert.equal(labels().includes("Profile"), true);
  assert.equal(labels().includes("Settings"), true);
  assert.equal(started, 0);
  assert.equal(serverStarts, 1);
  installed.restore();
});

test("lateral menu shows build version under Settings on every tab", async () => {
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

  const pinned = outlet.querySelector(".side-menu-pinned");
  assert.ok(pinned);
  const settings = pinned.querySelectorAll("button").find((button) => button.textContent === "Settings");
  const version = pinned.querySelector(".side-menu-version");
  assert.ok(settings);
  assert.ok(version);
  assert.equal(version.textContent, "v1.0.1");
  assert.equal(version.title, "Studio build version");
  assert.equal(version.dataset.studioVersion || version.getAttribute("data-studio-version"), "v1.0.1");
  const pinnedKids = pinned.children;
  const settingsIndex = [...pinnedKids].indexOf(settings);
  const versionIndex = [...pinnedKids].indexOf(version);
  assert.equal(versionIndex, settingsIndex + 1);

  outlet.querySelectorAll("button").find((button) => button.textContent === "Runtime").click();
  const versionAfter = outlet.querySelector(".side-menu-version");
  assert.ok(versionAfter);
  assert.equal(versionAfter.textContent, "v1.0.1");
  const settingsAfter = outlet.querySelector(".side-menu-pinned")
    .querySelectorAll("button")
    .find((button) => button.textContent === "Settings");
  assert.ok(settingsAfter);
  installed.restore();
});

test("lateral menu defaults build version to dev when config omits it", async () => {
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

  const version = outlet.querySelector(".side-menu-version");
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
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

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

  outlet.querySelectorAll("button").find((button) => button.textContent === "Settings").click();
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
