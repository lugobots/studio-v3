"use strict";

const CHANNELS = {
  docker: {
    status: "docker:status",
    pull: "docker:pull",
    progress: "docker:progress",
    ensureRef: "docker:ensure-ref",
    ensureLevel1: "docker:ensure-level1",
    ensureEditor: "docker:ensure-editor",
    stopEditor: "docker:stop-editor",
    openInstallPage: "docker:open-install-page",
  },
  config: {
    get: "config:get",
    set: "config:set",
    matchGet: "config:match-get",
    matchSet: "config:match-set",
    opponentGet: "config:opponent-get",
    opponentSet: "config:opponent-set",
    opponentRemember: "config:opponent-remember",
    opponentForget: "config:opponent-forget",
  },
  updates: {
    check: "updates:check",
    apply: "updates:apply",
    progress: "updates:progress",
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
    reset: "match:reset",
    getPositions: "match:get-positions",
    applyPositions: "match:apply-positions",
  },
  bot: {
    start: "bot:start",
    stop: "bot:stop",
    status: "bot:status",
  },
  logs: {
    arm: "logs:arm",
    disarm: "logs:disarm",
    watch: "logs:watch",
    unwatch: "logs:unwatch",
    event: "logs:event",
  },
  publish: {
    bot: "publish:bot",
    authStatus: "publish:auth-status",
    authLogin: "publish:auth-login",
    authLogout: "publish:auth-logout",
  },
  account: {
    status: "account:status",
    signIn: "account:sign-in",
    signOut: "account:sign-out",
    profile: "account:profile",
    bots: "account:bots",
    botTags: "account:bot-tags",
    openExternal: "account:open-external",
  },
};

module.exports = { CHANNELS };
