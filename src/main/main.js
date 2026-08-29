const { app, BrowserWindow } = require("electron");
const { createAppWindow } = require("./windows/app-window");
const { registerIpc } = require("./ipc/register");

app.whenReady().then(() => {
  registerIpc();
  createAppWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createAppWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
