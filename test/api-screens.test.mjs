import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { renderApiError } from "../src/renderer/pages/api-error/index.js";
import { renderApiLoading } from "../src/renderer/pages/api-loading/index.js";
import { setGateMessage } from "../src/renderer/lib/gate-message.js";

class El {
  constructor(tag) {
    this.tag = tag;
    this.className = "";
    this.textContent = "";
    this.children = [];
    this.style = {};
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  addEventListener() {}
}

function documentStub() {
  return { createElement: (tag) => new El(tag) };
}

function texts(page) {
  return page.children.filter((child) => child.tag === "p").map((child) => child.textContent);
}

test("loading screen uses the waiting robot and teal background", () => {
  const outlet = new El("div");
  renderApiLoading(outlet, documentStub());
  const page = outlet.children[0];
  const image = page.children.find((child) => child.tag === "img");
  assert.equal(page.style.backgroundColor, "rgb(144, 204, 199)");
  assert.ok(texts(page).includes("Please wait a few seconds."));
  assert.match(image.src, /waiting-robot\.png$/);
  assert.equal(image.alt, "Waiting robot");
  assert.ok(fs.existsSync(new URL("../src/renderer/assets/waiting-robot.png", import.meta.url)));
});

test("error screen shows the failure and the broken robot", () => {
  setGateMessage("The Studio API container is not running.");
  const outlet = new El("div");
  renderApiError(outlet, documentStub());
  const page = outlet.children[0];
  const image = page.children.find((child) => child.tag === "img");
  assert.equal(page.style.backgroundColor, "rgb(144, 204, 199)");
  assert.deepEqual(texts(page), ["The Studio API container is not running."]);
  assert.match(image.src, /error-robot\.png$/);
  assert.ok(fs.existsSync(new URL("../src/renderer/assets/error-robot.png", import.meta.url)));
});
