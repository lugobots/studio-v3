const appIpc = require("./app");
const docker = require("./docker");
const config = require("./config");
const updates = require("./updates");
const notifications = require("./notifications");

function registerIpc() {
  appIpc.register();
  docker.register();
  config.register();
  updates.register();
  notifications.register();
}

module.exports = { registerIpc };
