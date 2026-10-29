import assert from "node:assert/strict";
import test from "node:test";
import { renderBots } from "../src/renderer/pages/bots/index.js";

class El {
  constructor(tag) {
    this.tag = tag;
    this.className = "";
    this.textContent = "";
    this.children = [];
    this.listeners = [];
    this.attributes = {};
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
    }
    this.children.push(...nodes);
  }

  remove() {
    if (!this.parent) {
      return;
    }
    this.parent.children = this.parent.children.filter((child) => child !== this);
  }

  addEventListener(_type, fn) {
    this.listeners.push(fn);
  }
}

function documentStub() {
  return { createElement: (tag) => new El(tag) };
}

function walk(node, found = []) {
  found.push(node);
  for (const child of node.children || []) {
    walk(child, found);
  }
  return found;
}

test("bots screen shows each folder name and path and adds through start-project", async () => {
  const doc = documentStub();
  globalThis.document = doc;
  const navigated = [];
  const outlet = new El("div");
  await renderBots(outlet, doc, {
    config: { bot_paths: ["/bots/alpha", "/tmp/beta bot"] },
    navigate: (path) => navigated.push(path),
    host: {
      project: {
        open: async () => ({ ok: true, route: "/api-loading" }),
      },
    },
  });

  const rows = walk(outlet).filter((node) => node.className.split(/\s+/).includes("bot-row"));
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.children.map((child) => child.textContent)),
    [
      ["alpha", "/bots/alpha"],
      ["beta bot", "/tmp/beta bot"],
    ],
  );

  const add = walk(outlet).find((node) => node.textContent === "Add a bot");
  add.listeners[0]();
  assert.deepEqual(navigated, ["/start-project"]);
});

test("removing a bot asks first and leaves the list when declined", async () => {
  const doc = documentStub();
  globalThis.document = doc;
  const removed = [];
  const outlet = new El("div");
  await renderBots(outlet, doc, {
    config: { bot_paths: ["/bots/alpha", "/tmp/beta bot"] },
    dialogs: {
      confirm: async () => false,
    },
    host: {
      project: {
        open: async () => ({ ok: true, route: "/api-loading" }),
        remove: async (folder) => {
          removed.push(folder);
          return { ok: true };
        },
      },
    },
  });

  const remove = walk(outlet).find((node) => node.attributes["aria-label"] === "Remove alpha");
  await remove.listeners[0]();
  assert.deepEqual(removed, []);
  assert.equal(walk(outlet).filter((node) => node.className.split(/\s+/).includes("bot-row")).length, 2);
});

test("removing a bot drops that row and keeps the folder path for the request", async () => {
  const doc = documentStub();
  globalThis.document = doc;
  const removed = [];
  const navigated = [];
  const warnings = [];
  const outlet = new El("div");
  await renderBots(outlet, doc, {
    config: { bot_paths: ["/bots/alpha", "/tmp/beta bot"] },
    navigate: (path) => navigated.push(path),
    dialogs: {
      confirm: async (request) => {
        warnings.push(request.body);
        return true;
      },
    },
    host: {
      project: {
        open: async () => ({ ok: true, route: "/api-loading" }),
        remove: async (folder) => {
          removed.push(folder);
          return { ok: true };
        },
      },
    },
  });

  const remove = walk(outlet).find((node) => node.attributes["aria-label"] === "Remove alpha");
  await remove.listeners[0]();
  assert.deepEqual(removed, ["/bots/alpha"]);
  assert.match(warnings[0], /folder stays on disk/);
  assert.deepEqual(
    walk(outlet)
      .filter((node) => node.className.split(/\s+/).includes("bot-row"))
      .map((row) => row.children.map((child) => child.textContent)),
    [["beta bot", "/tmp/beta bot"]],
  );
  assert.deepEqual(navigated, []);
});

test("removing the last bot returns to the setup screen", async () => {
  const doc = documentStub();
  globalThis.document = doc;
  const navigated = [];
  const outlet = new El("div");
  await renderBots(outlet, doc, {
    config: { bot_paths: ["/bots/alpha"] },
    navigate: (path) => navigated.push(path),
    dialogs: {
      confirm: async () => true,
    },
    host: {
      project: {
        open: async () => ({ ok: true }),
        remove: async () => ({ ok: true }),
      },
    },
  });

  const remove = walk(outlet).find((node) => node.textContent === "Remove");
  await remove.listeners[0]();
  assert.deepEqual(navigated, ["/start-project"]);
});
