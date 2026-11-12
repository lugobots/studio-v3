import { createDialogController } from "./dialog-controller.js";

export const dialogs = createDialogController();

function button(label, className) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  return element;
}

function renderBusyProgress(documentRef, blocking) {
  const percent = Number.isFinite(blocking.percent) ? blocking.percent : 0;
  const track = documentRef.createElement("div");
  track.className = "dialog-progress";
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  track.setAttribute("aria-valuenow", String(percent));
  track.setAttribute("aria-valuetext", `${percent}%`);
  const fill = documentRef.createElement("div");
  fill.className = "dialog-progress-fill";
  fill.style.width = `${percent}%`;
  track.append(fill);
  const label = documentRef.createElement("p");
  label.className = "dialog-progress-label";
  label.textContent = `${percent}%`;
  return { track, label };
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
      card.className =
        blocking.kind === "busy" ? "dialog-card dialog-card-busy" : "dialog-card";
      card.setAttribute("role", "alertdialog");
      card.setAttribute("aria-modal", "true");
      const title = documentRef.createElement("h2");
      title.textContent = blocking.title;
      const body = documentRef.createElement("p");
      body.textContent = blocking.body;
      card.append(title, body);
      if (blocking.kind === "busy") {
        const { track, label } = renderBusyProgress(documentRef, blocking);
        card.append(track, label);
      } else {
        let input = null;
        if (blocking.kind === "prompt") {
          input = documentRef.createElement("input");
          input.type = "text";
          input.className = "dialog-input";
          input.setAttribute("aria-label", blocking.title || "Value");
          input.value = typeof blocking.value === "string" ? blocking.value : "";
          input.addEventListener("input", () => {
            blocking.value = input.value;
          });
          input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              blocking.value = input.value;
              controller.answer(true);
            }
          });
          card.append(input);
        }
        const actions = documentRef.createElement("div");
        actions.className = "dialog-actions";
        const cancel = button(blocking.cancelLabel, "button");
        cancel.addEventListener("click", () => controller.answer(false));
        const confirm = button(blocking.confirmLabel, "button button-primary");
        confirm.addEventListener("click", () => {
          if (input) {
            blocking.value = input.value;
          }
          controller.answer(true);
        });
        actions.append(cancel, confirm);
        card.append(actions);
        if (input && typeof input.focus === "function") {
          queueMicrotask(() => input.focus());
        }
      }
      backdrop.append(card);
    } else {
      backdrop.className = "dialog-backdrop dialog-backdrop-hidden";
    }

    for (const notice of notices) {
      const item = documentRef.createElement("section");
      item.className = "notice";
      item.dataset.noticeId = String(notice.id);
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
      const progress = documentRef.createElement("div");
      progress.className = "notice-progress";
      progress.setAttribute("aria-hidden", "true");
      item.append(progress);
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
