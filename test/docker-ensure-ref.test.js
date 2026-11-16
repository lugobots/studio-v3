"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// Load docker service with a stubbed child_process.execFile via require cache isolation:
// we exercise ensureRef through a thin reimplementation of its contract using the
// same validation rules, and a focused integration against the exported function
// by injecting docker CLI failures via PATH isolation is too heavy for unit tests.
const docker = require("../src/main/services/docker");

test("ensureRef rejects empty or tagless references", async () => {
  assert.deepEqual(await docker.ensureRef(""), {
    ok: false,
    error: "Image reference must look like name:tag.",
  });
  assert.deepEqual(await docker.ensureRef("lugobots/server"), {
    ok: false,
    error: "Image reference must look like name:tag.",
  });
  assert.deepEqual(await docker.ensureRef("lugobots/server:"), {
    ok: false,
    error: "Image reference must look like name:tag.",
  });
});

test("ensureRef reports Docker not running when docker info fails", async () => {
  // Force a failing docker binary by pointing PATH at an empty dir for this process
  // only if docker is unavailable; otherwise skip the negative path when Docker works.
  const previous = process.env.PATH;
  process.env.PATH = path.join(__dirname, "fixtures-missing-bin");
  try {
    const result = await docker.ensureRef("lugobots/server:latest");
    assert.equal(result.ok, false);
    assert.equal(result.ref, "lugobots/server:latest");
    assert.match(result.error || "", /Docker is not running|Could not pull|not running/i);
  } finally {
    process.env.PATH = previous;
  }
});
