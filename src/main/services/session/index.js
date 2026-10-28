"use strict";

const { app, dialog } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { CHANNELS } = require("../../../shared/ipc-channels");
const { createBot, inspectDirectory, openBot } = require("../bots/actions");
const { checkBotCompatibility } = require("../bots/compatibility");
const config = require("../config");
const docker = require("../docker");
const { openRuntime } = require("../docker/runtime");
const studioApi = require("../studio-api");
const {
  HEALTH_DEADLINE_MS,
  HEALTH_INTERVAL_MS,
  actionResult,
  decidePoll,
  decideStartup,
  routeForStatus,
} = require("./gate");

let webContents = null;
let watchGeneration = 0;

function attach(contents) {
  webContents = contents;
}

function emitRoute(decision) {
  webContents?.send(CHANNELS.startup.route, {
    route: decision.route,
    message: decision.message || "",
  });
}

function emptyProjectDir() {
  const dir = path.join(app.getPath("appData"), ".LugoStudio", "empty-project");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function launchPaths(saved) {
  const host = saved.project_path && fs.existsSync(saved.project_path) ? saved.project_path : "";
  return { host, mount: host || emptyProjectDir() };
}

function startWatch(projectPath, forcedRoute = "") {
  const token = ++watchGeneration;
  const startedAt = Date.now();
  let seenHealthy = false;
  let editorStarted = false;
  let lastKey = "";

  const tick = async () => {
    if (token !== watchGeneration) {
      return;
    }
    let running = false;
    let healthy = false;
    let readyRoute = forcedRoute || "/start-project";
    try {
      running = await docker.containerIsRunning();
      if (running) {
        healthy = await studioApi.healthy();
      }
      if (healthy) {
        if (!forcedRoute) {
          const body = await studioApi.status();
          readyRoute = routeForStatus(body);
        }
        if (readyRoute === "/main" && projectPath && !editorStarted) {
          editorStarted = true;
          await openRuntime({
            ensureApi: async () => ({ ok: true }),
            health: async () => ({ ok: true }),
            ensureEditor: () => docker.ensureEditor(projectPath),
          });
        }
      }
    } catch {
      healthy = false;
    }
    if (token !== watchGeneration) {
      return;
    }
    const decision = decidePoll({
      containerRunning: running,
      healthy,
      elapsedMs: Date.now() - startedAt,
      seenHealthy,
      readyRoute,
    });
    seenHealthy = decision.seenHealthy;
    if (!running && decision.route === "/api-error") {
      const logs = await docker.recentLogs();
      if (logs) {
        decision.message = logs;
      }
    }
    const key = `${decision.route}|${decision.message || ""}`;
    if (key !== lastKey && token === watchGeneration) {
      lastKey = key;
      emitRoute(decision);
    }
    if (decision.route === "/api-error" || token !== watchGeneration) {
      return;
    }
    setTimeout(tick, HEALTH_INTERVAL_MS);
  };

  tick();
}

async function startApi(saved) {
  const paths = launchPaths(saved);
  const started = await docker.ensureContainer(paths.mount, paths.host);
  if (!started.ok) {
    return { ok: false, route: "/api-error", message: started.error, error: started.error };
  }
  if (!paths.host) {
    await docker.stopEditor();
  }
  startWatch(paths.host);
  return { ok: true, route: "/api-loading" };
}

async function next() {
  const status = await docker.getStatus();
  const saved = await config.get();
  return decideStartup({
    dockerRunning: status.running,
    botPaths: saved.bot_paths,
  });
}

async function retry() {
  const status = await docker.getStatus();
  if (!status.running) {
    return { route: "/docker-check" };
  }
  watchGeneration += 1;
  await docker.stopContainer();
  const saved = await config.get();
  return startApi(saved);
}

async function pickFolder() {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, cancelled: true };
  }
  return { ok: true, folder: result.filePaths[0] };
}

async function open(folder) {
  return openBot({
    folder,
    check: checkBotCompatibility,
    remember: (dir) => config.rememberBot(dir),
    stop: () => docker.stopContainer(),
    start: (dir) => docker.ensureContainer(dir, dir),
    watch: (dir, route) => {
      watchGeneration += 1;
      startWatch(dir, route);
    },
  });
}

async function create({ folder, language, overwrite }) {
  return createBot({
    folder,
    language,
    overwrite: Boolean(overwrite),
    check: checkBotCompatibility,
    listEntries: inspectDirectory,
    remember: (dir) => config.rememberBot(dir),
    stop: () => docker.stopContainer(),
    start: async (dir) => {
      const image = await docker.ensureImage();
      if (!image.ok) {
        return image;
      }
      const container = await docker.ensureContainer(dir, dir);
      if (!container.ok) {
        return container;
      }
      return studioApi.waitUntilReady(undefined, HEALTH_DEADLINE_MS / HEALTH_INTERVAL_MS);
    },
    setup: async (lang) => {
      try {
        return actionResult(await studioApi.setupBot(lang));
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
    watch: (dir, route) => {
      watchGeneration += 1;
      startWatch(dir, route);
    },
  });
}

async function startMatch() {
  const saved = await config.get();
  if (!saved.project_path) {
    return { ok: false, error: "Open a bot before starting a match." };
  }
  const container = await docker.ensureContainer(saved.project_path, saved.project_path);
  if (!container.ok) {
    return container;
  }
  const ready = await studioApi.waitUntilReady(undefined, HEALTH_DEADLINE_MS / HEALTH_INTERVAL_MS);
  if (!ready.ok) {
    return ready;
  }
  try {
    return actionResult(await studioApi.startMatch());
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function publish({ botUri, tag }) {
  try {
    return actionResult(await studioApi.publishBot({ botUri, tag }));
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function projectStatus() {
  try {
    const body = await studioApi.status();
    return { ok: true, body };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = { attach, next, retry, pickFolder, open, create, startMatch, publish, projectStatus };
