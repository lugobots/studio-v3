const { BrowserWindow } = require("electron");
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

  win.loadFile(path.join(__dirname, "../../renderer/index.html"));
  return win;
}

module.exports = { createAppWindow };
