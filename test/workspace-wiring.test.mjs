import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHttpStudio } from "../src/renderer/lib/http-studio.js";
import { renderAppFrame } from "../src/renderer/shell/frame.js";
import { installDocument } from "./dom-stub.mjs";

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function buttonByTitle(root, title) {
  return root.querySelectorAll("button").find((button) => button.getAttribute("title") === title);
}

async function waitFor(predicate, { timeoutMs = 2000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for condition");
}

test("workspace wiring hits API for server, match, and reset; locked settings and editor stay local", async () => {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (req.url === "/api/server/start" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "OK" }));
      return;
    }
    if (req.url === "/api/server/stop" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "OK" }));
      return;
    }
    if (req.url === "/api/game/start" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "OK" }));
      return;
    }
    if (req.url === "/api/game/reset" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "OK" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const studio = createHttpStudio({ baseUrl: `http://127.0.0.1:${port}/api` });
    let editorStarts = 0;
    studio.config = {
      async get() {
        return {
          project_path: "/tmp/bot",
          telemetryEnabled: false,
          game_frontend_url: "http://localhost:8080",
          editor_url: "http://localhost:8082",
        };
      },
    };
    // Keep this fixture on the start/match/stop HTTP paths; status hydration is covered in shell tests.
    studio.server = {
      ...studio.server,
      async status() {
        return { ok: true, body: { running: false } };
      },
      onStatus() {
        return () => {};
      },
    };
    let editorStops = 0;
    studio.docker = {
      ...studio.docker,
      async ensureEditor() {
        editorStarts += 1;
        return { ok: true, url: "http://localhost:8082" };
      },
      async stopEditor() {
        editorStops += 1;
        return { ok: true };
      },
    };

    const installed = installDocument();
    const outlet = installed.document.createElement("div");
    const notices = [];
    let confirmAnswer = false;
    renderAppFrame(outlet, {
      host: studio,
      dialogs: {
        notify(payload) {
          notices.push(payload);
        },
        confirm() {
          return Promise.resolve(confirmAnswer);
        },
      },
    });
    await flush();

    assert.ok(outlet.querySelector(".game-start-overlay"));
    assert.ok(outlet.querySelector(".game-start-control"));
    const gameFrame = outlet.querySelector("#game_frame");
    assert.ok(gameFrame);
    assert.equal(gameFrame.tagName, "IFRAME");
    assert.equal(gameFrame.src, undefined);
    assert.equal(gameFrame.hidden, true);
    assert.equal(outlet.querySelector(".game-ctrl") !== null, true);
    assert.equal(buttonByTitle(outlet, "Starts the match").disabled, true);
    assert.equal(buttonByTitle(outlet, "Zombies mode").disabled, false);

    outlet.querySelector(".game-start-control").click();
    await waitFor(() => buttonByTitle(outlet, "Stops the Game Server"));
    await flush();
    assert.deepEqual(hits, ["POST /api/server/start"]);
    assert.equal(outlet.querySelector(".game-start-overlay"), null);
    assert.equal(outlet.querySelector("#game_frame").src, "http://localhost:8080");
    assert.equal(buttonByTitle(outlet, "Starts the match").disabled, false);
    assert.equal(buttonByTitle(outlet, "Zombies mode").disabled, true);
    assert.equal(buttonByTitle(outlet, "Slow speed").disabled, true);
    assert.equal(outlet.querySelector("#team-side-switch").getAttribute("aria-disabled"), "true");

    buttonByTitle(outlet, "Starts the match").click();
    await waitFor(() => notices.some((item) => item.title === "Match started"));
    await flush();
    assert.deepEqual(hits, ["POST /api/server/start", "POST /api/game/start"]);

    const beforeLocal = hits.length;
    const awayActive = outlet.querySelectorAll(".bot_actions")[1].querySelector('button[title="Active"]');
    assert.equal(awayActive.disabled, false);
    // Web host has no bot IPC; Active stays local. Locked settings do not write.
    awayActive.click();
    buttonByTitle(outlet, "Zombies mode").click();
    buttonByTitle(outlet, "Slow speed").click();
    outlet.querySelector("#team-side-switch").click();
    await flush();
    assert.equal(buttonByTitle(outlet, "Zombies mode").getAttribute("aria-pressed"), "false");
    assert.equal(buttonByTitle(outlet, "Slow speed").getAttribute("aria-pressed"), "false");
    assert.equal(outlet.querySelector("#team-side-switch").getAttribute("aria-disabled"), "true");
    assert.equal(hits.length, beforeLocal);

    buttonByTitle(outlet, "Resets the match").click();
    await waitFor(() => notices.some((item) => item.title === "Match reset"));
    await flush();
    assert.ok(hits.includes("POST /api/game/reset"));

    // Save/Apply need match config helpers; without them they stay off the wire.
    const afterReset = hits.length;
    buttonByTitle(outlet, "Save positions").click();
    buttonByTitle(outlet, "Apply").click();
    await flush();
    assert.equal(hits.length, afterReset);

    buttonByTitle(outlet, "Stops the Game Server").click();
    await flush();
    assert.equal(hits.length, afterReset);

    confirmAnswer = true;
    buttonByTitle(outlet, "Stops the Game Server").click();
    await waitFor(() => buttonByTitle(outlet, "Starts the Game Server"));
    await flush();
    assert.deepEqual(hits, [
      "POST /api/server/start",
      "POST /api/game/start",
      "POST /api/game/reset",
      "POST /api/server/stop",
    ]);
    assert.ok(outlet.querySelector(".game-start-overlay"));
    assert.equal(outlet.querySelector("#game_frame").hidden, true);
    assert.equal(buttonByTitle(outlet, "Starts the match").disabled, true);
    assert.equal(buttonByTitle(outlet, "Zombies mode").disabled, false);

    assert.equal(outlet.querySelectorAll("button").some((button) => button.textContent === "Editor"), false);
    assert.equal(editorStarts, 0);
    assert.equal(outlet.querySelector("#editor_frame"), null);

    outlet.querySelectorAll("button").find((button) => button.textContent === "Open editor").click();
    await flush();
    assert.equal(editorStarts, 1);
    assert.ok(outlet.querySelector(".workspace-main--editor-open"));
    assert.ok(outlet.querySelector(".game-panel"));
    assert.ok(outlet.querySelector(".editor-panel"));
    const editorFrame = outlet.querySelector("#editor_frame");
    assert.ok(editorFrame);
    assert.equal(editorFrame.src, "http://localhost:8082");
    assert.equal(Boolean(editorFrame.hidden), false);

    outlet.querySelectorAll("button").find((button) => button.textContent === "Close editor").click();
    await flush();
    assert.equal(editorStops, 1);
    assert.equal(outlet.querySelector(".editor-panel"), null);
    assert.equal(outlet.querySelector("#editor_frame")?.src, undefined);

    installed.restore();
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
