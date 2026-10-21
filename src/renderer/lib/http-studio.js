export function createHttpStudio({
  baseUrl = "http://127.0.0.1:8081/api",
  fetchImpl = globalThis.fetch,
  storage = globalThis.localStorage,
} = {}) {
  const desktopOnly = () => ({
    ok: false,
    unsupported: true,
    error: "This action needs the Studio desktop app.",
  });

  async function request(pathname, options) {
    const response = await fetchImpl(`${baseUrl}${pathname}`, options);
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { message: text };
      }
    }
    if (!response.ok) {
      throw new Error((body && (body.message || body.error)) || `Studio API ${response.status}`);
    }
    return body;
  }

  function telemetryEnabled() {
    if (!storage) {
      return true;
    }
    const saved = storage.getItem("lugo-studio-telemetry");
    if (saved === null) {
      return true;
    }
    return saved !== "off";
  }

  return {
    host: "web",
    versions: { node: "", chrome: "", electron: "" },
    docker: {
      status: async () => desktopOnly(),
      pull: async () => desktopOnly(),
      onProgress: () => () => {},
    },
    config: {
      async get() {
        return {
          projectCreated: false,
          telemetryEnabled: telemetryEnabled(),
          telemetry_enabled: telemetryEnabled(),
          measurementId: "",
          appVersion: "web",
          app_version: "web",
        };
      },
      async set(patch) {
        if (storage && Object.prototype.hasOwnProperty.call(patch, "telemetry_enabled")) {
          storage.setItem("lugo-studio-telemetry", patch.telemetry_enabled === false ? "off" : "on");
        }
        return this.get();
      },
    },
    updates: {
      check: async () => desktopOnly(),
      apply: async () => desktopOnly(),
    },
    notifications: {
      show: async () => {},
      onEvent: () => () => {},
    },
    startup: {
      async next() {
        try {
          const body = await request("/studio/status");
          return { route: body.project_status === "ready" ? "/main" : "/start-project" };
        } catch {
          return { route: "/main" };
        }
      },
    },
    project: {
      pickFolder: async () => desktopOnly(),
      open: async () => desktopOnly(),
      create: async () => desktopOnly(),
    },
    match: {
      async start() {
        const body = await request("/game/start", { method: "POST" });
        return { ok: true, body };
      },
      async status() {
        const body = await request("/studio/status");
        return { ok: true, body };
      },
    },
    publish: {
      async bot({ botUri, tag }) {
        const body = new URLSearchParams({ bot_uri: botUri, tag });
        const result = await request("/bot/publish", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });
        return { ok: true, body: result };
      },
    },
  };
}
