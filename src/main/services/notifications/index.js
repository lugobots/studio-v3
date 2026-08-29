"use strict";

const TITLE_MAX = 200;
const BODY_MAX = 500;

function sanitizeNotifyText(value, maxLen) {
  if (typeof value !== "string") {
    return "";
  }
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  const limit = Number.isFinite(maxLen) ? maxLen : TITLE_MAX;
  if (text.length <= limit) {
    return text;
  }
  return text.slice(0, limit).trim();
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const title = sanitizeNotifyText(payload.title, TITLE_MAX);
  if (!title) {
    return null;
  }
  const body = sanitizeNotifyText(payload.body, BODY_MAX);
  if (body) {
    return { title, body };
  }
  return { title };
}

function createNotificationService(options = {}) {
  const NotificationCtor = options.Notification;
  const isSupported =
    options.isSupported ||
    (() => {
      try {
        return !!(NotificationCtor && typeof NotificationCtor.isSupported === "function" && NotificationCtor.isSupported());
      } catch {
        return false;
      }
    });
  const broadcast = typeof options.broadcast === "function" ? options.broadcast : null;
  const icon = typeof options.icon === "string" && options.icon.length > 0 ? options.icon : null;

  function show(payload) {
    const normalized = normalizePayload(payload);
    if (!normalized) {
      return { shown: false, native: false };
    }

    let native = false;
    if (isSupported()) {
      try {
        const opts = {
          title: normalized.title,
          body: normalized.body || "",
        };
        if (icon) {
          opts.icon = icon;
        }
        const notification = new NotificationCtor(opts);
        if (notification && typeof notification.show === "function") {
          notification.show();
        }
        native = true;
      } catch {
        native = false;
      }
    }

    if (broadcast) {
      try {
        broadcast(normalized);
      } catch {
        // ignore
      }
    }

    return { shown: true, native };
  }

  return { show };
}

let service = null;

function getElectronService() {
  if (!service) {
    const path = require("node:path");
    const { Notification, BrowserWindow } = require("electron");
    const { CHANNELS } = require("../../shared/ipc-channels");
    const iconPath = path.join(__dirname, "../../../../resources/favicon.png");

    service = createNotificationService({
      Notification,
      isSupported: () => {
        try {
          return Notification.isSupported();
        } catch {
          return false;
        }
      },
      icon: iconPath,
      broadcast: (payload) => {
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
          if (!win || win.isDestroyed()) {
            continue;
          }
          try {
            win.webContents.send(CHANNELS.notifications.shown, payload);
          } catch {
            // ignore
          }
        }
      },
    });
  }
  return service;
}

function show(payload) {
  return getElectronService().show(payload);
}

module.exports = {
  show,
  createNotificationService,
  normalizePayload,
};
