# Private browser preview

The authored native-world build is available through
**https://l2.kingdom.lv/?world=interlude&authored=1** after private invitation
entry. It contains the `20_20.unr` section, Human male fighter, Greater Musveren,
flame preview and live FPS display. It remains an offline client demonstration;
native visual parity, full skill sequencing, hardware performance acceptance and
Phase 2 networking are unfinished.

**Current continuation — 2026-11-06 (Riga):** subsequent phone captures exposed
an early world reveal and procedural stand-ins. The earlier external **29/29
Chromium and 29/29 WebKit** results verified eventual loading, not the initial
visible frame, and do not establish startup acceptance. The new runtime-readiness
correction passes **479 unit tests**, a staged production build, **5/5 reveal
cases each in Chromium and WebKit**, and the corrected facing test **1/1**.
It remains **staged only** at `artifacts/private-preview/native-reveal/dist-stage/`.
The user's subsequent terrain task forbids service changes and production
deployment; the live URL still serves the earlier 22:11:35 UTC build, without
this startup correction. The origin retains 1024 worker connections and a
1024-connection listen backlog.

## Open it

On **IMPORTA-PC**, open the desktop **L2 Browser Preview** shortcut. Its helper
reads `%LOCALAPPDATA%\L2BrowserPreview\private-invite.txt`, opens the invitation
in the default browser, and the server redirects to the clean URL above. The
shortcut arguments contain the helper path, not the invitation key. Each new
browser needs private entry; the clean URL alone does not grant access.

On **DATABASE-PC**, the desktop **L2 Browser Preview** shortcut also opens the
invitation in the default browser. Alternatively, run from
`C:\laragon\www\l2-browser-client`:

```powershell
pwsh -NoProfile -File scripts/open-private-preview.ps1 -InviteFile .assets/private-preview/private-invite.txt
```

The same private invitation works outside the home network. Transfer it only
through a private channel to a device you intend to authorize. Do not put it in
chat, screenshots, tracked files, traces or HAR. The invitation is a bearer
secret; anyone holding it can access this preview.

If a phone or another browser shows `403 Forbidden`, open the private invitation
once in that same browser. Authorization in IMPORTA's Edge does not authorize
a phone, another browser profile, or T3's separate preview. The clean URL works
after entry; a new browser session can require the invitation again. A fresh
25-check HTTPS run after the reported phone 403 passed
(`artifacts/private-preview/403-followup-http/http.json`); the gate remained active.

For local development on DATABASE-PC, run `pnpm dev` and open
**http://127.0.0.1:5173/?world=interlude&authored=1**. That loopback URL refers to
DATABASE-PC and is not an outside-home address.

## Start, inspect and stop

The current terrain task forbids service changes and production deployment.
The lifecycle commands below are operating reference, not actions to run as
part of that task; keep the verified startup correction staged.

The preview uses the existing local `dist` build. DATABASE-PC must remain awake
and connected, with both the dedicated nginx origin and cloudflared connector
running. No Windows service, startup task or reboot persistence is installed.
These commands run in the project directory on DATABASE-PC:

```powershell
# Starts the private origin and its already provisioned connector.
pwsh -NoProfile -File scripts/private-preview-tunnel.ps1 -Action Start

# Inspect both independently.
pwsh -NoProfile -File scripts/private-preview-tunnel.ps1 -Action Status
pnpm preview:private status

# Stop outside access first, then its dedicated static origin.
pwsh -NoProfile -File scripts/private-preview-tunnel.ps1 -Action Stop
pnpm preview:private stop
```

`pnpm preview:private start` starts only the origin. The tunnel helper's `Stop`
action stops only its connector. Neither helper stops the project's development
server or unrelated Laragon/Cloudflare processes. Process identity checks include
the recorded executable, command line and creation time; a conflicting process
or modified ownership record is refused.

To refresh the build, first stop both preview processes to avoid serving mixed
old/new files while Vite replaces `dist`:

```powershell
pwsh -NoProfile -File scripts/private-preview-tunnel.ps1 -Action Stop
if ($LASTEXITCODE -ne 0) { throw 'Connector stop failed.' }
pnpm preview:private stop
if ($LASTEXITCODE -ne 0) { throw 'Origin stop failed.' }
pnpm build
if ($LASTEXITCODE -ne 0) { throw 'Build failed; preview remains stopped.' }
pwsh -NoProfile -File scripts/private-preview-tunnel.ps1 -Action Start
```

This uses the normal Editor export/build workflow; it does not regenerate or
replace authored source edits. Reload the browser after the successful restart.
Changing the Windows nginx listen backlog requires stopping and starting the
owned origin; reloading its configuration does not change the existing socket's
backlog.

## Hosting and privacy

The dedicated tunnel is `l2-browser-client-preview`. Its origin is an independent
nginx instance bound to **127.0.0.1:8189** on DATABASE-PC, serving only `dist`.
Cloudflare DNS/tunnel provisioning ran on IMPORTA-PC through the enrolled
`fleet-importa-pc` SSH route and the `/fleet` workflow. Existing Lineagen and T3
DNS routes, other tunnel identities and the login certificate were verified
unchanged. The provisioning script defaults to a dry run; ordinary starts do
not reprovision DNS.

Anonymous pages and assets return HTTP 403. A valid invitation receives a 303
redirect and a host-only, Secure, HttpOnly, SameSite=Lax session cookie. Responses
use `private, no-store`, `noindex` and `no-referrer`. Directory listings, hidden
paths, source modules and source maps are unavailable through the origin. This
is the project's invitation gate, not a Cloudflare Access login or game-server
authentication system.

The invitation, key, generated configuration, credentials and private diagnostic
logs live under ignored `.assets/private-preview/`, restricted to the current
Windows user and SYSTEM. Logs can contain private request details; inspect and
sanitize them locally before sharing evidence. Keep this directory, `dist`,
staged binaries and captures out of Git. The files remain on DATABASE-PC and
are delivered only through the authorized private preview.

## Verification and current limits

### Native runtime reveal correction — 2026-11-06 (Riga)

The scene loader had finished before the Editor's first-render script lifecycle
and native asynchronous assembly. The correction now keeps the canvas and HUD
concealed until terrain/camera attachment, native actors, initial equipment and
enabled flame startup resolve, followed by a complete ready frame. Downloads
do not keep an unnecessary render loop running. This uses actual readiness,
not an added timer. Failure/cancellation cleans up and retains an actionable
loading error.

Native visuals no longer allocate procedural stand-ins. Native package failures
reject startup; the app's required world also rejects missing terrain or failed
terrain/flame preparation. Optional Editor inspection retains a separate bounded
fallback policy. **479/479 unit tests** and the staged build pass under
`artifacts/private-preview/native-reveal/`. Its before, after-build and final
post-browser snapshots match all **1,684 authored paths, byte lengths and hashes**.
Five transition cases pass in each of Chromium and WebKit: desktop/mobile
delayed-resource reveal, native-package
failure/reload, actual context loss and runtime terrain failure. The first
visible desktop/mobile frames each contain two native actors, ready terrain,
equipment and HUD, with zero early exposures or fallbacks. The initial combined
run was 19/20; the corrected facing case passes 1/1 with a canvas-verified ground
target clear of the actor and label, retaining its original thresholds. Failed
and interrupted fixture runs remain in the
[browser receipt](../artifacts/private-preview/native-reveal/browser-verification.json).
This correction is verified locally and has not been deployed or externally
checked. Deployment is excluded by the current terrain-task instruction.
See [verification](VERIFICATION.md) and [architecture](ARCHITECTURE.md).

### Loading feedback and movement facing — 2026-11-06 (Riga)

This earlier deployed checkpoint predates the phone report and reveal correction
above. Its successful eventual-load checks do not prove a complete first frame.

The loading panel distinguishes **World data**, **Meshes & textures**,
**Graphics** and **Enter world**. Its percentage describes only the current
step: finite Editor download fractions and actual scene-item readiness supply
measurements; unknown totals and graphics work remain indeterminate. Stage
changes are announced, the current step is marked, and reduced motion is
supported. Module-download and scene-startup failures replace progress/puns
with an alert and a working **Reload and retry** button.

The native fighter's source assembly faces +X while client heading zero means
+Z. A -pi/2 rotation on the whole assembly's presentation parent aligns it with
movement; source rigs, animation keys, equipment and binary assets are unchanged.
Two perpendicular ground-click moves pass with actual model-forward alignment
greater than 0.995. The first browser attempt failed because the test reconstructed
a vertical field of view instead of the saved horizontal field of view; that
failed result remains retained alongside the corrected passing run.

The loading-panel visual review was **ship**, including the local retry pressed-state
contrast repair to **4.96:1**. Desktop, 320px portrait, short landscape and error
captures fit without clipping. All **1,684 authored paths, byte lengths and
SHA-256 hashes** match before/after; this is a separate baseline from the earlier
2,244-file Editor checkpoint. See [verification](VERIFICATION.md),
[finish review](../artifacts/private-preview/loading-panel/finish-review.md) and
[design comparison receipt](../artifacts/private-preview/loading-panel/documentation-receipt.md).

The final bundle deployed at **2026-11-05 22:11:35 UTC**, with the invitation
unchanged ([deployment receipt](../artifacts/private-preview/startup-loader-change/deployment.json)).
Final [Chromium](../artifacts/private-preview/final-loading-facing-chromium/browser.json)
and [WebKit](../artifacts/private-preview/final-loading-facing-webkit/browser.json)
runs each pass **29/29 checks**: desktop **630/630** and mobile **629/629**
requests complete, with no request/HTTP/page/console errors. Both verify the
61 models, 151 placements, two native actors, twelve flames and mobile Run
control. HTTP receipts and desktop/mobile PNGs are beside those browser reports.
The last run completed at **22:14:16 UTC** (2026-11-06 in Riga). Chromium uses
SwiftShader and WebKit runs on Windows with viewport/touch emulation; these
are functional delivery results, not physical-phone or hardware-FPS validation.

### Subsequent refusal/startup incident and backlog repair

The worker-capacity repair below did not eliminate all startup refusals.
IMPORTA's later 21:20 UTC load produced 21 refused requests. At **21:38:55 UTC**,
an external WebKit baseline reproduced **133 refused geometry requests** with
1024 worker connections, unchanged owned processes, the default listen backlog
and no new 1024-capacity warning. The application did not finish loading within
180 seconds. Preserve both the
[origin refusal receipt](../artifacts/private-preview/origin-refusal-webkit-baseline/receipt.json)
and [browser failure](../artifacts/private-preview/webkit-startup-baseline-restored/failure.json).

Only the listen directive then changed to `backlog=1024`, followed by an owned
stop/start. The **unchanged application** passed **29 external WebKit checks**:
630/630 desktop and 629/629 mobile requests completed, with zero failed requests,
HTTP errors or page/console errors. The same 61 models, 151 placements, two
native actors, twelve flames and mobile Run control passed. This isolates a
successful backlog change for the reproduced startup case, without claiming
every future load or physical phone is verified.

- [WebKit browser receipt](../artifacts/private-preview/webkit-backlog-1024/browser.json)
  and [HTTP receipt](../artifacts/private-preview/webkit-backlog-1024/http.json).
- [WebKit desktop PNG](../artifacts/private-preview/webkit-backlog-1024/desktop.png)
  and [mobile PNG](../artifacts/private-preview/webkit-backlog-1024/mobile.png).

These tests run WebKit on Windows with touch/viewport emulation. The reported
generic `Apple GPU` renderer string is **not proof of an Apple GPU or a physical
iPhone test**. No hardware-performance result follows from these captures.

The separate frontend guard in `src/scene/guardSceneStartup.ts` retains the
official Editor loader. It detects failed delayed geometry left in Babylon's
`LOADING` state after pending resources reach zero, reports texture/context-loss
errors and a 180-second deadline, and disposes/cancels failed loading instead
of starting a partial world. It also reports live startup status. A deliberate
geometry HTTP 502 in `nativeStartup.spec.ts` now produces a retryable error and
no runtime in the initial scratch production build: **1/1 passed**, 4.8-second case.
At that earlier checkpoint, all **442 unit tests** passed with at most two concurrent workers, without changing
test timeouts. The first default-concurrency run had one unrelated 5-second
Editor CLI packing timeout and 441 passes; that failed run is not hidden.

Evidence is under `artifacts/private-preview/startup-loader-change/`:
`build.log`, `unit.log` and `browser-guard.log`. Those receipts predate the
combined loading UI/facing checkpoint above. Its later build/test logs and
`authored-{before,after}.json` preserve the completed local validation separately.

### Earlier capacity repair and delivery checks

The 2026-11-05 external run after the connection-capacity repair passed **29 checks**, including exact
HTML/JavaScript build bytes, anonymous denial, invitation/cookie behavior and
real desktop/mobile rendering. Desktop **1440×900** and touch-emulated mobile
**390×844** rendered the scene; the mobile Run control changed the fighter's
animation. The desktop receipt reports **61 models, 151 placements, two real
actors and twelve active flames**, with zero page/console errors. After waiting
for network idle, request accounting recorded **630/630 desktop requests** and
**629/629 mobile requests** finished, with zero failed requests or HTTP errors.
Both views reached 608 requests in flight. Evidence:

- [Local gate/lifecycle receipt](../artifacts/private-preview/local-gate.json):
  **45 checks**, including occupied-port protection and invitation preservation.
- [External HTTP receipt](../artifacts/private-preview/external-capacity-verified/http.json)
  and [browser receipt](../artifacts/private-preview/external-capacity-verified/browser.json).
- [Desktop PNG](../artifacts/private-preview/external-capacity-verified/desktop.png) and
  [mobile PNG](../artifacts/private-preview/external-capacity-verified/mobile.png).
- [IMPORTA HTTP diagnostic](../artifacts/private-preview/importa-verified/http.json):
  anonymous 403, invitation 303 and authenticated HTML/catalog 200 using a
  temporary per-request public-IP resolution override.

The browser run used **SwiftShader**. Its displayed FPS is functional UI evidence,
not GTX 1060 performance, native parity or 120 FPS certification. The initial
served build contained 5,168 files totaling 1,727,495,825 bytes; this is the whole
`dist` footprint, not the transfer size of one page load.

An earlier [external attempt](../artifacts/private-preview/external-accepted/failure.json)
failed with thirteen HTTP 502 responses during parallel geometry/texture loads.
cloudflared logged origin connection refusals while the owned nginx processes
survived. A subsequent [bounded origin diagnostic](../artifacts/private-preview/origin-burst/README.md)
demonstrated a connection-capacity defect: 595 simultaneous authenticated HEAD
requests produced 467 HTTP 200 responses, 128 `ECONNRESET` failures and nginx's
`512 worker_connections are not enough` warning. Only `worker_connections`
changed, from 512 to **1024**, the supported maximum of this Windows build.
The [identical post-repair wave](../artifacts/private-preview/origin-burst-after-capacity/report.json)
returned **595/595 HTTP 200**, with no errors or new warnings. The reusable
checker also [passed](../artifacts/private-preview/burst-script-verified/report.json).

This fixed the demonstrated capacity defect. Resets in that diagnostic did not
prove the precise mechanism of the original connection-refused 502s; the later
refusal reproduction and backlog repair are recorded above. Neither bounded
check is a general availability or production-capacity guarantee.
Private nginx warning diagnostics remain enabled.

IMPORTA's router initially cached an NXDOMAIN answer for the new hostname.
After its negative cache expired, normal resolution worked at **21:19:42 UTC**.
The [normal-system DNS/HTTP receipt](../artifacts/private-preview/importa-normal/http-and-dns.json)
records anonymous 403, invitation 303 and authenticated HTML/catalog 200 without
a resolution override. No adapter, router DNS, hosts or browser settings changed.
The earlier override-based diagnostic remains preserved separately.

At **21:19:56 UTC**, the existing IMPORTA desktop shortcut ran in the logged-in
interactive session and opened a visible Edge window titled
`Proving grounds - L2 Browser Client`. The temporary task completed with result
0 and was removed; the browser remains open. The
[launch receipt](../artifacts/private-preview/importa-normal/interactive-launch.json)
proves shortcut execution and window-title visibility. Full rendered-world
assertions come from the separate external desktop/mobile browser checks above.

At the subsequent incident checkpoint, the local private-invite file was found
empty (timestamp **21:33:41 UTC**). Its original URL was reconstructed privately
from the unchanged valid access key after checking the generated configuration
matched that key. No key rotation or weakening of the gate occurred. Never
repair an invitation by inventing a new key independently of its configuration.

The separate T3 phone connection problem was resolved when the user enabled
Tailscale on the phone. Read-only host diagnostics in
`artifacts/private-preview/t3-phone-route-check/` found all three discovery
endpoints returning HTTP 200 and checked discovery CORS responses. No host
service or routing configuration was changed. This is separate from the game
preview's invitation and asset-loading behavior.

To repeat the external delivery check, use a fresh evidence directory:

```powershell
node scripts/check-private-preview-external.mjs --output artifacts/private-preview/external-new-check
```

Add `--http-only` to omit browser rendering. The checker reads secrets internally
and does not save browser storage, traces or HAR. To repeat the bounded origin
capacity check without downloading asset bodies:

```powershell
node scripts/check-private-preview-burst.mjs --output-dir artifacts/private-preview/new-burst --concurrency 595
```

Use a fresh output directory; the burst checker refuses to overwrite a report
and exits unsuccessfully if any request fails. This HEAD test measures
connection/file-lookup behavior, not GET transfer pressure or GPU performance.

The separate
`node scripts/check-private-preview.mjs` deliberately stops/restarts the origin
to test lifecycle protection; run it in a maintenance window, never during
someone's session or an external capture.
