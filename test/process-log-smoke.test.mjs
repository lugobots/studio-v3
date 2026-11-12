import test from "node:test";
import assert from "node:assert/strict";
import { renderAppFrame } from "../src/renderer/shell/frame.js";
import { installDocument } from "./dom-stub.mjs";

async function flush() {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

function createSession(initial = {}) {
  const arms = [];
  const disarms = [];
  const sets = [];
  let saved = {
    project_path: "/tmp/bot",
    telemetryEnabled: false,
    debug_mode: false,
    debugMode: false,
    game_frontend_url: "http://localhost:8080",
    editor_url: "http://localhost:8082",
    ...initial,
  };
  let onLines = null;
  let subscriptions = 0;
  const host = {
    config: {
      async get() {
        return { ...saved };
      },
      async set(patch) {
        sets.push({ ...patch });
        saved = {
          ...saved,
          ...patch,
          debugMode: Object.prototype.hasOwnProperty.call(patch, "debug_mode")
            ? patch.debug_mode === true
            : saved.debugMode,
        };
        return { ...saved };
      },
      async matchGet() {
        return {
          team_side: "home",
          skip_to_golden_goal: false,
          game_speed: "normal",
          opponent_team: "default",
          saved_positions: [],
        };
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
      subscribe(callback) {
        subscriptions += 1;
        onLines = callback;
        return () => {
          if (onLines === callback) {
            onLines = null;
          }
        };
      },
    },
    server: {
      async start() {
        return { ok: true };
      },
      async status() {
        return { ok: true, running: false };
      },
    },
  };
  return {
    host,
    arms,
    disarms,
    sets,
    saved: () => ({ ...saved }),
    push(lines) {
      onLines?.({ lines });
    },
    subscriptions: () => subscriptions,
    streaming: () => onLines !== null,
  };
}

function buttonByText(root, text) {
  return root.querySelectorAll("button").find((button) => (
    button.textContent === text || button.getAttribute("aria-label") === text
  ));
}

test("process log smoke: defaults stay quiet, arming shows tagged lines, and reload keeps only API debug", async () => {
  const installed = installDocument();
  const outlet = installed.document.createElement("div");
  const session = createSession();
  const dialogs = { notify() {}, confirm() { return Promise.resolve(false); } };

  renderAppFrame(outlet, { host: session.host, dialogs });
  await flush();

  const serverLogs = () => outlet.querySelector('button[title="Server logs"]');
  const verLogs = () => outlet.querySelector('button[title="Ver logs"]');
  assert.equal(serverLogs().getAttribute("aria-pressed"), "false");
  assert.equal(verLogs().querySelector("svg")?.getAttribute("data-icon"), "logs");
  assert.deepEqual(session.arms, []);
  assert.equal(session.subscriptions(), 0);
  assert.equal(session.streaming(), false);
  assert.equal(buttonByText(outlet, "Show logs").textContent, "Show logs");

  serverLogs().click();
  await flush();
  assert.deepEqual(session.arms, ["server"]);
  assert.equal(session.streaming(), true);
  assert.equal(
    outlet.querySelectorAll(".process-log-filter-chip").find((node) => node.dataset.source === "server")
      ?.getAttribute("aria-pressed"),
    "true",
  );

  verLogs().click();
  await flush();
  assert.deepEqual(session.arms, ["server", "home/1"]);
  assert.equal(session.streaming(), true);
  assert.equal(buttonByText(outlet, "Hide logs") !== undefined, true);
  assert.equal(
    outlet.querySelectorAll(".process-log-filter-chip").find((node) => node.dataset.source === "home/1")
      ?.getAttribute("aria-pressed"),
    "true",
  );

  session.push([
    { source: "server", text: "server-line", ts: 1 },
    { source: "home/1", text: "bot-line", ts: 2 },
  ]);
  const tags = () => outlet.querySelectorAll(".process-log-line-source").map((node) => node.textContent);
  assert.deepEqual(tags(), ["Home 1"]);

  const all = outlet.querySelectorAll(".process-log-filter-chip").find((node) => node.dataset.source === "all");
  all.click();
  assert.deepEqual(tags(), ["Server", "Home 1"]);
  assert.equal(
    outlet.querySelectorAll(".process-log-line-text").map((node) => node.textContent).join(" "),
    "server-line bot-line",
  );

  const beforeClose = outlet.querySelectorAll(".process-log-line").length;
  buttonByText(outlet, "Hide logs").click();
  assert.equal(session.streaming(), false);
  session.push([{ source: "server", text: "after-close", ts: 3 }]);
  assert.equal(outlet.querySelectorAll(".process-log-line").length, beforeClose);
  assert.equal(
    outlet.querySelectorAll(".process-log-line-text").some((node) => node.textContent === "after-close"),
    false,
  );

  buttonByText(outlet, "Settings").click();
  const debug = outlet.querySelector('input[aria-label="Studio API debug logging"]');
  assert.equal(debug.checked, false);
  debug.checked = true;
  await debug.listeners.change[0]();
  await flush();
  assert.deepEqual(session.sets, [{ debug_mode: true }]);
  assert.deepEqual(session.arms, ["server", "home/1", "api"]);
  assert.equal(session.arms.filter((source) => source === "server").length, 1);
  assert.equal(session.arms.filter((source) => source.startsWith("home/") || source.startsWith("away/")).length, 1);

  installed.restore();

  const reloadedDoc = installDocument();
  const reloadedOutlet = reloadedDoc.document.createElement("div");
  const reloaded = createSession({ debug_mode: true, debugMode: true });
  renderAppFrame(reloadedOutlet, { host: reloaded.host, dialogs });
  await flush();
  assert.deepEqual(reloaded.arms, ["api"]);
  assert.equal(reloadedOutlet.querySelector('button[title="Server logs"]').getAttribute("aria-pressed"), "false");
  assert.equal(
    reloadedOutlet.querySelector('button[title="Ver logs"]').querySelector("svg")?.getAttribute("data-icon"),
    "logs",
  );
  assert.equal(reloaded.subscriptions(), 0);
  reloadedDoc.restore();
});

test("closing a log tab disarms the source and syncs Ver logs off while keeping the drawer open", async () => {
  const installed = installDocument();
  const outlet = installed.document.createElement("div");
  const session = createSession();
  const dialogs = { notify() {}, confirm() { return Promise.resolve(false); } };

  renderAppFrame(outlet, { host: session.host, dialogs });
  await flush();

  outlet.querySelector('button[title="Server logs"]').click();
  outlet.querySelector('button[title="Ver logs"]').click();
  await flush();
  assert.equal(outlet.querySelector('button[title="Ver logs"]').getAttribute("aria-pressed"), "true");
  assert.equal(outlet.querySelector('button[title="Server logs"]').getAttribute("aria-pressed"), "true");

  const homeChip = outlet
    .querySelectorAll(".process-log-filter-chip")
    .find((node) => node.dataset.source === "home/1");
  homeChip.querySelector(".process-log-filter-close").click();
  await flush();

  assert.ok(session.disarms.includes("home/1"));
  assert.equal(outlet.querySelector('button[title="Ver logs"]').getAttribute("aria-pressed"), "false");
  assert.equal(outlet.querySelector('button[title="Server logs"]').getAttribute("aria-pressed"), "true");
  assert.equal(buttonByText(outlet, "Hide logs") !== undefined, true);
  assert.equal(
    outlet.querySelectorAll(".process-log-filter-chip").some((node) => node.dataset.source === "home/1"),
    false,
  );
  assert.ok(
    outlet.querySelectorAll(".process-log-filter-chip").find((node) => node.dataset.source === "server"),
  );

  installed.restore();
});

test("workspace omits project path publish strip and keeps game iframe across log toggles", async () => {
  const installed = installDocument();
  const outlet = installed.document.createElement("div");
  const session = createSession();
  session.host.server.status = async () => ({ ok: true, running: true });
  const dialogs = { notify() {}, confirm() { return Promise.resolve(false); } };

  renderAppFrame(outlet, { host: session.host, dialogs });
  await flush();

  assert.equal(outlet.querySelector(".workspace-meta"), null);
  assert.equal(outlet.querySelector(".publish-form"), null);
  assert.equal(outlet.querySelector('[aria-label="Bot URI"]'), null);

  const frameBefore = outlet.querySelector("#game_frame");
  assert.ok(frameBefore);
  assert.equal(frameBefore.src, "http://localhost:8080");

  outlet.querySelector('button[title="Server logs"]').click();
  outlet.querySelector('button[title="Ver logs"]').click();
  await flush();

  const frameAfter = outlet.querySelector("#game_frame");
  assert.equal(frameAfter, frameBefore);
  assert.equal(frameAfter.src, "http://localhost:8080");
  assert.equal(outlet.querySelector(".process-log-waiting") !== null, true);

  outlet.querySelector('button[title="Server logs"]').click();
  await flush();
  assert.equal(outlet.querySelector("#game_frame"), frameBefore);
  assert.equal(outlet.querySelector("#game_frame").src, "http://localhost:8080");

  installed.restore();
});

test("bot active and log toggles keep game and editor iframes mounted", async () => {
  const installed = installDocument();
  const outlet = installed.document.createElement("div");
  const session = createSession();
  session.host.server.status = async () => ({ ok: true, running: true });
  session.host.server.onStatus = () => () => {};
  session.host.config.matchSet = async () => ({});
  session.host.bot = {
    async start() { return { ok: true }; },
    async stop() { return { ok: true }; },
  };
  session.host.docker = {
    async ensureEditor() { return { ok: true, url: "http://localhost:8082" }; },
    async stopEditor() { return { ok: true }; },
  };
  const dialogs = { notify() {}, confirm() { return Promise.resolve(true); } };

  renderAppFrame(outlet, { host: session.host, dialogs });
  await flush();

  outlet.querySelector('button[title="Open editor"]').click();
  await flush();

  const gameBefore = outlet.querySelector("#game_frame");
  const editorBefore = outlet.querySelector("#editor_frame");
  assert.ok(gameBefore);
  assert.ok(editorBefore);
  assert.equal(gameBefore.src, "http://localhost:8080");
  assert.equal(editorBefore.src, "http://localhost:8082");

  outlet.querySelector('button[title="Ver logs"]').click();
  await flush();
  assert.equal(outlet.querySelector("#game_frame"), gameBefore);
  assert.equal(outlet.querySelector("#editor_frame"), editorBefore);
  assert.equal(outlet.querySelector("#editor_frame").src, "http://localhost:8082");

  const activeSwitch = outlet.querySelector(".bot-active-switch");
  assert.ok(activeSwitch);
  activeSwitch.click();
  await flush();
  assert.equal(outlet.querySelector("#game_frame"), gameBefore);
  assert.equal(outlet.querySelector("#editor_frame"), editorBefore);
  assert.equal(outlet.querySelector("#game_frame").src, "http://localhost:8080");
  assert.equal(outlet.querySelector("#editor_frame").src, "http://localhost:8082");

  installed.restore();
});
