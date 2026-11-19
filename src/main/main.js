const { loadLocalEnv } = require("./load-env");
loadLocalEnv();

const { app, BrowserWindow, Menu } = require("electron");
const { createAppWindow } = require("./windows/app-window");
const { registerIpc } = require("./ipc/register");
const { registerContainerCleanupOnQuit } = require("./services/app-lifecycle");
const notifications = require("./services/notifications");
const docker = require("./services/docker");
const session = require("./services/session");
const updater = require("./services/updater");
const store = require("./services/config/store");
const telemetry = require("./services/telemetry");
const pkg = require("../../package.json");

function aptabaseAppKeyFromEnv() {
  return (
    process.env.STUDIO_APTABASE_APP_KEY ||
    process.env.APTABASE_APP_KEY ||
    process.env.APPTBASE_API_KEY ||
    ""
  );
}

/**
 * Aptabase requires initialize() before app.whenReady(). Read the Privacy
 * preference synchronously from user.json; gate sends in track(), not init.
 */
function bootstrapTelemetry() {
  const appKey = aptabaseAppKeyFromEnv();
  let enabled = true;
  try {
    const file = store.settingsFile(app.getPath("appData"), process.platform);
    enabled = store.telemetryEnabled(store.read(file).data);
  } catch {
    enabled = true;
  }
  telemetry.configure({
    appKey,
    enabled,
    appVersion: pkg.version,
  });
  telemetry.init();
}

function wireCrashTelemetry() {
  process.on("uncaughtException", (error) => {
    telemetry.trackError({
      source: "main",
      type: "uncaughtException",
      message: error?.message || String(error),
    });
  });
  process.on("unhandledRejection", (reason) => {
    const message =
      reason && typeof reason === "object" && "message" in reason
        ? reason.message
        : String(reason);
    telemetry.trackError({
      source: "main",
      type: "unhandledRejection",
      message,
    });
  });
  app.on("web-contents-created", (_event, contents) => {
    contents.on("render-process-gone", (_e, details) => {
      telemetry.trackError({
        source: "renderer",
        type: "render-process-gone",
        message: details?.reason || "gone",
      });
    });
  });
}

bootstrapTelemetry();
registerContainerCleanupOnQuit(app, async () => {
  telemetry.track("app_closed");
  await docker.stopContainer();
});
wireCrashTelemetry();

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  telemetry.track("app_started");

  registerIpc();
  const win = await createAppWindow();
  notifications.attach(win.webContents);
  docker.attach(win.webContents);
  session.attach(win.webContents);
  updater.watch(win);

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const next = await createAppWindow();
      notifications.attach(next.webContents);
      docker.attach(next.webContents);
      session.attach(next.webContents);
      updater.watch(next);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
