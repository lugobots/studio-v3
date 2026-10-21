export function createDialogController() {
  let blocking = null;
  const notices = [];
  let nextId = 1;
  const listeners = new Set();

  function emit() {
    for (const listener of listeners) {
      listener();
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
          title: request.title,
          body: request.body || "",
          confirmLabel: request.confirmLabel || "OK",
          cancelLabel: request.cancelLabel || "Cancel",
          resolve,
        };
        emit();
      });
    },
    notify(request) {
      const notice = {
        id: nextId,
        title: request.title,
        body: request.body || "",
        action: request.action || null,
      };
      nextId += 1;
      notices.push(notice);
      emit();
      return notice.id;
    },
    answer(confirmed) {
      if (!blocking) {
        return;
      }
      const { resolve } = blocking;
      blocking = null;
      emit();
      resolve(Boolean(confirmed));
    },
    dismiss(id) {
      const index = notices.findIndex((notice) => notice.id === id);
      if (index >= 0) {
        notices.splice(index, 1);
        emit();
      }
    },
  };
}
