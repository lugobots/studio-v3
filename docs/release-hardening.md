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
- [ ] Artifact Attestations / required Environment reviewers need a plan that supports them (or a public repo). Until then Build release keeps checksums and treats attestation as best-effort (`continue-on-error`).

## Secrets (Environment `build`)

| Secret | Status | Purpose |
|--------|--------|---------|
| `GPG_PRIVATE_KEY` / `GPG_PASSPHRASE` | **Enrolled** | Detached signatures for Linux AppImages |
| `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` | **Enrolled** | Push `lugobots/studio-v3-api` on tagged **Build release** runs |
| `CSC_LINK` / `CSC_KEY_PASSWORD` | Deferred | macOS Developer ID (requires Apple Developer Program fee) |
| `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` | Deferred | notarytool notarization (same paid membership) |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | Deferred | Windows Authenticode / later Azure Trusted Signing (commercial) |

Never commit private signing material. Public Linux key: `docs/keys/studio-v3-release.asc` (fingerprint in `docs/signing.md`).

### Docker Hub image publish (Environment `build`)

On every GitHub version tag `v*`, **Build release** builds Electron artifacts **and** publishes `lugobots/studio-v3-api:<github-tag>` (and `:latest`) to Docker Hub. The Hub tag and the image `VERSION` build-arg MUST be the same string as the GitHub tag (for example `v0.2.0`), not a stripped `0.2.0`.

Enrollment:

```bash
gh secret set DOCKERHUB_USERNAME --env build --repo lugobots/studio-v3
gh secret set DOCKERHUB_TOKEN --env build --repo lugobots/studio-v3
```

A GitHub version without `lugobots/studio-v3-api:<tag>` on Docker Hub is **not** a ready-to-use Studio distribution (installer GitHub Release approval remains a separate Publish step).

## In-repo controls (this change)

- Release workflows under `.github/workflows/` with Actions **pinned by commit SHA**
- `npm` lockfile (`package-lock.json`) for reproducible installs
- Split **Build release** (artifacts + Hub API image on tags) vs **Publish release** (Environment `publish` for GitHub Release installers)
- CODEOWNERS on workflows, `package.json` build config, updater, and verify docs

## Operator verification

After settings are applied, confirm:

1. `gh api repos/lugobots/studio-v3/environments` lists `build` and `publish`
2. `gh secret list --env build --repo lugobots/studio-v3` includes `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`
3. Publishing without Environment approval cannot create a Release
4. A `workflow_dispatch` of **Build release** produces Windows/macOS/Linux artifacts + `SHA256SUMS` without creating a Release
5. A tagged **Build release** (`v*`) publishes `lugobots/studio-v3-api:<tag>` to Docker Hub and the image health version matches that tag

## Ready-to-use checklist (distribution)

Do **not** call a Studio GitHub version ready-to-use until all of the following are true for tag `T`:

1. Desktop build artifacts for `T` exist on the CI path (and the GitHub Release is published when installers are required)
2. Docker Hub has `lugobots/studio-v3-api:T` (same string as the GitHub tag)
3. For the VS Code helper version authors are expected to pull, Docker Hub has `lugobots/vs-code-for-lugo:<helper-tag>` matching that helper repo’s GitHub tag (see `lugobots/lugo-vs-code` `IMAGE.md`)

Hub image publish happens on the tagged **Build** workflow; installer GitHub Release still goes through **Publish release** approval.
