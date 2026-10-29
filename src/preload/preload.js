const { contextBridge, ipcRenderer } = require("electron");
const { CHANNELS } = require("../shared/ipc-channels");

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("studio", {
  host: "desktop",
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  docker: {
    status: () => ipcRenderer.invoke(CHANNELS.docker.status),
    pull: () => ipcRenderer.invoke(CHANNELS.docker.pull),
    onProgress: (callback) => subscribe(CHANNELS.docker.progress, callback),
  },
  config: {
    get: () => ipcRenderer.invoke(CHANNELS.config.get),
    set: (patch) => ipcRenderer.invoke(CHANNELS.config.set, patch),
  },
  updates: {
    check: () => ipcRenderer.invoke(CHANNELS.updates.check),
    apply: () => ipcRenderer.invoke(CHANNELS.updates.apply),
  },
  notifications: {
    show: (payload) => ipcRenderer.invoke(CHANNELS.notifications.show, payload),
    onEvent: (callback) => subscribe(CHANNELS.notifications.event, callback),
  },
  startup: {
    next: () => ipcRenderer.invoke(CHANNELS.startup.next),
    retry: () => ipcRenderer.invoke(CHANNELS.startup.retry),
    current: () => ipcRenderer.invoke(CHANNELS.startup.current),
    onRoute: (callback) => subscribe(CHANNELS.startup.route, callback),
    onProgress: (callback) => subscribe(CHANNELS.startup.progress, callback),
  },
  project: {
    pickFolder: () => ipcRenderer.invoke(CHANNELS.project.pickFolder),
    open: (folder) => ipcRenderer.invoke(CHANNELS.project.open, folder),
    create: (payload) => ipcRenderer.invoke(CHANNELS.project.create, payload),
    remove: (folder) => ipcRenderer.invoke(CHANNELS.project.remove, folder),
  },
  match: {
    start: () => ipcRenderer.invoke(CHANNELS.match.start),
    status: () => ipcRenderer.invoke(CHANNELS.match.status),
  },
  publish: {
    bot: (payload) => ipcRenderer.invoke(CHANNELS.publish.bot, payload),
  },
});
