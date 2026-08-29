const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("studio", {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
});
