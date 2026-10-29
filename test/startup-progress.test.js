const test = require("node:test");
const assert = require("node:assert/strict");
const { describeStartup } = require("../src/shared/startup-progress");

test("startup progress names each phase and marks the current step", () => {
  const checking = describeStartup();
  assert.equal(checking.phase, "docker");
  assert.equal(checking.label, "Checking Docker");
  assert.equal(checking.percent, 12);
  assert.equal(checking.steps[0].state, "current");
  assert.equal(checking.steps[1].state, "pending");

  const starting = describeStartup({
    phase: "container",
    detail: "Starting the container.",
  });
  assert.equal(starting.label, "Starting the Studio API");
  assert.equal(starting.percent, 64);
  assert.deepEqual(
    starting.steps.map((step) => step.state),
    ["done", "done", "current", "pending"],
  );
});

test("image download lines become a percent and a readable amount", () => {
  const progress = describeStartup({
    phase: "image",
    detail: "abc: Downloading [=>] 12.5MB/50MB",
  });
  assert.equal(progress.percent, 30);
  assert.equal(progress.detail, "12.5 MB of 50 MB");
  assert.equal(progress.steps[1].state, "current");

  const ready = describeStartup({ phase: "image", detail: "Studio image is ready" });
  assert.equal(ready.percent, 60);
  assert.equal(ready.detail, "Studio image is ready");

  const layer = describeStartup({
    phase: "image",
    detail: "abc: Pulling fs layer",
  });
  assert.equal(layer.percent, 24);
  assert.equal(layer.detail, "Downloading the Studio image.");
  assert.equal(
    describeStartup({ phase: "image", detail: "abc: Extracting 2 s" }).detail,
    "Extracting the Studio image.",
  );
});

test("creating a bot adds a setup step before the api wait", () => {
  const setup = describeStartup({
    flow: "create",
    phase: "setup",
    detail: "Downloading the Python bot template. This can take a minute.",
    elapsedMs: 0,
    deadlineMs: 120000,
  });
  assert.equal(setup.flow, "create");
  assert.equal(setup.label, "Setting up the bot");
  assert.equal(setup.percent, 74);
  assert.equal(
    describeStartup({
      flow: "create",
      phase: "container",
      elapsedMs: 0,
      deadlineMs: 180000,
    }).percent,
    64,
  );
  assert.equal(
    describeStartup({
      flow: "create",
      phase: "container",
      elapsedMs: 180000,
      deadlineMs: 180000,
    }).percent,
    72,
  );
  assert.deepEqual(
    setup.steps.map((step) => [step.label, step.state]),
    [
      ["Checking Docker", "done"],
      ["Preparing the Studio image", "done"],
      ["Starting the Studio API", "done"],
      ["Setting up the bot", "current"],
      ["Waiting for the Studio API", "pending"],
    ],
  );
  assert.equal(
    describeStartup({ flow: "create", phase: "setup", elapsedMs: 120000, deadlineMs: 120000 }).percent,
    81,
  );

  const waiting = describeStartup({
    flow: "create",
    phase: "health",
    detail: "Waiting for the API to respond.",
  });
  assert.equal(waiting.steps.find((step) => step.id === "setup").state, "done");
  assert.equal(waiting.steps.find((step) => step.id === "health").state, "current");
});

test("the health wait creeps forward until the api is ready", () => {
  assert.equal(describeStartup({ phase: "health", elapsedMs: 0 }).percent, 82);
  assert.equal(
    describeStartup({ phase: "health", elapsedMs: 180000, deadlineMs: 180000 }).percent,
    94,
  );
  const ready = describeStartup({ phase: "ready", detail: "Opening Studio." });
  assert.equal(ready.percent, 100);
  assert.equal(ready.label, "Studio API is ready");
  assert.ok(ready.steps.every((step) => step.state === "done"));
});
