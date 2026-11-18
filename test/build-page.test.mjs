import test from "node:test";
import assert from "node:assert/strict";
import {
  renderBuildPage,
  emptyBuildState,
  buildBlockedReason,
  describeBuildError,
  imageRef,
} from "../src/renderer/shell/build-page.js";
import { installDocument } from "./dom-stub.mjs";

const SIGNED_IN = { signedIn: true, profile: { name: "Ada", username: "ada" } };
const BOTS = {
  status: "ready",
  items: [
    { name: "Alpha", uri: "ada/alpha" },
    { name: "Beta", uri: "ada/beta" },
  ],
};

function readyBuild(overrides = {}) {
  return {
    ...emptyBuildState(),
    botUri: "ada/alpha",
    tags: { status: "ready", uri: "ada/alpha", items: ["v3", "v2", "v1"], error: null },
    registry: { status: "in", username: "ada", error: null, busy: false },
    ...overrides,
  };
}

function render(document, options) {
  return renderBuildPage(document, {
    account: SIGNED_IN,
    bots: BOTS,
    build: readyBuild(),
    onSignIn() {},
    ...options,
  });
}

function fire(node, type, event = {}) {
  for (const fn of node.listeners[type] || []) {
    fn({ preventDefault() {}, ...event });
  }
}

test("signed-out Build prompts to sign in and hides every build control", () => {
  const installed = installDocument();
  let signIns = 0;
  const page = renderBuildPage(installed.document, {
    account: { signedIn: false, profile: null },
    bots: BOTS,
    build: readyBuild(),
    onSignIn() {
      signIns += 1;
    },
  });
  assert.equal(page.getAttribute("data-window"), "build");
  assert.ok(page.querySelector('[data-build-section="sign-in"]'));
  assert.equal(page.querySelector("select"), null);
  assert.equal(page.querySelector('[data-build-field="tag"]'), null);
  assert.equal(page.querySelector('[data-build-action="build"]'), null);
  assert.equal(page.querySelector('[data-build-section="tags"]'), null);
  assert.equal(page.querySelector('[data-build-section="registry"]'), null);
  assert.equal(page.querySelector('[data-build-section="target"]'), null);
  page.querySelector("button").click();
  assert.equal(signIns, 1);
  installed.restore();
});

test("signed-in Build shows repo.lugobots.ai addresses and a tag field, and reports selection", () => {
  const installed = installDocument();
  const selected = [];
  const tags = [];
  const page = render(installed.document, {
    onSelectBot: (uri) => selected.push(uri),
    onTagChange: (tag) => tags.push(tag),
  });
  assert.equal(page.querySelector('[data-build-section="sign-in"]'), null);
  const select = page.querySelector("select");
  assert.deepEqual(
    select.children.map((option) => option.textContent),
    ["repo.lugobots.ai/ada/alpha", "repo.lugobots.ai/ada/beta"],
  );
  assert.deepEqual(
    select.children.map((option) => option.value),
    ["ada/alpha", "ada/beta"],
  );
  select.value = "ada/beta";
  fire(select, "change");
  assert.deepEqual(selected, ["ada/beta"]);

  const tag = page.querySelector('[data-build-field="tag"]');
  assert.equal(tag.type, "text");
  tag.value = "v4";
  fire(tag, "input");
  assert.deepEqual(tags, ["v4"]);
  assert.equal(
    page.querySelector('[data-build-image="true"]').textContent,
    "Will push repo.lugobots.ai/ada/alpha:v4",
  );
  installed.restore();
});

test("build action stays disabled until a tag is entered, then calls onBuild", () => {
  const installed = installDocument();
  let builds = 0;
  const page = render(installed.document, {
    onBuild() {
      builds += 1;
    },
  });
  const button = page.querySelector('[data-build-action="build"]');
  assert.equal(button.disabled, true);
  assert.match(page.querySelector('[data-build-blocked="true"]').textContent, /Enter an image tag/);
  button.click();
  assert.equal(builds, 0);

  const tag = page.querySelector('[data-build-field="tag"]');
  tag.value = "  ";
  fire(tag, "input");
  assert.equal(button.disabled, true);

  tag.value = "v1";
  fire(tag, "input");
  assert.equal(button.disabled, false);
  assert.equal(page.querySelector('[data-build-blocked="true"]').textContent, "");
  button.click();
  assert.equal(builds, 1);
  installed.restore();
});

test("latest tags panel covers loading, ready (three), fewer, empty and error states", () => {
  const installed = installDocument();
  const states = (tags) =>
    render(installed.document, { build: readyBuild({ tags }) }).querySelector(
      '[data-build-section="tags"]',
    );

  const loading = states({ status: "loading", uri: "ada/alpha", items: [], error: null });
  assert.equal(loading.getAttribute("data-tags-state"), "loading");
  assert.match(loading.querySelector(".build-helper").textContent, /Loading tags/);

  const three = states({ status: "ready", uri: "ada/alpha", items: ["v3", "v2", "v1"], error: null });
  assert.equal(three.getAttribute("data-tags-state"), "ready");
  assert.deepEqual(
    three.querySelectorAll(".build-tag-item").map((item) => item.textContent),
    ["v3", "v2", "v1"],
  );

  const two = states({ status: "ready", uri: "ada/alpha", items: ["v2", "v1"], error: null });
  assert.equal(two.querySelectorAll(".build-tag-item").length, 2);

  const empty = states({ status: "empty", uri: "ada/alpha", items: [], error: null });
  assert.equal(empty.getAttribute("data-tags-state"), "empty");
  assert.equal(empty.querySelectorAll(".build-tag-item").length, 0);
  assert.match(empty.querySelector(".build-helper").textContent, /No releases/);

  let retries = 0;
  const failed = render(installed.document, {
    build: readyBuild({
      tags: { status: "error", uri: "ada/alpha", items: [], error: "not_owner" },
      tag: "v1",
    }),
    onRetryTags: () => {
      retries += 1;
    },
  });
  const errorPanel = failed.querySelector('[data-build-section="tags"]');
  assert.equal(errorPanel.getAttribute("data-tags-state"), "error");
  assert.match(errorPanel.querySelector(".build-helper").textContent, /not_owner/);
  assert.match(errorPanel.querySelector(".build-helper").textContent, /still enter a tag/);
  errorPanel.querySelector("button").click();
  assert.equal(retries, 1);
  // A tag-list failure never blocks the form.
  assert.equal(failed.querySelector("select").disabled, false);
  const tag = failed.querySelector('[data-build-field="tag"]');
  assert.equal(tag.value, "v1");
  assert.equal(failed.querySelector('[data-build-action="build"]').disabled, false);
  installed.restore();
});

test("empty owned bots blocks build and shows no selector", () => {
  const installed = installDocument();
  const page = render(installed.document, {
    bots: { status: "empty", items: [], error: null },
    build: { ...emptyBuildState(), tag: "v1" },
  });
  assert.equal(page.querySelector('[data-build-section="target"]').getAttribute("data-bots-state"), "empty");
  assert.equal(page.querySelector("select"), null);
  assert.equal(page.querySelector('[data-build-field="tag"]'), null);
  assert.equal(page.querySelector('[data-build-section="tags"]'), null);
  const button = page.querySelector('[data-build-action="build"]');
  assert.equal(button.disabled, true);
  assert.match(page.querySelector('[data-build-blocked="true"]').textContent, /no bots/i);
  installed.restore();
});

test("bots loading and error states block build; error offers retry", () => {
  const installed = installDocument();
  const loading = render(installed.document, {
    bots: { status: "loading", items: [], error: null },
    build: emptyBuildState(),
  });
  assert.equal(loading.querySelector('[data-build-action="build"]').disabled, true);

  let retries = 0;
  const failed = render(installed.document, {
    bots: { status: "error", items: [], error: "bots_failed_500" },
    build: emptyBuildState(),
    onRetryBots: () => {
      retries += 1;
    },
  });
  assert.match(
    failed.querySelector('[data-build-section="target"] .build-helper').textContent,
    /bots_failed_500/,
  );
  failed.querySelector('[data-build-section="target"] button').click();
  assert.equal(retries, 1);
  assert.equal(failed.querySelector('[data-build-action="build"]').disabled, true);
  installed.restore();
});

test("registry section has no username/password fields when logged out; build still proceeds", () => {
  const installed = installDocument();
  const builds = [];
  const build = readyBuild({
    tag: "v1",
    registry: { status: "out", username: "", error: null, busy: false },
  });
  const page = render(installed.document, {
    build,
    onBuild() {
      builds.push(1);
    },
  });
  const registry = page.querySelector('[data-build-section="registry"]');
  assert.equal(registry.getAttribute("data-registry-state"), "out");
  assert.match(
    registry.querySelector(".build-helper").textContent,
    /Doorway session/,
  );
  assert.equal(registry.querySelector('input[type="password"]'), null);
  assert.equal(registry.querySelector('input[aria-label="Registry username"]'), null);
  assert.equal(registry.querySelector('input[aria-label="Registry password"]'), null);
  assert.equal(registry.querySelector('[data-registry-action="login"]'), null);
  assert.equal(registry.querySelectorAll("input").length, 0);
  // Registry docker login is OTP-at-publish; Doorway signed-in is enough to enable Build.
  assert.equal(page.querySelector('[data-build-action="build"]').disabled, false);
  assert.equal(page.querySelector('[data-build-blocked="true"]').textContent, "");
  page.querySelector('[data-build-action="build"]').click();
  assert.equal(builds.length, 1);
  installed.restore();
});

test("registry section shows logged-in, checking and error states", () => {
  const installed = installDocument();
  let logouts = 0;
  const signedIn = render(installed.document, {
    build: readyBuild(),
    onRegistryLogout: () => {
      logouts += 1;
    },
  }).querySelector('[data-build-section="registry"]');
  assert.equal(signedIn.getAttribute("data-registry-state"), "in");
  assert.match(signedIn.querySelector(".build-helper").textContent, /as ada/);
  assert.equal(signedIn.querySelectorAll("input").length, 0);
  signedIn.querySelector("button").click();
  assert.equal(logouts, 1);

  const checking = render(installed.document, {
    build: readyBuild({ registry: { status: "loading", username: "", error: null, busy: false } }),
  }).querySelector('[data-build-section="registry"]');
  assert.equal(checking.getAttribute("data-registry-state"), "loading");

  let retries = 0;
  const failed = render(installed.document, {
    build: readyBuild({
      tag: "v1",
      registry: { status: "error", username: "", error: "boom", busy: false },
    }),
    onRetryRegistry: () => {
      retries += 1;
    },
  });
  const panel = failed.querySelector('[data-build-section="registry"]');
  assert.match(panel.querySelector(".build-helper").textContent, /boom/);
  panel.querySelector("button").click();
  assert.equal(retries, 1);
  // Unknown registry state does not block an attempt; the push reports the real failure.
  assert.equal(failed.querySelector('[data-build-action="build"]').disabled, false);
  installed.restore();
});

test("run status shows progress, success and failure; missing Dockerfile is explicit", () => {
  const installed = installDocument();
  const image = imageRef("ada/alpha", "v1");
  const run = (state) =>
    render(installed.document, {
      build: readyBuild({ tag: "v1", run: { status: state.status, image, error: state.error || "" } }),
    });

  const building = run({ status: "building" });
  const progress = building.querySelector('[data-build-run="building"]');
  assert.ok(progress);
  assert.ok(progress.querySelector(".build-progress"));
  assert.match(progress.querySelector(".build-run-text").textContent, /several minutes/);
  assert.equal(building.querySelector('[data-build-action="build"]').disabled, true);

  const success = run({ status: "success" }).querySelector('[data-build-run="success"]');
  assert.equal(success.querySelector(".build-run-text").textContent, "Published repo.lugobots.ai/ada/alpha:v1");

  const missing = run({
    status: "error",
    error: "missing .lugo/Dockerfile in the bot project",
  }).querySelector('[data-build-run="error"]');
  assert.equal(missing.getAttribute("role"), "alert");
  assert.match(missing.querySelector(".build-run-text").textContent, /^Missing \.lugo\/Dockerfile/);

  const failure = run({ status: "error", error: "push denied" }).querySelector('[data-build-run="error"]');
  assert.equal(failure.querySelector(".build-run-text").textContent, "push denied");
  installed.restore();
});

test("describeBuildError and buildBlockedReason helpers", () => {
  assert.match(describeBuildError("missing .lugo/Dockerfile in the bot project"), /Missing \.lugo\/Dockerfile/);
  assert.match(describeBuildError("failed to read dockerfile: no such file"), /Missing \.lugo\/Dockerfile/);
  assert.equal(describeBuildError("push denied"), "push denied");
  assert.equal(describeBuildError(""), "The build failed.");
  assert.equal(imageRef("a/b"), "repo.lugobots.ai/a/b");
  assert.equal(imageRef("a/b", "v1"), "repo.lugobots.ai/a/b:v1");

  assert.equal(buildBlockedReason({ bots: BOTS, build: readyBuild({ tag: "v1" }) }), null);
  assert.equal(
    buildBlockedReason({
      bots: BOTS,
      build: readyBuild({
        tag: "v1",
        registry: { status: "out", username: "", error: null, busy: false },
      }),
    }),
    null,
  );
  assert.match(buildBlockedReason({ bots: BOTS, build: readyBuild({ botUri: "" }) }), /Select a bot/);
});
