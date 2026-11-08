# Dry-run results: `v0.1.0-ci-dryrun`

Recorded for OpenSpec task 6.1 (secure Studio V3 distribution).

| Field | Value |
|-------|-------|
| Tag | `v0.1.0-ci-dryrun` |
| Kind | **Prerelease** (not a production Release) |
| Repo | `lugobots/studio-v3` |
| Date checked | 2026-11-08 |

## Artifacts present

- Windows: `Lugo-Studio-Windows-0.1.0.exe` (unsigned — Authenticode deferred)
- macOS: x64/arm64 `.dmg` + `.zip` (unsigned / not notarized — Apple Developer Program deferred)
- Linux: `Lugo-Studio-Linux-0.1.0.AppImage` + **`Lugo-Studio-Linux-0.1.0.AppImage.asc`**
- `SHA256SUMS` (currently lists the Linux AppImage digest from the publish job aggregation)

## Verification (per `docs/verify-download.md`)

| Check | Result |
|-------|--------|
| `sha256sum -c SHA256SUMS --ignore-missing` on Linux AppImage | **PASS** — `84537971396ed34f17e5a6bbf0b64300fa2d010a94452c785d5ac7a0c3779360` |
| `gpg --verify …AppImage.asc …AppImage` with `docs/keys/studio-v3-release.asc` | **PASS** — fingerprint `31E53F0DC46B2CC0A64AA08A511EB233AE342775` |
| `gh attestation verify` | **SKIPPED** — local `gh` has no `attestation` subcommand / plan best-effort; checksums + GPG used |
| Windows / macOS publisher signature | **N/A** — deferred (paid); see `docs/signing.md` |

## Non-production Doorway pointer (task 6.2)

Example env for a non-prod Doorway (no binary upload):

```env
LATEST_LUGO_STUDIO_V3_VERSION=0.1.0
LUGO_STUDIO_V3_GITHUB_REPO=lugobots/studio-v3
LUGO_STUDIO_V3_RELEASE_TAG=v0.1.0-ci-dryrun
LUGO_STUDIO_V3_LINUX_ARTIFACT=Lugo-Studio-Linux-0.1.0.AppImage
LUGO_STUDIO_V3_LINUX_SHA256=84537971396ed34f17e5a6bbf0b64300fa2d010a94452c785d5ac7a0c3779360
LUGO_STUDIO_V3_LINUX_SIGNATURE_URL=https://github.com/lugobots/studio-v3/releases/download/v0.1.0-ci-dryrun/Lugo-Studio-Linux-0.1.0.AppImage.asc
```

Studio client pin for Linux: `LUGO_STUDIO_GPG_FINGERPRINT=31E53F0DC46B2CC0A64AA08A511EB233AE342775`.

## Blocker: repository is private

`lugobots/studio-v3` is **private**. Anonymous `https://github.com/.../releases/download/...` requests return **404**, so end users (and the in-app updater) cannot download assets until the repo is public (or a public release host is chosen).

Authenticated `gh release download` works for maintainers. Task 6.2 verification used cached authenticated downloads + updater allowlist/SHA-256/GPG checks.

## Follow-ups before first real Release (6.3)

- **Make `studio-v3` public** (or otherwise publish assets on a publicly downloadable GitHub Release host)
- Fix multi-platform `SHA256SUMS` aggregation so Win/macOS digests ship on the same file
- Re-run **Build release** so CI produces `.asc` automatically (secrets now in Environment `build`)
- Keep website V3 download CTAs hidden
- Do **not** point production Doorway at a Release until anonymous download URLs work
