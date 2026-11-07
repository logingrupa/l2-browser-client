# Private preview continuation — 2026-11-06 (Riga)

The private local/outside-home URL was provisioned through IMPORTA-PC and
`/fleet`. The current terrain follow-up expressly forbids service changes and
production deployment. Keep the verified startup fix staged; do not run the
deployment or service lifecycle helpers. The broader asset pipeline goal is
incomplete; do not mark it complete or claim native parity/120 FPS/networking.
Read `docs/PRIVATE_PREVIEW.md` for operation and the current verification record.
Read `.planning/native-flame-authoring-handoff.md` before resuming asset work.

## Native startup reveal: staged verification complete

The user's later phone screenshots disproved startup acceptance: the loader
disappeared before terrain coordinate attachment/native assembly, exposing
procedural dummies. The prior external 29/29 Chromium and 29/29 WebKit checks
only established eventual delivery/rendering. Preserve those results, but do
not treat them or the loading-panel visual **ship** review as transition proof.
The user requires a root correction, not a longer loading timer.

Implemented in source:

- `NativeCharacterVisual` creates no procedural dummy meshes; `CharacterVisual.ready`
  and `EntityRegistry.whenReady()` include native assembly and initial equipment,
  with current-entity replacement/cancellation ownership.
- Native catalog/package failures reject. App-required worlds also reject
  missing/failed terrain and enabled flame preparation. Optional Editor
  inspection retains a bounded world/effect fallback.
- `prepareSceneForReveal` activates the first Editor lifecycle frame concealed,
  pauses unnecessary rendering while real runtime work/downloads settle, then
  requires a ready frame before atomic canvas/HUD reveal. It guards failure,
  timeout, disposal, context loss and cancellation. No fixed delay was added.

Current evidence: `artifacts/private-preview/native-reveal/unit.log` passes
**479 tests / 42 files** in 20.02 seconds; `build.log` records the successful
staged production build at `dist-stage/`. All **5/5 reveal cases pass in Chromium
and 5/5 in WebKit**. Chromium desktop observed 396 samples/395 RAF and mobile
310/309; WebKit observed 585/584 and 880/879. Each first reveal occurs at the
loader-removal mutation with ready terrain/equipment/HUD, two native actors,
zero fallbacks/early exposures/errors. Observed ready frames are 3 for Chromium
and 5 for WebKit, not prescribed delays. Captures and transition JSON are under
`{chromium,webkit}-{desktop,mobile}/`; the root displayed actual captures.

`browser-verification.json` consolidates the final evidence. Initial Chromium
was **19/20** (`browser-chromium.log`). The second +0.7 m Z target hit the actor
torso; readiness-only retry also failed. A 1.4 m Z target then hit the HTML label,
and that recheck was interrupted after two passes/one failure by the new user
task. Preserve `facing-ready.log` and `browser-chromium-recheck.log`. Final facing
passes **1/1** (`facing-unobstructed.log`): wait for playable reveal, confirm
`elementFromPoint` is the canvas, use +X 0.7 m and +Z 2.2 m. Pointer input,
movement and forward-alignment thresholds are unchanged. Test typecheck passes.

`authored-before.json`, `authored-after-build.json` and final post-browser
`authored-after.json` match **all 1,684 paths, sizes and SHA-256 hashes**.
The source/staged startup correction is verified. It is **not deployed**:
the live URL retains the earlier 22:11:35 UTC build, and the new terrain task
forbids service changes/deployment. No external-delivery claim applies to this
staged correction. Do not close the broader asset goal.

The separate terrain follow-up's fresh WebKit baseline, captured before terrain
edits, is `artifacts/native-parity/research/terrain-browser-20261106/baseline/`
(`manifest.json`, authored desktop/mobile PNGs and transition JSON). Its research
report belongs to `terrain_evidence_mapping`; this startup documentation pass
does not edit that report or claim terrain/native parity.

## Earlier loading feedback and movement facing checkpoint

The requested loading bar, named steps/puns and native fighter-facing repair are
implemented and deployed at **2026-11-05 22:11:35 UTC**. Final external
Chromium and WebKit desktop/mobile runs each pass **29/29 checks**; the last
completed at **22:14:16 UTC**. That deployment completed, but the subsequent
phone evidence reopened startup acceptance as recorded above. Do not mark the
broader native pipeline goal complete.

The loading panel reports real progress for the current step only; unknown work
remains indeterminate. Four stages cover world data, meshes/textures, graphics
and world entry. Module/scene errors replace progress and humor with an alert
and a working reload. The finish review is **ship**, after a local pressed-state
contrast repair to **4.96:1**. `DESIGN.md` and `.impeccable/design.json` remain
unchanged; comparison/drift is documented in
`artifacts/private-preview/loading-panel/documentation-receipt.md`.

The native fighter's +X source forward basis is corrected to semantic +Z with
a -pi/2 rotation on the complete assembly's presentation parent. Source meshes,
rigs, keys, scale and equipment relationships remain intact. The model hash and
ankle-to-toe measurements are in
`artifacts/native-parity/research/movement-facing/forward-evidence.json`.

Completed combined evidence under `artifacts/private-preview/startup-loader-change/`:

- **444/444 unit tests**, 40 files, pass in 25.43 seconds (`unit-loading-facing.log`).
- `pnpm build` to scratch passes (`build-loading-facing.log`); the subsequent
  CSS-only review-fix bundle also passes (`build-review-fix.log`). Existing
  large-chunk warning remains; no performance result is claimed.
- Four loading browser cases and deliberate geometry-502 startup failure pass
  (`browser-loading-facing-run.log`). That run's facing case failed because the
  test used vertical FOV; the saved camera uses horizontal FOV. The corrected
  case passes **1/1**, including two perpendicular ground taps and actual
  model-forward alignment >0.995 (`facing-horizontal-fov.log`). Keep the failure.
- The rebuilt module-failure/reload case passes **1/1** (`browser-review-fix.log`).
  Final actual loading/error captures are `.impeccable/review/{desktop,mobile,
  landscape,mobile-error,mobile-error-pressed}.png`.
- `authored-before.json` and `authored-after.json` match **all 1,684 paths, byte
  lengths and SHA-256 hashes**, including native-world/UV2 recovery inputs.
  This is a separate current baseline, not the earlier 2,244-file checkpoint.
- `deployment.json` records the deployed index hash and rollback directory
  `dist-before-deployment/`. The invitation key is unchanged. Final Chromium
  receipts/captures are `artifacts/private-preview/final-loading-facing-chromium/`
  and `final-loading-facing-webkit/`. Each passes 29 checks, completes all
  630 desktop / 629 mobile requests and reports zero request/HTTP/page/console
  errors. Both verify 61 models, 151 placements, two native actors, twelve flames
  and mobile Run. Chromium uses SwiftShader; Windows WebKit emulation does not
  establish a physical-phone or hardware-performance result.

Earlier startup incident and guard evidence (retained):

- After the worker-capacity repair, IMPORTA's 21:20 UTC load still produced
  21 refused requests. At 21:38:55 UTC the unchanged-app WebKit baseline
  reproduced 133 refused geometry requests and a 180-second startup timeout.
  Preserve `artifacts/private-preview/origin-refusal-webkit-baseline/receipt.json`
  and `webkit-startup-baseline-restored/failure.json`. Worker processes survived;
  no new 1024-capacity warning appeared.
- Root changed only the listen backlog to 1024 and stopped/started the owned
  origin. Windows nginx reload does not replace the listen socket's backlog.
  The same unchanged application then passes 29 WebKit desktop/mobile checks:
  `webkit-backlog-1024/browser.json`, `http.json`, `desktop.png`, `mobile.png`.
  Desktop 630/630 and mobile 629/629 requests complete with zero errors; the
  same 61 models/151 placements, two actors, 12 flames and Run control pass. This is Windows
  WebKit emulation; the generic `Apple GPU` string does not prove a physical
  iPhone or Apple GPU.
- `src/scene/guardSceneStartup.ts` retains the official Editor loader, detects
  failed delayed geometry stuck in Babylon `LOADING` with zero pending data,
  handles texture/context-loss errors, cancels/disposes failed scenes and has a
  180-second deadline plus live progress. Do not replace the official loader
  or mark failed geometry ready to get past startup.
- The initial scratch build passed before the loading UI/facing edits. Its focused
  `tests/browser/nativeStartup.spec.ts` run passes 1/1 (4.8 seconds): an intentional
  geometry HTTP 502 causes a retryable alert and no runtime. See `build.log` and
  `browser-guard.log` under `startup-loader-change/`.
- The first default-concurrency unit run had 441 passes and one unrelated
  5000 ms timeout in the Editor CLI packing test. All 442 pass in 19.32 seconds with
  `--maxWorkers=2`, with test timeouts unchanged (`unit.log`). The later combined
  444-test checkpoint above supersedes that count.
- The local invitation file was empty at 21:33:41 UTC. Root privately restored
  the same generated URL from the unchanged valid access key after checking
  the generated config agreed. No key rotation. Never print either value.
- The phone's T3 disconnect was separate: user reported Tailscale was off and
  enabling it resolved that issue. `artifacts/private-preview/t3-phone-route-check/`
  records all three discovery endpoints HTTP 200 plus discovery CORS checks.
  No host services, routes or versions were modified.

## Live deployment (earlier build)

- Clean URL: `https://l2.kingdom.lv/?world=interlude&authored=1`.
- DATABASE project: `C:\laragon\www\l2-browser-client`; preserve dirty work.
- Independent private nginx serves only `dist` at `127.0.0.1:8189`.
- Dedicated tunnel: `l2-browser-client-preview`,
  `9698bff6-ae7d-4216-96f7-52accc7623a3`; readiness at port 20259.
- Main helpers: `scripts/private-preview.mjs`,
  `scripts/private-preview-tunnel.ps1`, `scripts/private-preview-cloudflare.ps1`.
- No reboot persistence. Use owned lifecycle helpers; never kill unrelated nginx,
  cloudflared, Editor, Jump or native-client processes.
- The local dev URL is `http://127.0.0.1:5173/?world=interlude&authored=1`.
- All key/config/invite/credential/log files remain in ignored, ACL-restricted
  `.assets/private-preview/`. Never print or screenshot secret contents.
- IMPORTA's Desktop `L2 Browser Preview.lnk` calls the private opener. Its invite
  is `%LOCALAPPDATA%\L2BrowserPreview\private-invite.txt`. The clean URL requires
  private invitation entry in each new browser.

## Delivery evidence

- `artifacts/private-preview/local-gate.json`: 45 gate/lifecycle checks passed
  again after the configuration repair. This test restarts the owned origin;
  do not run during anyone's session or a browser capture.
- Earlier `external-accepted/failure.json`: thirteen HTTP 502s, with cloudflared
  origin connection refusals; processes survived. Keep this failed evidence.
- `origin-burst/report.json`: 595 distinct scene resource HEADs at concurrency
  595 produced 467 HTTP 200 and 128 ECONNRESET; nginx explicitly warned that
  512 worker connections were insufficient.
- In that first repair, only `worker_connections` increased to 1024, the
  installed Windows select build's supported maximum. The later separate
  backlog repair is recorded in the active continuation above; keepalive was
  not changed.
- `origin-burst-after-capacity/report.json`: same 595 requests all passed, no new
  warning. The connection-reset mechanism is demonstrated; identity with the
  earlier connection-refusal mechanism is not proven.
- Reusable `scripts/check-private-preview-burst.mjs --output-dir <new-directory>
  --concurrency 595` passed; receipt in `burst-script-verified/report.json`.
- `external-capacity-verified/browser.json`: 29 checks pass. Desktop 630/630 and
  mobile 629/629 requests finished, zero HTTP/request/page/console failures,
  peak 608 requests in flight for both. 61 models/151 placements, two real
  actors, twelve flames, mobile Run control and network idle verified.
- Desktop/mobile PNGs are in that same directory. Chromium used SwiftShader;
  displayed FPS is not GTX 1060 performance or a 120 FPS result.
- The external checker uses secrets only in memory and records no trace/HAR.
  Always use a new `--output` directory to preserve failed evidence.
- Private nginx warning logs are enabled. Sanitize using the key read inside
  the shell before returning any log text; logs may contain invitation queries.

## IMPORTA DNS and launch completed

IMPORTA's router resolver `192.168.1.1` held a negative DNS entry from before
provisioning. Its cache expired normally: at 21:19:42 UTC ordinary DNS resolved
and anonymous/invitation/authenticated HTML/catalog checks all passed without
any resolution override. No DNS/hosts or browser settings changed.

`artifacts/private-preview/importa-verified/` records successful HTTP 403/303/200
gate checks via a temporary per-request resolution override; HTML/catalog hashes
match DATABASE's build. This alone is not normal browser availability.

Remote fleet run directory:
`C:\Users\rolan\fleet\runs\2026-11-05-l2-browser-private-preview`.
`Check-ImportaPreview.ps1 -NormalOnly` checks without DNS override.
`Invoke-PreviewShortcut.ps1` ran via an on-demand Interactive/Limited task in the
logged-in rolan session. At 21:19:56 UTC it opened a visible Edge window titled
`Proving grounds - L2 Browser Client`. Task result was 0 and the owned task was
removed; the requested browser remains open. Final receipts are under
`artifacts/private-preview/importa-normal/`: `http-and-dns.json` and
`interactive-launch.json`. Title visibility is not independent scene inspection;
the full rendered-world evidence is the external Playwright run above.
That initial URL handoff completed. The subsequently reported startup issue
and requested loading/facing improvements reopened active work, as recorded
above; the broader goal remains incomplete.

## Fleet and preservation

Skill: `C:\Users\rolan\fleet\claude\skills\fleet\SKILL.md`; also read fleet
root `CLAUDE.md`. No sync/reset/secret delivery is needed. Use enrolled
`fleet-importa-pc` SSH with UTF-16LE encoded PowerShell to avoid quoting errors.
Cloudflare API credentials are read on IMPORTA, never transferred or printed.
Existing Lineagen/T3 DNS and tunnels were preserved. No project binaries pushed.

Docs changed for this task: README, `docs/PRIVATE_PREVIEW.md`,
`docs/VERIFICATION.md`. The old full-tree whitespace check also flags a blank
line at EOF in `docs/screenshots/README.md`; that unrelated file was not edited
by this deployment continuation.

## Broader goal remains open

Editor 5.5.3/runtime 9.27.1; the earlier 436-unit checkpoint and prior
build/typecheck passed. The historical 444-unit loading/facing checkpoint and
the current 479-unit native-reveal correction, with five passing transition
cases per browser and the corrected facing pass, are recorded above. The latter
stays staged under the terrain task's no-deployment/service-change constraint.
Authored flame save/reopen/Play proof and 2,244-file preservation are recorded in
the earlier handoff. Native terrain/light equations, full Power Strike timing,
attachment parity, adequate matched native captures and GTX 1060 performance
remain incomplete. DATABASE display is at most 75 Hz. Phase 2 real M0 networking
remains planned; preserve GameWorldAdapter.
