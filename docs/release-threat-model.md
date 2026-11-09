# Studio V3 release threat model and key rotation

Owner: `@lugobots/maintainers` (update CODEOWNERS team if the org slug differs).

This document pairs with `docs/verify-download.md` and `docs/release-hardening.md`.

## Threats and mitigations

| Threat | Mitigation |
|--------|------------|
| Website/Doorway compromise replaces downloads | Binaries are not hosted there; official assets live only on GitHub Releases for `lugobots/studio-v3`. In-app updater allowlists that repo and rejects Doorway/S3 hosts. |
| Compromised developer laptop ships malware | CI-only publish; no laptop-built GitHub Releases. |
| Stolen CI token publishes a bad release | Split Build vs Publish workflows; Publish uses Environment `publish` with required reviewers when the plan allows; least-privilege `GITHUB_TOKEN`; CODEOWNERS on workflow changes. |
| Stolen code-signing key | Prefer cloud HSM / short-lived certs; pin expected publisher identity in the client (`LUGO_STUDIO_WIN_PUBLISHER`, `LUGO_STUDIO_MAC_TEAM_ID`, `LUGO_STUDIO_GPG_FINGERPRINT`); follow rotation runbooks below. **Current enrollment:** Linux GPG only (see `docs/signing.md`); Win/macOS publisher signing deferred (paid). |
| Malicious dependency / Action | Lockfile + Actions pinned by commit SHA; CODEOWNERS review on release-critical paths. |
| Tampered update mid-download | SHA-256 + publisher signature verification before apply; failure keeps the running version and shows a non-blocking rejection notice. |
| Supply-chain lookalike repo | Verify doc states canonical org/repo; client allowlists `lugobots/studio-v3` only. |
| Doorway discovery MITM (“update available” lie) | Doorway can advertise a fake version/URL, but allowlist + signature/checksum checks reject substitute binaries. Treat Doorway compromise as phishing UX risk, not binary substitution. |

## Key rotation / revocation runbooks

Each runbook: **owner**, **steps**, **client-pin update**. After any revoke, publish a GitHub Security Advisory and a website advisory that **links** to GitHub—do not host a replacement binary on the website.

### Windows (Authenticode / Azure Trusted Signing)

- **Owner:** `@lugobots/maintainers`
- **Steps:**
  1. Suspend Publish Environment approvals.
  2. Revoke or disable the compromised certificate / Trusted Signing account identity in the vendor portal.
  3. Issue a replacement cert or enroll a new Trusted Signing identity; store material only in Environment `build` secrets (never git).
  4. Cut a new CI-built Release signed with the replacement identity after Publish approval.
  5. Yank or mark the compromised Release as untrusted if it already shipped.
- **Client-pin update:** Ship a Studio build that sets `LUGO_STUDIO_WIN_PUBLISHER` (or the baked pin) to the new subject/CN. Communicate out-of-band that older clients may reject updates until upgraded. Prefer an emergency client release signed with a still-trusted fallback only if one exists; otherwise direct users to a freshly verified GitHub asset via the advisory.

### Apple (Developer ID + notarization)

- **Owner:** `@lugobots/maintainers`
- **Steps:**
  1. Suspend Publish approvals.
  2. Revoke the compromised Developer ID Application certificate in the Apple Developer account; rotate the App Store Connect API key used by notarytool if exposed.
  3. Create a replacement Developer ID cert; update `CSC_LINK` / related `build` Environment secrets; confirm spare cert inventory.
  4. Rebuild, notarize, staple, and publish a new approved Release.
- **Client-pin update:** Update `LUGO_STUDIO_MAC_TEAM_ID` (Team ID usually stable across certs; if the team itself is burned, ship a client that pins the new Team ID and document Gatekeeper expectations). Advise users to download only from the canonical Release after verifying checksums.

### Linux (GPG detached signatures)

- **Owner:** `@lugobots/maintainers`
- **Steps:**
  1. Suspend Publish approvals.
  2. Publish a revocation certificate for the compromised key to keyservers / the verify doc.
  3. Generate a new signing key in hardware or cloud KMS; store private material in Environment `build` only; publish the new public key in-repo.
  4. Re-sign AppImage artifacts (or cut a new Release) with the replacement key.
- **Client-pin update:** Update `LUGO_STUDIO_GPG_FINGERPRINT` to the new fingerprint and ship that Studio build. Older clients will reject updates signed with the new key until upgraded—state that clearly in the advisory.

## Emergency client allowlist update

If a signing identity is burned and users must stop trusting it immediately:

1. Owner opens a GitHub Security Advisory describing the window of risk and the replacement Release tag.
2. Website advisory links to the GitHub advisory and verify doc—**no binary upload**.
3. Land a Studio PR that updates publisher pins / allowlisted repo constants under CODEOWNERS review.
4. Publish that Studio version through the normal CI + approval gate using a still-valid signing path when possible.
5. Record the incident outcome in the next release notes draft.
