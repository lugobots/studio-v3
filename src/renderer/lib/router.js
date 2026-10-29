const routes = new Map();

export function registerRoute(path, render) {
  routes.set(path, render);
}

export function getPath() {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash || hash === "/") {
    return "/loading";
  }
  return hash.startsWith("/") ? hash : `/${hash}`;
}

export function navigate(path) {
  const next = path.startsWith("/") ? path : `/${path}`;
  if (window.location.hash === `#${next}`) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return;
  }
  window.location.hash = next;
}

let cleanup = () => {};

export function renderRoute(outlet) {
  cleanup();
  cleanup = () => {};
  const path = getPath();
  const render = routes.get(path) ?? routes.get("/loading");
  outlet.replaceChildren();
  const stop = render(outlet);
  if (typeof stop === "function") {
    cleanup = stop;
  }
}

export function startRouter(outlet) {
  if (!window.location.hash) {
    window.location.hash = "#/loading";
  }

  const onChange = () => renderRoute(outlet);
  window.addEventListener("hashchange", onChange);
  onChange();
}
