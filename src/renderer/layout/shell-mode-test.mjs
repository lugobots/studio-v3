import { PATHS } from "../lib/startup-sequencer.mjs";
import {
  SHELL_MODE,
  dockerStatusText,
  imageStateFromSnapshot,
  imageStatusText,
  projectPathFromConfig,
  shellModeForRoute,
  studioVersionText,
  truncatePath,
} from "./shell-mode.mjs";

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

function runTests() {
  console.log("== shell mode by route ==");
  assert(shellModeForRoute(PATHS.main) === SHELL_MODE.MAIN, "/main → chrome (main)");
  assert(shellModeForRoute("/main") === SHELL_MODE.MAIN, "literal /main → chrome");
  assert(shellModeForRoute(PATHS.loading) === SHELL_MODE.SIMPLE, "/loading → simple");
  assert(shellModeForRoute(PATHS.dockerCheck) === SHELL_MODE.SIMPLE, "/docker-check → simple");
  assert(shellModeForRoute(PATHS.startProject) === SHELL_MODE.SIMPLE, "/start-project → simple");
  assert(shellModeForRoute("/settings") === SHELL_MODE.SIMPLE, "unbuilt /settings → simple (no stub chrome)");
  assert(shellModeForRoute("/images") === SHELL_MODE.SIMPLE, "unbuilt /images → simple (no stub chrome)");
  assert(shellModeForRoute("") === SHELL_MODE.SIMPLE, "empty path → simple");
  assert(shellModeForRoute("/unknown") === SHELL_MODE.SIMPLE, "unknown route → simple");

  console.log("\n== truncatePath ==");
  assert(truncatePath("C:\\bots\\alpha") === "C:\\bots\\alpha", "short path is unchanged");
  assert(truncatePath("  D:\\ok  ") === "D:\\ok", "trims surrounding whitespace");
  assert(truncatePath("") === "", "empty string → empty");
  assert(truncatePath("   ") === "", "whitespace-only → empty");
  assert(truncatePath(null) === "", "null → empty");
  assert(truncatePath(undefined) === "", "undefined → empty");
  assert(truncatePath({ path: "C:\\nope" }) === "", "object is not stringified");

  const longWin =
    "C:\\Users\\ruben\\AppData\\Roaming\\Projects\\very-long-lugo-bot-folder-name";
  const truncated = truncatePath(longWin, 40);
  assert(truncated.length <= 40, "truncated length respects maxLength");
  assert(truncated.includes("…"), "long path uses a middle ellipsis");
  assert(truncated.startsWith("C:\\Us"), "keeps a Windows prefix");
  assert(truncated.endsWith("folder-name") || truncated.includes("bot-folder"), "keeps a leaf suffix");
  assert(truncated !== longWin, "long path actually shortens");
  assert(longWin.includes("very-long-lugo"), "original path is not mutated");

  const alreadyShort = "E:\\bot";
  assert(truncatePath(alreadyShort, 40) === alreadyShort, "path under maxLength is returned as-is");

  console.log("\n== status labels ==");
  assert(dockerStatusText(true) === "Docker: yes", "docker running → yes");
  assert(dockerStatusText(false) === "Docker: no", "docker not running → no");
  assert(dockerStatusText(null) === "Docker: unknown", "docker null → unknown");
  assert(dockerStatusText(undefined) === "Docker: unknown", "docker missing → unknown");

  assert(imageStateFromSnapshot(null) === null, "missing snapshot → null (unknown, not ready)");
  assert(imageStateFromSnapshot({ state: "pulling", pulling: true }) === "pulling", "progress state wins");
  assert(imageStateFromSnapshot({ state: "ready" }) === "ready", "ready state");
  assert(imageStateFromSnapshot({ state: "error" }) === "error", "error state");
  assert(imageStateFromSnapshot({ state: "idle" }) === "idle", "idle state");
  assert(imageStateFromSnapshot({ pulling: true }) === "pulling", "imageStatus pulling flag");
  assert(imageStateFromSnapshot({ present: true }) === "ready", "imageStatus present → ready");
  assert(imageStateFromSnapshot({ error: "pull failed" }) === "error", "imageStatus error string");
  assert(imageStateFromSnapshot({ present: false, pulling: false, error: null }) === "idle", "empty status → idle");

  assert(imageStatusText(null) === "Image: unknown", "null state → unknown");
  assert(imageStatusText("idle") === "Image: idle", "idle label");
  assert(imageStatusText("pulling") === "Image: pulling", "pulling label");
  assert(imageStatusText("pulling", 42) === "Image: pulling (42%)", "pulling includes percent");
  assert(imageStatusText("pulling", 42.6) === "Image: pulling (43%)", "percent is rounded");
  assert(imageStatusText("ready", 100) === "Image: ready", "ready ignores percent");
  assert(imageStatusText("error") === "Image: error", "error label");

  assert(studioVersionText("0.1.0") === "Studio 0.1.0", "package version");
  assert(studioVersionText("  1.2.3  ") === "Studio 1.2.3", "trims version");
  assert(studioVersionText("") === "Studio version pending", "empty version → pending");
  assert(studioVersionText(null) === "Studio version pending", "null version → pending");

  console.log("\n== projectPathFromConfig ==");
  assert(projectPathFromConfig({ projectPath: "C:\\bots\\alpha" }) === "C:\\bots\\alpha", "uses projectPath");
  assert(
    projectPathFromConfig({ projectPath: null, project_path: "D:\\legacy" }) === "D:\\legacy",
    "falls back to project_path when derived is null",
  );
  assert(projectPathFromConfig({ projectPath: ".", project_path: "." }) === "", "dot default is not a path");
  assert(projectPathFromConfig(null) === "", "null config → empty");
  assert(projectPathFromConfig({ projectPath: "<b>no</b>" }) === "<b>no</b>", "path is returned as plain text, not parsed as HTML");
}

runTests();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
