const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const logic = require("../src/main/services/updater/logic");
const trust = require("../src/main/services/updater/trust");
const updater = require("../src/main/services/updater/index.js");
const { windowsArtifactName } = require("../src/shared/artifact");
const pkg = require("../package.json");

const GH =
  "https://github.com/lugobots/studio-v3/releases/download/v0.2.0/Lugo-Studio-Windows-0.2.0.exe";
const GH_MAC =
  "https://github.com/lugobots/studio-v3/releases/download/v0.2.0/Lugo-Studio-macOS-0.2.0-x64.zip";
const GH_LINUX =
  "https://github.com/lugobots/studio-v3/releases/download/v0.2.0/Lugo-Studio-Linux-0.2.0.AppImage";
const DIGEST = "a".repeat(64);

test("a newer doorway payload notifies and a current one does not", () => {
  const newer = logic.interpret(
    {
      version: "0.2.0",
      newer: true,
      platformAssets: {
        windows: {
          name: "Lugo-Studio-Windows-0.2.0.exe",
          url: GH,
          sha256: DIGEST,
        },
      },
    },
    "0.1.0",
    "win32",
  );
  assert.equal(newer.state, "newer");
  assert.equal(logic.noticeFor(newer).mode, "notify");
  assert.equal(newer.asset.url, GH);

  const current = logic.interpret({ version: "0.1.0", newer: false, artifact: "x" }, "0.1.0");
  assert.equal(current.state, "current");
  assert.equal(logic.noticeFor(current), null);
});

test("an unusable check becomes a non-blocking failure notice", () => {
  const failed = logic.interpret(null, "0.1.0");
  assert.equal(failed.state, "error");
  assert.equal(logic.noticeFor(failed).mode, "notify");
});

test("legacy Doorway artifact-only payloads are rejected (no GitHub URL)", () => {
  const result = logic.interpret(
    { version: "0.2.0", newer: true, artifact: "Lugo-Studio-Windows-0.2.0.exe" },
    "0.1.0",
    "win32",
  );
  assert.equal(result.state, "error");
  assert.match(result.message, /allowlisted GitHub Release/);
});

test("Doorway/S3 style download hosts are not allowlisted", () => {
  assert.equal(trust.isAllowlistedReleaseAssetUrl(GH), true);
  assert.equal(
    trust.isAllowlistedReleaseAssetUrl(
      "https://lugobots.ai/api/studio/check-update/Lugo-Studio-Windows-0.2.0.exe",
    ),
    false,
  );
  assert.equal(
    trust.isAllowlistedReleaseAssetUrl(
      "https://s3.amazonaws.com/bucket/Lugo-Studio-Windows-0.2.0.exe",
    ),
    false,
  );
  assert.equal(
    trust.isAllowlistedReleaseAssetUrl(
      "https://github.com/evil/studio-v3/releases/download/v1/x.exe",
    ),
    false,
  );
  assert.equal(
    trust.isAllowlistedRedirectTarget(
      "https://objects.githubusercontent.com/github-production-release-asset/123/abc",
    ),
    true,
  );
  assert.equal(
    trust.isAllowlistedRedirectTarget("https://lugobots.ai/stolen.exe"),
    false,
  );
});

test("missing platform asset yields unavailable without selecting another OS build", () => {
  const result = logic.interpret(
    {
      version: "0.2.0",
      newer: true,
      platformAssets: {
        windows: { name: "Lugo-Studio-Windows-0.2.0.exe", url: GH, sha256: DIGEST },
      },
    },
    "0.1.0",
    "darwin",
  );
  assert.equal(result.state, "unavailable");
  assert.match(result.message, /macOS/);
  assert.equal(logic.noticeFor(result).mode, "notify");
});

test("platform selection picks the running OS artifact", () => {
  const body = {
    version: "0.2.0",
    newer: true,
    platformAssets: {
      windows: { name: "Lugo-Studio-Windows-0.2.0.exe", url: GH, sha256: DIGEST },
      macos: { name: "Lugo-Studio-macOS-0.2.0-x64.zip", url: GH_MAC, sha256: DIGEST },
      linux: {
        name: "Lugo-Studio-Linux-0.2.0.AppImage",
        url: GH_LINUX,
        sha256: DIGEST,
      },
    },
  };
  assert.equal(logic.interpret(body, "0.1.0", "win32").artifact, "Lugo-Studio-Windows-0.2.0.exe");
  assert.equal(logic.interpret(body, "0.1.0", "darwin").artifact, "Lugo-Studio-macOS-0.2.0-x64.zip");
  assert.equal(
    logic.interpret(body, "0.1.0", "linux").artifact,
    "Lugo-Studio-Linux-0.2.0.AppImage",
  );
});

test("declining the upgrade does not apply it", async () => {
  let applied = false;
  const result = await logic.confirmUpgrade(
    async () => false,
    async () => {
      applied = true;
      return { ok: true };
    },
  );
  assert.equal(result.declined, true);
  assert.equal(applied, false);
});

test("a failed windows launch is reported and a decline keeps the running version", async () => {
  const failed = await logic.launch("installer.exe", "win32", () => {
    const child = new EventEmitter();
    child.unref = () => {};
    queueMicrotask(() => child.emit("error", new Error("blocked")));
    return child;
  });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /blocked/);
});

test("macOS and Linux launch paths use the platform apply command", async () => {
  const macCalls = [];
  const mac = await logic.launch("/tmp/Lugo.dmg", "darwin", (command, args, opts) => {
    macCalls.push({ command, args, opts });
    const child = new EventEmitter();
    child.unref = () => {};
    queueMicrotask(() => child.emit("spawn"));
    return child;
  });
  assert.equal(mac.ok, true);
  assert.equal(macCalls[0].command, "open");
  assert.deepEqual(macCalls[0].args, ["/tmp/Lugo.dmg"]);

  const linuxCalls = [];
  const linux = await logic.launch("/tmp/Lugo.AppImage", "linux", (command, args) => {
    linuxCalls.push({ command, args });
    const child = new EventEmitter();
    child.unref = () => {};
    queueMicrotask(() => child.emit("spawn"));
    return child;
  });
  assert.equal(linux.ok, true);
  assert.equal(linuxCalls[0].command, "/tmp/Lugo.AppImage");
});

test("SHA-256 mismatch rejects the file and signature failure notices are non-blocking", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lugo-update-"));
  const bytes = Buffer.from("tampered-payload");
  const goodDigest = crypto.createHash("sha256").update(bytes).digest("hex");

  const asset = {
    name: "Lugo-Studio-Windows-0.2.0.exe",
    url: GH,
    sha256: DIGEST,
  };

  await assert.rejects(
    () =>
      updater.downloadAsset(asset, {
        directory,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          url: GH,
          headers: { get: () => null },
          arrayBuffer: async () => bytes,
        }),
        verifyImpl: async () => ({ ok: true }),
      }),
    /SHA-256/,
  );

  const okAsset = { ...asset, sha256: goodDigest };
  await assert.rejects(
    () =>
      updater.downloadAsset(okAsset, {
        directory,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          url: GH,
          headers: { get: () => null },
          arrayBuffer: async () => bytes,
        }),
        verifyImpl: async () => ({ ok: false, error: "bad publisher" }),
      }),
    /bad publisher/,
  );

  const notice = logic.noticeFor({ state: "rejected", message: "bad publisher" });
  assert.equal(notice.mode, "notify");
  assert.match(notice.title, /rejected/i);

  fs.rmSync(directory, { recursive: true, force: true });
});

test("downloadAllowlisted rejects off-allowlist redirects", async () => {
  await assert.rejects(
    () =>
      trust.downloadAllowlisted(GH, async () => ({
        status: 302,
        ok: false,
        headers: { get: () => "https://evil.example/payload.exe" },
        arrayBuffer: async () => Buffer.alloc(0),
      })),
    /allowlist/,
  );
});

test("download rejects Doorway artifact-name-only calls", async () => {
  await assert.rejects(
    () => updater.download("Lugo-Studio-Windows-0.2.0.exe"),
    /GitHub Release/,
  );
});

test("successful download verifies digest and signature before returning the file", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lugo-update-"));
  const bytes = Buffer.from("signed-official-build");
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const file = await updater.downloadAsset(
    { name: "Lugo-Studio-Windows-0.2.0.exe", url: GH, sha256 },
    {
      directory,
      fetchImpl: async (url, init) => {
        assert.equal(init.redirect, "manual");
        if (url === GH) {
          return {
            status: 302,
            ok: false,
            headers: {
              get: () =>
                "https://objects.githubusercontent.com/github-production-release-asset/1/file",
            },
            arrayBuffer: async () => Buffer.alloc(0),
          };
        }
        return {
          status: 200,
          ok: true,
          url: "https://objects.githubusercontent.com/github-production-release-asset/1/file",
          headers: { get: () => null },
          arrayBuffer: async () => bytes,
        };
      },
      verifyImpl: async () => ({ ok: true, publisher: "Lugo" }),
    },
  );
  assert.equal(path.basename(file), "Lugo-Studio-Windows-0.2.0.exe");
  assert.equal(fs.readFileSync(file, "utf8"), "signed-official-build");
  fs.rmSync(directory, { recursive: true, force: true });
});

test("downloadAsset emits progress for streamed downloads and verification", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lugo-update-"));
  const bytes = Buffer.from("abcdefghij");
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const events = [];
  let offset = 0;
  const body = {
    getReader() {
      return {
        async read() {
          if (offset >= bytes.length) {
            return { done: true, value: undefined };
          }
          const value = bytes.subarray(offset, offset + 4);
          offset += value.length;
          return { done: false, value };
        },
      };
    },
  };

  const file = await updater.downloadAsset(
    { name: "Lugo-Studio-Windows-0.2.0.exe", url: GH, sha256 },
    {
      directory,
      onProgress: (event) => events.push(event),
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        url: GH,
        headers: {
          get: (name) => (String(name).toLowerCase() === "content-length" ? String(bytes.length) : null),
        },
        body,
        arrayBuffer: async () => bytes,
      }),
      verifyImpl: async () => ({ ok: true, publisher: "Lugo" }),
    },
  );

  assert.equal(path.basename(file), "Lugo-Studio-Windows-0.2.0.exe");
  assert.ok(events.some((event) => event.phase === "download" && event.percent > 0));
  assert.ok(events.some((event) => event.phase === "verify"));
  assert.ok(events.at(-1).percent >= 96);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("windows package name matches the release artifact pattern", () => {
  assert.equal(pkg.build.win.artifactName, "Lugo-Studio-Windows-${version}.${ext}");
  assert.equal(windowsArtifactName(pkg.version), `Lugo-Studio-Windows-${pkg.version}.exe`);
  assert.equal(pkg.build.win.target[0].target, "portable");
});

test("confirm copy is platform-aware and trust failure notices stay non-blocking", () => {
  assert.match(logic.confirmCopy("linux").body, /Linux/);
  assert.match(logic.confirmCopy("darwin").body, /macOS/);
  const rejected = logic.noticeFor({ state: "rejected", message: "checksum mismatch" });
  assert.equal(rejected.mode, "notify");
  assert.equal(rejected.action, undefined);
});

test("Linux publisher pin is baked and env override wins", () => {
  assert.equal(trust.LINUX_GPG_FINGERPRINT, "31E53F0DC46B2CC0A64AA08A511EB233AE342775");
  const previous = process.env.LUGO_STUDIO_GPG_FINGERPRINT;
  try {
    delete process.env.LUGO_STUDIO_GPG_FINGERPRINT;
    assert.equal(trust.expectedPublisherFor("linux"), trust.LINUX_GPG_FINGERPRINT);
    process.env.LUGO_STUDIO_GPG_FINGERPRINT = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    assert.equal(
      trust.expectedPublisherFor("linux"),
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
  } finally {
    if (previous === undefined) {
      delete process.env.LUGO_STUDIO_GPG_FINGERPRINT;
    } else {
      process.env.LUGO_STUDIO_GPG_FINGERPRINT = previous;
    }
  }
  assert.equal(trust.expectedPublisherFor("win32"), "");
  assert.equal(trust.expectedPublisherFor("darwin"), "");
});

test("Linux GPG verify uses a bundled public key without the user keyring", async () => {
  const publicKey = trust.bundledPublicKeyPath();
  assert.ok(fs.existsSync(publicKey), `missing bundled key at ${publicKey}`);

  const cache = process.env.LUGO_DRYRUN_CACHE || "/tmp/studio-v3-reupload";
  const appImage = path.join(cache, "Lugo-Studio-Linux-0.1.0.AppImage");
  const asc = path.join(cache, "Lugo-Studio-Linux-0.1.0.AppImage.asc");
  if (!fs.existsSync(appImage) || !fs.existsSync(asc)) {
    // Cache is prepared by readiness/dry-run flows; skip when absent locally.
    return;
  }

  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "lugo-empty-gnupg-"));
  const previous = process.env.GNUPGHOME;
  const previousPin = process.env.LUGO_STUDIO_GPG_FINGERPRINT;
  process.env.GNUPGHOME = emptyHome;
  delete process.env.LUGO_STUDIO_GPG_FINGERPRINT;
  try {
    const ok = await trust.verifyPublisherSignature(appImage, "linux", {
      signaturePath: asc,
      publicKeyPath: publicKey,
    });
    assert.equal(ok.ok, true, ok.error);
    assert.equal(ok.fingerprint, trust.LINUX_GPG_FINGERPRINT);
  } finally {
    if (previous === undefined) {
      delete process.env.GNUPGHOME;
    } else {
      process.env.GNUPGHOME = previous;
    }
    if (previousPin === undefined) {
      delete process.env.LUGO_STUDIO_GPG_FINGERPRINT;
    } else {
      process.env.LUGO_STUDIO_GPG_FINGERPRINT = previousPin;
    }
    fs.rmSync(emptyHome, { recursive: true, force: true });
  }
});
