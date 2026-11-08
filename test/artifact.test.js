const test = require("node:test");
const assert = require("node:assert/strict");
const {
  windowsArtifactName,
  macArtifactName,
  linuxArtifactName,
  artifactNameForPlatform,
} = require("../src/shared/artifact");
const pkg = require("../package.json");

test("platform artifact names match electron-builder patterns", () => {
  assert.equal(windowsArtifactName("0.2.0"), "Lugo-Studio-Windows-0.2.0.exe");
  assert.equal(macArtifactName("0.2.0", "arm64", "zip"), "Lugo-Studio-macOS-0.2.0-arm64.zip");
  assert.equal(linuxArtifactName("0.2.0"), "Lugo-Studio-Linux-0.2.0.AppImage");
});

test("artifactNameForPlatform selects the running OS package", () => {
  assert.equal(artifactNameForPlatform("win32", "1.0.0"), "Lugo-Studio-Windows-1.0.0.exe");
  assert.equal(
    artifactNameForPlatform("darwin", "1.0.0", { arch: "x64", ext: "zip" }),
    "Lugo-Studio-macOS-1.0.0-x64.zip",
  );
  assert.equal(artifactNameForPlatform("linux", "1.0.0"), "Lugo-Studio-Linux-1.0.0.AppImage");
  assert.equal(artifactNameForPlatform("freebsd", "1.0.0"), null);
});

test("electron-builder config covers Windows, macOS, and Linux", () => {
  assert.equal(pkg.build.win.target[0].target, "portable");
  assert.equal(pkg.build.win.artifactName, "Lugo-Studio-Windows-${version}.${ext}");
  assert.deepEqual(
    pkg.build.mac.target.map((entry) => entry.target),
    ["dmg", "zip"],
  );
  assert.equal(pkg.build.mac.artifactName, "Lugo-Studio-macOS-${version}-${arch}.${ext}");
  assert.equal(pkg.build.linux.target[0].target, "AppImage");
  assert.equal(pkg.build.linux.artifactName, "Lugo-Studio-Linux-${version}.${ext}");
});
