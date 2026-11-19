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

test("publishWithOtpLogin mints OTP then publishes with email+otp (no docker login)", async () => {
  const calls = [];
  const result = await publishWithOtpLogin({
    botUri: "ada/alpha",
    tag: "v1",
    mintCredentials: async () => {
      calls.push({ type: "mint" });
      return { ok: true, email: "ada@example.com", otp: "otp-plain-1", expires_in: 60 };
    },
    publishBot: async (payload) => {
      calls.push({ type: "publish", payload: { ...payload } });
      return { status: "OK", image: "repo.lugobots.ai/ada/alpha:v1" };
    },
    actionResult,
  });

  assert.equal(result.ok, true);
  assert.equal(result.body.image, "repo.lugobots.ai/ada/alpha:v1");
  assert.deepEqual(calls, [
    { type: "mint" },
    {
      type: "publish",
      payload: {
        botUri: "ada/alpha",
        tag: "v1",
        username: "ada@example.com",
        password: "otp-plain-1",
      },
    },
  ]);
});

test("publishWithOtpLogin returns OTP mint failure and never publishes", async () => {
  const calls = [];
  const result = await publishWithOtpLogin({
    botUri: "ada/alpha",
    tag: "v1",
    mintCredentials: async () => {
      calls.push("mint");
      return { ok: false, error: "not_signed_in", status: 401 };
    },
    publishBot: async () => {
      calls.push("publish");
      return { status: "OK" };
    },
    actionResult,
  });

  assert.deepEqual(result, { ok: false, error: "not_signed_in", status: 401 });
  assert.deepEqual(calls, ["mint"]);
});

test("publishWithOtpLogin silently remints and retries once on auth failure", async () => {
  const calls = [];
  let publishAttempts = 0;
  let mintAttempts = 0;
  const result = await publishWithOtpLogin({
    botUri: "ada/alpha",
    tag: "v2",
    mintCredentials: async () => {
      mintAttempts += 1;
      calls.push(`mint:${mintAttempts}`);
      return {
        ok: true,
        email: "ada@example.com",
        otp: `otp-${mintAttempts}`,
        expires_in: 60,
      };
    },
    publishBot: async (payload) => {
      publishAttempts += 1;
      calls.push(`publish:${payload.tag}:${publishAttempts}:${payload.password}`);
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
  assert.deepEqual(calls, [
    "mint:1",
    "publish:v2:1:otp-1",
    "mint:2",
    "publish:v2:2:otp-2",
  ]);
});

test("publishWithOtpLogin does not retry non-auth publish failures", async () => {
  const calls = [];
  const result = await publishWithOtpLogin({
    botUri: "ada/alpha",
    tag: "v3",
    mintCredentials: async () => {
      calls.push("mint");
      return { ok: true, email: "ada@example.com", otp: "otp" };
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
  assert.deepEqual(calls, ["mint", "publish"]);
});

test("publishWithOtpLogin surfaces second push failure after one recovery attempt", async () => {
  const calls = [];
  const result = await publishWithOtpLogin({
    botUri: "ada/alpha",
    tag: "v4",
    mintCredentials: async () => {
      calls.push("mint");
      return { ok: true, email: "ada@example.com", otp: "otp" };
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
  assert.deepEqual(calls, ["mint", "publish", "mint", "publish"]);
});

test("publishWithOtpLogin returns remint failure without a second push", async () => {
  const calls = [];
  let mints = 0;
  const result = await publishWithOtpLogin({
    botUri: "ada/alpha",
    tag: "v5",
    mintCredentials: async () => {
      mints += 1;
      calls.push(`mint:${mints}`);
      if (mints === 1) {
        return { ok: true, email: "ada@example.com", otp: "otp" };
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
  assert.deepEqual(calls, ["mint:1", "publish", "mint:2"]);
});
