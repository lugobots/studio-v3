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
