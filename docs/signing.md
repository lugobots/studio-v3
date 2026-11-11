# Studio V3 code signing

## Policy

Paid vendor subscriptions are deferred. Only **free** signing is enrolled:

| Platform | Mechanism | Enrolled? |
|----------|-----------|-----------|
| Linux | Detached GPG over AppImage (`.asc`) | Yes — Environment `build` secrets `GPG_PRIVATE_KEY` / `GPG_PASSPHRASE` |
| macOS | Apple Developer ID + notarytool | No — Apple Developer Program fee |
| Windows | Authenticode / Azure Trusted Signing | No — commercial cert / cloud signing fee |

## Linux GPG

- **Identity:** `Lugo Bots Studio Release <studio-release@lugobots.ai>`
- **Fingerprint:** `31E53F0DC46B2CC0A64AA08A511EB233AE342775`
- **Public key (in repo / shipped with the app):** [`docs/keys/studio-v3-release.asc`](keys/studio-v3-release.asc)
- **Client pin:** baked into the Studio updater as that fingerprint. Optional override: `LUGO_STUDIO_GPG_FINGERPRINT=…` (rotation / emergency drills only).

Shipped Linux builds verify updates with a **temporary GPG homedir** that imports the bundled public key. End users do **not** need to run `gpg --import` for in-app updates.

### Verify a Linux AppImage (out-of-app / manual)

```bash
gpg --import docs/keys/studio-v3-release.asc
gpg --verify Lugo-Studio-Linux-<version>.AppImage.asc Lugo-Studio-Linux-<version>.AppImage
```

Expect a good signature from the fingerprint above. Manual import is only for this CLI check, not for the in-app updater.

### CI

`Build release` imports `GPG_PRIVATE_KEY` on the Linux runner and writes `dist/*.AppImage.asc` when the secret is present. `Publish release` uploads those `.asc` files with the other assets.

### Dry-run check

Prerelease `v0.1.0-ci-dryrun` includes `Lugo-Studio-Linux-0.1.0.AppImage.asc` signed with this key.

## macOS / Windows (deferred)

Do not set `CSC_*`, `APPLE_API_*`, or `WIN_CSC_*` until the org purchases the matching subscription/cert. Until then:

- Builds remain unsigned for those OSes
- Users should verify checksums via [verify-download.md](verify-download.md)
- In-app updater publisher checks for Win/macOS stay fail-closed (no pin configured)

When enrollment happens, update this file, `release-hardening.md`, and the README table in the same PR as the secret rollout.
