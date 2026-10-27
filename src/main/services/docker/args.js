"use strict";

const { DEFAULTS, editorImageFrom, imageFrom, portsFrom } = require("../../../shared/ports");

function runArgs(projectPath, env = process.env, hostProjectPath = "") {
  const ports = portsFrom(env);
  const image = imageFrom(env);
  return [
    "run",
    "-d",
    "--name",
    DEFAULTS.containerName,
    "-v",
    `${projectPath}:${DEFAULTS.mountTarget}`,
    "-p",
    `${ports.api}:${ports.api}`,
    "-p",
    `${ports.gameServer}:${ports.gameServer}`,
    "-p",
    `${ports.gameFrontend}:${ports.gameFrontend}`,
    "-e",
    `LUGO_STUDIO_API_PORT=${ports.api}`,
    "-e",
    `LUGO_STUDIO_GAME_SERVER_PORT=${ports.gameServer}`,
    "-e",
    `LUGO_STUDIO_GAME_FRONTEND_PORT=${ports.gameFrontend}`,
    "-e",
    `LUGO_HOST_PROJECT_PATH=${hostProjectPath}`,
    "-e",
    `BOT_SOURCE_PATH=${DEFAULTS.mountTarget}`,
    image,
    "api",
  ];
}

function editorRunArgs(projectPath, env = process.env) {
  const ports = portsFrom(env);
  const image = editorImageFrom(env);
  return [
    "run",
    "-d",
    "--name",
    DEFAULTS.editorContainerName,
    "-v",
    `${projectPath}:${DEFAULTS.mountTarget}`,
    "-p",
    `${ports.vsCode}:${ports.vsCode}`,
    "-e",
    `PORT=${ports.vsCode}`,
    "-e",
    `LUGO_VS_CODE_PORT=${ports.vsCode}`,
    image,
  ];
}

module.exports = { runArgs, editorRunArgs };
