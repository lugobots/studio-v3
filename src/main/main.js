const { app, BrowserWindow, Menu } = require("electron");
const { createAppWindow } = require("./windows/app-window");
const { registerIpc } = require("./ipc/register");
const { registerContainerCleanupOnQuit } = require("./services/app-lifecycle");
const notifications = require("./services/notifications");
const docker = require("./services/docker");
const session = require("./services/session");
const updater = require("./services/updater");

registerContainerCleanupOnQuit(app, () => docker.stopContainer());

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpc();
  const win = createAppWindow();
  notifications.attach(win.webContents);
  docker.attach(win.webContents);
  session.attach(win.webContents);
  updater.watch(win);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const next = createAppWindow();
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
