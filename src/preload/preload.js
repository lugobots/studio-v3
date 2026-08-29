const { contextBridge, ipcRenderer } = require("electron");
const { CHANNELS } = require("../shared/ipc-channels");

contextBridge.exposeInMainWorld("studio", {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  docker: {
    status: () => ipcRenderer.invoke(CHANNELS.docker.status),
  },
  config: {
    get: () => ipcRenderer.invoke(CHANNELS.config.get),
    set: (patch) => ipcRenderer.invoke(CHANNELS.config.set, patch),
  },
  updates: {
    check: () => ipcRenderer.invoke(CHANNELS.updates.check),
  },
  notifications: {
    show: (payload) => ipcRenderer.invoke(CHANNELS.notifications.show, payload),
  },
});
