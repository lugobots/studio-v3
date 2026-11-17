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
    onSignIn() {},
    onSignOut() {},
  });
  assert.equal(signedIn.querySelector(".profile-name").textContent, "Grace");
  assert.equal(signedIn.querySelector(".profile-username").textContent, "@ghopper");
  assert.ok(signedIn.querySelector('[data-profile-section="bots"] .profile-bot-item'));
  assert.ok(signedIn.querySelector('[data-profile-section="session"] .profile-action'));
  installed.restore();
});
