export function createShell() {
  const root = document.createElement("div");
  root.className = "shell";

  const outlet = document.createElement("div");
  outlet.className = "shell-outlet";
  outlet.id = "outlet";

  const overlayHost = document.createElement("div");
  overlayHost.className = "dialog-host";
  overlayHost.id = "dialog-host";

  const toastHost = document.createElement("div");
  toastHost.className = "toast-host";
  toastHost.id = "toast-host";
  toastHost.setAttribute("aria-live", "polite");
  toastHost.setAttribute("aria-relevant", "additions");
  toastHost.setAttribute("aria-atomic", "false");

  root.append(outlet, overlayHost, toastHost);
  return { root, outlet, overlayHost, toastHost };
}
