import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  DEFAULT_GAME_FRONTEND_PORT,
  gameFrontendUrl,
} from "../src/renderer/shell/game-frontend.js";

const require = createRequire(import.meta.url);
const ports = require("../src/shared/ports.js");

test("renderer game frontend URL matches shared ports defaults", () => {
  assert.equal(DEFAULT_GAME_FRONTEND_PORT, ports.DEFAULTS.gameFrontendPort);
  assert.equal(gameFrontendUrl(), ports.gameFrontendUrl({}));
  assert.equal(gameFrontendUrl(), "http://localhost:8080");
});

test("game frontend URL follows LUGO_STUDIO_GAME_FRONTEND_PORT", () => {
  assert.equal(
    ports.gameFrontendUrl({ LUGO_STUDIO_GAME_FRONTEND_PORT: "9090" }),
    "http://localhost:9090",
  );
  assert.equal(gameFrontendUrl({ port: "9090" }), "http://localhost:9090");
});
