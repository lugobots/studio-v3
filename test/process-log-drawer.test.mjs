import test from "node:test";
import assert from "node:assert/strict";
import { createProcessLogDrawer } from "../src/renderer/shell/process-log-drawer.js";
import { installDocument } from "./dom-stub.mjs";

function createHost() {
  let callback = null;
  const arms = [];
  const disarms = [];
  return {
    arms,
    disarms,
    push(lines) {
      callback?.({ lines });
    },
    host: {
      logs: {
        arm(source) {
          arms.push(source);
          return Promise.resolve({ ok: true });
        },
        disarm(source) {
          disarms.push(source);
          return Promise.resolve({ ok: true });
        },
        subscribe(cb) {
          callback = cb;
          return () => {
            callback = null;
          };
        },
      },
    },
    subscribed() {
      return callback !== null;
    },
  };
}

test("opening the drawer subscribes and closing unsubscribes", () => {
  const installed = installDocument();
  const fake = createHost();
  const drawer = createProcessLogDrawer({ host: fake.host });
  const parent = installed.document.createElement("div");
  drawer.mount(parent);

  assert.equal(fake.subscribed(), false);
  drawer.openDrawer("home/3");
  assert.equal(fake.subscribed(), true);
  assert.equal(drawer.snapshot().open, true);
  assert.equal(drawer.snapshot().filter, "home/3");

  fake.push([
    { source: "home/3", text: "one", ts: 1 },
    { source: "server", text: "two", ts: 2 },
  ]);
  assert.equal(drawer.snapshot().lines.length, 2);

  drawer.closeDrawer();
  assert.equal(fake.subscribed(), false);
  assert.equal(drawer.snapshot().open, false);

  installed.restore();
});

test("filter by source hides other lines in the drawer body", () => {
  const installed = installDocument();
  const fake = createHost();
  const drawer = createProcessLogDrawer({ host: fake.host });
  const parent = installed.document.createElement("div");
  drawer.mount(parent);
  drawer.openDrawer();
  fake.push([
    { source: "home/1", text: "home-line", ts: 1 },
    { source: "away/2", text: "away-line", ts: 2 },
  ]);
  drawer.setFilter("home/1");

  assert.equal(drawer.snapshot().filter, "home/1");
  const visible = drawer.snapshot().lines.filter((line) => line.source === "home/1");
  assert.equal(visible.length, 1);
  assert.equal(visible[0].text, "home-line");

  const root = parent.querySelector(".process-log-drawer");
  assert.ok(root);
  const chip = root.querySelectorAll(".process-log-filter-chip").find((node) => node.dataset.source === "home/1");
  assert.ok(chip);
  assert.equal(chip.getAttribute("aria-pressed"), "true");
  const rows = root.querySelectorAll(".process-log-line");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dataset.source, "home/1");

  installed.restore();
});

test("clear empties retained drawer lines", () => {
  const installed = installDocument();
  const fake = createHost();
  const drawer = createProcessLogDrawer({ host: fake.host });
  const parent = installed.document.createElement("div");
  drawer.mount(parent);
  drawer.openDrawer();
  fake.push([{ source: "api", text: "x", ts: 1 }]);
  assert.equal(drawer.snapshot().lines.length, 1);
  drawer.clear();
  assert.equal(drawer.snapshot().lines.length, 0);
  installed.restore();
});
