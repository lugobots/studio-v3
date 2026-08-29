import {
  PATHS,
  destinationForProjectCreated,
  guardStartupRoute,
  hashGuard,
  nextStepAfterDockerStatus,
  runStartupSequencer,
} from "./startup-sequencer.mjs";

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

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createDeferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createMockStudio(overrides = {}) {
  const calls = {
    status: 0,
    ensureImage: 0,
    imageStatus: 0,
    configGet: 0,
  };

  const studio = {
    docker: {
      status: async () => {
        calls.status += 1;
        if (typeof overrides.status === "function") {
          return overrides.status();
        }
        if (overrides.statusError) {
          throw overrides.statusError;
        }
        return {
          running: overrides.running === true,
          reason: overrides.running === true ? "ok" : "not_running",
        };
      },
      ensureImage: async () => {
        calls.ensureImage += 1;
        if (typeof overrides.ensureImage === "function") {
          return overrides.ensureImage();
        }
        if (overrides.ensureImageError) {
          throw overrides.ensureImageError;
        }
        return { present: false, pulling: true, error: null };
      },
      imageStatus: async () => {
        calls.imageStatus += 1;
        if (typeof overrides.imageStatus === "function") {
          return overrides.imageStatus();
        }
        return { present: false, pulling: true, error: null };
      },
    },
    config: {
      get: async () => {
        calls.configGet += 1;
        if (typeof overrides.configGet === "function") {
          return overrides.configGet();
        }
        if (overrides.configError) {
          throw overrides.configError;
        }
        return {
          projectCreated: overrides.projectCreated === true,
          projectPath: overrides.projectCreated === true ? "/tmp/bot" : null,
        };
      },
    },
  };

  return { studio, calls };
}

function createNavigate() {
  const paths = [];
  function navigate(path) {
    paths.push(path);
  }
  return { navigate, paths };
}

async function runTests() {
  console.log("== pure decisions ==");
  assert(nextStepAfterDockerStatus(false) === "docker-check", "docker down → docker-check step");
  assert(nextStepAfterDockerStatus(true) === "q1-then-q2", "docker up → Q1 then Q2");
  assert(destinationForProjectCreated(false) === PATHS.startProject, "Q2 no → start-project");
  assert(destinationForProjectCreated(true) === PATHS.main, "Q2 yes → main");
  assert(hashGuard(PATHS.main, { projectCreated: false }) === PATHS.startProject, "#/main with Q2 no → welcome");
  assert(hashGuard(PATHS.main, { projectCreated: true }) === null, "#/main with Q2 yes → stay");
  assert(hashGuard(PATHS.startProject, { projectCreated: true }) === PATHS.main, "#/start-project with Q2 yes → main");
  assert(hashGuard(PATHS.startProject, { projectCreated: false }) === null, "#/start-project with Q2 no → stay");

  console.log("\n== Docker down → docker-check ==");
  {
    const { studio, calls } = createMockStudio({ running: false, projectCreated: false });
    const { navigate, paths } = createNavigate();
    const result = await runStartupSequencer({ studio, navigate, minDisplayMs: 0 });
    assert(result.ok === true && result.path === PATHS.dockerCheck, "path is docker-check");
    assert(paths.join(",") === PATHS.dockerCheck, "navigates to docker-check");
    assert(calls.status === 1, "docker.status called");
    assert(calls.ensureImage === 0, "ensureImage not called when daemon is down");
    assert(calls.configGet === 0, "config.get not called when daemon is down");
  }

  console.log("\n== Docker up, projectCreated false → start-project, ensureImage called ==");
  {
    const { studio, calls } = createMockStudio({ running: true, projectCreated: false });
    const { navigate, paths } = createNavigate();
    const result = await runStartupSequencer({ studio, navigate, minDisplayMs: 0 });
    assert(result.ok === true && result.path === PATHS.startProject, "path is start-project");
    assert(paths.join(",") === PATHS.startProject, "navigates to start-project");
    assert(calls.ensureImage === 1, "ensureImage called");
    assert(calls.configGet === 1, "config.get called");
    assert(paths.includes(PATHS.dockerCheck) === false, "does not flash docker-check");
  }

  console.log("\n== Docker up, projectCreated true → main, ensureImage called ==");
  {
    const { studio, calls } = createMockStudio({ running: true, projectCreated: true });
    const { navigate, paths } = createNavigate();
    const result = await runStartupSequencer({ studio, navigate, minDisplayMs: 0 });
    assert(result.ok === true && result.path === PATHS.main, "path is main");
    assert(paths.join(",") === PATHS.main, "navigates to main");
    assert(calls.ensureImage === 1, "ensureImage called");
  }

  console.log("\n== ensureImage is not awaited for pull completion ==");
  {
    const pullDone = createDeferred();
    let pullFinished = false;
    void pullDone.promise.then(() => {
      pullFinished = true;
    });
    const { studio, calls } = createMockStudio({
      running: true,
      projectCreated: false,
      ensureImage: async () => {
        // Return while pulling. The sequencer must not wait on pullDone.
        return { present: false, pulling: true, error: null };
      },
    });
    const { navigate, paths } = createNavigate();
    const started = Date.now();
    const result = await runStartupSequencer({ studio, navigate, minDisplayMs: 0 });
    const elapsed = Date.now() - started;
    assert(elapsed < 500, "sequencer returns without waiting for pull completion");
    assert(result.ok === true && result.path === PATHS.startProject, "continues to start-project while pulling");
    assert(paths[0] === PATHS.startProject, "navigated while pulling");
    assert(pullFinished === false, "background pull is still in flight");
    assert(calls.imageStatus === 0, "does not poll imageStatus for pull completion");
    pullDone.resolve();
    await delay(0);
  }

  console.log("\n== #/main with Q2 no → welcome ==");
  {
    const { studio, calls } = createMockStudio({ projectCreated: false });
    const { navigate, paths } = createNavigate();
    const result = await guardStartupRoute({ path: PATHS.main, studio, navigate });
    assert(result.redirected === true && result.path === PATHS.startProject, "guard sends /main to welcome");
    assert(paths.join(",") === PATHS.startProject, "navigates to start-project");
    assert(calls.configGet === 1, "guard reads config");
  }

  console.log("\n== #/start-project with Q2 yes → main ==");
  {
    const { studio } = createMockStudio({ projectCreated: true });
    const { navigate, paths } = createNavigate();
    const result = await guardStartupRoute({ path: PATHS.startProject, studio, navigate });
    assert(result.redirected === true && result.path === PATHS.main, "guard sends welcome to main");
    assert(paths.join(",") === PATHS.main, "navigates to main");
  }

  console.log("\n== docker-check resume skips daemon check and still runs Q1 then Q2 ==");
  {
    const { studio, calls } = createMockStudio({
      running: false,
      projectCreated: true,
    });
    const { navigate, paths } = createNavigate();
    const result = await runStartupSequencer({
      studio,
      navigate,
      dockerAlreadyRunning: true,
      minDisplayMs: 0,
    });
    assert(calls.status === 0, "resume does not re-query docker.status");
    assert(calls.ensureImage === 1, "resume still calls ensureImage");
    assert(result.path === PATHS.main, "resume uses Q2 to reach main");
    assert(paths.join(",") === PATHS.main, "resume navigates to main, not docker-check");
  }

  console.log("\n== checks throw → do not send the user to /main ==");
  {
    const { studio } = createMockStudio({ statusError: new Error("status failed") });
    const { navigate, paths } = createNavigate();
    const result = await runStartupSequencer({ studio, navigate, minDisplayMs: 0 });
    assert(result.ok === false, "docker status throw → not ok");
    assert(paths.length === 0, "docker status throw → no navigation");
  }
  {
    const { studio, calls } = createMockStudio({
      running: true,
      configError: new Error("config failed"),
    });
    const { navigate, paths } = createNavigate();
    const result = await runStartupSequencer({ studio, navigate, minDisplayMs: 0 });
    assert(calls.ensureImage === 1, "Q1 still runs if config later fails");
    assert(result.ok === false, "config throw → not ok");
    assert(paths.includes(PATHS.main) === false, "config throw → not sent to /main");
    assert(paths.length === 0, "config throw → stay put");
  }
  {
    const { studio, calls } = createMockStudio({
      running: true,
      projectCreated: true,
      ensureImageError: new Error("ensure failed"),
    });
    const { navigate, paths } = createNavigate();
    const result = await runStartupSequencer({ studio, navigate, minDisplayMs: 0 });
    assert(calls.ensureImage === 1, "ensureImage was invoked");
    assert(result.ok === true && result.path === PATHS.main, "ensureImage throw does not block Q2");
    assert(paths.join(",") === PATHS.main, "still navigates after ensureImage throw");
  }
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
