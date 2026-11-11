const CONFIRM = {
  title: "Upgrade Studio?",
  body: "Studio will close after the update package for this system starts.",
  confirmLabel: "Upgrade",
  cancelLabel: "Not now",
};

export async function runAcceptedUpgrade(host, dialogs) {
  if (typeof host?.updates?.apply !== "function") {
    return { ok: false, error: "Updates are not available in this host." };
  }

  dialogs.busy({
    title: "Downloading update",
    body: "Please wait while Studio downloads and verifies the new version.",
    percent: 0,
  });

  const stop =
    typeof host.updates.onProgress === "function"
      ? host.updates.onProgress((progress) => {
          dialogs.setBusyProgress({
            title: progress?.label || "Downloading update",
            body: progress?.detail || "",
            percent: Number(progress?.percent) || 0,
          });
        })
      : () => {};

  try {
    return await host.updates.apply();
  } finally {
    stop();
    dialogs.clearBusy();
  }
}

export async function offerUpgrade(host, dialogs) {
  const accepted = await dialogs.confirm(CONFIRM);
  if (!accepted) {
    return { ok: false, declined: true };
  }
  return runAcceptedUpgrade(host, dialogs);
}
