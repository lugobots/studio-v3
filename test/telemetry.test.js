const test = require("node:test");
const assert = require("node:assert/strict");
const telemetry = require("../src/main/services/telemetry");

test("shouldCollect requires enabled flag and non-empty app key", () => {
  assert.equal(telemetry.shouldCollect({ enabled: true, appKey: "" }), false);
  assert.equal(telemetry.shouldCollect({ enabled: false, appKey: "A-TEST" }), false);
  assert.equal(telemetry.shouldCollect({ enabled: true, appKey: "A-TEST" }), true);
});

test("init runs with App Key even when privacy is off; track still gates", () => {
  telemetry.resetForTests();
  const events = [];
  let initializedKey = "";
  telemetry.useSdk({
    initialize: (key) => {
      initializedKey = key;
    },
    trackEvent: (name, props) => events.push({ name, props }),
  });

  telemetry.configure({ appKey: "", enabled: true, appVersion: "0.2.1" });
  assert.equal(telemetry.init(), false);
  assert.equal(telemetry.track("app_started"), false);

  telemetry.configure({ appKey: "A-TEST", enabled: false, appVersion: "0.2.1" });
  assert.equal(telemetry.init(), true);
  assert.equal(initializedKey, "A-TEST");
  assert.equal(telemetry.track("app_started"), false);

  telemetry.setEnabled(true);
  assert.equal(telemetry.track("app_started"), true);
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "app_started");
  assert.equal(events[0].props.app_version, "0.2.1");

  telemetry.setEnabled(false);
  assert.equal(telemetry.track("app_closed"), false);
  assert.equal(events.length, 1);
});

test("setEnabled toggles tracking after early init", () => {
  telemetry.resetForTests();
  const events = [];
  telemetry.useSdk({
    initialize: () => {},
    trackEvent: (name, props) => events.push({ name, props }),
  });
  telemetry.configure({ appKey: "A-TEST", enabled: false, appVersion: "9.9.9" });
  assert.equal(telemetry.init(), true);
  assert.equal(telemetry.track("login"), false);
  telemetry.setEnabled(true);
  assert.equal(telemetry.track("login"), true);
  assert.equal(events[0].name, "login");
  assert.equal(events[0].props.app_version, "9.9.9");
});

test("sanitizeProps truncates messages and strips home paths", () => {
  const props = telemetry.sanitizeProps({
    message: "x".repeat(250),
    path: "/home/alice/bots/demo",
    ok: true,
    skip: null,
  });
  assert.equal(props.message.length, 200);
  assert.equal(props.path, "~/bots/demo");
  assert.equal(props.ok, 1);
  assert.equal(props.skip, undefined);
});

test("trackError emits truncated app_error without throwing", () => {
  telemetry.resetForTests();
  const events = [];
  telemetry.useSdk({
    initialize: () => {},
    trackEvent: (name, props) => events.push({ name, props }),
  });
  telemetry.configure({ appKey: "A-TEST", enabled: true, appVersion: "0.2.1" });
  assert.equal(telemetry.init(), true);
  assert.equal(
    telemetry.trackError({
      source: "main",
      type: "uncaughtException",
      message: "boom ".repeat(80),
    }),
    true,
  );
  assert.equal(events[0].name, "app_error");
  assert.equal(events[0].props.source, "main");
  assert.ok(events[0].props.message.length <= 200);
  assert.equal(events[0].props.app_version, "0.2.1");
});
