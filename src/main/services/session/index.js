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
const notifications = require("../notifications");
const studioApi = require("../studio-api");
const {
  HEALTH_DEADLINE_MS,
  HEALTH_INTERVAL_MS,
  actionResult,
  applyStartupDecision,
  decidePoll,
  decideStartup,
  routeForStatus,
} = require("./gate");
const { createLevel1Ready } = require("./level1-ready");
const { createServerControls } = require("./server-controls");
const { createLogControls } = require("./log-controls");
const { describeStartup } = require("../../../shared/startup-progress");
const { sessionEditorUrl } = require("../session-urls");

let webContents = null;
let watchGeneration = 0;
let serverControls = null;
let logControls = null;
let lastProgress = describeStartup({
  phase: "docker",
  detail: "Checking Docker and your bot.",
});
let lastProgressKey = "";

const level1Ready = createLevel1Ready({
  getResolved: () => config.getLevel1(),
  ensureLevel1: (resolved) => docker.ensureLevel1(resolved),
  onProgress: (input) => emitProgress(input),
  notify: (payload) => notifications.show(payload),
});

function attach(contents) {
  webContents = contents;
}

function emitRoute(decision) {
  webContents?.send(CHANNELS.startup.route, {
    route: decision.route,
    message: decision.message || "",
  });
}

function emitProgress(input) {
  const progress = describeStartup(input);
  const key = JSON.stringify(progress);
  if (key === lastProgressKey) {
    return progress;
  }
  lastProgressKey = key;
  lastProgress = progress;
  webContents?.send(CHANNELS.startup.progress, progress);
  return progress;
}

function currentProgress() {
  return lastProgress;
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

function startWatch(projectPath, forcedRoute = "", flow = "startup") {
  const token = ++watchGeneration;
  const startedAt = Date.now();
  let seenHealthy = false;
  let editorStarted = false;
  let lastKey = "";
  emitProgress({
    flow,
    phase: "health",
    detail: "Waiting for the API to respond.",
    elapsedMs: 0,
    deadlineMs: HEALTH_DEADLINE_MS,
  });

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
    if (decision.route === "/api-loading") {
      const elapsedMs = Date.now() - startedAt;
      const seconds = Math.round(elapsedMs / 1000);
      emitProgress({
        flow,
        phase: "health",
        detail: seconds < 1 ? "Waiting for the API to respond." : `${seconds}s elapsed`,
        elapsedMs,
        deadlineMs: HEALTH_DEADLINE_MS,
      });
    } else if (decision.route === "/main" || decision.route === "/start-project") {
      emitProgress({ flow, phase: "ready", detail: "Opening Studio." });
    }
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

async function ensureApiContainer(projectPath, hostProjectPath = "") {
  const level1 = await level1Ready.awaitReady();
  if (!level1.ok) {
    return level1;
  }
  return docker.ensureContainer(projectPath, hostProjectPath, level1);
}

async function startApi(saved) {
  const paths = launchPaths(saved);
  const started = await ensureApiContainer(paths.mount, paths.host);
  if (!started.ok) {
    return { ok: false, route: "/api-error", message: started.error, error: started.error };
  }
  if (!paths.host) {
    await docker.stopEditor();
  }
  startWatch(paths.host);
  return { ok: true, route: "/api-loading" };
}

/**
 * On-demand VS Code helper: start the separate editor container for the open bot.
 * Must not be called from shell-enter / openRuntime auto-start.
 */
async function startEditor() {
  const saved = await config.get();
  const paths = launchPaths(saved);
  if (!paths.host) {
    return { ok: false, error: "Open a bot project before starting the editor" };
  }
  const started = await docker.ensureEditor(paths.host);
  if (!started.ok) {
    return { ok: false, error: started.error || "Could not start the editor" };
  }
  const url = sessionEditorUrl();
  const ready = await docker.waitEditorReady({ url });
  if (!ready.ok) {
    return {
      ok: false,
      error: ready.error || "Editor did not become reachable",
      url: ready.url || url,
    };
  }
  return { ok: true, url: ready.url || url };
}

async function stopEditor() {
  return docker.stopEditor();
}

async function next() {
  emitProgress({ phase: "docker", detail: "Checking that Docker is running." });
  const status = await docker.getStatus();
  const saved = await config.get();
  if (status.running) {
    // Non-blocking: shell entry must not wait on Level-1 pull/extract.
    level1Ready.kick();
  }
  const decision = decideStartup({
    dockerRunning: status.running,
    botPaths: saved.bot_paths,
    lastProjectReady: Boolean(saved.projectCreated),
    projectPath: typeof saved.project_path === "string" ? saved.project_path : "",
  });
  if (decision.resumePath) {
    emitProgress({ phase: "container", detail: "Opening this bot." });
  }
  return applyStartupDecision(decision, {
    open: (folder) => open(folder),
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
    start: (dir) => ensureApiContainer(dir, dir),
    watch: (dir, route) => {
      watchGeneration += 1;
      startWatch(dir, route);
    },
  });
}

const LANGUAGE_LABEL = {
  python: "Python",
  go: "Go",
  typescript: "JavaScript",
};

async function create({ folder, language, overwrite }) {
  let creating = false;
  return createBot({
    folder,
    language,
    overwrite: Boolean(overwrite),
    check: checkBotCompatibility,
    listEntries: inspectDirectory,
    remember: (dir) => config.rememberBot(dir),
    onWork: (kind) => {
      creating = kind === "create";
      if (creating) {
        emitProgress({
          flow: "create",
          phase: "docker",
          detail: "Checking the folder you chose.",
        });
        return;
      }
      emitProgress({ phase: "container", detail: "Opening this bot." });
    },
    stop: () => docker.stopContainer(),
    start: async (dir) => {
      const flow = creating ? "create" : "startup";
      emitProgress({ flow, phase: "image", detail: "Preparing the Studio image." });
      const image = await docker.ensureImage();
      if (!image.ok) {
        return image;
      }
      emitProgress({
        flow,
        phase: "image",
        detail: "Preparing the Level-1 opponent binary.",
      });
      const level1 = await level1Ready.awaitReady();
      if (!level1.ok) {
        return level1;
      }
      emitProgress({
        flow,
        phase: "container",
        detail: creating ? "Starting the API that will create the bot." : "Starting the Studio API.",
      });
      const container = await docker.ensureContainer(dir, dir, level1);
      if (!container.ok) {
        return container;
      }
      if (!creating) {
        return studioApi.waitUntilReady(undefined, HEALTH_DEADLINE_MS / HEALTH_INTERVAL_MS);
      }
      const startedAt = Date.now();
      const reportWait = () => {
        const elapsedMs = Date.now() - startedAt;
        const seconds = Math.round(elapsedMs / 1000);
        emitProgress({
          flow,
          phase: "container",
          detail:
            seconds < 2
              ? "Waiting until the API can set up the bot."
              : `Waiting until the API can set up the bot. ${seconds}s elapsed.`,
          elapsedMs,
          deadlineMs: HEALTH_DEADLINE_MS,
        });
      };
      reportWait();
      const timer = setInterval(reportWait, 1000);
      try {
        return await studioApi.waitUntilReady(undefined, HEALTH_DEADLINE_MS / HEALTH_INTERVAL_MS);
      } finally {
        clearInterval(timer);
      }
    },
    setup: async (lang) => {
      const startedAt = Date.now();
      const template = LANGUAGE_LABEL[lang] || "bot";
      const deadlineMs = 120000;
      const reportSetup = () => {
        const elapsedMs = Date.now() - startedAt;
        const seconds = Math.round(elapsedMs / 1000);
        emitProgress({
          flow: "create",
          phase: "setup",
          detail:
            seconds < 2
              ? `Downloading the ${template} bot template. This can take a minute.`
              : `Downloading the ${template} bot template. ${seconds}s elapsed.`,
          elapsedMs,
          deadlineMs,
        });
      };
      reportSetup();
      const timer = setInterval(reportSetup, 1000);
      try {
        return actionResult(await studioApi.setupBot(lang));
      } catch (error) {
        return { ok: false, error: error.message };
      } finally {
        clearInterval(timer);
      }
    },
    watch: (dir, route) => {
      watchGeneration += 1;
      startWatch(dir, route, creating ? "create" : "startup");
    },
  });
}

async function remove(folder) {
  if (!folder) {
    return { ok: false, error: "Choose a bot to remove." };
  }
  const saved = await config.forgetBot(folder);
  return { ok: true, config: saved };
}

async function ensureStudioApiReady(missingBotError) {
  const saved = await config.get();
  if (!saved.project_path) {
    return { ok: false, error: missingBotError };
  }
  const container = await ensureApiContainer(saved.project_path, saved.project_path);
  if (!container.ok) {
    return container;
  }
  const ready = await studioApi.waitUntilReady(undefined, HEALTH_DEADLINE_MS / HEALTH_INTERVAL_MS);
  if (!ready.ok) {
    return ready;
  }
  return { ok: true };
}

function getServerControls() {
  if (!serverControls) {
    serverControls = createServerControls({
      ensureReady: ensureStudioApiReady,
      api: studioApi,
      matchSettings: () => config.matchSettingsForApi(),
      sendStatus: (status) => {
        webContents?.send(CHANNELS.server.statusEvent, status);
      },
    });
  }
  return serverControls;
}

async function startServer(settings) {
  return getServerControls().start(settings);
}

async function stopServer() {
  return getServerControls().stop();
}

async function serverStatus() {
  return getServerControls().status();
}

function watchServerStatus(options) {
  return getServerControls().watch(options);
}

function getLogControls() {
  if (!logControls) {
    logControls = createLogControls({
      ensureReady: ensureStudioApiReady,
      api: studioApi,
      sendLines: (payload) => {
        webContents?.send(CHANNELS.logs.event, payload);
      },
    });
  }
  return logControls;
}

async function armLogs(source) {
  return getLogControls().arm(source);
}

async function disarmLogs(source) {
  return getLogControls().disarm(source);
}

function watchProcessLogs(options) {
  return getLogControls().watch(options);
}

function unwatchProcessLogs() {
  return getLogControls().unwatch();
}

async function startMatch(options = {}) {
  const level1 = await level1Ready.awaitReady();
  if (!level1.ok) {
    return level1;
  }
  const ready = await ensureStudioApiReady("Open a bot before starting a match.");
  if (!ready.ok) {
    return ready;
  }
  try {
    const settings = await config.matchSettingsForApi();
    const payload = { ...settings };
    if (options && Array.isArray(options.active)) {
      payload.active = options.active;
    }
    return actionResult(await studioApi.startMatch(payload));
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function resetMatch() {
  const ready = await ensureStudioApiReady("Open a bot before resetting a match.");
  if (!ready.ok) {
    return ready;
  }
  try {
    return actionResult(await studioApi.resetMatch());
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function getPositions() {
  const ready = await ensureStudioApiReady("Open a bot before reading positions.");
  if (!ready.ok) {
    return ready;
  }
  try {
    const body = await studioApi.getPositions();
    return { ok: true, body };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function applyPositions(snapshot) {
  const ready = await ensureStudioApiReady("Open a bot before applying positions.");
  if (!ready.ok) {
    return ready;
  }
  try {
    return actionResult(await studioApi.applyPositions(snapshot));
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function startBot(slot = {}) {
  const ready = await ensureStudioApiReady("Open a bot before starting a player.");
  if (!ready.ok) {
    return ready;
  }
  try {
    const settings = await config.matchSettingsForApi();
    return actionResult(
      await studioApi.startBot({
        side: slot.side,
        number: slot.number,
        settings,
      }),
    );
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function stopBot(slot) {
  const ready = await ensureStudioApiReady("Open a bot before stopping a player.");
  if (!ready.ok) {
    return ready;
  }
  try {
    return actionResult(await studioApi.stopBot(slot));
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function botStatus(slot) {
  const ready = await ensureStudioApiReady("Open a bot before reading player status.");
  if (!ready.ok) {
    return ready;
  }
  try {
    const body = await studioApi.botStatus(slot);
    return { ok: true, body };
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

docker.setPullListener((pull) => {
  const phase = lastProgress.phase;
  const flow = lastProgress.flow;
  if (phase !== "docker" && phase !== "image") {
    return;
  }
  if (pull.status === "pulling") {
    emitProgress({ flow, phase: "image", detail: pull.message || "Downloading the Studio image." });
    return;
  }
  if (pull.status === "present") {
    emitProgress({ flow, phase: "container", detail: "Starting the container." });
  }
});

module.exports = {
  attach,
  next,
  retry,
  current: currentProgress,
  pickFolder,
  open,
  create,
  remove,
  startServer,
  stopServer,
  serverStatus,
  watchServerStatus,
  armLogs,
  disarmLogs,
  watchProcessLogs,
  unwatchProcessLogs,
  startMatch,
  resetMatch,
  getPositions,
  applyPositions,
  startBot,
  stopBot,
  botStatus,
  publish,
  projectStatus,
  startEditor,
  stopEditor,
};
