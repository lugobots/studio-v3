import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { noteStartupProgress } from "../src/renderer/components/startup-screen.js";
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
    this.hidden = false;
    this.attributes = {};
    this.classList = {
      toggle: (name, on) => {
        const parts = new Set(this.className.split(/\s+/).filter(Boolean));
        if (on) {
          parts.add(name);
        } else {
          parts.delete(name);
        }
        this.className = [...parts].join(" ");
      },
    };
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = nodes;
  }

  addEventListener() {}
}

function documentStub() {
  return { createElement: (tag) => new El(tag) };
}

function texts(page) {
  return page.children.filter((child) => child.tag === "p").map((child) => child.textContent);
}

function allTexts(node, found = []) {
  if (node.textContent) {
    found.push(node.textContent);
  }
  for (const child of node.children || []) {
    allTexts(child, found);
  }
  return found;
}

test("loading screen shows bot setup while a new bot is created", () => {
  noteStartupProgress({
    flow: "create",
    phase: "setup",
    label: "Setting up the bot",
    detail: "Downloading the Python bot template. This can take a minute.",
    percent: 72,
    steps: [
      { id: "docker", label: "Checking Docker", state: "done" },
      { id: "image", label: "Preparing the Studio image", state: "done" },
      { id: "container", label: "Starting the Studio API", state: "done" },
      { id: "setup", label: "Setting up the bot", state: "current" },
      { id: "deps", label: "Installing bot dependencies", state: "pending" },
      { id: "health", label: "Waiting for the Studio API", state: "pending" },
    ],
  });
  const outlet = new El("div");
  renderApiLoading(outlet, documentStub());
  const copy = allTexts(outlet.children[0]);
  assert.ok(copy.includes("Creating your bot"));
  assert.ok(copy.includes("Setting up the bot"));
  assert.ok(copy.includes("Downloading the Python bot template. This can take a minute."));
  assert.ok(copy.includes("72%"));
  noteStartupProgress({
    phase: "docker",
    label: "Checking Docker",
    detail: "Checking Docker and your bot.",
    percent: 12,
    steps: [
      { id: "docker", label: "Checking Docker", state: "current" },
      { id: "image", label: "Preparing the Studio image", state: "pending" },
      { id: "container", label: "Starting the Studio API", state: "pending" },
      { id: "health", label: "Waiting for the Studio API", state: "pending" },
    ],
  });
});

test("loading screen shows dependency install progress and logs during create", () => {
  noteStartupProgress({
    flow: "create",
    phase: "deps",
    label: "Installing bot dependencies",
    detail: "Installing Python dependencies. 12s elapsed.",
    percent: 85,
    logs: ["$ pip install -r requirements.txt", "Collecting lugo4py"],
    steps: [
      { id: "docker", label: "Checking Docker", state: "done" },
      { id: "image", label: "Preparing the Studio image", state: "done" },
      { id: "container", label: "Starting the Studio API", state: "done" },
      { id: "setup", label: "Setting up the bot", state: "done" },
      { id: "deps", label: "Installing bot dependencies", state: "current" },
      { id: "health", label: "Waiting for the Studio API", state: "pending" },
    ],
  });
  const outlet = new El("div");
  renderApiLoading(outlet, documentStub());
  const page = outlet.children[0];
  const copy = allTexts(page);
  assert.ok(copy.includes("Installing bot dependencies"));
  assert.ok(copy.includes("Installing Python dependencies. 12s elapsed."));
  const log = page.children.find((child) => child.className === "api-gate-logs");
  assert.ok(log);
  assert.equal(log.hidden, false);
  assert.ok(String(log.textContent).includes("Collecting lugo4py"));
  noteStartupProgress({
    phase: "docker",
    label: "Checking Docker",
    detail: "Checking Docker and your bot.",
    percent: 12,
    steps: [
      { id: "docker", label: "Checking Docker", state: "current" },
      { id: "image", label: "Preparing the Studio image", state: "pending" },
      { id: "container", label: "Starting the Studio API", state: "pending" },
      { id: "health", label: "Waiting for the Studio API", state: "pending" },
    ],
  });
});

test("loading screen shows startup progress on the waiting robot", () => {
  noteStartupProgress({
    phase: "docker",
    label: "Checking Docker",
    detail: "Checking Docker and your bot.",
    percent: 12,
    steps: [
      { id: "docker", label: "Checking Docker", state: "current" },
      { id: "image", label: "Preparing the Studio image", state: "pending" },
      { id: "container", label: "Starting the Studio API", state: "pending" },
      { id: "health", label: "Waiting for the Studio API", state: "pending" },
    ],
  });
  const outlet = new El("div");
  renderApiLoading(outlet, documentStub());
  const page = outlet.children[0];
  const image = page.children.find((child) => child.tag === "img");
  const track = page.children.find((child) => child.attributes?.role === "progressbar");
  const copy = allTexts(page);
  assert.equal(page.style.backgroundColor, "rgb(144, 204, 199)");
  assert.ok(copy.includes("Checking Docker"));
  assert.ok(copy.includes("12%"));
  assert.ok(copy.includes("Waiting for the Studio API"));
  assert.equal(track.attributes["aria-valuenow"], "12");
  assert.match(track.className, /is-busy/);
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
