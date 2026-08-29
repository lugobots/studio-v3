"use strict";

const CHANNELS = {
  docker: {
    status: "docker:status",
    imageStatus: "docker:image-status",
    imageEnsure: "docker:image-ensure",
    imageProgress: "docker:image-progress",
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
