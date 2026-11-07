# Continue native asset integration — 2026-11-05, exact NPC profile checkpoint

Latest bounded follow-up: read
`artifacts/native-parity/editor/play-viewport-20261106/REPORT.md` and
`final-verification.json`. Actual visible Editor Play recovered after normal
project-close/Dashboard/reopen with all 2,248 current asset/project files intact.
Final build and authored desktop/mobile checks pass. No permanent lifecycle
cause/fix is claimed; raw Play still omits UV2 and reports scene.isReady false.
Final saved/public/dist exports preserve corrected primary UV and diffuse UV2.
Do not repeat the completed UV migration or session-recovery checks without a
new failure/change. Capture failed view/canvas state before any future reset.

**Superseded current state: [native-material-dispatch-continuation.md](native-material-dispatch-continuation.md).**
Read that handoff first for the completed material UI proof, exact Power Strike
dispatch, 381-product migration, final checks and owned processes. Sections below
retain historical evidence and commands, not current status.

## Latest checkpoint — read before the historical section below

Continue the existing root tracked goal; it remains active. Do not create a new
goal, discard this dirty workspace, publish binaries, or implement networking.
Project stays `C:/laragon/www/l2-browser-client`, DATABASE-PC. Native files,
protected INI, Jump Fluid and source lineagen workspace stay preserved. User
priority remains reusable migration and visible native world/assets before
optimization. No root/ancestor AGENTS.md was found in this checkout.

### Completed and verified

- Exact Greater Musveren **NPC21622 → field_stalker_20_bi → field_stalker_m00**.
  The correct class directly extends LineagePawn, not the earlier field_stalker
  class. Authored DrawScale1.2, CollisionRadius18, CollisionHeight36; inherited
  DrawScale3D1. Source PrePivot remains explicitly unverified.
- New pinned npcname decoder, exact-ID profile adapter/recipe, main migration
  job, immutable runtime staging and profile parser. `loadNativeActorCatalog`
  uses one catalog snapshot. Whole native assembly scales outside mesh origin/
  rig; height remains independent0.36m. Tests cover rejection/fallback/cleanup.
- Lock142files/2,480,358,713bytes. `npcname-e.dat`51,248bytes,
  SHA25684c79b73a97e489b455f44f21d8c8cba0f4df401ccb1d56887a1eacc62285b9a.
  All6,519name/group rows parsed. Both selected row1431 ranges preserved.
- `pnpm assets:migrate --prove-rebuild --stage-runtime`: **315identical products,
  26/26cache hits, zero clean hits,95archives,68GLBs zero validator errors/warnings**.
  Clean dir`migration-clean-4z5m6k_n/`. Final `--verify-only` also passed.
- Build/typecheck PASS; **179unit tests/27files PASS**. Main chunk3862.45kB /
  956.21kBgzip, existing warning. Logs `browser/{build,unit}-npc-profiles.log`.
- **291pipeline tests PASS/zero skips/47.643s**. Old288test run skipped stale
  flame fixture; test now selects stableID in active validated products and
  verifies archive+fingerprint. All238nonmanifest flame payloads unchanged.
  Evidence `research/material-policy-current/{receipt.json,pipeline-tests.log}`.
- **3/3native production browser PASS in2.7m**; session33267 collected/closed.
  Saved Editor properties, NPCmetadata/scale, skinning, equipment, death,
  movement, cleanup/fallback checked; captured errors empty. Unique log:
  `browser/native-npc-profiles-e2e.log`. Section/courtyard not rerun this invocation.
- Six PNG/JSON files frozen in `browser/npc-profiles-20261105/`, with hashes,
  preservation and copied migration receipts. Gallery shown inline (desktop,
  mobile, wide world and death). Screenshot FPS is SwiftShader, not GTX1060.
- Preservation passed243/243native authored files,123/123example,project,
  all142inputs and all67modelarchiveGLBs plus terrainGLB versus prior cleanbuild.
  **Archive/catalog/world-manifest hashes changed with fingerprints**; compare
  payloads rather than claiming entire archives unchanged.
- Docs updated: README/PRODUCT/ROADMAP/ARCHITECTURE/SOURCE_REUSE/ASSET_AUDIT/
  VERIFICATION/EDITOR_ROUNDTRIP/NATIVE_ACTOR_PLACEMENT and newNPCprofiles plus
  migration/clientaudit. All13localMarkdown link/fence checks passed.

### Current residual — no fitted offset or conversion repair

`research/musveren-death/probe-npc-profile.{mjs,json,log}` runs exact production
factory/profileparser/playback/skin adapter in NullEngine, using frozen browser
profile/position and staged terrain. Idlebounds match; finalbrowser rotations
error0. **660/1591vertices below terrain; maxdepth0.119400140m**, highest point
+0.143178566m. Old76vertices/4cm was unit-scale evidence; do not use it as current.
All original GLB payloads/10,769keys remain unchanged.

`viewer-placement/scale-residual-notes.md` and audit JSON: viewer Hit.Time lift
≤.0215m and terrain descending-trace backoff≤.005m are isolated terms, NOT an
overall bound. FarMoveActor can invoke FindSpot and change committed location.
Native MeshOrigin35 becomes-.35m then actor-scale-.42m, consistent with source
transform. PrePivot ctor/default and live actorlocation/bones remain unproven.
Next minimal evidence: effective native PrePivot, Hit.Location and actorlocation
after move at matcheddeath state, or a complete verified collision adapter.
Do not alterdeathkeys, shrink model, multiplyheight by1.2 orfit+0.1194m.

### Power Strike source research — next raw migration work

Completed `research/fighter-action-reference/{README.md,findings.json}` and
`build-report.py --extract`:22byteanchors/2switches/class hashes/six directdeps.
Skill3 animationS → SpAtk01AnimName[CurWeaponType]; fighterfamily1 →
`SpAtk01_1HS_MFighter`,47frames/30fps. AttackShot raw.9233333727s;
AttackItem.8766665995s. Runtime SkillHitTime is conditional and NOT proven equal
to skillgrp.hit_time. Full live fighterattack motion remains unverified.
Startup → **LineageEffect.s_u002_a** (DrawScale.05), hand attachment via
GetRHandBoneName/AttachToBone. Shot → **LineageEffect.p_u004_a** (DrawScale.02).
Both extendEmitter directly. Startup emitterpayloads equal old at_power_strike_cs
candidate but actor defaults differ. Current production recipe still exports
the OLD candidate; integrate actual dispatch identities/defaults next with
tests/coverage. Do not infer dispatch solely from equal payloads or clipnames.
Impact position=target.Location-unitDirection*target.CollisionRadius/2.
Helper can AdjustparticleLife(ShotTime+1) under MagicAniStatus0; init writes
effect+0xe8=ShotTime. Preserve conditions/dynamictiming as unresolved runtime data.

### Owned processes and UI

- Actual Editor5.5.3 **PID36352** remains foreground, maximized, Play stopped.
  Guarded capture `editor/current-idle-npc-profiles-final.png` confirms front.
  Earlier actual save/reopen/build proof alreadycomplete for equipment/clip/
  camera/fog; materials/effect timing unfinished. Do not repeat completed UI
  work unnecessarily. StopPlay before source/generate/build. No guard bypass.
- User-facing built preview **exec session 24910** intentionally running:
  `pnpm serve --port 5173`, `http://127.0.0.1:5173/?world=interlude`, HTTP 200.
  Log`browser/serve-current-native-world.log`. Stop only this owned server
  before tests needing5173. Old35472stopped; no build/test remainsrunning.
- Sharedpreviewopenedbackground, snapshot failedTWICE with15s timeout. Final
  read-only evaluation showed nativeRuntimeReadytrue and modelrequests200;
  visualcapture notcertified. Tab CLOSED. State saved in
  `browser/npc-profiles-shared-preview-state.json`. No need to repeat tool retries.
- Native IMPORTA state lastread:PID55968,1404x667window,daylight,display59Hz.
  No native input sent during this continuation. Read `reference-current/README.md`
  and `resume-1400/README.md` before input; repeatedblind drag/tab/end/rightclick
  attempts already failed. Updated controller docs and userauthorization persist.
- All delegated workcompleted. npc_viewer_placement accidentally created a
  childscoped goal after its context compaction; root originalgoal unchanged.
  It and its unnecessary terrainchild were interrupted. Do not resume those
  children or recreate goals; use fresh bounded agents for future work.

Broaderremaining: nativeattackref/PowerStrike timingandruntime, swordattachment,
liveworld/camera/material matching, persistentnative Editor material/effect
authoring, pairedvideos/diffs and hardwarebaseline/optimization. DATABASE75Hz
cannot certify normal120FPS presentation; IMPORTAresults cannot certifyGTX1060.
Continue rawmigration rather than declaring assetgoal/Phase2complete.

## Historical checkpoint below — superseded where contradicted above

Read this before older handoffs. The existing tracked goal stays **active**;
do not create another goal, discard the dirty workspace or publish binaries.
Work remains `C:/laragon/www/l2-browser-client` on DATABASE-PC. User priority is
raw reusable migration and visible native world/assets before optimization.
Preserve native files, protected INI, source lineagen workspace and Jump Fluid.
Phase 2 networking remains planned behind the unchanged GameWorldAdapter.

## Current verified state

- Actual Babylon Editor **5.5.3** saved/reopened Leather Shirt item22=true,
  `Wait_1HS_MFighter`, camera radius4.25, fog enabled with None/mode0. Play
  rendered native world/fighter/Musveren. UI save, generation, build and actual
  desktop/mobile browser saved-property assertions passed.
- Editor fixes: GLTF2 loader-extension registration supports its UMD rewrites;
  validated `/l2/...` fetch paths adapt to `l2/...` on file pages; controls and
  projection use the public input canvas; HUD clears the measured Editor toolbar.
  The scene's fog None avoids in-process Play bypassing the CLI fog adapter.
- Initial example save persisted missing Meadow/Sunlight and a pine-material
  replacement. That failed save is retained; original example was restored and
  verified123/123 identical. Do not reintroduce it.
- Native scene save externalized119 geometry buffers. All geometry/indices/parts
  match earlier data;119meshes,7materials,2lights remain. These are the authored
  inspection environment, NOT the runtime native world61models/151placements.
  World meshes are not yet persistent editable Editor objects.
- Repeated Play/Stop/hot restarts caused blank views, also in authoring mode.
  Closing project window normally → Dashboard → reopening recovered it; cause
  unproven. **Stop Play before source changes, generation and browser checks.**
  Play rewrites public/scene and src/scripts.ts. Do not kill Editor or bypass
  its foreground input guard. Editor PID36352 remains open, maximized, idle,
  Play stopped. Recheck state before future input. User released foreground/input.
- After the Editor checkpoint, native source research demonstrated Musveren
  burial: all1591vertices under terrain at final death, while all10769 source
  keys and timestamps match exactly. Native viewer supports its collision
  cylinder; height and DrawScale are independent.
- Client now supplies optional NativeCharacterProfile.collisionHalfHeight and
  sets **.36m for the explicit Greater Musveren reference only**. Other profiles
  retain prior idle support. Mesh shared by22npcgrp rows; don't infer every NPC's
  placement from mesh name. Unit scale preserved; no GLB/key or floor fitting.
- Fresh browser shows visible corpse and hovering idle. Residual76/1591vertices
  remain below actual terrain, maxdepth.039502143m. Native reference Scale1.2
  remains unmatched; local support doesn't reproduce native sweep/contact margins.
  No death visual-parity pass. See docs/NATIVE_ACTOR_PLACEMENT.md.

## Checks and evidence

- Latest full unit run **168tests/26files PASS**; build/typecheck PASS.
  Main chunk3858.62kB/953.84kBgzip, existing warning, no performance claim.
- After support repair, **3/3 native browser cases PASS in2.9m**, production
  build, unchanged limits. Logs editor/{build-native-support,
  unit-native-support-all,browser-native-support}.log under artifacts/native-parity.
- Earlier Editor roundtrip production **12/12 PASS in4.4m** (9courtyard+3native).
  Initial courtyard5.4s. Kept separate from later3case run.
- Dev run **17/18**, first courtyard goto exceeded45s, repeated on rerun.
  All native saved-value checks passed. Do not claim full green dev suite.
  Read-only analysis research/editor-dev-startup shows pre-scene module waterfall,
  262/288JS requests and unexplained21–23s gap; no source fix proven. No timeout
  relaxed. Temporary production-playwright.config.ts changes only server/output.
- Current immutable six-file capture set:
  browser/musveren-support-20261105/{native-desktop.png,json,native-mobile.png,json,
  native-wide.png,native-death.png}; hashes/preservation/README beside them.
  Prior sets editor-roundtrip-production-20261105 and editor-roundtrip-dev-20261105
  retained. Desktop/mobile/death gallery was shown inline to user.
- Latest preservation:243/243native files,123/123example,project unchanged;
  actor GLBs/world manifest/catalog/archives/source packages retain audited hashes.
  No imported binaries/captures tracked. Native geometry/thumbnail ignored.
- Death proof: research/musveren-death/README.md, source-audit.json,
  native-transform.json, viewer-placement/; original probe.json/baseline frozen.
  New probe-after-profile-support.{mjs,json} reads frozen browser-after-profile-support.json
  and uses exact runtime modules/actual staged terrain. Root owns this new probe.
- Authoritative NWindow is staged reference-next/source-support/NWindow.dll;
  E: NWindow DOES NOT match IMPORTA. Engine E: candidate matches source hash.
  Viewer initial offset uses **Hit.Time, not normalZ**; earlier agent message was
  corrected and final evidence is right. No native input sent this continuation.

## Next work and ownership

All source researchers finished; no outstanding runtime edit ownership. No
build/test process remains from the listed runs. The user-facing production
preview is intentionally running in exec session **35472**, `pnpm serve --port
5173`, at http://127.0.0.1:5173/?world=interlude. Log:
`artifacts/native-parity/browser/serve-current-native-world.log`. HTTP200 checked.
Stop only that owned server before future browser tests that require port5173.
The earlier dev session11097 and production test sessions are closed.

Read docs/EDITOR_ROUNDTRIP.md, NATIVE_ACTOR_PLACEMENT.md, VERIFICATION.md and
ASSET_AUDIT.md. Guarded UI helper is artifacts/native-parity/editor/Control-Editor.ps1.
Native control docs remain under reference-current/source-support and on IMPORTA.

The raw migration proof remains297byte-identical products,25/25cachehits,
95archives,68validGLBs. It was NOT rerun for these client-only changes. Current
section is source-backed PlayerStart10 area; exact live native pawn/camera match
still unobserved.12flame placements are diagnostic, complete raw graphs retained.

Remaining work: native fullattack/PowerStrike motion reference and sequencing;
weapon attachment transform; live location/camera/material/lighting match;
native actor scale/collision and deformation parity; persistent native material/
effect-timing authoring; matched video/diffs; hardware baseline and optimization.
DATABASE max75Hz cannot certify normal120FPS presentation. IMPORTA hardware
results cannot certify GTX1060. Current screenshots force SwiftShader.

Don't repeat failed blind native input or install broad tools. Source-focused
reverse-engineering brief: artifacts/native-parity/research/REVERSE_ENGINEERING_HANDOFF.md.
User wants periodic real screenshots and a fresh pass-down prompt at compaction.
