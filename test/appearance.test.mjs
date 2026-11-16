import test from "node:test";
import assert from "node:assert/strict";
import { applyAppearance, normalizeAppearance } from "../src/renderer/lib/appearance.js";

test("normalizeAppearance defaults to dark", () => {
  assert.equal(normalizeAppearance(undefined), "dark");
  assert.equal(normalizeAppearance("dark"), "dark");
  assert.equal(normalizeAppearance("light"), "light");
  assert.equal(normalizeAppearance("system"), "dark");
});

test("applyAppearance sets data-theme, palette, and distinct color schemes", () => {
  const attrs = new Map();
  const style = {};
  const documentRef = {
    documentElement: {
      setAttribute(name, value) {
        attrs.set(name, value);
      },
      getAttribute(name) {
        return attrs.get(name);
      },
      style,
    },
  };

  assert.equal(applyAppearance(documentRef, undefined), "dark");
  assert.equal(attrs.get("data-theme"), "dark");
  assert.equal(attrs.get("data-palette"), "default");
  assert.equal(style.colorScheme, "dark");

  assert.equal(applyAppearance(documentRef, "light"), "light");
  assert.equal(attrs.get("data-theme"), "light");
  assert.equal(attrs.get("data-palette"), "default");
  assert.equal(style.colorScheme, "light");
  assert.notEqual(attrs.get("data-theme"), "dark");
});

test("theme tokens cover control and canvas surfaces in both modes", async () => {
  const { readFile } = await import("node:fs/promises");
  const base = await readFile(new URL("../src/renderer/styles/base.css", import.meta.url), "utf8");
  const pages = await readFile(new URL("../src/renderer/styles/pages.css", import.meta.url), "utf8");

  assert.match(base, /data-palette="default"[\s\S]*--bg-base:\s*#0f1412/i);
  assert.match(base, /data-theme="light"[\s\S]*--bg-base:\s*#f4f7f5/i);
  for (const token of ["--canvas", "--control", "--control-deep", "--control-border"]) {
    assert.match(base, new RegExp(`${token}:\\s*var\\(--`));
  }

  assert.match(pages, /\.game-start-overlay[\s\S]*background:\s*var\(--canvas\)/);
  assert.match(pages, /\.side-menu \.game-ctrl-section[\s\S]*background:\s*var\(--control\)/);
  assert.match(pages, /\.side-menu \.game-ctrl \.bot_actions[\s\S]*background:\s*var\(--control\)/);
  assert.match(pages, /\.side-menu \.game-ctrl \.start_stop_buttons button[\s\S]*background:\s*var\(--control-deep\)/);
});
