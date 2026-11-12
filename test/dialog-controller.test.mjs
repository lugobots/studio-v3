import test from "node:test";
import assert from "node:assert/strict";
import { createDialogController, NOTICE_TTL_MS } from "../src/renderer/lib/dialog-controller.js";
import { mountDialogs } from "../src/renderer/lib/dialogs.js";
import { installDocument } from "./dom-stub.mjs";

test("notices auto-dismiss after the TTL and cancel on manual dismiss", () => {
  const timers = new Map();
  let nextTimer = 1;
  const controller = createDialogController({
    now: () => 1000,
    setTimeout(fn, ms) {
      const id = nextTimer;
      nextTimer += 1;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  });

  const id = controller.notify({ title: "Match started", body: "The match is running." });
  assert.equal(controller.snapshot().notices.length, 1);
  assert.equal(controller.snapshot().notices[0].ttlMs, NOTICE_TTL_MS);
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].ms, NOTICE_TTL_MS);

  controller.dismiss(id);
  assert.equal(controller.snapshot().notices.length, 0);
  assert.equal(timers.size, 0);

  const autoId = controller.notify({ title: "Match reset" });
  const timer = [...timers.values()][0];
  timer.fn();
  assert.equal(controller.snapshot().notices.find((notice) => notice.id === autoId), undefined);
  assert.equal(controller.snapshot().notices.length, 0);
});

test("mounted notices use distinct class and a countdown progress bar", () => {
  const installed = installDocument();
  const body = installed.document.createElement("div");
  body.querySelector = (selector) => body.querySelectorAll(selector)[0] || null;
  body.querySelectorAll = (selector) => {
    const out = [];
    const walk = (node) => {
      for (const child of node.children || []) {
        if (child.nodeType !== 1) {
          continue;
        }
        if (selector.startsWith(".") && String(child.className || "").split(/\s+/).includes(selector.slice(1))) {
          out.push(child);
        }
        walk(child);
      }
    };
    walk(body);
    return out;
  };
  installed.document.body = body;
  installed.document.querySelector = () => null;

  const controller = createDialogController({
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
  });
  mountDialogs(installed.document, controller);
  controller.notify({ title: "Match started", body: "Running." });

  const notice = body.querySelector(".notice");
  assert.ok(notice);
  assert.equal(notice.className, "notice");
  assert.ok(notice.querySelector(".notice-progress"));
  assert.equal(body.querySelector(".dialog-card"), null);

  installed.restore();
});

test("prompt resolves with entered text or null on cancel", async () => {
  const controller = createDialogController({
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
  });

  const pending = controller.prompt({
    title: "Save positions",
    body: "Pick a name",
    confirmLabel: "Save",
  });
  assert.equal(controller.snapshot().blocking.kind, "prompt");
  assert.equal(controller.snapshot().blocking.confirmLabel, "Save");
  controller.snapshot().blocking.value = "  corner kick  ";
  controller.answer(true);
  assert.equal(await pending, "  corner kick  ");
  assert.equal(controller.snapshot().blocking, null);

  const cancelled = controller.prompt({ title: "Save positions" });
  controller.answer(false);
  assert.equal(await cancelled, null);
});

test("busy dialog blocks with a real progress bar and no action buttons", () => {
  const installed = installDocument();
  const body = installed.document.createElement("div");
  body.querySelector = (selector) => body.querySelectorAll(selector)[0] || null;
  body.querySelectorAll = (selector) => {
    const out = [];
    const walk = (node) => {
      for (const child of node.children || []) {
        if (child.nodeType !== 1) {
          continue;
        }
        if (selector.startsWith(".") && String(child.className || "").split(/\s+/).includes(selector.slice(1))) {
          out.push(child);
        }
        walk(child);
      }
    };
    walk(body);
    return out;
  };
  installed.document.body = body;
  installed.document.querySelector = () => null;

  const controller = createDialogController({
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
  });
  mountDialogs(installed.document, controller);
  controller.busy({
    title: "Downloading update",
    body: "Please wait",
    percent: 12,
  });

  const card = body.querySelector(".dialog-card");
  assert.ok(card);
  assert.match(String(card.className), /dialog-card-busy/);
  const progress = body.querySelector(".dialog-progress");
  assert.ok(progress);
  assert.equal(progress.getAttribute("role"), "progressbar");
  assert.equal(progress.getAttribute("aria-valuenow"), "12");
  assert.equal(body.querySelector(".dialog-actions"), null);
  assert.equal(body.querySelector(".notice-progress"), null);

  controller.setBusyProgress({ percent: 64, title: "Verifying update", body: "Checking SHA-256…" });
  assert.equal(body.querySelector(".dialog-progress").getAttribute("aria-valuenow"), "64");
  assert.equal(controller.snapshot().blocking.title, "Verifying update");
  assert.equal(controller.snapshot().blocking.body, "Checking SHA-256…");
  assert.equal(controller.snapshot().blocking.percent, 64);

  controller.clearBusy();
  assert.equal(body.querySelector(".dialog-card"), null);

  installed.restore();
});
