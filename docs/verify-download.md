# Verify your Lugo Studio download

Official Studio V3 installers are published only as **GitHub Release** assets of the canonical repository:

`https://github.com/lugobots/studio-v3`

The Lugo website must not host these binaries. Prefer links that open the GitHub Release page or a Release asset URL under that repository.

## Packaging targets (current)

| Platform | Artifact | Notes |
|----------|----------|-------|
| Windows | `Lugo-Studio-Windows-<version>.exe` | **Portable** build (not NSIS). Chosen so the in-app updater can launch a single executable without a separate installer wizard. Revisit NSIS later if SmartScreen / install UX requires it. |
| macOS | `Lugo-Studio-macOS-<version>-<arch>.dmg` and `.zip` | DMG for manual install; zip for update-friendly distribution. Requires Developer ID signing + notarization for Gatekeeper. |
| Linux | `Lugo-Studio-Linux-<version>.AppImage` | Detached GPG signature (`.asc`) when the release was signed in CI. |

## Checksums

Each release should include a `SHA256SUMS` file.

```bash
# Linux / macOS
sha256sum -c SHA256SUMS --ignore-missing

# Or for one file
sha256sum Lugo-Studio-Linux-0.2.0.AppImage
```

```powershell
Get-FileHash .\Lugo-Studio-Windows-0.2.0.exe -Algorithm SHA256
```

Compare the digest to the matching line in `SHA256SUMS` from the **same** GitHub Release.

## Signatures and provenance

- **Windows:** Confirm Authenticode signature once CI signing is enrolled (publisher identity will be pinned here).
- **macOS:** Confirm Gatekeeper accepts the notarized app (`spctl --assess` / first-launch prompt).
- **Linux:** `gpg --verify Lugo-Studio-Linux-<version>.AppImage.asc Lugo-Studio-Linux-<version>.AppImage` using the project public key published with the release docs.
- **Provenance:** `gh attestation verify <artifact> --repo lugobots/studio-v3` for builds that emitted GitHub Artifact Attestations.

Do not install an artifact whose checksum, signature, or provenance check fails.
