# Studio V3 release hardening

Checklist for making `lugobots/studio-v3` safe to publish from as a public repo. Repo files in this change cover workflows, CODEOWNERS, and lockfile/Action pins; **GitHub Settings** items must be applied by an org admin.

## Repository settings (manual)

- [ ] Default branch protection: required PR reviews, no force push, required status checks (at least unit tests / build workflow when available)
- [ ] Tag protection for `v*`
- [ ] Organization or repository rule: 2FA required for write access
- [ ] Create GitHub Environment **`build`** (optional reviewers; holds signing secrets)
- [ ] Create GitHub Environment **`publish`** with **required reviewers** (approval gate before Release upload)
- [ ] Restrict who can approve `publish` and who can edit Environments
- [ ] Create/link CODEOWNERS team `@lugobots/maintainers` (or update `.github/CODEOWNERS` to a real team)

## Secrets (Environment `build`)

| Secret | Purpose |
|--------|---------|
| `CSC_LINK` / `CSC_KEY_PASSWORD` | macOS Developer ID certificate (base64 p12) for electron-builder |
| `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` | notarytool notarization |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | Windows Authenticode (or migrate to Azure Trusted Signing OIDC later) |
| `GPG_PRIVATE_KEY` / `GPG_PASSPHRASE` | Detached signatures for Linux AppImages |

Never commit signing material. Prefer cloud HSM / short-lived certs when available.

## In-repo controls (this change)

- Release workflows under `.github/workflows/` with Actions **pinned by commit SHA**
- `npm` lockfile (`package-lock.json`) for reproducible installs
- Split **Build release** (artifacts only) vs **Publish release** (Environment `publish`)
- CODEOWNERS on workflows, `package.json` build config, updater, and verify docs

## Operator verification

After settings are applied, confirm:

1. `gh api repos/lugobots/studio-v3/environments` lists `build` and `publish`
2. Publishing without Environment approval cannot create a Release
3. A `workflow_dispatch` of **Build release** produces Windows/macOS/Linux artifacts + `SHA256SUMS` without creating a Release
