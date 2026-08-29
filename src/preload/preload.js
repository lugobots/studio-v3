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
    imageStatus: () => ipcRenderer.invoke(CHANNELS.docker.imageStatus),
    ensureImage: () => ipcRenderer.invoke(CHANNELS.docker.imageEnsure),
    onImageProgress: (listener) => {
      if (typeof listener !== "function") {
        return () => {};
      }
      const wrapped = (_event, payload) => {
        listener(payload);
      };
      ipcRenderer.on(CHANNELS.docker.imageProgress, wrapped);
      return () => {
        ipcRenderer.removeListener(CHANNELS.docker.imageProgress, wrapped);
      };
    },
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
    onShow: (listener) => {
      if (typeof listener !== "function") {
        return () => {};
      }
      const wrapped = (_event, payload) => {
        listener(payload);
      };
      ipcRenderer.on(CHANNELS.notifications.shown, wrapped);
      return () => {
        ipcRenderer.removeListener(CHANNELS.notifications.shown, wrapped);
      };
    },
  },
});
