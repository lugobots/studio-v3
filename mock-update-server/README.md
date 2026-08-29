# Mock update server

Local HTTP server that advertises and serves Studio binaries dropped into `releases/`. Use it in development to test version checks and downloads. It does not build installers and does not talk to production.

Listen address is always `127.0.0.1:47821`. If that port is taken, the process exits with an error instead of choosing another port.

This is a local test tool. There is no upload size cap.

## Run

From the Studio V3 repo root:

```powershell
npm run mock-update-server
```

Or from this folder:

```powershell
npm start
```

Confirm it is up:

```powershell
curl http://127.0.0.1:47821/health
```

## Name drop files

Put files in `releases/` using:

```text
Lugo-Studio-{Windows|Mac|Linux}-{version}.{ext}
```

- Platform tokens are exactly `Windows`, `Mac`, or `Linux`.
- Version is semver with no `v` prefix (for example `0.2.0` or `0.2.0-beta.1`).
- Extension is whatever you drop (`.exe`, `.dmg`, `.AppImage`, `.zip`, …).

Example for Windows, newer than the app’s `0.1.0`:

```text
mock-update-server/releases/Lugo-Studio-Windows-0.2.0.exe
```

Create a dummy binary and check it:

```powershell
node -e "require('fs').writeFileSync('mock-update-server/releases/Lugo-Studio-Windows-9.9.9.exe', 'dummy')"
curl "http://127.0.0.1:47821/api/studio/check-update?currentVersion=0.1.0&platform=win32"
curl -O -J "http://127.0.0.1:47821/api/studio/download/Lugo-Studio-Windows-9.9.9.exe"
```

`platform` is Electron’s `process.platform`: `win32`, `darwin`, or `linux`.

## How a winner is chosen

The check endpoint picks the **highest semver** for that platform that is **strictly greater** than `currentVersion`. Equal or older files are not advertised.

If two files share the same platform and version, the server picks the **lexicographically last** file name (UTF-16 string order, which matches ASCII). Example: `Lugo-Studio-Windows-0.2.0.zip` wins over `Lugo-Studio-Windows-0.2.0.exe`.

Unparseable names are ignored and printed to stdout.

## Endpoints

| Method | Path | Result |
|--------|------|--------|
| GET | `/health` | `{ "ok": true }` |
| GET | `/api/studio/check-update?currentVersion=&platform=` | JSON with `available`, `version`, `fileName`, `downloadPath`, `sizeBytes` |
| GET | `/api/studio/download/{fileName}` | File bytes, or 404 |

Binaries in `releases/` are gitignored.

## Tests

From the repo root:

```powershell
npm run test:mock-update-server
```

Or `node mock-update-server/test.js`. Stop any other process on port 47821 first.
