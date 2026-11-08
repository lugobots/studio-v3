# Studio V3 release hardening

Checklist for making `lugobots/studio-v3` safe to publish from as a public repo. Repo files in this change cover workflows, CODEOWNERS, and lockfile/Action pins; **GitHub Settings** items must be applied by an org admin.

## Repository settings (manual)

- [ ] Default branch protection: required PR reviews, no force push, required status checks (at least unit tests / build workflow when available)
- [ ] Tag protection for `v*`
- [ ] Organization or repository rule: 2FA required for write access
- [x] Create GitHub Environment **`build`** (holds signing secrets when enrolled)
- [x] Create GitHub Environment **`publish`** (used by Publish release workflow)
- [ ] Enable **required reviewers** on `publish` when the org billing plan supports Environment protection rules (private free plans reject this API). Until then, keep Publish as manual `workflow_dispatch` only and limit who can run Actions.
- [ ] Restrict who can edit Environments
- [ ] Create/link CODEOWNERS team `@lugobots/maintainers` (or update `.github/CODEOWNERS` to a real team)
- [ ] Apply default-branch protection + `v*` tag ruleset in the GitHub UI (API returned Forbidden for this token/plan); require PR reviews and block force-push
- [ ] Confirm org 2FA requirement for write access

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
