"use strict";

function windowsArtifactName(version) {
  return `Lugo-Studio-Windows-${version}.exe`;
}

function macArtifactName(version, arch = "x64", ext = "zip") {
  return `Lugo-Studio-macOS-${version}-${arch}.${ext}`;
}

function linuxArtifactName(version) {
  return `Lugo-Studio-Linux-${version}.AppImage`;
}

function artifactNameForPlatform(platform, version, options = {}) {
  switch (platform) {
    case "win32":
      return windowsArtifactName(version);
    case "darwin":
      return macArtifactName(version, options.arch || "x64", options.ext || "zip");
    case "linux":
      return linuxArtifactName(version);
    default:
      return null;
  }
}

module.exports = {
  windowsArtifactName,
  macArtifactName,
  linuxArtifactName,
  artifactNameForPlatform,
};
