# Private browser preview

The private preview serves the local `dist` build of this client at
**https://l2.kingdom.lv/?world=interlude&authored=1** behind a private
invitation gate. It shows the `20_20.unr` section, a Human male fighter, Greater
Musveren, the flame preview and a live FPS display. It is an offline client
demonstration. Native visual parity, full skill sequencing, hardware
performance acceptance and Phase 4 networking are not part of it. See
[.planning/STATE.md](../.planning/STATE.md) and
[.planning/ROADMAP.md](../.planning/ROADMAP.md) for status and order.

## Current deployed state

- The live URL serves the build deployed at **2026-11-05 22:11:35 UTC**
  (`artifacts/private-preview/startup-loader-change/deployment.json`). That
  receipt records the deployed index hash and the rollback directory
  `dist-before-deployment/`.
- The native startup reveal correction is verified and **staged only** at
  `artifacts/private-preview/native-reveal/dist-stage/`. The live URL does not
  include it.
- The origin runs with 1024 worker connections and a 1024-connection listen
  backlog.
- The origin and tunnel do not persist across a reboot. No Windows service or
  startup task is installed.

## Open it

On **IMPORTA-PC**, open the desktop **L2 Browser Preview** shortcut. Its helper
reads `%LOCALAPPDATA%\L2BrowserPreview\private-invite.txt`, opens the invitation
in the default browser, and the server redirects to the clean URL above. The
shortcut arguments contain the helper path, not the invitation key. Each new
browser needs private entry. The clean URL alone does not grant access.

On **DATABASE-PC**, the desktop **L2 Browser Preview** shortcut also opens the
invitation in the default browser. Or run this from
`C:\laragon\www\l2-browser-client`:

```powershell
pwsh -NoProfile -File scripts/open-private-preview.ps1 -InviteFile .assets/private-preview/private-invite.txt
```

The same invitation works outside the home network. Transfer it only through a
private channel to a device you intend to authorize.

If a phone or another browser shows `403 Forbidden`, open the private invitation
once in that same browser. Authorization in IMPORTA's Edge does not authorize a
phone, another browser profile, or T3's separate preview. A new browser session
can require the invitation again.

For local development on DATABASE-PC, run `pnpm dev` and open
**http://127.0.0.1:5173/?world=interlude&authored=1**. That loopback URL refers
to DATABASE-PC and is not an outside-home address.

## Start, inspect and stop

DATABASE-PC must stay awake and connected, with the dedicated nginx origin and
the cloudflared connector both running. Run these in the project directory on
DATABASE-PC:

```powershell
# Starts the private origin and its provisioned connector.
pwsh -NoProfile -File scripts/private-preview-tunnel.ps1 -Action Start

# Inspect both independently.
pwsh -NoProfile -File scripts/private-preview-tunnel.ps1 -Action Status
pnpm preview:private status

# Stop outside access first, then the dedicated static origin.
pwsh -NoProfile -File scripts/private-preview-tunnel.ps1 -Action Stop
pnpm preview:private stop
```

- `pnpm preview:private start` starts only the origin.
- The tunnel helper's `Stop` action stops only its connector.
- Neither helper stops the development server or unrelated Laragon, Cloudflare,
  nginx, cloudflared, Editor, Jump or native-client processes.
- Process identity checks use the recorded executable, command line and creation
  time. A conflicting process or a modified ownership record is refused.
- A listen backlog change needs an owned stop and start of the origin. A
  configuration reload does not change the existing socket's backlog.

## Deploy a new build

Stop both preview processes first, so the origin never serves mixed old and new
files while Vite replaces `dist`:

```powershell
pwsh -NoProfile -File scripts/private-preview-tunnel.ps1 -Action Stop
if ($LASTEXITCODE -ne 0) { throw 'Connector stop failed.' }
pnpm preview:private stop
if ($LASTEXITCODE -ne 0) { throw 'Origin stop failed.' }
pnpm build
if ($LASTEXITCODE -ne 0) { throw 'Build failed; preview remains stopped.' }
pwsh -NoProfile -File scripts/private-preview-tunnel.ps1 -Action Start
```

Reload the browser after the restart. Record each deployment in a new receipt
under `artifacts/private-preview/` and keep the invitation unchanged.

## Hosting and privacy

### Origin and tunnel

- Origin: an independent nginx instance bound to **127.0.0.1:8189** on
  DATABASE-PC, serving only `dist`.
- Tunnel: `l2-browser-client-preview`, ID
  `9698bff6-ae7d-4216-96f7-52accc7623a3`, readiness on port 20259.
- Helpers: `scripts/private-preview.mjs`, `scripts/private-preview-tunnel.ps1`
  and `scripts/private-preview-cloudflare.ps1`.

### Provisioning

`scripts/private-preview-tunnel.ps1` refuses to start when the dedicated tunnel
is not provisioned. Provisioning runs on IMPORTA-PC with
`scripts/private-preview-cloudflare.ps1`. It is a dry run unless `-Apply` is
given, and ordinary starts never reprovision DNS. It creates only this client's
tunnel and DNS route. Existing Lineagen and T3 DNS routes, other tunnel
identities and the login certificate stay unchanged.

- Reach IMPORTA-PC through the enrolled `fleet-importa-pc` SSH route with
  UTF-16LE encoded PowerShell, following the fleet skill at
  `C:\Users\rolan\fleet\claude\skills\fleet\SKILL.md`.
- Cloudflare API credentials are read on IMPORTA only. They are never
  transferred or printed.
- The IMPORTA fleet run directory is
  `C:\Users\rolan\fleet\runs\2026-11-05-l2-browser-private-preview`.
  `Check-ImportaPreview.ps1 -NormalOnly` checks the preview without a DNS
  override. `Invoke-PreviewShortcut.ps1` runs the desktop shortcut through an
  on-demand Interactive/Limited task in the logged-in session.

### Access gate

- Anonymous pages and assets return HTTP 403.
- A valid invitation receives a 303 redirect and a host-only, Secure, HttpOnly,
  SameSite=Lax session cookie.
- Responses use `private, no-store`, `noindex` and `no-referrer`.
- Directory listings, hidden paths, source modules and source maps are not
  served.
- This is the project's invitation gate. It is not a Cloudflare Access login or
  game-server authentication.

### Privacy rules

- The invitation is a bearer secret. Anyone holding it can open the preview.
- Never put the invitation or key in chat, screenshots, tracked files, traces or
  HAR. Never print either value.
- The invitation, key, generated configuration, credentials and private
  diagnostic logs live under ignored `.assets/private-preview/`, restricted to
  the current Windows user and SYSTEM.
- Logs can contain invitation queries. Sanitize them locally before sharing any
  log text.
- Keep `.assets/private-preview/`, `dist`, staged binaries and captures out of
  Git.
- Never repair an invitation by inventing a new key independently of its
  configuration. Restore it from the valid key after checking the generated
  configuration matches.

## Checks

Repeat the external delivery check with a fresh evidence directory:

```powershell
node scripts/check-private-preview-external.mjs --output artifacts/private-preview/external-new-check
```

Add `--http-only` to skip browser rendering. The checker reads secrets in memory
and saves no browser storage, traces or HAR.

Repeat the bounded origin capacity check without downloading asset bodies:

```powershell
node scripts/check-private-preview-burst.mjs --output-dir artifacts/private-preview/new-burst --concurrency 595
```

The burst checker refuses to overwrite a report and fails if any request fails.
This HEAD test measures connection and file-lookup behavior, not GET transfer
pressure or GPU performance.

`node scripts/check-private-preview.mjs` stops and restarts the origin to test
lifecycle protection. Run it only in a maintenance window, never during
someone's session or an external capture.

## Evidence

The evidence index is [docs/VERIFICATION.md](VERIFICATION.md). Preview receipts:

- Staged startup reveal correction: `artifacts/private-preview/native-reveal/`.
  479 unit tests pass, 5/5 reveal cases pass in each of Chromium and WebKit,
  and the facing case passes 1/1 (`browser-verification.json`). All 1,684
  authored paths, byte lengths and hashes match before and after.
- Deployed build checks:
  `artifacts/private-preview/final-loading-facing-chromium/` and
  `artifacts/private-preview/final-loading-facing-webkit/`. Each passes 29/29
  checks with 630/630 desktop and 629/629 mobile requests complete. These show
  eventual loading, not the first visible frame.
- Loading panel review: `artifacts/private-preview/loading-panel/`.
- Startup guard and loader logs: `artifacts/private-preview/startup-loader-change/`.
- Listen backlog: `artifacts/private-preview/webkit-backlog-1024/`, with the
  refusal baseline in `artifacts/private-preview/origin-refusal-webkit-baseline/`
  and `artifacts/private-preview/webkit-startup-baseline-restored/`.
- Worker connections: `artifacts/private-preview/origin-burst/`,
  `artifacts/private-preview/origin-burst-after-capacity/` and
  `artifacts/private-preview/burst-script-verified/`.
- External delivery and gate: `artifacts/private-preview/external-capacity-verified/`,
  `artifacts/private-preview/external-accepted/failure.json` and
  `artifacts/private-preview/local-gate.json` (45 checks).
- IMPORTA normal DNS and shortcut launch: `artifacts/private-preview/importa-normal/`
  and `artifacts/private-preview/importa-verified/`.
- Phone 403 follow-up: `artifacts/private-preview/403-followup-http/http.json`.
- T3 phone route check: `artifacts/private-preview/t3-phone-route-check/`.

Chromium runs use SwiftShader, and WebKit runs on Windows with viewport and
touch emulation. They are functional delivery results. The generic `Apple GPU`
renderer string is not proof of an Apple GPU or a physical iPhone. Displayed
FPS is not GTX 1060 performance or a 120 FPS result.

## Open

- The startup reveal correction is verified but not deployed. Deploy it with
  the steps above, then rerun the external checks into a fresh directory.
- The origin and tunnel do not persist across a reboot. Start them by hand after
  each DATABASE-PC restart.
- No physical phone or real Apple GPU check exists.
- The preview URL uses the optional Editor-authored route (`authored=1`). It
  moves to `?world=interlude` with NOED-01. See
  [EDITOR_VIEWER.md](EDITOR_VIEWER.md) for the optional viewer.
