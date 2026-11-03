import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  DEFAULT_EDITOR_PORT,
  editorUrl,
} from "../src/renderer/shell/editor-url.js";

const require = createRequire(import.meta.url);
const ports = require("../src/shared/ports.js");

test("renderer editor URL matches shared ports defaults", () => {
  assert.equal(DEFAULT_EDITOR_PORT, ports.DEFAULTS.vsCodePort);
  assert.equal(editorUrl(), ports.editorUrl({}));
  assert.equal(editorUrl(), "http://localhost:8082");
});

test("editor URL follows LUGO_VS_CODE_PORT", () => {
  assert.equal(
    ports.editorUrl({ LUGO_VS_CODE_PORT: "9092" }),
    "http://localhost:9092",
  );
  assert.equal(editorUrl({ port: "9092" }), "http://localhost:9092");
});
