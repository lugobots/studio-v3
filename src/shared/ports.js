"use strict";

const DEFAULTS = {
  image: "lugobots/studio:latest",
  containerName: "lugo-studio-v3",
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

module.exports = { DEFAULTS, portsFrom, imageFrom };
