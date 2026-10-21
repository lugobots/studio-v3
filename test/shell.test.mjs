import test from "node:test";
import assert from "node:assert/strict";
import { createDialogController } from "../src/renderer/lib/dialog-controller.js";
import { menuFor } from "../src/renderer/shell/model.js";
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
  assert.deepEqual(workspace.actions, ["open", "match", "publish"]);
  assert.deepEqual(runtime.actions, ["image"]);
  assert.deepEqual(workspace.pinned, ["profile", "settings"]);
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

test("web adapter reaches match and publish and refuses local upgrade", async () => {
  const server = http.createServer((req, res) => {
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
  const started = await studio.match.start();
  assert.equal(started.ok, true);
  const published = await studio.publish.bot({ botUri: "repo/bot", tag: "latest" });
  assert.equal(published.ok, true);
  const upgrade = await studio.updates.apply();
  assert.equal(upgrade.unsupported, true);
  const docker = await studio.docker.status();
  assert.equal(docker.unsupported, true);
  server.close();
});
