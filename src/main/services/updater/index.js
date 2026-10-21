"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { app } = require("electron");
const logic = require("./logic");
const pkg = require("../../../../package.json");

function doorwayBase() {
  return (process.env.LUGO_DOORWAY_URL || "https://lugobots.ai").replace(/\/$/, "");
}

async function check(fetchImpl = global.fetch) {
  const version = pkg.version;
  try {
    const response = await fetchImpl(
      `${doorwayBase()}/api/studio-v3/check-update?version=${encodeURIComponent(version)}`,
    );
    if (!response.ok) {
      return { state: "error", message: `Update check failed (${response.status})` };
    }
    const body = await response.json();
    return logic.interpret(body, version);
  } catch (error) {
    return { state: "error", message: error.message || "Doorway could not be reached" };
  }
}

async function download(artifact, fetchImpl = global.fetch) {
  const name = path.basename(String(artifact || ""));
  if (!name || name === "." || name === "..") {
    throw new Error("Doorway did not name a Windows build");
  }
  const directory = path.join(app.getPath("appData"), ".LugoStudio", "updates");
  fs.mkdirSync(directory, { recursive: true });
  const destination = path.join(directory, name);
  const response = await fetchImpl(
    `${doorwayBase()}/api/studio/check-update/${encodeURIComponent(name)}`,
  );
  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destination, bytes);
  return destination;
}

function launch(file, platform = process.platform, spawnImpl = spawn) {
  return logic.launch(file, platform, spawnImpl);
}

function watch(win) {
  win.webContents.once("did-finish-load", () => {
    check().then((result) => {
      const notice = logic.noticeFor(result);
      if (!notice) {
        return;
      }
      win.webContents.send("notifications:event", notice);
    });
  });
}

module.exports = { check, download, launch, watch, doorwayBase };
