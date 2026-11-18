import test from "node:test";
import assert from "node:assert/strict";
import { renderAppFrame } from "../src/renderer/shell/frame.js";
import { installDocument } from "./dom-stub.mjs";

const BOTS = [
  { name: "Alpha", uri: "ada/alpha", avatarUrl: null, category: "Sandbox", pageUrl: "", manageUrl: "" },
  { name: "Beta", uri: "ada/beta", avatarUrl: null, category: "Sandbox", pageUrl: "", manageUrl: "" },
];

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function fire(node, type) {
  for (const fn of node.listeners[type] || []) {
    fn({ preventDefault() {} });
  }
}

function createHost(overrides = {}) {
  const calls = {
    bots: 0,
    tags: [],
    publish: [],
    authStatus: 0,
    authLogin: [],
    signIns: 0,
  };
  const state = {
    signedIn: true,
    bots: BOTS,
    tags: { "ada/alpha": ["v3", "v2", "v1", "v0"], "ada/beta": [] },
    registry: { loggedIn: true, username: "ada" },
    publish: async () => ({ ok: true, body: { status: "OK" } }),
  };
  const host = {
    config: {
      async get() {
        return {
          project_path: "/tmp/bot",
          telemetryEnabled: false,
          game_frontend_url: "http://localhost:8080",
          editor_url: "http://localhost:8082",
          workspace_editor_open: false,
        };
      },
    },
    account: {
      async status() {
        return state.signedIn
          ? { signedIn: true, profile: { name: "Ada", username: "ada", avatarUrl: null } }
          : { signedIn: false, profile: null };
      },
      async signIn() {
        calls.signIns += 1;
        state.signedIn = true;
        return {
          ok: true,
          signedIn: true,
          profile: { name: "Ada", username: "ada", avatarUrl: null },
        };
      },
      async signOut() {
        state.signedIn = false;
        return { ok: true, signedIn: false, profile: null };
      },
      async bots() {
        calls.bots += 1;
        return { ok: true, bots: state.bots };
      },
      async botTags({ uri }) {
        calls.tags.push(uri);
        const result = state.tags[uri];
        if (result instanceof Error) {
          return { ok: false, error: result.message, tags: [] };
        }
        return { ok: true, uri, tags: (result || []).slice(0, 3) };
      },
      async openExternal() {
        return { ok: true };
      },
    },
    publish: {
      async bot(payload) {
        calls.publish.push(payload);
        return state.publish(payload);
      },
      async authStatus() {
        calls.authStatus += 1;
        return { ok: true, ...state.registry, registry: "repo.lugobots.ai" };
      },
      async authLogin(credentials) {
        calls.authLogin.push(credentials);
        state.registry = { loggedIn: true, username: credentials.username };
        return { ok: true, ...state.registry, registry: "repo.lugobots.ai" };
      },
      async authLogout() {
        state.registry = { loggedIn: false, username: "" };
        return { ok: true, ...state.registry, registry: "repo.lugobots.ai" };
      },
    },
    server: {
      async status() {
        return { ok: true, body: { running: false } };
      },
      onStatus() {
        return () => {};
      },
    },
    match: { async start() { return { ok: true }; } },
    docker: { async status() { return { imagePresent: true }; } },
    ...overrides,
  };
  return { host, calls, state };
}

function mount(host, { confirm = async () => true } = {}) {
  const installed = installDocument();
  const outlet = installed.document.createElement("div");
  const notices = [];
  const confirms = [];
  renderAppFrame(outlet, {
    host,
    dialogs: {
      notify: (notice) => notices.push(notice),
      confirm: async (options) => {
        confirms.push(options);
        return confirm(options);
      },
      alert: async () => {},
    },
  });
  return { outlet, installed, notices, confirms };
}

test("signed-out Build prompts to sign in, hides build controls, and keeps a Build-only lateral", async () => {
  const { host, calls, state } = createHost();
  state.signedIn = false;
  const { outlet, installed } = mount(host);
  await flush();

  outlet.querySelector('[data-area="build"]').click();
  await flush();

  assert.ok(outlet.querySelector(".build-page"));
  assert.ok(outlet.querySelector('[data-build-section="sign-in"]'));
  assert.equal(outlet.querySelector(".build-select"), null);
  assert.equal(outlet.querySelector('[data-build-field="tag"]'), null);
  assert.equal(outlet.querySelector('[data-build-action="build"]'), null);
  assert.equal(outlet.querySelector('[data-build-section="tags"]'), null);
  assert.deepEqual(calls.tags, []);
  assert.equal(calls.authStatus, 0);
  assert.equal(calls.bots, 0);
  assert.equal(outlet.querySelector('[data-window="build"]').querySelectorAll("p").some((p) => p.textContent === "Coming soon"), false);

  // Lateral is Build-scoped: no Workspace game controls, no publish strip.
  assert.equal(outlet.querySelector(".side-menu").hidden, false);
  assert.ok(outlet.querySelector('[data-build-menu="bot-image"]'));
  assert.equal(outlet.querySelector(".game-ctrl"), null);
  assert.equal(outlet.querySelector(".publish-form"), null);
  assert.equal(outlet.querySelectorAll("button").some((b) => b.title === "Open editor"), false);
  installed.restore();
});

test("signing in from Build loads bots, tags and registry state", async () => {
  const { host, calls, state } = createHost();
  state.signedIn = false;
  const { outlet, installed } = mount(host);
  await flush();
  outlet.querySelector('[data-area="build"]').click();
  await flush();

  outlet.querySelector('[data-build-section="sign-in"] button').click();
  await flush();

  assert.equal(calls.signIns, 1);
  assert.equal(outlet.querySelector('[data-build-section="sign-in"]'), null);
  assert.ok(outlet.querySelector(".build-select"));
  assert.deepEqual(calls.tags, ["ada/alpha"]);
  assert.equal(calls.authStatus, 1);
  installed.restore();
});

test("signed-in Build lists owned bots, defaults to the first and shows the latest three tags", async () => {
  const { host, calls } = createHost();
  const { outlet, installed } = mount(host);
  await flush();
  outlet.querySelector('[data-area="build"]').click();
  await flush();

  const select = outlet.querySelector(".build-select");
  assert.deepEqual(
    select.children.map((option) => option.textContent),
    ["repo.lugobots.ai/ada/alpha", "repo.lugobots.ai/ada/beta"],
  );
  assert.equal(select.value, "ada/alpha");
  assert.deepEqual(calls.tags, ["ada/alpha"]);
  const panel = outlet.querySelector('[data-build-section="tags"]');
  assert.equal(panel.getAttribute("data-tags-state"), "ready");
  assert.deepEqual(
    panel.querySelectorAll(".build-tag-item").map((item) => item.textContent),
    ["v3", "v2", "v1"],
  );
  assert.equal(outlet.querySelector('[data-build-section="registry"]').getAttribute("data-registry-state"), "in");
  assert.equal(outlet.querySelector('[data-build-action="build"]').disabled, true);
  assert.ok(outlet.querySelector('[data-build-menu="bot-image"]'));
  assert.equal(outlet.querySelector(".game-ctrl"), null);
  installed.restore();
});

test("changing the selected bot refreshes the tags panel (empty and error states)", async () => {
  const { host, calls, state } = createHost();
  state.tags["ada/beta"] = new Error("not_owner");
  const { outlet, installed } = mount(host);
  await flush();
  outlet.querySelector('[data-area="build"]').click();
  await flush();

  let select = outlet.querySelector(".build-select");
  select.value = "ada/beta";
  fire(select, "change");
  await flush();
  assert.deepEqual(calls.tags, ["ada/alpha", "ada/beta"]);
  let panel = outlet.querySelector('[data-build-section="tags"]');
  assert.equal(panel.getAttribute("data-tags-state"), "error");
  assert.match(panel.querySelector(".build-helper").textContent, /not_owner/);
  // Form still usable after a tag-list failure.
  const tag = outlet.querySelector('[data-build-field="tag"]');
  tag.value = "v1";
  fire(tag, "input");
  assert.equal(outlet.querySelector('[data-build-action="build"]').disabled, false);

  state.tags["ada/beta"] = [];
  panel.querySelector("button").click();
  await flush();
  panel = outlet.querySelector('[data-build-section="tags"]');
  assert.equal(panel.getAttribute("data-tags-state"), "empty");
  // Selection and the typed tag survive repaints.
  select = outlet.querySelector(".build-select");
  assert.equal(select.value, "ada/beta");
  assert.equal(outlet.querySelector('[data-build-field="tag"]').value, "v1");
  installed.restore();
});

test("account with no owned bots cannot start a build", async () => {
  const { host, calls, state } = createHost();
  state.bots = [];
  const { outlet, installed, confirms } = mount(host);
  await flush();
  outlet.querySelector('[data-area="build"]').click();
  await flush();

  assert.equal(
    outlet.querySelector('[data-build-section="target"]').getAttribute("data-bots-state"),
    "empty",
  );
  assert.equal(outlet.querySelector(".build-select"), null);
  const button = outlet.querySelector('[data-build-action="build"]');
  assert.equal(button.disabled, true);
  button.click();
  await flush();
  assert.equal(confirms.length, 0);
  assert.deepEqual(calls.publish, []);
  assert.deepEqual(calls.tags, []);
  installed.restore();
});

test("build asks for a long-running confirmation, publishes, reports success and refreshes tags", async () => {
  const { host, calls, state } = createHost();
  let release;
  state.publish = () =>
    new Promise((resolve) => {
      release = () => resolve({ ok: true, body: { status: "OK", image: "repo.lugobots.ai/ada/alpha:v4" } });
    });
  const { outlet, installed, confirms, notices } = mount(host);
  await flush();
  outlet.querySelector('[data-area="build"]').click();
  await flush();

  const tag = outlet.querySelector('[data-build-field="tag"]');
  tag.value = "v4";
  fire(tag, "input");
  outlet.querySelector('[data-build-action="build"]').click();
  await flush();

  assert.equal(confirms.length, 1);
  assert.match(confirms[0].body, /several minutes/);
  assert.match(confirms[0].body, /repo\.lugobots\.ai\/ada\/alpha:v4/);
  assert.deepEqual(calls.publish, [{ botUri: "ada/alpha", tag: "v4" }]);

  const building = outlet.querySelector('[data-build-run="building"]');
  assert.ok(building);
  assert.equal(outlet.querySelector('[data-build-action="build"]').disabled, true);

  state.tags["ada/alpha"] = ["v4", "v3", "v2", "v1"];
  release();
  await flush();

  const success = outlet.querySelector('[data-build-run="success"]');
  assert.equal(success.querySelector(".build-run-text").textContent, "Published repo.lugobots.ai/ada/alpha:v4");
  assert.deepEqual(calls.tags, ["ada/alpha", "ada/alpha"]);
  assert.deepEqual(
    outlet.querySelectorAll(".build-tag-item").map((item) => item.textContent),
    ["v4", "v3", "v2"],
  );
  assert.equal(notices.at(-1).title, "Image published");
  installed.restore();
});

test("declining the confirmation does not publish", async () => {
  const { host, calls } = createHost();
  const { outlet, installed, confirms } = mount(host, { confirm: async () => false });
  await flush();
  outlet.querySelector('[data-area="build"]').click();
  await flush();
  const tag = outlet.querySelector('[data-build-field="tag"]');
  tag.value = "v4";
  fire(tag, "input");
  outlet.querySelector('[data-build-action="build"]').click();
  await flush();
  assert.equal(confirms.length, 1);
  assert.deepEqual(calls.publish, []);
  assert.equal(outlet.querySelector("[data-build-run]"), null);
  installed.restore();
});

test("missing .lugo/Dockerfile is reported clearly and never as success", async () => {
  const { host, calls, state } = createHost();
  state.publish = async () => ({ ok: false, error: "missing .lugo/Dockerfile in the bot project" });
  const { outlet, installed, notices } = mount(host);
  await flush();
  outlet.querySelector('[data-area="build"]').click();
  await flush();
  const tag = outlet.querySelector('[data-build-field="tag"]');
  tag.value = "v4";
  fire(tag, "input");
  outlet.querySelector('[data-build-action="build"]').click();
  await flush();

  const failed = outlet.querySelector('[data-build-run="error"]');
  assert.ok(failed);
  assert.match(failed.querySelector(".build-run-text").textContent, /^Missing \.lugo\/Dockerfile/);
  assert.equal(outlet.querySelector('[data-build-run="success"]'), null);
  // No tag refresh after a failed publish.
  assert.deepEqual(calls.tags, ["ada/alpha"]);
  assert.equal(notices.at(-1).title, "Build failed");
  // The user can retry right away.
  assert.equal(outlet.querySelector('[data-build-action="build"]').disabled, false);
  installed.restore();
});

test("registry out shows no password fields; publish proceeds with a valid Doorway session", async () => {
  const { host, calls, state } = createHost();
  state.registry = { loggedIn: false, username: "" };
  const { outlet, installed, confirms } = mount(host);
  await flush();
  outlet.querySelector('[data-area="build"]').click();
  await flush();

  const registry = outlet.querySelector('[data-build-section="registry"]');
  assert.equal(registry.getAttribute("data-registry-state"), "out");
  assert.equal(registry.querySelector('input[type="password"]'), null);
  assert.equal(registry.querySelector('input[aria-label="Registry username"]'), null);
  assert.equal(registry.querySelector('input[aria-label="Registry password"]'), null);
  assert.equal(registry.querySelector('[data-registry-action="login"]'), null);
  assert.equal(registry.querySelectorAll("input").length, 0);
  assert.match(registry.querySelector(".build-helper").textContent, /Doorway session/);

  const tag = outlet.querySelector('[data-build-field="tag"]');
  tag.value = "v4";
  fire(tag, "input");
  assert.equal(outlet.querySelector('[data-build-action="build"]').disabled, false);

  outlet.querySelector('[data-build-action="build"]').click();
  await flush();

  assert.equal(confirms.length, 1);
  assert.deepEqual(calls.publish, [{ botUri: "ada/alpha", tag: "v4" }]);
  assert.deepEqual(calls.authLogin, []);
  assert.equal(outlet.querySelector('[data-build-field="tag"]').value, "v4");
  installed.restore();
});

test("signing out hides Build controls again and clears build state", async () => {
  const { host } = createHost();
  const { outlet, installed } = mount(host);
  await flush();
  outlet.querySelector('[data-area="build"]').click();
  await flush();
  assert.ok(outlet.querySelector(".build-select"));

  outlet.querySelector('[data-area="profile"]').click();
  await flush();
  outlet.querySelectorAll("button").find((button) => button.textContent === "Log out").click();
  await flush();
  outlet.querySelector('[data-area="build"]').click();
  await flush();

  assert.ok(outlet.querySelector('[data-build-section="sign-in"]'));
  assert.equal(outlet.querySelector(".build-select"), null);
  assert.equal(outlet.querySelector('[data-build-action="build"]'), null);
  installed.restore();
});
