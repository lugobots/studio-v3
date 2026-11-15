"use strict";

const {
  LEVEL1_CONTAINER_BINARY_PATH,
  OPPONENT_PROJECT_CONTAINER_PATH,
} = require("../config/store");
const { DEFAULTS, editorImageFrom, imageFrom, portsFrom } = require("../../../shared/ports");

/**
 * Build `docker run` args for the Studio API container.
 * When `level1` includes a host binary path, bind-mount it at the path the API
 * bot manager expects (default `/usr/local/lib/lugo/bot-level-1`).
 * When `opponentProject` includes a host path, bind-mount that bot project for
 * local-project opponents (default `/bot-opponent`).
 *
 * @param {string} projectPath
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [hostProjectPath]
 * @param {{ hostBinaryPath?: string, containerBinaryPath?: string }} [level1]
 * @param {{ api?: string, gameServer?: string, gameFrontend?: string }} [hostPorts]
 *        Resolved host publish ports. Container listen ports stay on preferred env defaults.
 * @param {{ hostPath?: string, containerPath?: string }} [opponentProject]
 */
function runArgs(
  projectPath,
  env = process.env,
  hostProjectPath = "",
  level1 = null,
  hostPorts = null,
  opponentProject = null,
) {
  const ports = portsFrom(env);
  const host = {
    api: (hostPorts && hostPorts.api) || ports.api,
    gameServer: (hostPorts && hostPorts.gameServer) || ports.gameServer,
    gameFrontend: (hostPorts && hostPorts.gameFrontend) || ports.gameFrontend,
  };
  const image = imageFrom(env);
  const args = [
    "run",
    "-d",
    "--name",
    DEFAULTS.containerName,
    "-v",
    `${projectPath}:${DEFAULTS.mountTarget}`,
    "-p",
    `${host.api}:${ports.api}`,
    "-p",
    `${host.gameServer}:${ports.gameServer}`,
    "-p",
    `${host.gameFrontend}:${ports.gameFrontend}`,
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
  ];

  const hostBinaryPath = level1 && level1.hostBinaryPath;
  if (hostBinaryPath) {
    const containerBinaryPath =
      (level1 && level1.containerBinaryPath) || LEVEL1_CONTAINER_BINARY_PATH;
    args.push(
      "-v",
      `${hostBinaryPath}:${containerBinaryPath}`,
      "-e",
      `LUGO_STUDIO_OPPONENT_BOT=${containerBinaryPath}`,
      "-e",
      `LUGO_HOST_OPPONENT_BOT=${hostBinaryPath}`,
    );
  }

  const opponentHostPath = opponentProject && opponentProject.hostPath;
  if (opponentHostPath) {
    const containerPath =
      (opponentProject && opponentProject.containerPath) || OPPONENT_PROJECT_CONTAINER_PATH;
    args.push(
      "-v",
      `${opponentHostPath}:${containerPath}`,
      "-e",
      `LUGO_STUDIO_OPPONENT_PROJECT=${containerPath}`,
      "-e",
      `LUGO_HOST_OPPONENT_PROJECT=${opponentHostPath}`,
    );
  }

  args.push(image, "api");
  return args;
}

/**
 * @param {string} projectPath
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ vsCode?: string }} [hostPorts] resolved host publish port for the editor
 */
function editorRunArgs(projectPath, env = process.env, hostPorts = null) {
  const ports = portsFrom(env);
  const hostVsCode = (hostPorts && hostPorts.vsCode) || ports.vsCode;
  const image = editorImageFrom(env);
  return [
    "run",
    "-d",
    "--name",
    DEFAULTS.editorContainerName,
    "-v",
    `${projectPath}:${DEFAULTS.mountTarget}`,
    "-p",
    `${hostVsCode}:${ports.vsCode}`,
    "-e",
    `PORT=${ports.vsCode}`,
    "-e",
    `LUGO_VS_CODE_PORT=${ports.vsCode}`,
    image,
  ];
}

module.exports = { runArgs, editorRunArgs };
