import assert from "node:assert/strict";
import test from "node:test";
import { createDialogController } from "../src/renderer/lib/dialog-controller.js";
import {
  isDockerNotInstalled,
  ledeForStatus,
  renderDockerCheck,
} from "../src/renderer/pages/docker-check/index.js";
import { installDocument } from "./dom-stub.mjs";

function walk(node, found = []) {
  found.push(node);
  for (const child of node.children || []) {
    walk(child, found);
  }
  return found;
}

function buttonByLabel(root, label) {
  return walk(root).find((node) => node.tagName === "BUTTON" && node.textContent === label);
}

function ledeText(root) {
  const lede = walk(root).find((node) => node.className === "lede");
  return lede ? lede.textContent : "";
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test("ledeForStatus distinguishes not installed from not running", () => {
  assert.match(ledeForStatus({ installed: false, reason: "not_installed" }), /not installed/i);
  assert.match(ledeForStatus({ installed: true, reason: "not_running", running: false }), /not running/i);
  assert.equal(isDockerNotInstalled({ installed: false }), true);
  assert.equal(isDockerNotInstalled({ reason: "not_running", installed: true }), false);
});

test("not-installed state shows Open Docker website and keeps the route", async () => {
  const { document } = installDocument();
  const outlet = document.createElement("div");
  const navigated = [];
  const opened = [];
  renderDockerCheck(outlet, document, {
    navigate: (route) => navigated.push(route),
    dialogs: createDialogController(),
    host: {
      docker: {
        status: async () => ({
          running: false,
          installed: false,
          reason: "not_installed",
        }),
        openInstallPage: async () => {
          opened.push("install");
          return { ok: true };
        },
      },
      startup: {
        next: async () => ({ route: "/bots" }),
      },
    },
  });

  await flush();
  assert.match(ledeText(outlet), /not installed/i);
  const openSite = buttonByLabel(outlet, "Open Docker website");
  assert.ok(openSite);
  openSite.click();
  await flush();
  assert.deepEqual(opened, ["install"]);
  assert.deepEqual(navigated, []);
});

test("not-running state omits Open Docker website as primary guidance", async () => {
  const { document } = installDocument();
  const outlet = document.createElement("div");
  renderDockerCheck(outlet, document, {
    host: {
      docker: {
        status: async () => ({
          running: false,
          installed: true,
          reason: "not_running",
        }),
      },
    },
  });
  await flush();
  assert.match(ledeText(outlet), /not running/i);
  assert.equal(buttonByLabel(outlet, "Open Docker website"), undefined);
  assert.ok(buttonByLabel(outlet, "Check again"));
});

test("Check again shows busy feedback then clears it", async () => {
  const { document } = installDocument();
  const outlet = document.createElement("div");
  const dialogs = createDialogController();
  const titles = [];
  dialogs.subscribe(() => {
    const snapshot = dialogs.snapshot();
    titles.push(snapshot.blocking ? snapshot.blocking.title : null);
  });

  let calls = 0;
  let resolveCheck;
  const checkWait = new Promise((resolve) => {
    resolveCheck = resolve;
  });

  renderDockerCheck(outlet, document, {
    dialogs,
    navigate: () => {},
    host: {
      docker: {
        status: async () => {
          calls += 1;
          if (calls === 1) {
            return { running: false, installed: true, reason: "not_running" };
          }
          return checkWait;
        },
      },
      startup: {
        next: async () => ({ route: "/bots" }),
      },
    },
  });

  await flush();
  const retry = buttonByLabel(outlet, "Check again");
  assert.ok(retry);
  retry.click();
  await flush();
  assert.ok(titles.includes("Checking for Docker"));

  resolveCheck({ running: false, installed: true, reason: "not_running" });
  await flush();
  assert.equal(titles[titles.length - 1], null);
});

test("Check again navigates when Docker becomes available", async () => {
  const { document } = installDocument();
  const outlet = document.createElement("div");
  const navigated = [];
  let calls = 0;

  renderDockerCheck(outlet, document, {
    dialogs: createDialogController(),
    navigate: (route) => navigated.push(route),
    host: {
      docker: {
        status: async () => {
          calls += 1;
          if (calls === 1) {
            return { running: false, installed: true, reason: "not_running" };
          }
          return { running: true, installed: true, reason: null };
        },
      },
      startup: {
        next: async () => ({ route: "/bots" }),
      },
    },
  });

  await flush();
  buttonByLabel(outlet, "Check again").click();
  await flush();
  assert.deepEqual(navigated, ["/bots"]);
});
