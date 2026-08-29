const { app, BrowserWindow } = require("electron");
const { createAppWindow } = require("./windows/app-window");
const { registerIpc } = require("./ipc/register");
const docker = require("./services/docker");

app.whenReady().then(() => {
  registerIpc();
  createAppWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createAppWindow();
    }
  });
});

app.on("before-quit", () => {
  docker.detachActivePull();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
