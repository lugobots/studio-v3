import test from "node:test";
import assert from "node:assert/strict";
import { renderProfilePage } from "../src/renderer/shell/profile-page.js";
import { installDocument } from "./dom-stub.mjs";

test("profile page renders signed-out and signed-in states", () => {
  const installed = installDocument();
  const { document } = installed;

  const signedOut = renderProfilePage(document, {
    account: { signedIn: false, profile: null },
    onSignIn() {},
    onSignOut() {},
  });
  assert.ok(signedOut.querySelector('[data-profile-section="sign-in"]'));
  assert.equal(signedOut.querySelector('[data-profile-section="identity"]'), null);

  const signedIn = renderProfilePage(document, {
    account: {
      signedIn: true,
      profile: { name: "Grace", username: "ghopper", avatarUrl: "https://example.test/g.png" },
    },
    bots: {
      status: "ready",
      items: [
        {
          name: "Alpha",
          uri: "grace/alpha",
          avatarUrl: "https://example.test/bot.png",
          category: "Sandbox",
          pageUrl: "https://example.test/bots/grace/alpha",
          manageUrl: "https://example.test/manage/grace/alpha",
          badge: "official",
          star: true,
        },
      ],
    },
    onSignIn() {},
    onSignOut() {},
  });
  assert.equal(signedIn.querySelector(".profile-name").textContent, "Grace");
  assert.equal(signedIn.querySelector(".profile-username").textContent, "@ghopper");
  assert.ok(signedIn.querySelector('[data-profile-section="bots"] .profile-bot-item'));
  assert.equal(signedIn.querySelector(".profile-bot-name").textContent, "Alpha");
  assert.equal(signedIn.querySelector(".profile-bot-uri").textContent, "grace/alpha");
  assert.equal(signedIn.querySelector(".profile-bot-category").textContent, "Sandbox");
  assert.equal(signedIn.querySelector(".profile-bot-badge").textContent, "official");
  assert.ok(signedIn.querySelector(".profile-bot-star"));
  assert.ok(signedIn.querySelector('[data-profile-section="session"] .profile-action'));
  installed.restore();
});

test("profile bots section covers loading empty and error states", () => {
  const installed = installDocument();
  const { document } = installed;
  const account = {
    signedIn: true,
    profile: { name: "Ada", username: "ada" },
  };

  const loading = renderProfilePage(document, {
    account,
    bots: { status: "loading", items: [] },
    onSignIn() {},
    onSignOut() {},
  });
  assert.equal(
    loading.querySelector('[data-profile-section="bots"]').getAttribute("data-bots-state"),
    "loading",
  );

  const empty = renderProfilePage(document, {
    account,
    bots: { status: "empty", items: [] },
    onSignIn() {},
    onSignOut() {},
  });
  assert.equal(
    empty.querySelector('[data-profile-section="bots"]').getAttribute("data-bots-state"),
    "empty",
  );

  const errored = renderProfilePage(document, {
    account,
    bots: { status: "error", items: [], error: "timeout" },
    onSignIn() {},
    onSignOut() {},
  });
  assert.equal(
    errored.querySelector('[data-profile-section="bots"]').getAttribute("data-bots-state"),
    "error",
  );
  assert.match(
    errored.querySelector('[data-profile-section="bots"] .profile-helper').textContent,
    /timeout/,
  );
  installed.restore();
});

test("profile bot links invoke onOpenExternal with Doorway URLs", () => {
  const installed = installDocument();
  const { document } = installed;
  const opened = [];
  const page = renderProfilePage(document, {
    account: {
      signedIn: true,
      profile: { name: "Ada", username: "ada" },
    },
    bots: {
      status: "ready",
      items: [
        {
          name: "Alpha",
          uri: "ada/alpha",
          category: "Sandbox",
          pageUrl: "https://doorway.test/bots/ada/alpha",
          manageUrl: "https://doorway.test/bots/ada/alpha/manage",
        },
      ],
    },
    onSignIn() {},
    onSignOut() {},
    onOpenExternal(url) {
      opened.push(url);
    },
  });
  const links = page.querySelectorAll(".profile-bot-link");
  assert.equal(links.length, 2);
  links[0].listeners.click[0]();
  links[1].listeners.click[0]();
  assert.deepEqual(opened, [
    "https://doorway.test/bots/ada/alpha",
    "https://doorway.test/bots/ada/alpha/manage",
  ]);
  installed.restore();
});
