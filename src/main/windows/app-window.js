const { BrowserWindow, shell } = require("electron");
const path = require("node:path");

const iconPath = path.join(__dirname, "../../../resources/favicon.png");

function createAppWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 640,
    minHeight: 420,
    icon: iconPath,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });

  win.webContents.setWindowOpenHandler((details) => {
    try {
      const parsed = new URL(details.url);
      if (parsed.protocol === "https:") {
        shell.openExternal(details.url).catch(() => {});
      }
    } catch {
      // Ignore invalid URLs; never open a new Electron window.
    }
    return { action: "deny" };
  });

  win.loadFile(path.join(__dirname, "../../renderer/index.html"));
  return win;
}

module.exports = { createAppWindow };
