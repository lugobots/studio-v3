"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const studioApi = require("../src/main/services/studio-api");

function respond(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("studio api client posts server and match start routes", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET" });
    return respond(200, { status: "OK" });
  };

  await studioApi.startServer(fetchImpl);
  await studioApi.startMatch(fetchImpl);

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/api\/server\/start$/);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[1].url, /\/api\/game\/start$/);
  assert.equal(calls[1].method, "POST");
});
