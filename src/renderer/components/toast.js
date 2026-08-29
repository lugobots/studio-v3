import { asDialogText } from "../lib/dialog-policy.mjs";

/** Toast DOM only. Never focused; title/body are textContent. */
export function createToastElement(payload) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");

  const title = document.createElement("p");
  title.className = "toast-title";
  title.textContent = asDialogText(payload && payload.title);

  toast.append(title);

  const bodyText = asDialogText(payload && payload.body);
  if (bodyText) {
    const body = document.createElement("p");
    body.className = "toast-body";
    body.textContent = bodyText;
    toast.append(body);
  }

  return toast;
}
