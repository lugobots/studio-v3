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
    ensureEditor: () => ipcRenderer.invoke(CHANNELS.docker.ensureEditor),
    stopEditor: () => ipcRenderer.invoke(CHANNELS.docker.stopEditor),
    onProgress: (callback) => subscribe(CHANNELS.docker.progress, callback),
  },
  config: {
    get: () => ipcRenderer.invoke(CHANNELS.config.get),
    set: (patch) => ipcRenderer.invoke(CHANNELS.config.set, patch),
    matchGet: () => ipcRenderer.invoke(CHANNELS.config.matchGet),
    matchSet: (patch) => ipcRenderer.invoke(CHANNELS.config.matchSet, patch),
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
  server: {
    start: (settings) => ipcRenderer.invoke(CHANNELS.server.start, settings),
    stop: () => ipcRenderer.invoke(CHANNELS.server.stop),
    status: () => ipcRenderer.invoke(CHANNELS.server.status),
    onStatus: (callback) => {
      const unsubscribe = subscribe(CHANNELS.server.statusEvent, callback);
      void ipcRenderer.invoke(CHANNELS.server.watchStatus);
      return unsubscribe;
    },
  },
  match: {
    start: (payload) => ipcRenderer.invoke(CHANNELS.match.start, payload),
    status: () => ipcRenderer.invoke(CHANNELS.match.status),
    reset: () => ipcRenderer.invoke(CHANNELS.match.reset),
    getPositions: () => ipcRenderer.invoke(CHANNELS.match.getPositions),
    applyPositions: (snapshot) => ipcRenderer.invoke(CHANNELS.match.applyPositions, snapshot),
  },
  bot: {
    start: (payload) => ipcRenderer.invoke(CHANNELS.bot.start, payload),
    stop: (payload) => ipcRenderer.invoke(CHANNELS.bot.stop, payload),
    status: (payload) => ipcRenderer.invoke(CHANNELS.bot.status, payload),
  },
  logs: {
    arm: (source) => ipcRenderer.invoke(CHANNELS.logs.arm, source),
    disarm: (source) => ipcRenderer.invoke(CHANNELS.logs.disarm, source),
    subscribe: (callback) => {
      const unsubscribe = subscribe(CHANNELS.logs.event, callback);
      void ipcRenderer.invoke(CHANNELS.logs.watch);
      return () => {
        unsubscribe();
        void ipcRenderer.invoke(CHANNELS.logs.unwatch);
      };
    },
  },
  publish: {
    bot: (payload) => ipcRenderer.invoke(CHANNELS.publish.bot, payload),
  },
});
