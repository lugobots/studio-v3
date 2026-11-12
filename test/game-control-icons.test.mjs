import test from "node:test";
import assert from "node:assert/strict";
import {
  GAME_CONTROL_ICONS,
  createGameControlIcon,
  iconFingerprint,
} from "../src/renderer/shell/game-control-icons.js";
import { installDocument } from "./dom-stub.mjs";

test("each game-control glyph renders an SVG with distinct path data", () => {
  installDocument();
  const names = Object.keys(GAME_CONTROL_ICONS);
  assert.ok(names.length >= 10);
  const fingerprints = new Set();
  for (const name of names) {
    const svg = createGameControlIcon(name, { color: "#22c55e" });
    assert.equal(svg.tagName.toLowerCase(), "svg");
    assert.equal(svg.getAttribute("data-icon"), name);
    assert.ok(svg.children.length > 0, `${name} has paths`);
    const fp = iconFingerprint(name);
    assert.ok(fp.length > 0, `${name} fingerprint`);
    assert.equal(fingerprints.has(fp), false, `${name} must be unique`);
    fingerprints.add(fp);
  }
});
