"use strict";

const { execFile, spawn } = require("node:child_process");
const { CHANNELS } = require("../../../shared/ipc-channels");
const { DEFAULTS, imageFrom } = require("../../../shared/ports");
const { editorRunArgs, runArgs } = require("./args");
const { removeOk, stopStudioContainers } = require("./stop");

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
    return { running: false, image: imageFrom(), imagePresent: false, pull: pullState };
  }
  const inspected = await exec("docker", ["image", "inspect", imageFrom()]);
  return {
    running: true,
    image: imageFrom(),
    imagePresent: inspected.ok,
    pull: pullState,
  };
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

async function containerIsRunning(name = DEFAULTS.containerName) {
  const running = await exec("docker", ["inspect", "-f", "{{.State.Running}}", name]);
  return running.ok && running.stdout.trim() === "true";
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

async function runningHostPath(name = DEFAULTS.containerName) {
  if (!(await containerIsRunning(name))) {
    return { running: false, hostPath: "" };
  }
  const inspected = await exec("docker", [
    "inspect",
    "-f",
    "{{range .Config.Env}}{{println .}}{{end}}",
    name,
  ]);
  if (!inspected.ok) {
    return { running: true, hostPath: null };
  }
  const prefix = "LUGO_HOST_PROJECT_PATH=";
  const line = inspected.stdout.split("\n").find((item) => item.startsWith(prefix));
  return { running: true, hostPath: line ? line.slice(prefix.length) : "" };
}

async function ensureContainer(projectPath, hostProjectPath = "") {
  const current = await runningHostPath();
  if (current.running && current.hostPath === hostProjectPath) {
    return { ok: true, name: DEFAULTS.containerName };
  }
  if (current.running) {
    await stopContainer();
  }
  return ensureNamedContainer(
    DEFAULTS.containerName,
    runArgs(projectPath, process.env, hostProjectPath),
  );
}

async function stopEditor() {
  const editor = await exec("docker", ["rm", "-f", DEFAULTS.editorContainerName], 20000);
  return { ok: removeOk(editor) };
}

async function recentLogs(name = DEFAULTS.containerName) {
  const result = await exec("docker", ["logs", "--tail", "5", name], 5000);
  const text = `${result.stdout}\n${result.stderr}`.trim();
  if (!text) {
    return "";
  }
  const line = text.split("\n").filter(Boolean).pop();
  return line.slice(0, 300);
}

async function ensureEditor(projectPath) {
  const started = await ensureNamedContainer(DEFAULTS.editorContainerName, editorRunArgs(projectPath));
  if (!started.ok) {
    notify({ mode: "notify", title: "Editor", body: started.error });
  }
  return started;
}

async function stopContainer() {
  return stopStudioContainers(async (name) => exec("docker", ["rm", "-f", name], 20000));
}

module.exports = {
  attach,
  setPullListener,
  getStatus,
  startPull,
  ensureImage,
  containerIsRunning,
  ensureContainer,
  ensureEditor,
  stopContainer,
  stopEditor,
  recentLogs,
};
