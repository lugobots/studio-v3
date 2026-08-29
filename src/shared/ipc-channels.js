"use strict";

const CHANNELS = {
  docker: {
    status: "docker:status",
  },
  config: {
    get: "config:get",
    set: "config:set",
  },
  updates: {
    check: "updates:check",
  },
  notifications: {
    show: "notifications:show",
  },
};

module.exports = { CHANNELS };
