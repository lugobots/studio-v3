import test from "node:test";
import assert from "node:assert/strict";
import {
  createProcessLogDrawer,
  WAITING_FOR_LOGS,
  PERF_ALERT_TEXT,
} from "../src/renderer/shell/process-log-drawer.js";
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

function chip(root, source) {
  return root.querySelectorAll(".process-log-filter-chip").find((node) => node.dataset.source === source);
}

function fireScroll(body, scrollTop) {
  body.scrollTop = scrollTop;
  for (const fn of body.listeners.scroll || []) {
    fn({});
  }
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
  drawer.noteArmed("home/1");
  drawer.noteArmed("away/2");
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
  const homeChip = chip(root, "home/1");
  assert.ok(homeChip);
  assert.equal(homeChip.getAttribute("aria-pressed"), "true");
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

test("open empty drawer shows waiting feedback until lines arrive and after clear", () => {
  const installed = installDocument();
  const fake = createHost();
  const drawer = createProcessLogDrawer({ host: fake.host });
  const parent = installed.document.createElement("div");
  drawer.mount(parent);

  drawer.openDrawer("home/3");
  const root = parent.querySelector(".process-log-drawer");
  assert.ok(root);
  const waiting = () => root.querySelector(".process-log-waiting");
  assert.ok(waiting());
  assert.equal(waiting().textContent, WAITING_FOR_LOGS);
  assert.equal(root.querySelectorAll(".process-log-line").length, 0);

  fake.push([{ source: "home/3", text: "first", ts: 1 }]);
  assert.equal(waiting(), null);
  assert.equal(root.querySelectorAll(".process-log-line").length, 1);
  assert.equal(root.querySelector(".process-log-line-text").textContent, "first");

  drawer.clear();
  assert.ok(waiting());
  assert.equal(waiting().textContent, WAITING_FOR_LOGS);
  assert.equal(root.querySelectorAll(".process-log-line").length, 0);

  installed.restore();
});

test("armed silent source is selectable and shows waiting empty state", () => {
  const installed = installDocument();
  const fake = createHost();
  const drawer = createProcessLogDrawer({ host: fake.host });
  const parent = installed.document.createElement("div");
  drawer.mount(parent);

  drawer.openDrawer("home/1");
  drawer.noteArmed("server");
  const root = parent.querySelector(".process-log-drawer");
  const serverChip = chip(root, "server");
  assert.ok(serverChip);
  serverChip.click();
  assert.equal(drawer.snapshot().filter, "server");
  assert.ok(root.querySelector(".process-log-waiting"));
  assert.equal(root.querySelector(".process-log-waiting").textContent, WAITING_FOR_LOGS);

  installed.restore();
});

test("can switch from focused bot filter to All while lines keep arriving", () => {
  const installed = installDocument();
  const fake = createHost();
  const drawer = createProcessLogDrawer({ host: fake.host });
  const parent = installed.document.createElement("div");
  drawer.mount(parent);

  drawer.openDrawer("home/1");
  drawer.noteArmed("server");
  const root = parent.querySelector(".process-log-drawer");
  const allChip = chip(root, "all");
  const homeChip = chip(root, "home/1");

  fake.push([{ source: "home/1", text: "a", ts: 1 }]);
  allChip.click();
  assert.equal(drawer.snapshot().filter, "all");
  fake.push([{ source: "server", text: "b", ts: 2 }]);
  assert.equal(drawer.snapshot().filter, "all");
  assert.equal(chip(root, "all").getAttribute("aria-pressed"), "true");
  assert.equal(homeChip.getAttribute("aria-pressed"), "false");
  assert.equal(root.querySelectorAll(".process-log-line").length, 2);

  installed.restore();
});

test("follow-tail scrolls on append, pauses when scrolled up, and resumes at bottom", () => {
  const installed = installDocument();
  const fake = createHost();
  const drawer = createProcessLogDrawer({ host: fake.host });
  const parent = installed.document.createElement("div");
  drawer.mount(parent);
  drawer.openDrawer();
  drawer.noteArmed("server");
  drawer.setFilter("server");

  const root = parent.querySelector(".process-log-drawer");
  const body = root.querySelector(".process-log-drawer-body");
  body.clientHeight = 40;

  const batch = Array.from({ length: 12 }, (_, index) => ({
    source: "server",
    text: `line-${index + 1}`,
    ts: index + 1,
  }));
  fake.push(batch);
  assert.equal(drawer.snapshot().followTail, true);
  assert.equal(body.scrollTop, body.scrollHeight);
  assert.ok(body.scrollHeight > body.clientHeight + 40);

  fireScroll(body, 0);
  assert.equal(drawer.snapshot().followTail, false);

  const pausedTop = body.scrollTop;
  fake.push([{ source: "server", text: "tail", ts: 100 }]);
  assert.equal(drawer.snapshot().followTail, false);
  assert.equal(body.scrollTop, pausedTop);

  fireScroll(body, body.scrollHeight);
  assert.equal(drawer.snapshot().followTail, true);
  fake.push([{ source: "server", text: "more", ts: 101 }]);
  assert.equal(body.scrollTop, body.scrollHeight);

  installed.restore();
});

test("closing a source tab disarms, drops the tab, and leaves the drawer open", async () => {
  const installed = installDocument();
  const fake = createHost();
  const closed = [];
  const drawer = createProcessLogDrawer({
    host: fake.host,
    onSourceDisarmed(source) {
      closed.push(source);
    },
  });
  const parent = installed.document.createElement("div");
  drawer.mount(parent);

  drawer.noteArmed("home/1");
  drawer.noteArmed("server");
  drawer.openDrawer("home/1");
  const root = parent.querySelector(".process-log-drawer");
  assert.ok(chip(root, "home/1"));
  assert.ok(chip(root, "server"));

  const closeBtn = chip(root, "home/1").querySelector(".process-log-filter-close");
  assert.ok(closeBtn);
  closeBtn.click();
  await Promise.resolve();

  assert.deepEqual(fake.disarms, ["home/1"]);
  assert.deepEqual(closed, ["home/1"]);
  assert.equal(drawer.snapshot().open, true);
  assert.equal(drawer.snapshot().filter, "all");
  assert.equal(chip(root, "home/1"), undefined);
  assert.ok(chip(root, "server"));
  assert.ok(chip(root, "all"));

  installed.restore();
});

test("performance alert shows above two armed sources only while drawer is open", () => {
  const installed = installDocument();
  const fake = createHost();
  const drawer = createProcessLogDrawer({ host: fake.host });
  const parent = installed.document.createElement("div");
  drawer.mount(parent);
  const root = parent.querySelector(".process-log-drawer");
  const alert = () => root.querySelector(".process-log-perf-alert");

  drawer.noteArmed("api");
  drawer.noteArmed("server");
  drawer.noteArmed("home/1");
  assert.equal(alert().hidden, true);

  drawer.openDrawer();
  assert.equal(alert().hidden, false);
  assert.equal(alert().textContent, PERF_ALERT_TEXT);

  drawer.noteDisarmed("home/1");
  assert.equal(alert().hidden, true);

  drawer.noteArmed("home/1");
  assert.equal(alert().hidden, false);
  drawer.closeDrawer();
  assert.equal(alert().hidden, true);

  installed.restore();
});
