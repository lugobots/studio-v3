"use strict";

/**
 * Detect registry authentication failures from Studio API / docker push errors.
 * Publish failures are usually HTTP 500 with docker's "unauthorized" / "denied" text;
 * login failures use HTTP 401.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function isRegistryAuthFailure(error) {
  if (!error) {
    return false;
  }
  if (Number(error.status) === 401) {
    return true;
  }
  const text = String(error.message || error || "").toLowerCase();
  if (!text) {
    return false;
  }
  return (
    /\bunauthorized\b/.test(text) ||
    /authentication required/.test(text) ||
    /authori[sz]ation (?:failed|required)/.test(text) ||
    /denied:\s*requested access/.test(text) ||
    /invalid (?:username|password|credentials)/.test(text) ||
    /(?:docker )?login failed/.test(text) ||
    /\b401\b/.test(text)
  );
}

/**
 * Mint+login with Doorway OTP immediately before publish, then push.
 * On one registry auth failure during push: silent re-mint + re-login + retry.
 * Never asks for or uses a website account password.
 *
 * @param {{
 *   botUri: string,
 *   tag: string,
 *   loginWithOtp: () => Promise<{ ok: boolean, error?: string, status?: number }>,
 *   publishBot: (payload: { botUri: string, tag: string }) => Promise<unknown>,
 *   actionResult: (body: unknown) => { ok: boolean, error?: string, body?: unknown },
 * }} deps
 */
async function publishWithOtpLogin({ botUri, tag, loginWithOtp, publishBot, actionResult }) {
  const login = await loginWithOtp();
  if (!login || !login.ok) {
    return (
      login || {
        ok: false,
        error: "registry_otp_login_failed",
      }
    );
  }

  try {
    return actionResult(await publishBot({ botUri, tag }));
  } catch (firstError) {
    if (!isRegistryAuthFailure(firstError)) {
      return { ok: false, error: firstError.message || String(firstError) };
    }

    const relogin = await loginWithOtp();
    if (!relogin || !relogin.ok) {
      return (
        relogin || {
          ok: false,
          error: "registry_otp_login_failed",
        }
      );
    }

    try {
      return actionResult(await publishBot({ botUri, tag }));
    } catch (secondError) {
      return { ok: false, error: secondError.message || String(secondError) };
    }
  }
}

module.exports = {
  isRegistryAuthFailure,
  publishWithOtpLogin,
};
