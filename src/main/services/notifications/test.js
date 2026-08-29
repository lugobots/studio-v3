"use strict";

const { createNotificationService, normalizePayload } = require("./index");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`ok  ${message}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${message}`);
  }
}

class FakeNotification {
  constructor(opts) {
    this.opts = opts;
    this.shown = false;
    FakeNotification.instances.push(this);
  }

  show() {
    this.shown = true;
  }
}

FakeNotification.instances = [];
FakeNotification.isSupported = () => true;

function runTests() {
  console.log("== normalizePayload ==");
  assert(normalizePayload(null) == null, "null payload is rejected");
  assert(normalizePayload({ title: "" }) == null, "empty title is rejected");
  assert(normalizePayload({ title: 1 }) == null, "non-string title is rejected");
  assert(normalizePayload({ title: "Update available" }).title === "Update available", "title is kept");
  assert(normalizePayload({ title: "Pull failed" }).body == null, "missing body is omitted");
  assert(
    normalizePayload({ title: "Pull failed", body: "manifest unknown" }).body === "manifest unknown",
    "string body is kept"
  );
  assert(normalizePayload({ title: "Hi", body: { html: "<b>x</b>" } }).body == null, "non-string body is dropped");
  const longTitle = "x".repeat(250);
  assert(normalizePayload({ title: longTitle }).title.length === 200, "title is capped");

  console.log("\n== native supported ==");
  FakeNotification.instances = [];
  const broadcasts = [];
  const supported = createNotificationService({
    Notification: FakeNotification,
    isSupported: () => true,
    broadcast: (payload) => broadcasts.push(payload),
  });
  const nativeResult = supported.show({ title: "Studio image pull failed", body: "manifest unknown" });
  assert(nativeResult.shown === true, "valid payload is shown");
  assert(nativeResult.native === true, "supported OS notification is native");
  assert(FakeNotification.instances.length === 1, "one native notification is constructed");
  assert(FakeNotification.instances[0].shown === true, "native notification is shown");
  assert(FakeNotification.instances[0].opts.title === "Studio image pull failed", "native title is the sanitized string");
  assert(broadcasts.length === 1, "renderer toast is broadcast even when native succeeds");
  assert(broadcasts[0].title === "Studio image pull failed", "broadcast title matches");

  console.log("\n== native unsupported still toasts ==");
  const toasts = [];
  let constructed = 0;
  const unsupported = createNotificationService({
    Notification: function Broken() {
      constructed += 1;
    },
    isSupported: () => false,
    broadcast: (payload) => toasts.push(payload),
  });
  const toastOnly = unsupported.show({ title: "Update available" });
  assert(toastOnly.shown === true, "unsupported OS still reports shown");
  assert(toastOnly.native === false, "unsupported OS is not native");
  assert(constructed === 0, "Notification is not constructed when unsupported");
  assert(toasts.length === 1 && toasts[0].title === "Update available", "in-app toast is still broadcast");

  console.log("\n== native throw still toasts ==");
  const fallback = [];
  const throwing = createNotificationService({
    Notification: function Boom() {
      throw new Error("no permission");
    },
    isSupported: () => true,
    broadcast: (payload) => fallback.push(payload),
  });
  const threw = throwing.show({ title: "Download failed", body: "disk full" });
  assert(threw.shown === true, "constructor failure still shows in-app");
  assert(threw.native === false, "constructor failure is not native");
  assert(fallback.length === 1, "toast is broadcast after native failure");

  console.log("\n== invalid payload does not spam ==");
  const ignored = [];
  const strict = createNotificationService({
    Notification: FakeNotification,
    isSupported: () => true,
    broadcast: (payload) => ignored.push(payload),
  });
  const before = FakeNotification.instances.length;
  assert(strict.show({ title: "", body: "tick 12%" }).shown === false, "empty title is not shown");
  assert(strict.show(undefined).shown === false, "missing payload is not shown");
  assert(FakeNotification.instances.length === before, "invalid payload creates no native notification");
  assert(ignored.length === 0, "invalid payload is not broadcast");
}

runTests();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
