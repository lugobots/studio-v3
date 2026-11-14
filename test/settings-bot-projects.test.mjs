import test from "node:test";
import assert from "node:assert/strict";
import {
  NEW_BOT_PROJECT_VALUE,
  folderName,
  renderRailBotCombobox,
  switchBotProject,
} from "../src/renderer/shell/settings-bot-projects.js";
import { installDocument, leafText } from "./dom-stub.mjs";

test("folderName uses the last path segment", () => {
  assert.equal(folderName("/bots/alpha"), "alpha");
  assert.equal(folderName("C:\\bots\\beta\\"), "beta");
});

test("switchBotProject no-ops for the current path and opens others", async () => {
  const opened = [];
  const same = await switchBotProject({
    folder: "/bots/a",
    currentPath: "/bots/a",
    open: async (folder) => {
      opened.push(folder);
      return { ok: true, route: "/api-loading" };
    },
  });
  assert.equal(same.ok, true);
  assert.equal(same.skipped, true);
  assert.deepEqual(opened, []);

  const switched = await switchBotProject({
    folder: "/bots/b",
    currentPath: "/bots/a",
    open: async (folder) => {
      opened.push(folder);
      return { ok: true, route: "/api-loading" };
    },
  });
  assert.equal(switched.ok, true);
  assert.equal(switched.skipped, undefined);
  assert.equal(switched.route, "/api-loading");
  assert.deepEqual(opened, ["/bots/b"]);

  const failed = await switchBotProject({
    folder: "/bots/c",
    currentPath: "/bots/a",
    open: async () => ({ ok: false, error: "missing" }),
  });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /missing/);
});

test("rail bot combobox selects the current bot and offers new project", () => {
  const installed = installDocument();
  const selected = [];
  let newClicks = 0;
  const wrap = renderRailBotCombobox(installed.document, {
    config: {
      project_path: "/bots/beta",
      bot_paths: ["/bots/alpha", "/bots/beta"],
    },
    onSelectBot: (folder) => selected.push(folder),
    onNewBotProject: () => {
      newClicks += 1;
    },
  });

  assert.equal(wrap.getAttribute("aria-label"), "Bot project");
  const select = wrap.querySelector(".area-rail-bot-select");
  assert.ok(select);
  assert.equal(select.value, "/bots/beta");
  const labels = leafText(select);
  assert.ok(labels.includes("alpha"));
  assert.ok(labels.includes("beta"));
  assert.ok(labels.includes("New bot project"));

  select.value = "/bots/alpha";
  select.listeners.change[0]();
  assert.deepEqual(selected, ["/bots/alpha"]);

  select.value = NEW_BOT_PROJECT_VALUE;
  select.listeners.change[0]();
  assert.equal(newClicks, 1);
  assert.equal(select.value, "/bots/beta");
  installed.restore();
});
