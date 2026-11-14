import assert from "node:assert/strict";
import test from "node:test";
import { renderStartProject } from "../src/renderer/pages/start-project/index.js";

class El {
  constructor(tag) {
    this.tag = tag;
    this.className = "";
    this.textContent = "";
    this.value = "";
    this.children = [];
    this.listeners = [];
    this.attributes = {};
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  addEventListener(_type, fn) {
    this.listeners.push(fn);
  }
}

function walk(node, found = []) {
  found.push(node);
  for (const child of node.children || []) {
    walk(child, found);
  }
  return found;
}

test("declining the overwrite warning stays on start-project and does not submit again", async () => {
  const doc = { createElement: (tag) => new El(tag) };
  globalThis.document = doc;
  const creates = [];
  const warnings = [];
  const navigated = [];
  const outlet = new El("div");
  renderStartProject(outlet, doc, {
    navigate: (path) => navigated.push(path),
    dialogs: {
      confirm: async (request) => {
        warnings.push(request);
        return false;
      },
    },
    host: {
      project: {
        pickFolder: async () => ({ ok: true, folder: "/bots/messy" }),
        create: async (payload) => {
          creates.push(payload);
          return {
            ok: false,
            confirmOverwrite: true,
            error: "Existing files may be overwritten.",
          };
        },
      },
    },
  });

  const form = walk(outlet).find((node) => node.tag === "form");
  await form.listeners[0]({ preventDefault() {} });
  assert.equal(creates.length, 1);
  assert.equal(creates[0].overwrite, undefined);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].body, /overwritten/);
  assert.equal(warnings[0].title, "Overwrite existing files?");
  assert.deepEqual(navigated, []);
});

test("a new bot shows the loading screen as soon as setup starts", async () => {
  const doc = { createElement: (tag) => new El(tag) };
  globalThis.document = doc;
  const navigated = [];
  let notify = () => {};
  let release;
  const outlet = new El("div");
  renderStartProject(outlet, doc, {
    navigate: (path) => navigated.push(path),
    host: {
      startup: {
        onProgress: (callback) => {
          notify = callback;
          return () => {};
        },
      },
      project: {
        pickFolder: async () => ({ ok: true, folder: "/bots/new" }),
        create: () =>
          new Promise((resolve) => {
            notify({
              flow: "create",
              phase: "setup",
              label: "Setting up the bot",
              detail: "Downloading the Python bot template. This can take a minute.",
              percent: 74,
            });
            release = resolve;
          }),
      },
    },
  });

  const form = walk(outlet).find((node) => node.tag === "form");
  const pending = form.listeners[0]({ preventDefault() {} });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(navigated, ["/api-loading"]);
  release({ ok: true, route: "/api-loading" });
  await pending;
  assert.deepEqual(navigated, ["/api-loading"]);
});

test("from-shell Welcome shows Cancel that returns to main", async () => {
  const doc = { createElement: (tag) => new El(tag) };
  globalThis.document = doc;
  const navigated = [];
  const outlet = new El("div");
  renderStartProject(outlet, doc, {
    fromShell: true,
    navigate: (path) => navigated.push(path),
    host: {
      project: {
        pickFolder: async () => ({ ok: false, cancelled: true }),
      },
    },
  });

  const cancel = walk(outlet).find(
    (node) => node.tag === "button" && node.textContent === "Cancel",
  );
  assert.ok(cancel);
  cancel.listeners[0]();
  assert.deepEqual(navigated, ["/main"]);
});

test("first-run Welcome omits Cancel", () => {
  const doc = { createElement: (tag) => new El(tag) };
  globalThis.document = doc;
  const outlet = new El("div");
  renderStartProject(outlet, doc, {
    fromShell: false,
    host: {
      project: {
        pickFolder: async () => ({ ok: false, cancelled: true }),
      },
    },
  });

  const cancel = walk(outlet).find(
    (node) => node.tag === "button" && node.textContent === "Cancel",
  );
  assert.equal(cancel, undefined);
});

test("a failed setup returns to the bot screen and reports the error", async () => {
  const doc = { createElement: (tag) => new El(tag) };
  globalThis.document = doc;
  const navigated = [];
  const reports = [];
  let notify = () => {};
  const outlet = new El("div");
  renderStartProject(outlet, doc, {
    navigate: (path) => navigated.push(path),
    reportResult: async (_prompt, result) => {
      reports.push(result);
    },
    host: {
      startup: {
        onProgress: (callback) => {
          notify = callback;
          return () => {};
        },
      },
      project: {
        pickFolder: async () => ({ ok: true, folder: "/bots/new" }),
        create: async () => {
          notify({ flow: "create", phase: "setup", label: "Setting up the bot" });
          return { ok: false, error: "clone failed" };
        },
      },
    },
  });

  const form = walk(outlet).find((node) => node.tag === "form");
  await form.listeners[0]({ preventDefault() {} });
  assert.deepEqual(navigated, ["/api-loading", "/start-project"]);
  assert.equal(reports[0].error, "clone failed");
});
