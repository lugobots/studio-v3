const { BrowserWindow, screen } = require("electron");
const path = require("node:path");
const config = require("../services/config");

const iconPath = path.join(__dirname, "../../../resources/favicon.png");

/** Match style-guide --bg-base for the active appearance (dark default). */
function backgroundForAppearance(appearance) {
  return appearance === "light" ? "#F4F7F5" : "#0F1412";
}

async function createAppWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  let appearance = "dark";
  try {
    const saved = await config.get();
    appearance = saved?.appearance === "light" ? "light" : "dark";
  } catch {
    appearance = "dark";
  }
  const win = new BrowserWindow({
    width,
    height,
    minWidth: 640,
    minHeight: 420,
    icon: iconPath,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: backgroundForAppearance(appearance),
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
