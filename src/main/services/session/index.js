"use strict";

const { dialog } = require("electron");
const config = require("../config");
const docker = require("../docker");
const studioApi = require("../studio-api");

async function next() {
  const status = await docker.getStatus();
  if (!status.running) {
    return { route: "/docker-check" };
  }
  if (!status.imagePresent) {
    docker.startPull();
  }
  const saved = await config.get();
  return { route: saved.projectCreated ? "/main" : "/start-project" };
}

async function pickFolder() {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, cancelled: true };
  }
  return { ok: true, folder: result.filePaths[0] };
}

async function open(folder) {
  if (!config.projectFileReady(folder)) {
    return { ok: false, error: "That folder is not a Lugo bot (.lugo/info.json is missing)." };
  }
  const saved = await config.set({
    project_path: folder,
    compose_file: require("node:path").join(folder, "docker-compose.yml"),
  });
  return { ok: true, config: saved };
}

async function create({ folder, language }) {
  if (!folder || !language) {
    return { ok: false, error: "Choose a language and a folder." };
  }
  const image = await docker.ensureImage();
  if (!image.ok) {
    return image;
  }
  const container = await docker.ensureContainer(folder);
  if (!container.ok) {
    return container;
  }
  const ready = await studioApi.waitUntilReady();
  if (!ready.ok) {
    return ready;
  }
  try {
    await studioApi.setupBot(language);
  } catch (error) {
    return { ok: false, error: error.message };
  }
  const saved = await config.set({
    project_path: folder,
    compose_file: require("node:path").join(folder, "docker-compose.yml"),
  });
  return { ok: true, config: saved };
}

async function startMatch() {
  const saved = await config.get();
  if (!saved.project_path) {
    return { ok: false, error: "Open a bot before starting a match." };
  }
  const container = await docker.ensureContainer(saved.project_path);
  if (!container.ok) {
    return container;
  }
  const ready = await studioApi.waitUntilReady();
  if (!ready.ok) {
    return ready;
  }
  try {
    const body = await studioApi.startMatch();
    return { ok: true, body };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function publish({ botUri, tag }) {
  try {
    const body = await studioApi.publishBot({ botUri, tag });
    return { ok: true, body };
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

module.exports = { next, pickFolder, open, create, startMatch, publish, projectStatus };
