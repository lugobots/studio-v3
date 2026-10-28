"use strict";

async function openBot({ folder, check, remember, stop, start, watch }) {
  const compatibility = check(folder);
  if (!compatibility.ok) {
    return { ok: false, error: compatibility.error };
  }
  const saved = await remember(folder);
  await stop();
  const started = await start(folder);
  if (!started || started.ok === false) {
    return { ok: false, error: (started && started.error) || "Could not start the Studio container." };
  }
  watch(folder, "/main");
  return { ok: true, config: saved, route: "/api-loading" };
}

module.exports = { openBot };
