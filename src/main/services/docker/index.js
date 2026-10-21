"use strict";

const { execFile, spawn } = require("node:child_process");
const { CHANNELS } = require("../../../shared/ipc-channels");
const { DEFAULTS, imageFrom } = require("../../../shared/ports");
const { runArgs } = require("./args");

let webContents = null;
let pullState = { status: "idle", message: "" };

function attach(contents) {
  webContents = contents;
}

function notify(payload) {
  webContents?.send(CHANNELS.notifications.event, payload);
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
    const line = String(chunk).trim().split("\n").filter(Boolean).pop();
    if (!line) {
      return;
    }
    pullState = { status: "pulling", message: line };
    notify({ mode: "notify", title: "Studio image", body: line });
    webContents?.send(CHANNELS.docker.progress, pullState);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("close", (code) => {
    pullState = {
      status: code === 0 ? "present" : "error",
      message: code === 0 ? "Studio image is ready" : "Image pull failed",
    };
    notify({ mode: "notify", title: "Studio image", body: pullState.message });
    webContents?.send(CHANNELS.docker.progress, pullState);
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

async function ensureContainer(projectPath) {
  const running = await exec("docker", ["inspect", "-f", "{{.State.Running}}", DEFAULTS.containerName]);
  if (running.ok && running.stdout.trim() === "true") {
    return { ok: true, name: DEFAULTS.containerName };
  }
  if (running.ok) {
    await exec("docker", ["rm", "-f", DEFAULTS.containerName], 20000);
  }
  const started = await exec("docker", runArgs(projectPath), 120000);
  if (!started.ok) {
    return { ok: false, error: started.stderr || "Could not start the Studio image" };
  }
  return { ok: true, name: DEFAULTS.containerName };
}

async function stopContainer() {
  const stopped = await exec("docker", ["rm", "-f", DEFAULTS.containerName], 20000);
  return { ok: stopped.ok };
}

module.exports = {
  attach,
  getStatus,
  startPull,
  ensureImage,
  ensureContainer,
  stopContainer,
};
