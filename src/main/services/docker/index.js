"use strict";

const { execFile, spawn } = require("node:child_process");
const { CHANNELS } = require("../../../shared/ipc-channels");
const { DEFAULTS, imageFrom, portsFrom } = require("../../../shared/ports");
const runtimePorts = require("../runtime-ports");
const { editorRunArgs, runArgs } = require("./args");
const { waitEditorReady } = require("./editor-ready");
const { resolveHostPorts } = require("./free-ports");
const { ensureLevel1Binary } = require("./level1");
const { buildDockerStatus } = require("./status");
const { isMissingContainer, removeOk, stopStudioContainers } = require("./stop");

let webContents = null;
let pullListener = () => {};
let pullState = { status: "idle", message: "" };

function attach(contents) {
  webContents = contents;
}

function notify(payload) {
  webContents?.send(CHANNELS.notifications.event, payload);
}

function setPullListener(listener) {
  pullListener = typeof listener === "function" ? listener : () => {};
}

function publishPull() {
  webContents?.send(CHANNELS.docker.progress, pullState);
  pullListener(pullState);
}

function exec(command, args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: stdout || "",
        stderr: stderr || "",
        error,
      });
    });
  });
}

async function getStatus() {
  const info = await exec("docker", ["info"], 5000);
  if (!info.ok) {
    return buildDockerStatus({
      info,
      image: imageFrom(),
      pull: pullState,
    });
  }
  const inspected = await exec("docker", ["image", "inspect", imageFrom()]);
  return buildDockerStatus({
    info,
    image: imageFrom(),
    imagePresent: inspected.ok,
    pull: pullState,
  });
}

function startPull() {
  if (pullState.status === "pulling") {
    return pullState;
  }
  pullState = { status: "pulling", message: "Starting pull" };
  const child = spawn("docker", ["pull", imageFrom()], { stdio: ["ignore", "pipe", "pipe"] });
  const onData = (chunk) => {
    const line = String(chunk)
      .split(/\r|\n/)
      .map((item) => item.trim())
      .filter(Boolean)
      .pop();
    if (!line) {
      return;
    }
    pullState = { status: "pulling", message: line };
    publishPull();
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("close", (code) => {
    pullState = {
      status: code === 0 ? "present" : "error",
      message: code === 0 ? "Studio image is ready" : "Image pull failed",
    };
    notify({ mode: "notify", title: "Studio image", body: pullState.message });
    publishPull();
  });
  return pullState;
}

async function ensureImage() {
  const status = await getStatus();
  if (!status.running) {
    return { ok: false, error: "Docker is not running" };
  }
  if (!status.imagePresent) {
    startPull();
  }
  return { ok: true, imagePresent: status.imagePresent, pull: pullState };
}

/**
 * Inspect a Docker image:tag and pull it when missing locally.
 * @param {string} ref
 * @returns {Promise<{ok:boolean,ref?:string,present?:boolean,pulled?:boolean,error?:string}>}
 */
async function ensureRef(ref) {
  const imageRef = typeof ref === "string" ? ref.trim() : "";
  if (!imageRef || !imageRef.includes(":") || imageRef.endsWith(":")) {
    return { ok: false, error: "Image reference must look like name:tag." };
  }
  const info = await exec("docker", ["info"], 5000);
  if (!info.ok) {
    return { ok: false, ref: imageRef, error: "Docker is not running." };
  }
  const inspected = await exec("docker", ["image", "inspect", imageRef], 15000);
  if (inspected.ok) {
    return { ok: true, ref: imageRef, present: true, pulled: false };
  }
  const pulled = await exec("docker", ["pull", imageRef], 600000);
  if (!pulled.ok) {
    const detail = (pulled.stderr || pulled.stdout || "pull failed").trim();
    return {
      ok: false,
      ref: imageRef,
      error: `Could not pull ${imageRef}: ${detail}`,
    };
  }
  return { ok: true, ref: imageRef, present: true, pulled: true };
}

/**
 * Pull (if needed) and extract the Level-1 opponent binary into the host cache.
 * Session kicks this after the Docker gate (background) and awaits it before
 * match start / API container start.
 */
async function ensureLevel1(resolved) {
  return ensureLevel1Binary({
    resolved,
    execDocker: (args, timeout) => exec("docker", args, timeout),
  });
}

async function containerIsRunning(name = DEFAULTS.containerName) {
  const running = await exec("docker", ["inspect", "-f", "{{.State.Running}}", name]);
  return running.ok && running.stdout.trim() === "true";
}

function hostPortFromBindings(portsJson, containerPort) {
  const bindings = portsJson && portsJson[`${containerPort}/tcp`];
  if (!Array.isArray(bindings) || !bindings[0]) {
    return "";
  }
  return String(bindings[0].HostPort || "");
}

/**
 * Read published host ports from a running container.
 * Container-side ports are the preferred env defaults (stable listen ports).
 */
async function publishedHostPorts(name, keys) {
  const preferred = portsFrom();
  const inspected = await exec("docker", ["inspect", "-f", "{{json .NetworkSettings.Ports}}", name]);
  if (!inspected.ok) {
    return null;
  }
  let portsJson;
  try {
    portsJson = JSON.parse(inspected.stdout.trim() || "{}");
  } catch {
    return null;
  }
  const result = {};
  for (const key of keys) {
    const containerPort = preferred[key];
    const host = hostPortFromBindings(portsJson, containerPort);
    result[key] = host || containerPort;
  }
  return result;
}

async function ensureNamedContainer(name, args) {
  if (await containerIsRunning(name)) {
    return { ok: true, name };
  }
  const inspected = await exec("docker", ["inspect", name]);
  if (inspected.ok) {
    await exec("docker", ["rm", "-f", name], 20000);
  }
  const started = await exec("docker", args, 120000);
  if (!started.ok) {
    return { ok: false, error: (started.stderr || started.stdout || `Could not start ${name}`).trim() };
  }
  return { ok: true, name };
}

function envValue(lines, prefix) {
  const line = lines.find((item) => item.startsWith(prefix));
  return line ? line.slice(prefix.length) : "";
}

/**
 * Inspect a running Studio API container for recreate decisions.
 * Compares LUGO_HOST_PROJECT_PATH, LUGO_HOST_OPPONENT_BOT (Level-1), and
 * LUGO_HOST_OPPONENT_PROJECT (local opponent project).
 */
async function runningContainerState(name = DEFAULTS.containerName) {
  if (!(await containerIsRunning(name))) {
    return {
      running: false,
      hostPath: "",
      opponentHostPath: "",
      opponentProjectHostPath: "",
    };
  }
  const inspected = await exec("docker", [
    "inspect",
    "-f",
    "{{range .Config.Env}}{{println .}}{{end}}",
    name,
  ]);
  if (!inspected.ok) {
    return {
      running: true,
      hostPath: null,
      opponentHostPath: null,
      opponentProjectHostPath: null,
    };
  }
  const lines = inspected.stdout.split("\n");
  return {
    running: true,
    hostPath: envValue(lines, "LUGO_HOST_PROJECT_PATH="),
    opponentHostPath: envValue(lines, "LUGO_HOST_OPPONENT_BOT="),
    opponentProjectHostPath: envValue(lines, "LUGO_HOST_OPPONENT_PROJECT="),
  };
}

/**
 * Whether a running API container already matches the expected mounts.
 * Exported for unit tests without talking to Docker.
 */
function containerMatchesExpected(current, hostProjectPath = "", level1 = null, opponentProject = null) {
  if (!current || !current.running) {
    return false;
  }
  const expectedOpponent = (level1 && level1.hostBinaryPath) || "";
  const expectedOppProject = (opponentProject && opponentProject.hostPath) || "";
  return (
    current.hostPath === hostProjectPath &&
    current.opponentHostPath === expectedOpponent &&
    current.opponentProjectHostPath === expectedOppProject
  );
}

/**
 * Resolve host publish ports and build `docker run` args for the API container.
 * Exported for focused tests without talking to Docker.
 */
async function prepareApiRunArgs(
  projectPath,
  hostProjectPath = "",
  level1 = null,
  env = process.env,
  opponentProject = null,
) {
  const preferred = portsFrom(env);
  let hostPorts;
  try {
    hostPorts = await resolveHostPorts({
      api: preferred.api,
      gameServer: preferred.gameServer,
      gameFrontend: preferred.gameFrontend,
    });
  } catch (error) {
    return { ok: false, error: error.message || "Could not find a free host port" };
  }
  return {
    ok: true,
    hostPorts,
    args: runArgs(projectPath, env, hostProjectPath, level1, hostPorts, opponentProject),
  };
}

/**
 * Resolve host publish port and build `docker run` args for the editor container.
 */
async function prepareEditorRunArgs(projectPath, env = process.env) {
  const preferred = portsFrom(env);
  let hostPorts;
  try {
    hostPorts = await resolveHostPorts({ vsCode: preferred.vsCode });
  } catch (error) {
    return { ok: false, error: error.message || "Could not find a free host port" };
  }
  return {
    ok: true,
    hostPorts,
    args: editorRunArgs(projectPath, env, hostPorts),
  };
}

async function ensureContainer(projectPath, hostProjectPath = "", level1 = null, opponentProject = null) {
  const current = await runningContainerState();
  if (containerMatchesExpected(current, hostProjectPath, level1, opponentProject)) {
    const hostPorts =
      (await publishedHostPorts(DEFAULTS.containerName, ["api", "gameServer", "gameFrontend"])) ||
      portsFrom();
    runtimePorts.setApiHostPorts(hostPorts);
    return { ok: true, name: DEFAULTS.containerName, hostPorts };
  }
  if (current.running) {
    await stopContainer();
  }
  const prepared = await prepareApiRunArgs(
    projectPath,
    hostProjectPath,
    level1,
    process.env,
    opponentProject,
  );
  if (!prepared.ok) {
    return prepared;
  }
  const started = await ensureNamedContainer(DEFAULTS.containerName, prepared.args);
  if (!started.ok) {
    return started;
  }
  runtimePorts.setApiHostPorts(prepared.hostPorts);
  return { ok: true, name: DEFAULTS.containerName, hostPorts: prepared.hostPorts };
}

async function stopEditor() {
  const editor = await exec("docker", ["rm", "-f", DEFAULTS.editorContainerName], 20000);
  runtimePorts.clearEditorHostPort();
  return { ok: removeOk(editor) };
}

async function recentLogs(name = DEFAULTS.containerName) {
  const result = await exec("docker", ["logs", "--tail", "5", name], 5000);
  // Missing container is normal during intentional recreate; do not surface daemon noise.
  if (isMissingContainer(result.stderr) || isMissingContainer(result.stdout)) {
    return "";
  }
  const text = `${result.stdout}\n${result.stderr}`.trim();
  if (!text) {
    return "";
  }
  const line = text.split("\n").filter(Boolean).pop();
  return line.slice(0, 300);
}

/**
 * Make the mounted bot writable by the VS Code helper (`coder`, uid 1000).
 * The API container writes templates/deps as root; without this, saves EACCES.
 */
async function fixProjectOwnershipForEditor() {
  if (!(await containerIsRunning(DEFAULTS.containerName))) {
    return { ok: false, reason: "api-not-running" };
  }
  const result = await exec(
    "docker",
    ["exec", DEFAULTS.containerName, "chown", "-R", "1000:1000", DEFAULTS.mountTarget],
    60000,
  );
  return { ok: result.ok, error: result.ok ? "" : (result.stderr || result.stdout || "").trim() };
}

async function ensureEditor(projectPath) {
  if (await containerIsRunning(DEFAULTS.editorContainerName)) {
    await fixProjectOwnershipForEditor();
    const hostPorts =
      (await publishedHostPorts(DEFAULTS.editorContainerName, ["vsCode"])) || {
        vsCode: portsFrom().vsCode,
      };
    runtimePorts.setEditorHostPort(hostPorts.vsCode);
    return { ok: true, name: DEFAULTS.editorContainerName, hostPorts };
  }
  const prepared = await prepareEditorRunArgs(projectPath);
  if (!prepared.ok) {
    notify({ mode: "notify", title: "Editor", body: prepared.error });
    return prepared;
  }
  const started = await ensureNamedContainer(DEFAULTS.editorContainerName, prepared.args);
  if (!started.ok) {
    notify({ mode: "notify", title: "Editor", body: started.error });
    return started;
  }
  await fixProjectOwnershipForEditor();
  runtimePorts.setEditorHostPort(prepared.hostPorts.vsCode);
  return {
    ok: true,
    name: DEFAULTS.editorContainerName,
    hostPorts: prepared.hostPorts,
  };
}

async function stopContainer() {
  const result = await stopStudioContainers(async (name) => exec("docker", ["rm", "-f", name], 20000));
  runtimePorts.clearAll();
  return result;
}

module.exports = {
  attach,
  setPullListener,
  getStatus,
  startPull,
  ensureImage,
  ensureRef,
  ensureLevel1,
  containerIsRunning,
  containerMatchesExpected,
  ensureContainer,
  ensureEditor,
  waitEditorReady,
  stopContainer,
  stopEditor,
  recentLogs,
  prepareApiRunArgs,
  prepareEditorRunArgs,
  publishedHostPorts,
};
