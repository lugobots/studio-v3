const docker = require("./docker");
const config = require("./config");
const updates = require("./updates");
const notifications = require("./notifications");
const session = require("./session");
const account = require("./account");

function registerIpc() {
  docker.register();
  config.register();
  updates.register();
  notifications.register();
  session.register();
  account.register();
}

module.exports = { registerIpc };
