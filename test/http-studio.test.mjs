import assert from "node:assert/strict";
import test from "node:test";
import { createHttpStudio } from "../src/renderer/lib/http-studio.js";

function respond(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("web adapter shows the api error and retry only polls", async () => {
  const calls = [];
  const studio = createHttpStudio({
    fetchImpl: async (url) => {
      calls.push(url);
      return respond(500, { message: "down" });
    },
    storage: null,
  });
  const first = await studio.startup.next();
  assert.equal(first.route, "/api-error");
  assert.match(first.message, /down|Studio API/);
  const again = await studio.startup.retry();
  assert.equal(again.route, "/api-error");
  assert.equal(calls.length, 2);
});

test("web adapter opens the welcome screen when no bot is configured", async () => {
  const studio = createHttpStudio({
    fetchImpl: async (url) => {
      if (url.endsWith("/health")) {
        return respond(200, { status: "OK" });
      }
      return respond(200, { project_status: "missing", project_path: "" });
    },
    storage: null,
  });
  const next = await studio.startup.next();
  assert.equal(next.route, "/start-project");
});

test("web adapter opens the shell when health and status succeed", async () => {
  const studio = createHttpStudio({
    fetchImpl: async (url) => {
      if (url.endsWith("/health")) {
        return respond(200, { status: "OK" });
      }
      return respond(200, { project_status: "ready" });
    },
    storage: null,
  });
  const next = await studio.startup.next();
  assert.equal(next.route, "/main");
});

test("web adapter treats stub match and publish calls as failures", async () => {
  const studio = createHttpStudio({
    fetchImpl: async () => respond(200, { implemented: false, message: "not implemented" }),
    storage: null,
  });
  const match = await studio.match.start();
  const published = await studio.publish.bot({ botUri: "demo", tag: "v1" });
  assert.equal(match.ok, false);
  assert.equal(published.ok, false);
  assert.match(match.error, /not available/);
});
