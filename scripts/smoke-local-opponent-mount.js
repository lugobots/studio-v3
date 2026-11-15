#!/usr/bin/env node
/**
 * Host-side smoke for local opponent project wiring (OpenSpec local-opponent-project).
 *
 * Proves without a full Docker match:
 *   1) labeled opponent persistence + Level-1 fallback
 *   2) docker runArgs bind-mount + LUGO_STUDIO_OPPONENT_PROJECT env
 *   3) container identity recreates when switching Level-1 ↔ local
 *
 * Opponent process start without MODE is covered by
 * api/internal/bots TestManagerLocalOpponentProjectStartsWithoutMODE (Linux).
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const store = require("../src/main/services/config/store");
const { checkBotCompatibility } = require("../src/main/services/bots/compatibility");
const { runArgs } = require("../src/main/services/docker/args");
const { containerMatchesExpected } = require("../src/main/services/docker");

function makeBot(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `smoke-opp-${label}-`));
  fs.mkdirSync(path.join(dir, ".lugo"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".lugo", "info.json"),
    `${JSON.stringify({ studio: { major: 1 } }, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(dir, "requirements.txt"), "lugo4py\n");
  return dir;
}

function main() {
  const player = makeBot("player");
  const rival = makeBot("rival");

  const compat = checkBotCompatibility(rival);
  assert.equal(compat.ok, true, compat.error || "rival should be compatible");

  let data = {};
  const remembered = store.rememberOpponentProject(
    data,
    { label: "Rival", path: rival },
    compat,
  );
  assert.equal(remembered.ok, true, remembered.error);
  data = remembered.data;

  const cfg = store.opponentSourceConfig(data, (folder) => checkBotCompatibility(folder).ok);
  assert.equal(cfg.effective_source, "local");
  assert.equal(cfg.effective_project_path, rival);

  const args = runArgs(player, {}, player, null, null, {
    hostPath: rival,
    containerPath: store.OPPONENT_PROJECT_CONTAINER_PATH,
  });
  const mount = `${rival}:${store.OPPONENT_PROJECT_CONTAINER_PATH}`;
  assert.ok(args.includes(mount), `missing mount ${mount}`);
  assert.ok(args.includes(`LUGO_STUDIO_OPPONENT_PROJECT=${store.OPPONENT_PROJECT_CONTAINER_PATH}`));
  assert.ok(args.includes(`LUGO_HOST_OPPONENT_PROJECT=${rival}`));
  assert.equal(args.some((part) => String(part).startsWith("LUGO_HOST_OPPONENT_BOT=")), false);

  const level1 = { hostBinaryPath: "/cache/my-bot" };
  const local = { hostPath: rival };
  assert.equal(
    containerMatchesExpected(
      {
        running: true,
        hostPath: player,
        opponentHostPath: "/cache/my-bot",
        opponentProjectHostPath: "",
      },
      player,
      level1,
      null,
    ),
    true,
  );
  assert.equal(
    containerMatchesExpected(
      {
        running: true,
        hostPath: player,
        opponentHostPath: "/cache/my-bot",
        opponentProjectHostPath: "",
      },
      player,
      null,
      local,
    ),
    false,
    "switching to local opponent must recreate the container",
  );

  const back = store.setOpponentSource(data, "level1");
  assert.equal(back.ok, true);
  assert.equal(back.data.opponent_source, "level1");
  assert.deepEqual(back.data.opponent_projects, [{ label: "Rival", path: rival }]);

  console.log("smoke-local-opponent-mount: ok");
}

main();
