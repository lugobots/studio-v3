const test = require("node:test");
const assert = require("node:assert/strict");
const { registerContainerCleanupOnQuit } = require("../src/main/services/app-lifecycle");

function mockApp() {
  const handlers = new Map();
  const app = {
    quitCalls: 0,
    on(event, handler) {
      handlers.set(event, handler);
    },
    emit(event, ...args) {
      return handlers.get(event)?.(...args);
    },
    quit() {
      this.quitCalls += 1;
    },
  };
  return app;
}

function waitForQuit(app) {
  return new Promise((resolve) => {
    const previous = app.quit.bind(app);
    app.quit = () => {
      previous();
      resolve();
    };
  });
}

test("before-quit stops Studio containers then quits", async () => {
  const app = mockApp();
  const calls = [];
  registerContainerCleanupOnQuit(app, async () => {
    calls.push("stop");
    return { ok: true };
  });

  const done = waitForQuit(app);
  const event = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
  app.emit("before-quit", event);
  assert.equal(event.prevented, true);
  await done;
  assert.deepEqual(calls, ["stop"]);
  assert.equal(app.quitCalls, 1);
});

test("before-quit still quits when stop fails", async () => {
  const app = mockApp();
  registerContainerCleanupOnQuit(app, async () => {
    throw new Error("docker unavailable");
  });

  const done = waitForQuit(app);
  app.emit("before-quit", { preventDefault() {} });
  await done;
  assert.equal(app.quitCalls, 1);
});

test("before-quit does not re-enter while cleanup is in progress", async () => {
  const app = mockApp();
  let stops = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  registerContainerCleanupOnQuit(app, async () => {
    stops += 1;
    await gate;
    return { ok: true };
  });

  const done = waitForQuit(app);
  const event = { preventDefault() {} };
  app.emit("before-quit", event);
  await new Promise((resolve) => setImmediate(resolve));
  app.emit("before-quit", event);
  assert.equal(stops, 1);
  release();
  await done;
  assert.equal(app.quitCalls, 1);
});
