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

export function renderRoute(outlet) {
  const path = getPath();
  const render = routes.get(path) ?? routes.get("/loading");
  outlet.replaceChildren();
  render(outlet);
}

export function startRouter(outlet, options) {
  if (!window.location.hash) {
    window.location.hash = "#/loading";
  }

  const onChange = () => {
    const path = getPath();
    if (options && typeof options.onRoute === "function") {
      options.onRoute(path);
    }
    renderRoute(outlet);
  };
  window.addEventListener("hashchange", onChange);
  onChange();
}
