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
    retry: "startup:retry",
    route: "startup:route",
    current: "startup:current",
    progress: "startup:progress",
  },
  project: {
    pickFolder: "project:pick-folder",
    open: "project:open",
    create: "project:create",
    remove: "project:remove",
  },
  server: {
    start: "server:start",
    stop: "server:stop",
    status: "server:status",
    watchStatus: "server:watch-status",
    statusEvent: "server:status-event",
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
