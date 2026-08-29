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
  app: {
    version: "app:version",
  },
  updates: {
    check: "updates:check",
    download: "updates:download",
    cancel: "updates:cancel",
    progress: "updates:progress",
  },
  notifications: {
    show: "notifications:show",
    shown: "notifications:shown",
  },
};

module.exports = { CHANNELS };
