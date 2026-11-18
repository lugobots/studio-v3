"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isRegistryAuthFailure,
  publishWithOtpLogin,
} = require("../src/main/services/session/publish-registry");
const { actionResult } = require("../src/main/services/session/gate");

function authError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}

test("isRegistryAuthFailure recognizes docker/registry auth shapes", () => {
  assert.equal(isRegistryAuthFailure(authError("unauthorized: authentication required")), true);
  assert.equal(isRegistryAuthFailure(authError("docker push failed: denied: requested access to the resource is denied")), true);
  assert.equal(isRegistryAuthFailure(authError("registry login failed", 401)), true);
  assert.equal(isRegistryAuthFailure({ status: 401, message: "nope" }), true);
  assert.equal(isRegistryAuthFailure(authError("missing .lugo/Dockerfile in the bot project", 400)), false);
  assert.equal(isRegistryAuthFailure(authError("permission denied reading project files")), false);
  assert.equal(isRegistryAuthFailure(null), false);
});

test("publishWithOtpLogin mints OTP login then pushes without a website password", async () => {
  const calls = [];
  const result = await publishWithOtpLogin({
    botUri: "ada/alpha",
    tag: "v1",
    loginWithOtp: async () => {
      calls.push({ type: "login" });
      return { ok: true, loggedIn: true, username: "ada@example.com" };
    },
    publishBot: async (payload) => {
      calls.push({ type: "publish", payload });
      return { status: "OK", image: "repo.lugobots.ai/ada/alpha:v1" };
    },
    actionResult,
  });

  assert.equal(result.ok, true);
  assert.equal(result.body.image, "repo.lugobots.ai/ada/alpha:v1");
  assert.deepEqual(calls, [
    { type: "login" },
    { type: "publish", payload: { botUri: "ada/alpha", tag: "v1" } },
  ]);
  // Orchestration never accepts or forwards a website password.
  assert.equal(JSON.stringify(calls).includes("password"), false);
  assert.equal(JSON.stringify(result).includes("password"), false);
});

test("publishWithOtpLogin returns OTP login failure and never publishes", async () => {
  const calls = [];
  const result = await publishWithOtpLogin({
    botUri: "ada/alpha",
    tag: "v1",
    loginWithOtp: async () => {
      calls.push("login");
      return { ok: false, error: "not_signed_in", status: 401 };
    },
    publishBot: async () => {
      calls.push("publish");
      return { status: "OK" };
    },
    actionResult,
  });

  assert.deepEqual(result, { ok: false, error: "not_signed_in", status: 401 });
  assert.deepEqual(calls, ["login"]);
});

test("publishWithOtpLogin silently remints, re-logins, and retries once on auth failure", async () => {
  const calls = [];
  let publishAttempts = 0;
  const result = await publishWithOtpLogin({
    botUri: "ada/alpha",
    tag: "v2",
    loginWithOtp: async () => {
      calls.push("login");
      return { ok: true, loggedIn: true, username: "ada@example.com" };
    },
    publishBot: async (payload) => {
      publishAttempts += 1;
      calls.push(`publish:${payload.tag}:${publishAttempts}`);
      if (publishAttempts === 1) {
        throw authError(
          "docker push failed: exit status 1: unauthorized: authentication required",
        );
      }
      return { status: "OK", image: "repo.lugobots.ai/ada/alpha:v2" };
    },
    actionResult,
  });

  assert.equal(result.ok, true);
  assert.equal(result.body.image, "repo.lugobots.ai/ada/alpha:v2");
  assert.deepEqual(calls, ["login", "publish:v2:1", "login", "publish:v2:2"]);
  assert.equal(JSON.stringify(calls).includes("password"), false);
});

test("publishWithOtpLogin does not retry non-auth publish failures", async () => {
  const calls = [];
  const result = await publishWithOtpLogin({
    botUri: "ada/alpha",
    tag: "v3",
    loginWithOtp: async () => {
      calls.push("login");
      return { ok: true };
    },
    publishBot: async () => {
      calls.push("publish");
      throw authError("missing .lugo/Dockerfile in the bot project", 400);
    },
    actionResult,
  });

  assert.deepEqual(result, {
    ok: false,
    error: "missing .lugo/Dockerfile in the bot project",
  });
  assert.deepEqual(calls, ["login", "publish"]);
});

test("publishWithOtpLogin surfaces second push failure after one recovery attempt", async () => {
  const calls = [];
  const result = await publishWithOtpLogin({
    botUri: "ada/alpha",
    tag: "v4",
    loginWithOtp: async () => {
      calls.push("login");
      return { ok: true };
    },
    publishBot: async () => {
      calls.push("publish");
      throw authError("denied: requested access to the resource is denied");
    },
    actionResult,
  });

  assert.deepEqual(result, {
    ok: false,
    error: "denied: requested access to the resource is denied",
  });
  assert.deepEqual(calls, ["login", "publish", "login", "publish"]);
});

test("publishWithOtpLogin returns relogin failure without a second push", async () => {
  const calls = [];
  let logins = 0;
  const result = await publishWithOtpLogin({
    botUri: "ada/alpha",
    tag: "v5",
    loginWithOtp: async () => {
      logins += 1;
      calls.push(`login:${logins}`);
      if (logins === 1) {
        return { ok: true };
      }
      return { ok: false, error: "registry_otp_failed" };
    },
    publishBot: async () => {
      calls.push("publish");
      throw authError("unauthorized: authentication required", 401);
    },
    actionResult,
  });

  assert.deepEqual(result, { ok: false, error: "registry_otp_failed" });
  assert.deepEqual(calls, ["login:1", "publish", "login:2"]);
});
