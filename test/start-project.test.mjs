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
