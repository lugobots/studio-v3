function statusWsUrl(baseUrl) {
  return `${baseUrl.replace(/^http/, "ws")}/server/status/ws`;
}

function parseStatusPayload(raw) {
  let data = raw;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") {
    return null;
  }
  return { running: Boolean(data.running) };
}

export function createHttpStudio({
  baseUrl = "http://127.0.0.1:8081/api",
  fetchImpl = globalThis.fetch,
  storage = globalThis.localStorage,
  WebSocketImpl = globalThis.WebSocket,
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
      async current() {
        return null;
      },
      onRoute() {
        return () => {};
      },
      onProgress() {
        return () => {};
      },
    },
    project: {
      pickFolder: async () => desktopOnly(),
      open: async () => desktopOnly(),
      create: async () => desktopOnly(),
      remove: async () => desktopOnly(),
    },
    server: {
      async start() {
        try {
          return actionResult(await request("/server/start", { method: "POST" }));
        } catch (error) {
          return { ok: false, error: error.message };
        }
      },
      async stop() {
        try {
          return actionResult(await request("/server/stop", { method: "POST" }));
        } catch (error) {
          return { ok: false, error: error.message };
        }
      },
      async status() {
        try {
          const body = await request("/server/status", { method: "GET" });
          return { ok: true, body };
        } catch (error) {
          return { ok: false, error: error.message };
        }
      },
      onStatus(callback) {
        if (typeof callback !== "function") {
          throw new TypeError("server.onStatus requires a callback");
        }
        if (typeof WebSocketImpl !== "function") {
          throw new Error("WebSocket is not available");
        }
        const ws = new WebSocketImpl(statusWsUrl(baseUrl));
        const handleMessage = (event) => {
          const status = parseStatusPayload(event && event.data);
          if (status) {
            callback(status);
          }
        };
        if (typeof ws.addEventListener === "function") {
          ws.addEventListener("message", handleMessage);
        } else {
          ws.onmessage = handleMessage;
        }
        return () => {
          if (typeof ws.removeEventListener === "function") {
            ws.removeEventListener("message", handleMessage);
          } else if (ws.onmessage === handleMessage) {
            ws.onmessage = null;
          }
          if (typeof ws.close === "function") {
            try {
              ws.close();
            } catch {
              // ignore close errors on teardown
            }
          }
        };
      },
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
