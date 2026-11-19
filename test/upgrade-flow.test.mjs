import test from "node:test";
import assert from "node:assert/strict";
import { createDialogController } from "../src/renderer/lib/dialog-controller.js";
import { offerUpgrade, runAcceptedUpgrade } from "../src/renderer/lib/upgrade-flow.js";

test("offerUpgrade declines without opening the busy dialog", async () => {
  const dialogs = createDialogController();
  const tracks = [];
  const pending = offerUpgrade(
    {
      updates: {
        apply: async () => {
          throw new Error("should not apply");
        },
      },
      telemetry: {
        track(name) {
          tracks.push(name);
        },
      },
    },
    dialogs,
  );
  assert.equal(dialogs.snapshot().blocking.kind, "confirm");
  dialogs.answer(false);
  const result = await pending;
  assert.deepEqual(result, { ok: false, declined: true });
  assert.equal(dialogs.snapshot().blocking, null);
  assert.deepEqual(tracks, []);
});

test("offerUpgrade tracks update_accepted when confirmed", async () => {
  const dialogs = createDialogController();
  const tracks = [];
  const pending = offerUpgrade(
    {
      updates: {
        apply: async () => ({ ok: true }),
      },
      telemetry: {
        track(name) {
          tracks.push(name);
        },
      },
    },
    dialogs,
  );
  dialogs.answer(true);
  const result = await pending;
  assert.equal(result.ok, true);
  assert.deepEqual(tracks, ["update_accepted"]);
});

test("runAcceptedUpgrade shows busy progress then clears it", async () => {
  const dialogs = createDialogController();
  let progressCb = null;
  const host = {
    updates: {
      onProgress(callback) {
        progressCb = callback;
        return () => {
          progressCb = null;
        };
      },
      async apply() {
        assert.equal(dialogs.snapshot().blocking.kind, "busy");
        progressCb({
          phase: "download",
          percent: 40,
          label: "Downloading update",
          detail: "Downloaded 40%",
        });
        assert.equal(dialogs.snapshot().blocking.percent, 40);
        return { ok: true };
      },
    },
  };

  const result = await runAcceptedUpgrade(host, dialogs);
  assert.equal(result.ok, true);
  assert.equal(dialogs.snapshot().blocking, null);
});
