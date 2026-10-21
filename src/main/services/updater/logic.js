"use strict";

function parseSemver(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(version || ""));
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(latest, current) {
  const left = parseSemver(latest);
  const right = parseSemver(current);
  if (!left || !right) {
    return 0;
  }
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) {
      return 1;
    }
    if (left[index] < right[index]) {
      return -1;
    }
  }
  return 0;
}

function interpret(body, current) {
  if (!body || typeof body.version !== "string") {
    return { state: "error", message: "Doorway returned an unusable version check" };
  }
  if (body.newer === true && compareSemver(body.version, current) === 1) {
    return {
      state: "newer",
      version: body.version,
      artifact: body.artifact,
    };
  }
  return { state: "current", version: body.version };
}

function noticeFor(result) {
  if (result.state === "newer") {
    return {
      mode: "notify",
      title: "Update available",
      body: `Version ${result.version} is ready to download.`,
      action: "upgrade",
    };
  }
  if (result.state === "error") {
    return {
      mode: "notify",
      title: "Update check failed",
      body: result.message || "Doorway could not be reached",
    };
  }
  return null;
}

function launch(file, platform, spawnImpl) {
  if (platform !== "win32") {
    return Promise.resolve({
      ok: false,
      error: "The downloaded build is a Windows installer and was not launched on this system.",
    });
  }
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(file, [], { detached: true, stdio: "ignore" });
    } catch (error) {
      resolve({ ok: false, error: error.message });
      return;
    }
    child.once("error", (error) => {
      resolve({ ok: false, error: error.message || "The installer did not start" });
    });
    child.once("spawn", () => {
      child.unref();
      resolve({ ok: true, file });
    });
  });
}

async function confirmUpgrade(confirm, apply) {
  const accepted = await confirm({
    title: "Upgrade Studio?",
    body: "Studio will close after the Windows installer starts.",
    confirmLabel: "Upgrade",
    cancelLabel: "Not now",
  });
  if (!accepted) {
    return { ok: false, declined: true };
  }
  return apply();
}

module.exports = { parseSemver, compareSemver, interpret, noticeFor, confirmUpgrade, launch };
