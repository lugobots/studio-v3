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

  function actionResult(body) {
    if (body && body.implemented === false) {
      return {
        ok: false,
        error: "This action is not available in this Studio version yet.",
        body,
      };
    }
    return { ok: true, body };
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
          await request("/health");
          const body = await request("/studio/status");
          return { route: body.project_status === "ready" ? "/main" : "/start-project" };
        } catch (error) {
          return {
            route: "/api-error",
            message: error.message || "The Studio API is not available.",
          };
        }
      },
      async retry() {
        return this.next();
      },
      onRoute() {
        return () => {};
      },
    },
    project: {
      pickFolder: async () => desktopOnly(),
      open: async () => desktopOnly(),
      create: async () => desktopOnly(),
    },
    match: {
      async start() {
        try {
          return actionResult(await request("/game/start", { method: "POST" }));
        } catch (error) {
          return { ok: false, error: error.message };
        }
      },
      async status() {
        const body = await request("/studio/status");
        return { ok: true, body };
      },
    },
    publish: {
      async bot({ botUri, tag }) {
        const body = new URLSearchParams({ bot_uri: botUri, tag });
        try {
          return actionResult(await request("/bot/publish", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
          }));
        } catch (error) {
          return { ok: false, error: error.message };
        }
      },
    },
  };
}
