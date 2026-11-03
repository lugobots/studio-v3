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
  const editor = menuFor("editor");
  const runtime = menuFor("runtime");
  assert.deepEqual(workspace.actions, []);
  assert.deepEqual(editor.actions, []);
  assert.deepEqual(runtime.actions, ["image"]);
  assert.deepEqual(workspace.pinned, ["profile", "settings"]);
  assert.deepEqual(editor.pinned, ["profile", "settings"]);
  assert.deepEqual(runtime.pinned, ["profile", "settings"]);
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
        throw new Error("Editor UI must not start the editor container");
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
  assert.equal(labels().includes("Editor"), true);
  assert.equal(labels().includes("Open bot"), false);
  assert.equal(labels().includes("Start match"), false);
  assert.equal(labels().includes("Publish bot"), false);
  assert.ok(outlet.querySelector('[aria-label="Bot URI"]'));
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

  panelStart.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(serverStarts, 1);
  assert.equal(outlet.querySelector(".game-start-overlay"), null);
  const runningFrame = outlet.querySelector("#game_frame");
  assert.ok(runningFrame);
  assert.equal(runningFrame.src, "http://localhost:8080");
  assert.equal(runningFrame.hidden, undefined);

  outlet.querySelectorAll("button").find((button) => button.textContent === "Editor").click();
  const editorPane = outlet.querySelector(".editor-main");
  assert.ok(editorPane);
  assert.equal(editorPane.dataset.editorUrl, "http://localhost:8082");
  const placeholder = outlet.querySelector(".editor-placeholder");
  assert.ok(placeholder);
  assert.equal(placeholder.textContent, "editor not started");
  const editorFrame = outlet.querySelector("#editor_frame");
  assert.ok(editorFrame);
  assert.equal(editorFrame.tagName, "IFRAME");
  assert.equal(editorFrame.src, undefined);
  assert.equal(editorFrame.getAttribute("src"), null);
  assert.equal(editorFrame.dataset.src, "http://localhost:8082");
  assert.equal(editorFrame.hidden, true);

  outlet.querySelectorAll("button").find((button) => button.textContent === "Runtime").click();
  assert.equal(labels().includes("Studio image"), true);
  assert.equal(labels().includes("Profile"), true);
  assert.equal(labels().includes("Settings"), true);
  assert.equal(started, 0);
  assert.equal(serverStarts, 1);
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
  assert.equal(upFrame.hidden, undefined);

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
