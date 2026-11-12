"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { waitEditorReady } = require("../src/main/services/docker/editor-ready");

test("waitEditorReady succeeds when the editor URL answers", async () => {
  let calls = 0;
  const result = await waitEditorReady({
    url: "http://localhost:8082",
    deadlineMs: 1000,
    intervalMs: 10,
    fetchImpl: async () => {
      calls += 1;
      return { status: 302 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.url, "http://localhost:8082");
  assert.equal(calls, 1);
});

test("waitEditorReady polls a remapped editor host port URL", async () => {
  const urls = [];
  const result = await waitEditorReady({
    url: "http://localhost:18082",
    deadlineMs: 1000,
    intervalMs: 10,
    fetchImpl: async (url) => {
      urls.push(url);
      return { status: 200 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.url, "http://localhost:18082");
  assert.deepEqual(urls, ["http://localhost:18082"]);
});

test("waitEditorReady fails after the deadline when fetch keeps erroring", async () => {
  const result = await waitEditorReady({
    url: "http://localhost:8082",
    deadlineMs: 40,
    intervalMs: 10,
    fetchImpl: async () => {
      throw new Error("connection refused");
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /connection refused|did not become reachable/i);
});
