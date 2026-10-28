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
    this.children.push(...nodes);
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
