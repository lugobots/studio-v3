# Verify your Lugo Studio download

Official Studio V3 installers are published only as **GitHub Release** assets of the canonical repository:

`https://github.com/lugobots/studio-v3`

The Lugo website must not host these binaries. Prefer links that open the GitHub Release page or a Release asset URL under that repository.

In-app updates follow the same trust path: Doorway only answers “is there a newer version?” over an **unauthenticated** check. The client then downloads from GitHub Release URLs directly. Updater traffic does **not** use website OAuth cookies or sessions.

## Packaging targets (current)

| Platform | Artifact | Notes |
|----------|----------|-------|
| Windows | `Lugo-Studio-Windows-<version>.exe` | **Portable** build (not NSIS). **Not** Authenticode-signed (paid cert deferred). |
| macOS | `Lugo-Studio-macOS-<version>-<arch>.dmg` and `.zip` | **Not** Developer ID–signed / notarized (Apple Developer Program fee deferred). |
| Linux | `Lugo-Studio-Linux-<version>.AppImage` | Detached GPG signature (`.asc`) from the project release key. |

Signing policy and fingerprint: [signing.md](signing.md).

## Checksums

Each release should include a `SHA256SUMS` file.

```bash
# Linux / macOS
sha256sum -c SHA256SUMS --ignore-missing

# Or for one file
sha256sum Lugo-Studio-Linux-0.1.0.AppImage
```

```powershell
Get-FileHash .\Lugo-Studio-Windows-0.1.0.exe -Algorithm SHA256
```

Compare the digest to the matching line in `SHA256SUMS` from the **same** GitHub Release.

### Checked against prerelease `v0.1.0-ci-dryrun`

```bash
gh release download v0.1.0-ci-dryrun --repo lugobots/studio-v3 --pattern 'SHA256SUMS'
gh release download v0.1.0-ci-dryrun --repo lugobots/studio-v3 --pattern 'Lugo-Studio-Linux-0.1.0.AppImage'
gh release download v0.1.0-ci-dryrun --repo lugobots/studio-v3 --pattern 'Lugo-Studio-Linux-0.1.0.AppImage.asc'
sha256sum -c SHA256SUMS --ignore-missing
gpg --import docs/keys/studio-v3-release.asc   # or download the key from this repo
gpg --verify Lugo-Studio-Linux-0.1.0.AppImage.asc Lugo-Studio-Linux-0.1.0.AppImage
```

That dry-run `SHA256SUMS` currently lists:

`84537971396ed34f17e5a6bbf0b64300fa2d010a94452c785d5ac7a0c3779360  Lugo-Studio-Linux-0.1.0.AppImage`

The matching `.asc` verifies with fingerprint `31E53F0DC46B2CC0A64AA08A511EB233AE342775`.

## Signatures and provenance

- **Windows:** Not enrolled (commercial Authenticode / Trusted Signing deferred). Rely on checksums + GitHub Release source until a publisher pin is configured (`LUGO_STUDIO_WIN_PUBLISHER`).
- **macOS:** Not enrolled (Apple Developer Program deferred). Rely on checksums until `LUGO_STUDIO_MAC_TEAM_ID` is set against a notarized build.
- **Linux (manual):** `gpg --import docs/keys/studio-v3-release.asc` then `gpg --verify Lugo-Studio-Linux-<version>.AppImage.asc Lugo-Studio-Linux-<version>.AppImage`. Fingerprint pin: `31E53F0DC46B2CC0A64AA08A511EB233AE342775`. The in-app updater already ships that pin and public key and does not require a manual import.
- **Linux (in-app):** Studio verifies with the baked fingerprint and the bundled `docs/keys/studio-v3-release.asc`. Set `LUGO_STUDIO_GPG_FINGERPRINT` only to override the pin for rotation testing.
- **Provenance:** `gh attestation verify <artifact> --repo lugobots/studio-v3` when the build emitted GitHub Artifact Attestations (best-effort on some plans).

Do not install an artifact whose checksum or (when expected) signature check fails.

## Canonical trust anchors

| Anchor | Value |
|--------|-------|
| Repository | `lugobots/studio-v3` |
| Release asset URL prefix | `https://github.com/lugobots/studio-v3/releases/download/` |
| Checksums file | `SHA256SUMS` on the same Release |
| Linux GPG fingerprint | `31E53F0DC46B2CC0A64AA08A511EB233AE342775` |
| Linux public key | `docs/keys/studio-v3-release.asc` |
| Attestation repo flag | `--repo lugobots/studio-v3` |
