/**
 * Queue, keyboard, and progress-dismiss policy for in-app dialogs.
 * DOM stays in the shell layer; this module is unit-tested in Node.
 */

export const DIALOG_KIND = Object.freeze({
  CONFIRM: "confirm",
  ERROR: "error",
  PROGRESS: "progress",
});

export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function asDialogText(value, fallback = "") {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return fallback;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

export function isDeterminateProgress(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function normalizeProgress(value) {
  return isDeterminateProgress(value) ? value : null;
}

export function canEscapeDismiss(kind, options = {}) {
  if (kind === DIALOG_KIND.CONFIRM || kind === DIALOG_KIND.ERROR) {
    return true;
  }
  if (kind === DIALOG_KIND.PROGRESS) {
    return options.hasCancelHandler === true;
  }
  return false;
}

export function canBackdropDismiss(kind) {
  return kind === DIALOG_KIND.CONFIRM || kind === DIALOG_KIND.ERROR;
}

export function escapeAction(kind, options = {}) {
  if (!canEscapeDismiss(kind, options)) {
    return null;
  }
  if (kind === DIALOG_KIND.CONFIRM || kind === DIALOG_KIND.PROGRESS) {
    return "cancel";
  }
  if (kind === DIALOG_KIND.ERROR) {
    return "dismiss";
  }
  return null;
}

export function backdropAction(kind) {
  if (!canBackdropDismiss(kind)) {
    return null;
  }
  if (kind === DIALOG_KIND.CONFIRM) {
    return "cancel";
  }
  if (kind === DIALOG_KIND.ERROR) {
    return "dismiss";
  }
  return null;
}

export function nextFocusIndex(currentIndex, count, shiftKey) {
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }
  if (!Number.isFinite(currentIndex) || currentIndex < 0) {
    return shiftKey ? count - 1 : 0;
  }
  if (shiftKey) {
    return currentIndex <= 0 ? count - 1 : currentIndex - 1;
  }
  return currentIndex >= count - 1 ? 0 : currentIndex + 1;
}

function makeItem(kind, fields, resolve) {
  return {
    id: fields.id,
    kind,
    title: asDialogText(fields.title),
    body: asDialogText(fields.body),
    detail: asDialogText(fields.detail),
    progress: normalizeProgress(fields.progress),
    primaryLabel: asDialogText(fields.primaryLabel, "OK") || "OK",
    secondaryLabel: asDialogText(fields.secondaryLabel, "Cancel") || "Cancel",
    dismissLabel: asDialogText(fields.dismissLabel, "OK") || "OK",
    cancelLabel: asDialogText(fields.cancelLabel, "Cancel") || "Cancel",
    hasCancelHandler: typeof fields.onCancel === "function",
    onCancel: typeof fields.onCancel === "function" ? fields.onCancel : null,
    resolve,
    settled: false,
  };
}

/**
 * FIFO session: one visible dialog, later requests wait (so an update confirm
 * is not lost behind a folder error).
 */
export function createDialogSession() {
  const pending = [];
  const listeners = new Set();
  let current = null;
  let nextId = 1;

  function emit() {
    for (const listener of listeners) {
      try {
        listener(current);
      } catch {
        // ignore listener errors
      }
    }
  }

  function pump() {
    if (current || pending.length === 0) {
      return;
    }
    current = pending.shift();
  }

  function settleCurrent(action) {
    if (!current || current.settled) {
      return null;
    }
    const item = current;
    item.settled = true;
    current = null;

    if (action === "cancel" && item.kind === DIALOG_KIND.PROGRESS && typeof item.onCancel === "function") {
      try {
        item.onCancel();
      } catch {
        // ignore
      }
    }

    if (typeof item.resolve === "function") {
      if (item.kind === DIALOG_KIND.CONFIRM) {
        item.resolve(action === "accept");
      } else if (item.kind === DIALOG_KIND.ERROR) {
        item.resolve();
      } else {
        item.resolve(action);
      }
    }

    pump();
    emit();
    return item;
  }

  function enqueue(item) {
    pending.push(item);
    if (!current) {
      pump();
      emit();
    }
    return item;
  }

  function requestConfirm(options = {}) {
    return new Promise((resolve) => {
      enqueue(
        makeItem(
          DIALOG_KIND.CONFIRM,
          {
            id: `dialog-${nextId++}`,
            title: options.title,
            body: options.body,
            primaryLabel: options.primaryLabel,
            secondaryLabel: options.secondaryLabel,
          },
          resolve,
        ),
      );
    });
  }

  function requestError(options = {}) {
    return new Promise((resolve) => {
      enqueue(
        makeItem(
          DIALOG_KIND.ERROR,
          {
            id: `dialog-${nextId++}`,
            title: options.title,
            body: options.body,
            dismissLabel: options.dismissLabel,
          },
          resolve,
        ),
      );
    });
  }

  function requestProgress(options = {}) {
    let resolveClose = () => {};
    const closed = new Promise((resolve) => {
      resolveClose = resolve;
    });
    const item = makeItem(
      DIALOG_KIND.PROGRESS,
      {
        id: `dialog-${nextId++}`,
        title: options.title,
        detail: options.detail,
        progress: options.progress,
        onCancel: options.onCancel,
        cancelLabel: options.cancelLabel,
      },
      resolveClose,
    );
    enqueue(item);

    return {
      update(patch) {
        if (item.settled || !patch || typeof patch !== "object") {
          return;
        }
        if ("detail" in patch) {
          item.detail = asDialogText(patch.detail);
        }
        if ("progress" in patch) {
          item.progress = normalizeProgress(patch.progress);
        }
        if (current === item) {
          emit();
        }
      },
      close() {
        if (item.settled) {
          return;
        }
        if (current === item) {
          settleCurrent("close");
          return;
        }
        const index = pending.indexOf(item);
        if (index >= 0) {
          pending.splice(index, 1);
        }
        item.settled = true;
        item.resolve("close");
      },
      closed,
    };
  }

  function handleEscape() {
    if (!current) {
      return null;
    }
    const action = escapeAction(current.kind, { hasCancelHandler: current.hasCancelHandler === true });
    if (!action) {
      return null;
    }
    return settleCurrent(action);
  }

  function handleBackdrop() {
    if (!current) {
      return null;
    }
    const action = backdropAction(current.kind);
    if (!action) {
      return null;
    }
    return settleCurrent(action);
  }

  function handlePrimary() {
    if (!current || current.kind !== DIALOG_KIND.CONFIRM) {
      return null;
    }
    return settleCurrent("accept");
  }

  function handleSecondary() {
    if (!current) {
      return null;
    }
    if (current.kind === DIALOG_KIND.CONFIRM) {
      return settleCurrent("cancel");
    }
    if (current.kind === DIALOG_KIND.ERROR) {
      return settleCurrent("dismiss");
    }
    if (current.kind === DIALOG_KIND.PROGRESS && current.hasCancelHandler) {
      return settleCurrent("cancel");
    }
    return null;
  }

  function subscribe(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    requestConfirm,
    requestError,
    requestProgress,
    handleEscape,
    handleBackdrop,
    handlePrimary,
    handleSecondary,
    getCurrent: () => current,
    getPendingCount: () => pending.length,
    subscribe,
  };
}
