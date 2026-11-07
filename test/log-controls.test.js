const test = require("node:test");
const assert = require("node:assert/strict");
const { createLogControls } = require("../src/main/services/session/log-controls");

test("opening a log subscription receives lines and closing it ends the stream", async () => {
  let onLines = null;
  let closed = false;
  const api = {
    async armLogSource(source) {
      return { status: "OK", source, armed: true };
    },
    subscribeProcessLogs(callback) {
      onLines = callback;
      return () => {
        closed = true;
        onLines = null;
      };
    },
  };
  const received = [];
  const controls = createLogControls({
    ensureReady: async () => ({ ok: true }),
    api,
    sendLines: (payload) => {
      received.push(payload);
    },
  });

  const armed = await controls.arm("home/3");
  assert.equal(armed.ok, true);

  const watched = controls.watch();
  assert.equal(watched.ok, true);
  assert.equal(typeof onLines, "function");

  onLines({ lines: [{ source: "home/3", text: "snapshot", ts: 1 }] });
  onLines({ lines: [{ source: "home/3", text: "live", ts: 2 }] });
  assert.deepEqual(
    received.map((payload) => payload.lines[0].text),
    ["snapshot", "live"],
  );

  const stopped = controls.unwatch();
  assert.equal(stopped.ok, true);
  assert.equal(closed, true);
  assert.equal(onLines, null);
  assert.equal(received.length, 2);
});
