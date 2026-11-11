export const NOTICE_TTL_MS = 5000;

export function createDialogController(options = {}) {
  const now = options.now || (() => Date.now());
  const schedule = options.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const cancel = options.clearTimeout || ((id) => clearTimeout(id));

  let blocking = null;
  const notices = [];
  const timers = new Map();
  let nextId = 1;
  const listeners = new Set();

  function emit() {
    for (const listener of listeners) {
      listener();
    }
  }

  function clearNoticeTimer(id) {
    const timer = timers.get(id);
    if (timer != null) {
      cancel(timer);
      timers.delete(id);
    }
  }

  function dismiss(id) {
    clearNoticeTimer(id);
    const index = notices.findIndex((notice) => notice.id === id);
    if (index >= 0) {
      notices.splice(index, 1);
      emit();
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot() {
      return { blocking, notices: notices.slice() };
    },
    confirm(request) {
      if (blocking) {
        return Promise.reject(new Error("A dialog is already open"));
      }
      return new Promise((resolve) => {
        blocking = {
          kind: "confirm",
          title: request.title,
          body: request.body || "",
          confirmLabel: request.confirmLabel || "OK",
          cancelLabel: request.cancelLabel || "Cancel",
          resolve,
        };
        emit();
      });
    },
    busy(request = {}) {
      if (blocking?.kind === "confirm") {
        throw new Error("A dialog is already open");
      }
      blocking = {
        kind: "busy",
        title: request.title || "Please wait",
        body: request.body || "",
        percent: Number.isFinite(request.percent) ? request.percent : 0,
      };
      emit();
    },
    setBusyProgress(request = {}) {
      if (!blocking || blocking.kind !== "busy") {
        return;
      }
      if (request.title != null) {
        blocking.title = request.title;
      }
      if (request.body != null) {
        blocking.body = request.body;
      }
      if (Number.isFinite(request.percent)) {
        blocking.percent = Math.max(0, Math.min(100, request.percent));
      }
      emit();
    },
    clearBusy() {
      if (!blocking || blocking.kind !== "busy") {
        return;
      }
      blocking = null;
      emit();
    },
    notify(request) {
      const notice = {
        id: nextId,
        title: request.title,
        body: request.body || "",
        action: request.action || null,
        createdAt: now(),
        ttlMs: NOTICE_TTL_MS,
      };
      nextId += 1;
      notices.push(notice);
      timers.set(
        notice.id,
        schedule(() => {
          dismiss(notice.id);
        }, NOTICE_TTL_MS),
      );
      emit();
      return notice.id;
    },
    answer(confirmed) {
      if (!blocking || blocking.kind !== "confirm") {
        return;
      }
      const { resolve } = blocking;
      blocking = null;
      emit();
      resolve(Boolean(confirmed));
    },
    dismiss,
  };
}
