import {
  DIALOG_KIND,
  asDialogText,
  backdropAction,
  canBackdropDismiss,
  canEscapeDismiss,
  createDialogSession,
  escapeAction,
  isDeterminateProgress,
  nextFocusIndex,
  normalizeProgress,
} from "./dialog-policy.mjs";
import { TOAST_MAX_VISIBLE, capToastList } from "./toast-policy.mjs";

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

async function runTests() {
  console.log("== text + progress ==");
  assert(asDialogText("Folder is not a bot") === "Folder is not a bot", "string body is kept");
  assert(asDialogText(null, "") === "", "null body uses fallback");
  assert(asDialogText({ html: "<b>no</b>" }, "") === "", "objects are not stringified into the dialog");
  assert(asDialogText(0.5) === "0.5", "finite numbers can be detail text");
  assert(isDeterminateProgress(0) === true, "0 is determinate");
  assert(isDeterminateProgress(1) === true, "1 is determinate");
  assert(isDeterminateProgress(0.4) === true, "0.4 is determinate");
  assert(isDeterminateProgress(null) === false, "null is indeterminate");
  assert(isDeterminateProgress(undefined) === false, "undefined is indeterminate");
  assert(isDeterminateProgress(1.2) === false, "value above 1 is indeterminate");
  assert(isDeterminateProgress(-0.1) === false, "value below 0 is indeterminate");
  assert(normalizeProgress(0.25) === 0.25, "normalize keeps 0–1");
  assert(normalizeProgress(2) === null, "out-of-range progress becomes indeterminate");

  console.log("\n== escape + backdrop policy ==");
  assert(canEscapeDismiss(DIALOG_KIND.CONFIRM) === true, "Escape cancels confirm");
  assert(canEscapeDismiss(DIALOG_KIND.ERROR) === true, "Escape dismisses error");
  assert(canEscapeDismiss(DIALOG_KIND.PROGRESS, { hasCancelHandler: false }) === false, "Escape does not dismiss progress without cancel");
  assert(canEscapeDismiss(DIALOG_KIND.PROGRESS, { hasCancelHandler: true }) === true, "Escape cancels progress when cancel exists");
  assert(canBackdropDismiss(DIALOG_KIND.CONFIRM) === true, "backdrop cancels confirm");
  assert(canBackdropDismiss(DIALOG_KIND.ERROR) === true, "backdrop dismisses error");
  assert(canBackdropDismiss(DIALOG_KIND.PROGRESS) === false, "backdrop never dismisses progress");
  assert(escapeAction(DIALOG_KIND.CONFIRM) === "cancel", "Escape on confirm → cancel");
  assert(escapeAction(DIALOG_KIND.ERROR) === "dismiss", "Escape on error → dismiss");
  assert(escapeAction(DIALOG_KIND.PROGRESS, { hasCancelHandler: false }) === null, "Escape on progress without cancel → none");
  assert(escapeAction(DIALOG_KIND.PROGRESS, { hasCancelHandler: true }) === "cancel", "Escape on progress with cancel → cancel");
  assert(backdropAction(DIALOG_KIND.PROGRESS) === null, "backdrop action on progress is none");

  console.log("\n== focus wrap ==");
  assert(nextFocusIndex(0, 3, false) === 1, "Tab moves to the next control");
  assert(nextFocusIndex(2, 3, false) === 0, "Tab wraps from last to first");
  assert(nextFocusIndex(0, 3, true) === 2, "Shift+Tab wraps from first to last");
  assert(nextFocusIndex(-1, 2, false) === 0, "Tab from the card focuses the first control");
  assert(nextFocusIndex(-1, 2, true) === 1, "Shift+Tab from the card focuses the last control");

  console.log("\n== toast cap ==");
  assert(TOAST_MAX_VISIBLE === 3, "visible toast cap is three");
  assert(capToastList(["a"], "b").join(",") === "a,b", "under the cap, toasts stack");
  assert(capToastList(["a", "b", "c"], "d").join(",") === "b,c,d", "fourth toast drops the oldest");

  console.log("\n== queue order (error then confirm is not lost) ==");
  const queued = createDialogSession();
  const folderError = queued.requestError({ title: "Not a bot folder", body: "Missing .lugo/info.json" });
  const updateConfirm = queued.requestConfirm({
    title: "Update available",
    body: "Download the new Studio version?",
    primaryLabel: "Download",
  });
  assert(queued.getCurrent().kind === DIALOG_KIND.ERROR, "folder error is shown first");
  assert(queued.getPendingCount() === 1, "update confirm waits in the queue");
  queued.handleEscape();
  await folderError;
  assert(queued.getCurrent().kind === DIALOG_KIND.CONFIRM, "update confirm is shown after the error");
  assert(queued.getCurrent().title === "Update available", "queued confirm keeps its title");
  queued.handlePrimary();
  assert((await updateConfirm) === true, "confirm accept returns true");
  assert(queued.getCurrent() == null, "queue is empty after the confirm");

  console.log("\n== confirm cancel vs accept ==");
  const session = createDialogSession();
  const cancelled = session.requestConfirm({ title: "Download update?", body: "About 40 MB." });
  session.handleBackdrop();
  assert((await cancelled) === false, "backdrop cancel returns false");
  const accepted = session.requestConfirm({ title: "Download update?", body: "About 40 MB." });
  session.handleSecondary();
  assert((await accepted) === false, "secondary cancel returns false");
  const ok = session.requestConfirm({ title: "Download update?", body: "About 40 MB.", primaryLabel: "Download" });
  session.handlePrimary();
  assert((await ok) === true, "primary accept returns true");

  console.log("\n== progress cannot dismiss without cancel handler ==");
  const progressSession = createDialogSession();
  const busy = progressSession.requestProgress({ title: "Downloading update", detail: "Starting…", progress: 0.2 });
  assert(progressSession.getCurrent().kind === DIALOG_KIND.PROGRESS, "progress is visible");
  assert(progressSession.getCurrent().progress === 0.2, "0–1 progress is determinate");
  assert(progressSession.handleEscape() == null, "Escape does not close progress without cancel");
  assert(progressSession.handleBackdrop() == null, "backdrop does not close progress");
  assert(progressSession.handleSecondary() == null, "no cancel button action without handler");
  assert(progressSession.getCurrent() != null, "progress stays open");
  busy.update({ detail: "12 MB", progress: 0.5 });
  assert(progressSession.getCurrent().detail === "12 MB", "progress detail updates");
  assert(progressSession.getCurrent().progress === 0.5, "progress value updates");
  busy.close();
  assert(progressSession.getCurrent() == null, "caller close dismisses progress");
  assert((await busy.closed) === "close", "progress close settles with close");

  console.log("\n== progress cancel handler ==");
  let cancelledPulls = 0;
  const cancelSession = createDialogSession();
  const pulling = cancelSession.requestProgress({
    title: "Pulling Studio image",
    onCancel: () => {
      cancelledPulls += 1;
    },
  });
  assert(cancelSession.getCurrent().hasCancelHandler === true, "cancel handler is recorded");
  assert(cancelSession.getCurrent().progress === null, "missing 0–1 value is indeterminate");
  cancelSession.handleEscape();
  assert(cancelledPulls === 1, "Escape with cancel handler invokes it");
  assert((await pulling.closed) === "cancel", "progress cancel settles with cancel");

  console.log("\n== FIFO confirms ==");
  const fifo = createDialogSession();
  const first = fifo.requestConfirm({ title: "First", body: "a" });
  const second = fifo.requestConfirm({ title: "Second", body: "b" });
  const third = fifo.requestConfirm({ title: "Third", body: "c" });
  assert(fifo.getCurrent().title === "First", "first confirm is current");
  assert(fifo.getPendingCount() === 2, "two confirms wait");
  fifo.handlePrimary();
  assert((await first) === true, "first confirm resolved first");
  assert(fifo.getCurrent().title === "Second", "second confirm follows");
  fifo.handleSecondary();
  assert((await second) === false, "second confirm cancelled");
  assert(fifo.getCurrent().title === "Third", "third confirm is last");
  fifo.handlePrimary();
  assert((await third) === true, "third confirm resolved last");

  console.log("\n== progress queued behind confirm keeps updates ==");
  const mixed = createDialogSession();
  const blocking = mixed.requestConfirm({ title: "Blocking", body: "Wait" });
  const later = mixed.requestProgress({ title: "Download", detail: "0%" });
  later.update({ detail: "80%", progress: 0.8 });
  assert(mixed.getCurrent().kind === DIALOG_KIND.CONFIRM, "confirm stays in front");
  mixed.handlePrimary();
  await blocking;
  assert(mixed.getCurrent().kind === DIALOG_KIND.PROGRESS, "queued progress becomes current");
  assert(mixed.getCurrent().detail === "80%", "updates applied while queued are visible");
  assert(mixed.getCurrent().progress === 0.8, "queued progress value is kept");
  later.close();
}

runTests()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) {
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
