# Lugo Studio V3

Desktop environment for building bots that play [Lugo Bots](https://lugobots.ai).

Lugo Studio V3 is an Electron app, strongly inspired by Lugo Studio V1. The main change is a new Docker image that centralizes most of the Lugo Bots Server logic, including bot runtimes. Bots and the server share the same memory space, which improves performance compared to running those pieces as separate processes.

## What it does

- **Starts the Lugo Studio image.** That image runs the Lugo Bots server and the bots internally.
- **Optionally opens VS Code for the Web** with the environment already set up, so you can start coding on day one.
- **Publishes a Docker image with your bot code.** Publishing uses the same single image: it builds and publishes for you.

## Requirements

- [Node.js](https://nodejs.org/) 18 or later
- npm (included with Node.js)

## Install

From the project root:

```powershell
npm install
```

## Start in development mode

```powershell
npm run dev
```

This launches the Electron window. `npm start` does the same thing.

## Studio API Docker image version

The Studio API binary embeds a build version (default `dev`) and exposes it on `GET /api/health` as `version`. Official release builds inject the **GitHub version tag** into the binary and publish the same string as the Docker Hub tag (for example `v0.2.0`):

```bash
# Development (binary version stays "dev")
docker build -t lugobots/studio-v3-api:latest .

# Release (binary version and image tag both match the GitHub tag, e.g. v0.2.0)
docker build --build-arg VERSION=v0.2.0 -t lugobots/studio-v3-api:v0.2.0 .
```

On every `v*` GitHub tag, the **Build release** workflow also publishes `lugobots/studio-v3-api:<github-tag>` (and `:latest`) to Docker Hub. A GitHub version without that Hub tag is not a complete, ready-to-use Studio distribution. See [docs/release-hardening.md](docs/release-hardening.md).

## Official downloads and signing

Official installers are published only as [GitHub Releases](https://github.com/lugobots/studio-v3/releases) for this repository. See [docs/verify-download.md](docs/verify-download.md).

### Code signing status

We sign what we can **without paid vendor subscriptions**:

| Platform | Status | Why |
|----------|--------|-----|
| **Linux** | GPG detached signature (`.asc`) in CI when Environment `build` secrets are set | Free. Public key: [`docs/keys/studio-v3-release.asc`](docs/keys/studio-v3-release.asc) |
| **macOS** | Not Developer ID–signed / not notarized | Requires [Apple Developer Program](https://developer.apple.com/programs/) (~USD 99/year) — deferred |
| **Windows** | Not Authenticode-signed | Requires a commercial code-signing certificate or Azure Trusted Signing — deferred |

Integrity without macOS/Windows publisher signatures still relies on:

- CI-only builds (no laptop-published official releases)
- Per-release `SHA256SUMS`
- Canonical repo allowlist (`lugobots/studio-v3`)

More detail: [docs/signing.md](docs/signing.md) and [docs/release-hardening.md](docs/release-hardening.md).
