/**
 * Non-prod discovery dry-run against prerelease v0.1.0-ci-dryrun metadata.
 *
 * Uses allowlisted GitHub Release URLs. Prefer anonymous live downloads when
 * the repo is public; cached assets (via `gh release download` / LUGO_DRYRUN_CACHE)
 * still exercise discover → download → verify → tamper-reject offline.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const logic = require("../src/main/services/updater/logic");
const updater = require("../src/main/services/updater");
const trust = require("../src/main/services/updater/trust");

const TAG = "v0.1.0-ci-dryrun";
const VERSION = "0.1.0";
const NAME = "Lugo-Studio-Linux-0.1.0.AppImage";
const URL = `https://github.com/lugobots/studio-v3/releases/download/${TAG}/${NAME}`;
const SIG_URL = `${URL}.asc`;
const SHA256 = "84537971396ed34f17e5a6bbf0b64300fa2d010a94452c785d5ac7a0c3779360";
const FPR = "31E53F0DC46B2CC0A64AA08A511EB233AE342775";
const PUBLIC_KEY = path.join(__dirname, "../docs/keys/studio-v3-release.asc");
const CACHE = process.env.LUGO_DRYRUN_CACHE || "/tmp/tmp.W5hb0MxH9G";

function doorwayBody() {
  return {
    version: VERSION,
    newer: true,
    artifact: "Lugo-Studio-Windows-0.1.0.exe",
    platformAssets: {
      linux: {
        name: NAME,
        url: URL,
        sha256: SHA256,
        signatureUrl: SIG_URL,
      },
    },
  };
}

function cachedFetch(url) {
  const map = {
    [URL]: path.join(CACHE, NAME),
    [SIG_URL]: path.join(CACHE, `${NAME}.asc`),
  };
  const file = map[url];
  if (!file || !fs.existsSync(file)) {
    return Promise.resolve({
      ok: false,
      status: 404,
      url,
      headers: { get: () => null },
      arrayBuffer: async () => Buffer.alloc(0),
    });
  }
  const bytes = fs.readFileSync(file);
  return Promise.resolve({
    ok: true,
    status: 200,
    url,
    headers: { get: () => null },
    arrayBuffer: async () => bytes,
  });
}

test("non-prod Doorway-shaped payload selects the GitHub Linux asset", () => {
  const result = logic.interpret(doorwayBody(), "0.0.1", "linux");
  assert.equal(result.state, "newer");
  assert.equal(result.asset.url, URL);
  assert.equal(result.asset.sha256, SHA256);
  assert.equal(trust.isAllowlistedReleaseAssetUrl(result.asset.url), true);
});

test("anonymous GitHub download URLs succeed for the public release asset", async () => {
  const response = await fetch(URL, { redirect: "manual" });
  assert.ok([200, 302].includes(response.status), `unexpected status ${response.status}`);
});

test("tampered bytes fail SHA-256 before apply", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lugo-tamper-"));
  const asset = doorwayBody().platformAssets.linux;
  await assert.rejects(
    () =>
      updater.downloadAsset(asset, {
        directory,
        platform: "linux",
        expectedPublisher: FPR,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          url: URL,
          headers: { get: () => null },
          arrayBuffer: async () => Buffer.from("tampered-not-the-release"),
        }),
        verifyImpl: async () => ({ ok: true }),
      }),
    /SHA-256/,
  );
  fs.rmSync(directory, { recursive: true, force: true });
});

test(
  "cached prerelease AppImage verifies digest + GPG and rejects Doorway hosts",
  {
    skip: fs.existsSync(path.join(CACHE, NAME))
      ? false
      : `cached AppImage absent under ${CACHE}`,
  },
  async () => {
    assert.equal(
      trust.isAllowlistedReleaseAssetUrl(`https://lugobots.ai/api/studio/check-update/${NAME}`),
      false,
    );

    const imported = spawnSync("gpg", ["--batch", "--import", PUBLIC_KEY], {
      encoding: "utf8",
    });
    assert.equal(imported.status, 0, imported.stderr);

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lugo-dryrun-"));
    const file = await updater.downloadAsset(doorwayBody().platformAssets.linux, {
      directory,
      platform: "linux",
      expectedPublisher: FPR,
      fetchImpl: cachedFetch,
    });

    assert.equal(path.basename(file), NAME);
    assert.equal(trust.sha256File(file), SHA256);

    const notice = logic.noticeFor({
      state: "rejected",
      message: "checksum mismatch",
    });
    assert.equal(notice.mode, "notify");

    const corrupt = path.join(directory, "corrupt.AppImage");
    fs.copyFileSync(file, corrupt);
    fs.appendFileSync(corrupt, Buffer.from("x"));
    assert.equal(trust.verifySha256(corrupt, SHA256).ok, false);

    fs.rmSync(directory, { recursive: true, force: true });
  },
);
