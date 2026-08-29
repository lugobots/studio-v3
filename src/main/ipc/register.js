const appIpc = require("./app");
const docker = require("./docker");
const config = require("./config");
const project = require("./project");
const updates = require("./updates");
const notifications = require("./notifications");

function registerIpc() {
  appIpc.register();
  docker.register();
  config.register();
  project.register();
  updates.register();
  notifications.register();
}

module.exports = { registerIpc };
