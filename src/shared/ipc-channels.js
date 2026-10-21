"use strict";

const CHANNELS = {
  docker: {
    status: "docker:status",
    pull: "docker:pull",
    progress: "docker:progress",
  },
  config: {
    get: "config:get",
    set: "config:set",
  },
  updates: {
    check: "updates:check",
    apply: "updates:apply",
  },
  notifications: {
    show: "notifications:show",
    event: "notifications:event",
  },
  startup: {
    next: "startup:next",
  },
  project: {
    pickFolder: "project:pick-folder",
    open: "project:open",
    create: "project:create",
  },
  match: {
    start: "match:start",
    status: "match:status",
  },
  publish: {
    bot: "publish:bot",
  },
};

module.exports = { CHANNELS };
