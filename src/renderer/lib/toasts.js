/**
 * In-app toasts. Auto-hide; never steal focus from dialogs.
 * Shown for every `notifications.show` (renderer or main) via preload `onShow`.
 */

import { createToastElement } from "../components/toast.js";
import { TOAST_DURATION_MS, TOAST_MAX_VISIBLE, capToastList } from "./toast-policy.mjs";

export function mountToasts(toastHost) {
  const items = [];

  function retire(item) {
    if (!item) {
      return;
    }
    if (item.timer != null) {
      clearTimeout(item.timer);
      item.timer = null;
    }
    if (item.el && item.el.remove) {
      item.el.remove();
    }
  }

  function show(payload) {
    const title = payload && typeof payload.title === "string" ? payload.title.trim() : "";
    if (!title) {
      return;
    }
    const item = {
      id: `toast-${Date.now()}-${items.length}`,
      el: createToastElement({ title, body: payload.body }),
      timer: null,
    };
    const keptIds = capToastList(
      items.map((entry) => entry.id),
      item.id,
      TOAST_MAX_VISIBLE,
    );
    while (items.length > 0 && !keptIds.includes(items[0].id)) {
      retire(items.shift());
    }
    items.push(item);
    toastHost.append(item.el);
    item.timer = setTimeout(() => {
      const index = items.indexOf(item);
      if (index >= 0) {
        items.splice(index, 1);
      }
      retire(item);
    }, TOAST_DURATION_MS);
  }

  return { show };
}
