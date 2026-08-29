/**
 * Background update prompt. Subscribe from app bootstrap so the confirm is
 * not tied to `/main`. Does not block Docker / Q1 / Q2.
 */

import { studio } from "./api.js";
import { dialogs } from "./dialogs.js";

function progressDetail(fileName, received, total) {
  const name = fileName || "Downloading…";
  if (Number.isFinite(total) && total > 0 && Number.isFinite(received)) {
    return `${name} (${received} / ${total} bytes)`;
  }
  return name;
}

async function runUpdatePrompt(api, dialogApi) {
  let info;
  try {
    info = await api.updates.check();
  } catch {
    return;
  }
  if (!info || info.available !== true) {
    return;
  }

  const versionLabel = info.version ? `Studio ${info.version}` : "A newer Studio version";
  const accepted = await dialogApi.confirm({
    title: "Update available",
    body: `${versionLabel} is available. Download it now? Studio will not install or restart.`,
    primaryLabel: "Download",
    secondaryLabel: "Not now",
  });
  if (!accepted) {
    return;
  }

  let progress = null;
  const unsub =
    api.updates && typeof api.updates.onProgress === "function"
      ? api.updates.onProgress((payload) => {
          if (!payload || !progress) {
            return;
          }
          const total = Number.isFinite(payload.totalBytes) ? payload.totalBytes : info.sizeBytes;
          const received = Number.isFinite(payload.receivedBytes) ? payload.receivedBytes : 0;
          const ratio = Number.isFinite(total) && total > 0 ? received / total : null;
          progress.update({
            progress: ratio,
            detail: progressDetail(payload.fileName || info.fileName, received, total),
          });
        })
      : () => {};

  progress = dialogApi.progress({
    title: "Downloading update",
    detail: progressDetail(info.fileName, 0, info.sizeBytes),
    progress: Number.isFinite(info.sizeBytes) && info.sizeBytes > 0 ? 0 : null,
    cancelLabel: "Cancel",
    onCancel: () => {
      if (api.updates && typeof api.updates.cancel === "function") {
        void api.updates.cancel();
      }
    },
  });

  try {
    const result = await api.updates.download(info);
    progress.close();
    if (result && result.cancelled) {
      return;
    }
    if (!result || result.ok !== true) {
      await dialogApi.error({
        title: "Download failed",
        body: (result && result.error) || "Could not download the update.",
      });
      return;
    }
    if (result.path && api.notifications && typeof api.notifications.show === "function") {
      await api.notifications.show({
        title: "Update downloaded",
        body: result.path,
      });
    }
  } catch (err) {
    progress.close();
    await dialogApi.error({
      title: "Download failed",
      body: err && err.message ? String(err.message) : "Could not download the update.",
    });
  } finally {
    unsub();
  }
}

export function startUpdatePrompt(options = {}) {
  const api = options.studio || studio;
  const dialogApi = options.dialogs || dialogs;
  if (!api || !api.updates || typeof api.updates.check !== "function") {
    return;
  }
  void runUpdatePrompt(api, dialogApi).catch(() => {});
}
