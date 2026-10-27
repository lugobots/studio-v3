const { BrowserWindow, screen } = require("electron");
const path = require("node:path");

const iconPath = path.join(__dirname, "../../../resources/favicon.png");

function createAppWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width,
    height,
    minWidth: 640,
    minHeight: 420,
    icon: iconPath,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload imports the shared channel list. The sandboxed resolver
      // cannot load that module, which leaves the page without window.studio.
      sandbox: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });

  win.loadFile(path.join(__dirname, "../../renderer/index.html"));
  return win;
}

module.exports = { createAppWindow };
