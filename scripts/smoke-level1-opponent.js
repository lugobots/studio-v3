#!/usr/bin/env node
/**
 * Scripted smoke for OpenSpec studio-v3-pull-level-1-binary task 3.2.
 *
 * Proves against real Docker:
 *   1) ensureLevel1Binary pulls/extracts lugobots/level-1 into the host cache
 *   2) Studio API container runArgs mount + LUGO_STUDIO_OPPONENT_BOT expose it
 *   3) POST /api/game/start with active opponent rows succeeds (no missing
 *      /usr/local/lib/lugo/bot-level-1) while inactive rows stay stopped
 *
 * Uses a dedicated container/ports so it does not disturb a running Studio session.
 */
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const store = require("../src/main/services/config/store");
const { ensureLevel1Binary } = require("../src/main/services/docker/level1");
const { runArgs } = require("../src/main/services/docker/args");
const { DEFAULTS } = require("../src/shared/ports");

const SMOKE_NAME = "lugo-studio-v3-level1-smoke";
/** Dedicated tag built from the current tree so active-set + opponent env match HEAD. */
const SMOKE_IMAGE = process.env.LUGO_STUDIO_IMAGE || "lugobots/studio-v3-api:level1-smoke";
const SMOKE_ENV = {
  LUGO_STUDIO_API_PORT: "18081",
  LUGO_STUDIO_GAME_SERVER_PORT: "15000",
  LUGO_STUDIO_GAME_FRONTEND_PORT: "18080",
  LUGO_STUDIO_IMAGE: SMOKE_IMAGE,
};

async function ensureSmokeApiImage() {
  const inspected = await execDocker(["image", "inspect", SMOKE_IMAGE], 15000);
  if (inspected.ok) {
    log("image", `using ${SMOKE_IMAGE}`);
    return;
  }
  if (process.env.LUGO_STUDIO_IMAGE) {
    fail(`LUGO_STUDIO_IMAGE=${SMOKE_IMAGE} is not present locally`);
  }
  const root = path.join(__dirname, "..");
  log("image", `building ${SMOKE_IMAGE} from ${root}/Dockerfile`);
  const rebuild = await new Promise((resolve) => {
    const child = spawn("docker", ["build", "-t", SMOKE_IMAGE, "-f", "Dockerfile", "."], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, stdout, stderr: `${stderr}\ntimeout building API image` });
    }, 600000);
    child.stdout.on("data", (c) => {
      stdout += c;
    });
    child.stderr.on("data", (c) => {
      stderr += c;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: error.message });
    });
  });
  if (!rebuild.ok) {
    fail(`docker build failed: ${(rebuild.stderr || rebuild.stdout).trim()}`);
  }
  log("image", `built ${SMOKE_IMAGE}`);
}

const API_BASE = `http://127.0.0.1:${SMOKE_ENV.LUGO_STUDIO_API_PORT}`;
const CONTAINER_BINARY = store.LEVEL1_CONTAINER_BINARY_PATH;

function log(step, detail) {
  process.stdout.write(`[smoke-level1] ${step}${detail ? `: ${detail}` : ""}\n`);
}

function fail(message) {
  process.stderr.write(`[smoke-level1] FAIL: ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

function execDocker(args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, stdout, stderr: `${stderr}\ntimeout after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr });
    });
  });
}

function request(method, urlPath, body) {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${API_BASE}${urlPath}`,
      {
        method,
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
          : {},
        timeout: 60000,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, raw, json });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error(`timeout ${method} ${urlPath}`));
    });
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function waitForApi(attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await request("GET", "/api/server/status");
      if (res.status === 200) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  fail(`API did not become ready at ${API_BASE}`);
}

function makeProjectDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-level1-smoke-project-"));
  fs.writeFileSync(path.join(dir, "requirements.txt"), "lugobot-client\n");
  fs.writeFileSync(
    path.join(dir, "main.py"),
    'print("smoke player stub")\n',
  );
  return dir;
}

async function cleanup(projectDir) {
  await execDocker(["rm", "-f", SMOKE_NAME], 20000);
  if (projectDir && fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
}

async function main() {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), "studio-level1-smoke-appdata-"));
  const projectDir = makeProjectDir();
  let cleaned = false;
  const finish = async () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    await cleanup(projectDir);
    fs.rmSync(appData, { recursive: true, force: true });
  };
  process.on("exit", () => {
    // best-effort sync cleanup if we crash mid-flight
  });
  process.on("SIGINT", async () => {
    await finish();
    process.exit(130);
  });

  try {
    log("docker", "checking daemon");
    const info = await execDocker(["info"], 30000);
    if (!info.ok) {
      fail(`Docker is not available: ${(info.stderr || info.stdout).trim()}`);
    }
    await ensureSmokeApiImage();

    const resolved = store.level1Resolved(
      {
        bot_level_1_image: "lugobots/level-1",
        bot_level_1_version: "v4",
      },
      appData,
      "linux",
    );
    log("extract", `ensuring ${resolved.ref} -> ${resolved.hostBinaryPath}`);
    const extracted = await ensureLevel1Binary({
      resolved,
      execDocker,
    });
    if (!extracted.ok) {
      fail(extracted.error || "Level-1 extract failed");
    }
    log(
      "extract",
      `ok cached=${Boolean(extracted.cached)} pulled=${Boolean(extracted.pulled)} path=${extracted.hostBinaryPath}`,
    );
    if (!fs.existsSync(extracted.hostBinaryPath)) {
      fail(`cache file missing after extract: ${extracted.hostBinaryPath}`);
    }

    // Negative control: image has no baked-in opponent binary.
    log("negative", "confirm API image has no baked-in bot-level-1");
    const baked = await execDocker(
      [
        "run",
        "--rm",
        "--entrypoint",
        "sh",
        SMOKE_ENV.LUGO_STUDIO_IMAGE,
        "-c",
        `if [ -e '${CONTAINER_BINARY}' ]; then echo PRESENT; else echo ABSENT; fi`,
      ],
      60000,
    );
    if (!baked.ok) {
      fail(`could not probe API image: ${(baked.stderr || baked.stdout).trim()}`);
    }
    if (!baked.stdout.includes("ABSENT")) {
      fail(`expected baked-in ${CONTAINER_BINARY} to be absent; got: ${baked.stdout.trim()}`);
    }
    log("negative", "API image has no baked-in opponent binary (as designed)");

    await execDocker(["rm", "-f", SMOKE_NAME], 20000);

    // Patch runArgs output to use the smoke container name.
    const args = runArgs(projectDir, SMOKE_ENV, projectDir, {
      hostBinaryPath: extracted.hostBinaryPath,
      containerBinaryPath: CONTAINER_BINARY,
    }).map((part) => (part === DEFAULTS.containerName ? SMOKE_NAME : part));

    log("container", `starting ${SMOKE_NAME} with Level-1 bind mount`);
    const started = await execDocker(args, 180000);
    if (!started.ok) {
      fail(`docker run failed: ${(started.stderr || started.stdout).trim()}`);
    }

    const mountCheck = await execDocker(
      [
        "exec",
        SMOKE_NAME,
        "sh",
        "-c",
        `test -x "$LUGO_STUDIO_OPPONENT_BOT" && ls -la "$LUGO_STUDIO_OPPONENT_BOT" && echo MOUNT_OK`,
      ],
      20000,
    );
    if (!mountCheck.ok || !mountCheck.stdout.includes("MOUNT_OK")) {
      fail(
        `mounted opponent binary not executable in container: ${(mountCheck.stderr || mountCheck.stdout).trim()}`,
      );
    }
    log("container", `mount ok env LUGO_STUDIO_OPPONENT_BOT=${CONTAINER_BINARY}`);

    log("api", `waiting for ${API_BASE}`);
    await waitForApi();

    // Player side HOME => AWAY slots are opponents (Level-1). Only mark two AWAY
    // rows active; AWAY/3 and all HOME rows must stay stopped.
    const startBody = {
      team_side: "home",
      opponent_mode: "default",
      game_speed: "normal",
      skip_to_golden_goal: false,
      active: [
        { side: "AWAY", number: 1 },
        { side: "AWAY", number: 2 },
      ],
    };
    log("match", "POST /api/game/start with active AWAY/1 and AWAY/2");
    const startRes = await request("POST", "/api/game/start", startBody);
    if (startRes.status !== 200) {
      const msg = (startRes.json && startRes.json.message) || startRes.raw;
      if (String(msg).includes("bot-level-1") || String(msg).includes("no such file")) {
        fail(`opponent start hit missing-binary error: ${msg}`);
      }
      fail(`game/start status ${startRes.status}: ${msg}`);
    }
    if (String(startRes.raw).includes("no such file or directory")) {
      fail(`game/start body mentions missing file: ${startRes.raw}`);
    }
    log("match", `game/start OK ${startRes.raw}`);

    async function assertRunning(side, number, want) {
      const res = await request("GET", `/api/team/${side}/bots/${number}`);
      if (res.status !== 200) {
        fail(`status ${side}/${number}: HTTP ${res.status} ${res.raw}`);
      }
      const running = Boolean(res.json && res.json.running);
      if (running !== want) {
        fail(`${side}/${number} running=${running}, want ${want} (body=${res.raw})`);
      }
      log("status", `${side}/${number} running=${running}`);
    }

    await assertRunning("AWAY", 1, true);
    await assertRunning("AWAY", 2, true);
    await assertRunning("AWAY", 3, false);
    await assertRunning("HOME", 1, false);

    // Reset bots so cleanup is quieter.
    await request("POST", "/api/game/start", { ...startBody, active: [] });

    log("pass", "Level-1 extract + mount + active opponent start verified; inactive stayed stopped");
  } finally {
    await finish();
  }
}

main().catch((error) => {
  process.stderr.write(`[smoke-level1] ${error && error.stack ? error.stack : error}\n`);
  process.exitCode = 1;
});
