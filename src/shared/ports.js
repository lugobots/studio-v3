"use strict";

const DEFAULTS = {
  image: "lugobots/studio-v3-api:latest",
  editorImage: "lugobots/vs-code-for-lugo:latest",
  containerName: "lugo-studio-v3",
  editorContainerName: "lugo-studio-v3-editor",
  mountTarget: "/home/coder/project",
  apiPort: "8081",
  gameServerPort: "5000",
  gameFrontendPort: "8080",
  vsCodePort: "8082",
};

function portsFrom(env = process.env) {
  return {
    api: env.LUGO_STUDIO_API_PORT || DEFAULTS.apiPort,
    gameServer: env.LUGO_STUDIO_GAME_SERVER_PORT || DEFAULTS.gameServerPort,
    gameFrontend: env.LUGO_STUDIO_GAME_FRONTEND_PORT || DEFAULTS.gameFrontendPort,
    vsCode: env.LUGO_VS_CODE_PORT || DEFAULTS.vsCodePort,
  };
}

function imageFrom(env = process.env) {
  return env.LUGO_STUDIO_IMAGE || DEFAULTS.image;
}

function editorImageFrom(env = process.env) {
  return env.LUGO_VS_CODE_IMAGE || DEFAULTS.editorImage;
}

function gameFrontendUrl(env = process.env) {
  return `http://localhost:${portsFrom(env).gameFrontend}`;
}

function editorUrl(env = process.env) {
  return `http://localhost:${portsFrom(env).vsCode}`;
}

module.exports = { DEFAULTS, portsFrom, imageFrom, editorImageFrom, gameFrontendUrl, editorUrl };
