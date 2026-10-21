import { createDialogController } from "./dialog-controller.js";

export const dialogs = createDialogController();

function button(label, className) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  return element;
}

export function mountDialogs(documentRef, controller = dialogs, onAction) {
  const backdrop = documentRef.createElement("div");
  const stack = documentRef.createElement("div");
  stack.className = "notice-stack";
  documentRef.body.append(backdrop, stack);

  function paint() {
    const { blocking, notices } = controller.snapshot();
    backdrop.replaceChildren();
    stack.replaceChildren();
    const frame = documentRef.querySelector(".app-frame");
    if (frame) {
      frame.inert = Boolean(blocking);
    }

    if (blocking) {
      backdrop.className = "dialog-backdrop";
      const card = documentRef.createElement("section");
      card.className = "dialog-card";
      card.setAttribute("role", "alertdialog");
      card.setAttribute("aria-modal", "true");
      const title = documentRef.createElement("h2");
      title.textContent = blocking.title;
      const body = documentRef.createElement("p");
      body.textContent = blocking.body;
      const actions = documentRef.createElement("div");
      actions.className = "dialog-actions";
      const cancel = button(blocking.cancelLabel, "button");
      cancel.addEventListener("click", () => controller.answer(false));
      const confirm = button(blocking.confirmLabel, "button button-primary");
      confirm.addEventListener("click", () => controller.answer(true));
      actions.append(cancel, confirm);
      card.append(title, body, actions);
      backdrop.append(card);
    } else {
      backdrop.className = "dialog-backdrop dialog-backdrop-hidden";
    }

    for (const notice of notices) {
      const item = documentRef.createElement("section");
      item.className = "notice";
      const title = documentRef.createElement("strong");
      title.textContent = notice.title;
      const body = documentRef.createElement("p");
      body.textContent = notice.body;
      item.append(title, body);
      if (notice.action && onAction) {
        const action = button("Review", "button");
        action.addEventListener("click", () => {
          controller.dismiss(notice.id);
          onAction(notice.action);
        });
        item.append(action);
      }
      const close = button("Dismiss", "button");
      close.addEventListener("click", () => controller.dismiss(notice.id));
      item.append(close);
      stack.append(item);
    }
  }

  controller.subscribe(paint);
  paint();
}

export async function reportResult(controller, result) {
  if (result && result.ok) {
    return result;
  }
  if (result && result.declined) {
    return result;
  }
  await controller.confirm({
    title: "Something went wrong",
    body: (result && result.error) || "The action failed.",
    confirmLabel: "Close",
    cancelLabel: "Close",
  });
  return result;
}
