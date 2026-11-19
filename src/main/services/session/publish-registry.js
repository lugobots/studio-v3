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
 * Mint a Doorway OTP, then publish with email+OTP as Docker Basic credentials.
 *
 * Important: do NOT call `docker login` first. Login consumes a single-use OTP;
 * `docker push` re-sends the stored password and would fail with
 * "unauthorized: invalid auth credentials". Instead the API writes credentials
 * after build and only contacts Porteiro during push.
 *
 * On one registry auth failure: silent remint + retry publish once.
 *
 * @param {{
 *   botUri: string,
 *   tag: string,
 *   mintCredentials: () => Promise<{
 *     ok: boolean,
 *     email?: string,
 *     otp?: string,
 *     error?: string,
 *     status?: number,
 *   }>,
 *   publishBot: (payload: {
 *     botUri: string,
 *     tag: string,
 *     username: string,
 *     password: string,
 *   }) => Promise<unknown>,
 *   actionResult: (body: unknown) => { ok: boolean, error?: string, body?: unknown },
 * }} deps
 */
async function publishWithOtpLogin({ botUri, tag, mintCredentials, publishBot, actionResult }) {
  async function mintAndPublish() {
    const creds = await mintCredentials();
    if (!creds || !creds.ok) {
      return (
        creds || {
          ok: false,
          error: "registry_otp_login_failed",
        }
      );
    }
    try {
      return actionResult(
        await publishBot({
          botUri,
          tag,
          username: creds.email,
          password: creds.otp,
        }),
      );
    } finally {
      if (creds) {
        creds.otp = "";
      }
    }
  }

  try {
    return await mintAndPublish();
  } catch (firstError) {
    if (!isRegistryAuthFailure(firstError)) {
      return { ok: false, error: firstError.message || String(firstError) };
    }
    try {
      return await mintAndPublish();
    } catch (secondError) {
      return { ok: false, error: secondError.message || String(secondError) };
    }
  }
}

module.exports = {
  isRegistryAuthFailure,
  publishWithOtpLogin,
};
