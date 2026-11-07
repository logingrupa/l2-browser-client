# Current continuation — native materials and exact skill dispatch

Updated 2026-11-05, approximately 17:55 Riga. This supersedes active state and
counts in the older Editor/world/pipeline handoffs. Preserve the dirty workspace
at `C:/laragon/www/l2-browser-client` on DATABASE-PC. No project AGENTS.md exists.
The tracked parent asset goal remains **active and incomplete**. Do not create
another goal, discard work, publish binaries or implement networking.

## Authorization and priority

The user released native input and permits foreground/input on **both PCs**;
do not ask the same GUI permission again. Raw reusable migration and visible
world/assets first, optimization afterward. Preserve native files, protected
l2.ini, Jump Fluid, source lineagen and LIVESTREAM workloads. Use subagents.
Fleet/lane skills were read at `C:/Users/rolan/fleet/claude/skills/`; fleet was
clean, DATABASE SSH-only by design. Lane does not support this project.

## Completed

- `/?world=interlude`: PlayerStart10/Sector229 startup candidate, nine sectors,
  61 scenery models / 151 placements, fighter, Greater Musveren, mobile HUD/FPS.
  Twelve flame placements remain diagnostic. Live location/camera is unverified.
- Actual **Babylon Editor 5.5.3** UI save/reopen/Play and rebuilt desktop/mobile
  checks passed for equipment, exact clips, camera/fog and actor-material
  tint/roughness. `nativeMaterialOverrides.ts` clones only selected PBR materials,
  preserves source settings, handles equipment replacement and disposes owned
  resources. Saved normal override is disabled; RGB `[.45,1,.6]`/roughness `.45`
  remain available. The normal browser uses source colors and zero clones.
- Editor Color3 script numeric fields omitted the persistence callback.
  Client Vector3 text controls work when typed then blurred/Enter. No installed
  Editor patch. Research: `research/editor-color-authoring/` under evidence root.
- Editor ID-only material deduplication collides internal lightProxy ID8 with
  Tree bark ID8. First failed save retained; 18 mesh files restored from immediate
  backup before accepted save. Play causation is unproven. New read-only
  `scripts/validate-editor-materials.mjs` precedes official packing in generate;
  rejects referenced ShaderMaterial with BOTH stages lightProxy, follows mesh/
  LOD/MultiMaterial references, reports records, never repairs them. Six tests.
  This contains export contamination, not the underlying Editor loader defect.
- Main migration now includes `power-strike-source-dispatch`, preserving older
  candidate output. Exact init `LineageEffect.s_u002_a`, scale .05; conditional
  shot `LineageEffect.p_u004_a`, scale .02; both extend Engine.Emitter directly.
  Six emitters, 12 inherited definitions, 20 raw objects, 17 assets (four models,
  11 textures, two audio). Ten Engine.dll anchors and complete defaults checked.
  Only exact `system/Engine.dll` allowed as opaque binary evidence, never run.
  Source lock **143 files / 2,511,063,181 bytes**. Fresh Engine/protected INI
  receipt: `source-audit/power-strike-engine-staging-20261105T151212Z.json`.

## Checks and evidence

Evidence root `artifacts/native-parity/`; current authoring evidence
`editor/material-authoring-20261105/`: README, before/failed snapshots, configs,
actual Play `play-materials-first.png`, `browser-enabled/`, `browser-final/`,
`preservation.json`, `post-preflight-preservation.json` and logs.

- **193 unit tests / 29 files**, 8.14s (`unit-preflight-final.log`).
- Final build/typecheck passed (`build-preflight-final.log`); preflight accepts
  two scenes /238 mesh files. JS3,866.67kB /956.18kB gzip; size warning remains.
- **302 pipeline tests /zero skips**,158.124s (`pipeline-all.log`).
- Enabled material browser **3/3**,3.6min; final disabled **3/3**,3.5min.
  Error arrays empty. Not repeated for later build-only preflight addition.
- Clean migration **381 identical products**, **26/26 replay hits**, zero clean
  hits; **100 archives =69 models+29 textures+2 audio**, **70 valid GLBs**, no
  validator errors/warnings. Clean dir `migration-clean-1to9688v/`.
  `migration-power-strike-dispatch-{proof,verify}.log` passed.
- All67 previous model GLBs plus terrain GLB unchanged. Added model identities:
  Impact.shockwave00 and Impact.sparkredcone00. **365 authored files unchanged**;
  accepted changes only native config/thumbnail. Project/example intact.

Desktop/mobile/wide PNGs shown inline via HTML tools. They use SwiftShader,
not hardware performance. Shared preview snapshots failed twice with
`Preview automation snapshot timed out after 15000ms`; tab closed and Playwright
fallback used. Do not blindly repeat that failed step.

## Processes and commands

Editor **PID36352**, project window l2-browser-client, **Play stopped**; fresh
`editor-idle-final.png`. Stop Play before generation/browser checks. Previous
blank viewport after repeated Play/hot restarts recovered by ordinary project
close/dashboard reopen. Cause remains unproven; no forced termination needed.

Owned built preview **exec session20600**: `pnpm serve --port 5173 --strictPort`.
`http://127.0.0.1:5173/?world=interlude` HTTP200. Stop only this owned server before
browser tests, which use the same port. `pnpm assets:migrate --prove-rebuild
--stage-runtime` reproduces raw products. Build/generation and browser checks
must run sequentially. pnpm only, strict TS. No further UI proof needed for
already verified properties.

## Native reference continuation

Read fresh IMPORTA support docs:
`C:/Lineage2-client-support/debug-control/{CONTROL,CODEC,DISPLAY,PLAYBACK,HANDOFF}.md`,
controller-verification.json and CODEC-VERIFICATION.json. Client
`C:/Lineage2-client`; inspect existing process before launch (Start-Debug can
rewrite INI). Keep Jump active. Use Control-L2, fresh State/Environment/screenshot.

Read `reference-current/README.md` and `reference-current/resume-1400/README.md`.
At14:00Riga PID55968/window1404x667 rendered but Tab/End/tabs/drags/list attempts
did not establish input receipt. Those process/window values are historical.
Full fighter attack remains unverified. Native PawnViewer X is source-proven
no-op; pv toggles the whole viewer, not a selector alone. Overlapping combo pane
may intercept the attack list. Do not repeat blind failed gestures, invent
commands or inject native memory/calls. Fresh visible results must confirm input.
Known FPS console: Tab, confirm actual prompt, stat fps, Enter; End toggles it.

Skill3 animation S /family1 maps to SpAtk01_1HS_MFighter,47frames/30fps.
Notifications do not establish live timing. Establish actual full motion,
effect attachment/timing and defensible20_20 location evidence next.

T3 IMPORTA environment `20b54a96-ad0d-46e3-9eec-9f7158c0978f`, native project
`127893ff-4129-478c-9841-f36a4c9b3405`. Capabilities already called this thread.
Remote delegation launched at approximately17:55Riga, status running:
task `node:delegated-task:command%3Amcp%3Acd560e39-23d5-4a03-a85c-285c5e04f4ef%3Aremote-delegate%3A09a7735d-e6e0-434b-bfe6-b9aef2caecab`;
remote thread `mcp:launch:2f2c201deb37dc935dbc66f383267ce670a6d75bc51a07b3d70cec7e457450f0`.
Scope: fresh native state/world/FPS and bounded full-attack reference attempt;
no source/controller edits or display changes. Destination reference evidence
`artifacts/native-parity/reference-current/resume-1755-20261105/` (unique suffix
if needed). Preserve returned completion evidence; do not start competing input.
Follow returned next; never poll running delegate. Both local subagents finished:
editor_material_adapter(preflight), powerstrike_integration_audit(docs audit).
Do not restart old interrupted NPC agents or create child goals.

## Remaining acceptance

Full live attack/Power Strike execution, sword attachment, exact world/camera/
shader parity, persistent world/effect authoring, paired videos/diffs, hardware
baseline/optimization remain open. Musveren death residual **660/1,591 vertices**,
maxdepth **.119400140m**; preserve source keys/scale, no fitted offset.
DATABASE monitor max75Hz cannot certify normal120FPS presentation. IMPORTA is
reported144Hz-capable, last observed active59Hz; verify fresh mode. RTX4090 cannot
certify GTX1060. Read NATIVE_POWER_STRIKE, NATIVE_MIGRATION, EDITOR_ROUNDTRIP,
NATIVE_PARITY and VERIFICATION docs. Parent goal remains active; Phase2 planned.
