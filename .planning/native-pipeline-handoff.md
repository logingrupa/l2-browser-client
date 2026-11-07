# Continuation prompt — native asset pipeline

**Mandatory 2026-11-06 clarification:** [audio is included in 1:1](native-audio-continuation.md).
The browser owner owns actual world-audio integration alongside terrain work;
exports/decoding and inspector-only playback are insufficient. Read the linked
continuation before resuming any older checkpoint below.

**Latest: [native-material-dispatch-continuation.md](native-material-dispatch-continuation.md).**
It supersedes active commands/Editor status below and records the visible
Musveren corpse repair, preserved assets and remaining native-parity gaps.

## Latest checkpoint — expanded native world, 2026-11-05

Read `.planning/world-import-continuation.md` first. It supersedes the active
commands and dataset counts below: the default migration now stages the
PlayerStart10 surroundings (61 models/151 placements), all 297 products reproduce
byte-identically, and the flame graph survives as raw data with 12 explicitly
diagnostic placements. A demonstrated Editor fog export omission is fixed by a
narrow post-pack adapter. The goal remains ACTIVE; native visual parity, full
attack/Power Strike, actual Editor edit/save/rebuild and hardware performance
acceptance are still incomplete. Do not recreate the goal or clean the dirty tree.

## Latest checkpoint — DDS and section source metadata, 2026-11-05 12:05 +02

The tracked goal remains ACTIVE and incomplete. User priority is still raw reusable
migration first, optimization afterward. This checkpoint supersedes counts/status
below; preserve the existing dirty workspace and original project location.

### Completed and verified in this continuation

- Reviewed and extended `scripts/native_assets_lib/texture_mips.py` for the exact
  UE123/licensee30 material prefix, preserving fields, opaque blocks and encoded
  strings without shader interpretation. Both Engine exports match an independent
  probe. All 26 requested standalone textures now retain 141 mips / 4,458,013 bytes.
  The previous 24 source sidecars/payloads remain byte-identical. Licensee31+ remains
  unsupported. Evidence: `research/terrain-materials/LICENSEE30_READER.md` and
  `licensee30-reader-validation.json` under `artifacts/native-parity/`.
- Added filesystem-independent `texture_dds.py`: `build_texture_dds(metadata, files)`
  returns exact original DXT1 blocks in `texture.dds` and a deterministic manifest.
  23 textures /134 mips /4,194,504 native bytes; DDS containers total4,197,448 bytes.
  Three P8 sources remain explicit compressed-derivative gaps: T_20_20.Height.20_20_C,
  Engine.S_Emitter, Engine.DefaultTexture. Native source/PNG data is retained.
- Integrated into `native_assets.py`; PNG stays primary, DDS is discoverable in
  image.derivatives and provenance. Added `native_texture_validation.py` and four
  regression cases. Main migration validates regenerated DDS bytes against source
  blocks, not just derivative checksums; coverage/validation include statuses.
- `pnpm assets:migrate --prove-rebuild` PASSED:25 job rows,40 archives (12 models,
  26 textures,2 audio),242/242 identical products,25/25 cache hits,zero clean hits in
  `migration-clean-s9jpeig4`.13 GLBs have zero Khronos errors/warnings. `--verify-only`
  and `--stage-runtime` PASSED;4 model entries/1 section. Logs:
  `migration-native-dds-{proof,verify,stage}.log`. Acceptance hash remains
  7a0ae70c593dbdad30637fa1de7bfd446d7091cbe0f31bb97eab31c130ea2df5.
- World audit rechecked396 legacy GLBs,2186 non-grass placements with zero identical
  same-model TRS duplicates,nine RGB masks and four opaque leaf records containing
  transparency. Prior precision/visibility fixes are runtime responsibilities and
  are already retained. Do not broadly rebake or move the world. Existing narrow
  leaf cutout approximation remains necessary. Legacy Unity island is not native20_20.
- Repaired native section metadata completeness: `native_map_geometry.py` now retains
  90 authored Scale/ToWorld/ToMaskmap/bUseAlpha property records,1377 serialized bytes,
  native array indices and map/object identity in nativeSamplingSource. maskUV is
  explicitly an unverified inspector candidate. Terrain shader remains neutral.
  `terrain.bin` unchanged; glTF differs only in nativeLayers extras. GLB changes due
  to that metadata. Evidence `research/world-conversion-review/{README.md,audit.json,
  metadata-preservation.md,metadata-preservation.json}`.
- All40 prior primary GLB/PNG/audio payloads remain byte-identical. Reproduce the
  integration comparison with `python artifacts/native-parity/research/compressed-textures/check-migration.py`.
  Its `migration-integration.json` records source counts and unchanged geometry.
- `pnpm test:pipeline`:230PASS; `pnpm build` including typecheck:PASS;
  `pnpm test:unit`:136PASS/20 files. Main bundle3836.01kB/946.61kB gzip warning remains.
  Logs `pipeline-tests-native-dds.log`, `browser/build-native-dds.log`, `browser/unit-native-dds.log`.
- Added tests/browser/nativeTexture.{html,ts,spec.ts}. Real pinned Babylon WebGL2/S3TC
  browser render passed1/1:9 exact compressed uploads for t_oren.OST_10 plus1 mip0
  upload for partial LineageEffectsTextures.Spark.fx_m_t0042. NoGL/page/console errors,
  nonuniform framebuffer samples. SwiftShader software rendering,not hardware proof.
  Consumer limitations:partial DDS chains upload mip0;legal136-byte DDS fails pinned
  parser's140-byte header view;native DXT1 alpha/material/filter semantics unverified.
- Existing native actor/section browser checks passed5/5 in a separate invocation:
  desktop/mobile,equipment,death hold/revival,movement,targeting,cleanup,fallback,
  and corrupt-section rollback. Log browser/native-dds-integration.log. Do not claim
  the full browser suite was rerun. Prior broader evidence remains historical.
- Fresh screenshots shown inline through html_preview/html_render:
  research/compressed-textures/browser-desktop.png, browser/native-desktop.png,
  native-mobile.png,native-section-desktop.png. JSON diagnostics adjacent. Shared
  preview WORKED for DDS this time; earlier timeout reports are historical.
- All249 authored scene/project/package files still match saved baseline:
  editor/authored-preservation-native-dds.json. This is preservation proof,not an
  actual Editor UI save/reopen/rebuild test. New guide docs/NATIVE_TEXTURES.md;
  README,ARCHITECTURE,ROADMAP,SOURCE_REUSE,VERIFICATION,ASSET_AUDIT,ASSET_PIPELINE,
  NATIVE_MIGRATION,WORLD_ASSETS updated with scoped findings.

### Current ownership and unresolved prerequisites

- All subagents completed/frozen: native_attack_reference (licensee30 reader),
  compressed_texture (DDS/browser fixture),world_conversion_audit (audit/layer data).
  All tool-owned browser tabs/devservers and tracked command sessions are closed.
- No native or Editor input was sent in this continuation. The earlier user's
  native-capture release still authorizes capture; do not ask permission again.
  A subsequent manual diagnostic is pending:click native world then press End once,
  observe whether FPS toggles. Earlier automatic input delivery had no visible
  effect despite matched session/integrity. Hold further automatic input until the
  observation arrives; see reference-current/README.md and NEXT-AGENT-PROMPT.md.
  Last observed native process55968,windowed1404x667,Jump connected; recheck state.
  ProtectedINI hash e0e4a52ee3e539472eeae49cc34852ad8845592995809a69982a2b4f056acfde.
- The earlier DATABASE-PC Editor foreground question is still unanswered. Hold
  Editor input. Actual5.5.3 editing viewport was opened historically; native-scene
  edits/save/reopen/rebuild/browser proof and effect timing controls remain undone.
  Use ordinaryUIA helper; remote-debugging launch was rejected,do not retry.
- /fleet and /lane read; fleet status passed again. Lane supports other named repos,
  so no lane checkout. No source edits,tool downloads,binary publication or networking.
- Remaining goal work is substantial:full native fighter attack/reference and exact
  20_20 location/camera;PowerStrike sequencing/attachment/blend and five repetitions;
  sword attachment;native terrain material/collision;actual Editor roundtrip;
  aligned videos/diffs;then hardware baseline/optimization and120FPS acceptance.
  DATABASE display max75Hz/active60Hz remains unfit for normal120FPS presentation.
  Do not confuse IMPORTA RTX4090 tests or SwiftShader with GTX1060 certification.
- Native mip/DDS support currently covers standalone texture archives; model GLB
  embedded textures are still PNG derivatives. General P8 GPU compression/mobile
  transcoding is not implemented. No performance gains are claimed by raw packaging.

## Previous checkpoint — native input and Editor context

This continuation remains part of the ACTIVE tracked goal. Do not create a
duplicate goal, declare completion or discard the existing dirty workspace.

### User authorization and current ownership

- The latest user explicitly released IMPORTA-PC native capture: their testing
  finished and their session is not controlling L2. Proceed there, using the
  documented windowed mode if fullscreen minimizes, and keep Jump Fluid active.
- `/root/native_control_validation` completed the resumed native pass. It
  recovered the game and captured fresh equipment, but later automated input
  stopped producing visible changes. No native input is currently running.
- Fresh exclusive restore exposed an actual **Insufficient Memory** native crash
  dialog (timestamp 2026.11.5 10:37:08, FArray::Realloc / FaceRotation / Actor::Tick).
  Screenshot: `reference-current/005-restored-exclusive.png`. Earlier black and
  minimized screenshots are failure evidence, not usable reference frames.
- Recovery succeeded through documented direct `L2.exe` with matching protected
  Debug INI and RunAsInvoker. New PID 55968 remains running windowed, client
  1404x667 / window 1420x706. Jump stays connected. `Start-Client` was avoided
  because it rewrites the protected INI. Source INI hash/ReadOnly stayed intact.
- Fresh `reference-current/010-equipment-input-check.png` visibly equips Leather
  Shirt item 22 and expected native mesh/texture references; shown to the user.
  Later FPS/Tab/click controls failed despite inputSent reports. Focus recovery,
  held End and modifier checks did not resolve it. Game/controller are both
  session 1, Medium integrity, unelevated; no supported UIPI explanation.
- A user question is PENDING: manually click world and press End once to test
  whether the FPS overlay toggles. Hold automatic native input pending that
  observation. User's capture authorization remains valid; do not ask it again.
  Full attack and exact native20_20 location/camera remain unverified. The report
  explicitly avoids relabeling the recovered world image as the requested sector.
  All temporary tasks removed; resumed evidence hashes verified. Read
  reference-current/README.md and NEXT-AGENT-PROMPT.md for reproduction.
- The DATABASE-PC Editor foreground question is still unanswered. Its input
  helper refused clicks while another terminal/browser covered the Editor.
  Hold Editor input until answered; scripts and browser checks can continue.
- `/fleet` and `/lane` were read. Read-only `fleet.ps1 status` passed; log
  `artifacts/native-parity/fleet-status-current.log`. No sync/reset/drift repair.
  Lane supports other named projects, so this project stays in place.

### Completed since the older handoff

- Added `recipes/native-terrain-textures.json`: exact nine diffuse textures and
  nine masks from already pinned `T_texture.utx`, `t_oren.utx`, `T_20_20.utx`.
  Main `native-migration.json` includes `map-20-20-textures` using the existing
  `assets` adapter. No additional source dependencies or tool downloads.
- LATEST `pnpm assets:migrate --prove-rebuild` PASSED after native mip sidecars:
  **25 job rows, 40 archives** (12 models, 26 textures, two audio),
  **216/216 byte-identical products**, **25/25 cache hits**, zero hits in empty
  `migration-clean-74urbedn`. Prior terrain-only run had159 products and clean
  directory `migration-clean-lwb6k2hx`; it remains available for comparison.
  All **13 GLBs** still have zero Khronos errors/warnings.
- `--verify-only` and `--stage-runtime` PASSED; staging has four model catalog
  entries and one map section. Logs:
  LATEST logs `migration-native-mips-{proof,verify,stage}.log`. Current `migration/`
  receipts describe216 products. Terrain-only logs remain under
  `migration-terrain-textures-*`. Previous141-product proof remains in its
  retained clean directory and `research/migration-section-proof.log`.
- New `scripts/native_texture_png.mjs` uses installed lock-pinned pngjs 7.0.0
  for bounded RGBA/channel hashes and histograms without gamma correction,
  premultiplication or channel selection. New
  `tests/pipeline/test_native_texture_png.py` checks distinct RGB under alpha 0.
- Supplementary audit: `research/terrain-materials/TEXTURE_EXTRACTION.md`,
  `texture-channel-audit.json`, `audit-extracted-textures.py`, `palettes/`.
  Eighteen verified archives, five exact Palette export payloads. Seven 1024
  DXT1 masks have binary 0/255 and identical RGBA channels; the 512 P8 mask has
  all 256 values with identical channels; the 256 base mask is constant 255.
  This is decoded mip-0 evidence, not native palette/blend equivalence.
- UModel PNG/DDS exporters emit **mip 0 only**. A NEW reviewed reader now also
  appends original mip source data to the archives: see next bullet. Native
  filtering/blending and bUseAlpha remain unverified; keep neutral terrain.
  Actual IDs `interlude:t_oren.*` and original `T_oren.*` references are both
  retained; exact references resolve uniquely case-insensitively.
- NEW `scripts/native_assets_lib/texture_mips.py` and
  `tests/pipeline/test_texture_mips.py`:14 focused tests including24/26 real
  textures. Supports UE123/licensee20,28 DXT1/P8 only. Preserves135 authored mip
  payloads /4,456,648bytes, complete native exports, source offsets/order/bits,
  exact same-package Palette export/RGBA bytes and deterministic JSON sidecars.
  No decoding/recompression/alpha edits/mip generation. Partial chains stay
  partial. Two Engine123/30 textures remain explicit unsupported sidecars.
- Root integrated `build_texture_source` in `scripts/native_assets.py` for
  standalone textures. Only UnsupportedTextureSource is caught as a coverage
  gap; malformed supported bytes fail. Omitted Format additionally verifies
  and registers actual Engine package hash against the reviewed default pin.
  Existing PNG preview remains. No runtime sampling/material changes.
- `research/terrain-materials/{NATIVE_MIPS.md,TEXTURE_MIP_READER.md,native-mip-audit.json,texture-mips-reader-validation.json}`
  contain layout evidence. `verify-mip-integration.py` / `mip-integration.json`
  prove all40 existing primary GLB/PNG/audio bytes unchanged versus preceding
  clean build. Selected P8 mask's original indices/palette expand exactly to PNG.
- `src/scripts/nativeParity.ts` now has fresh per-start cancellation ownership;
  old completion/errors cannot overwrite the current runtime. Five tests in
  `tests/unit/nativeParityScript.test.ts` include the actual pinned Editor
  loader. Editor normally starts once per instance: this is defensive explicit
  restart safety, NOT a demonstrated desktop bug.
- Build including strict typecheck PASSED; **136 unit tests PASSED** and latest
  **205 Python tests PASSED**. Logs: `browser/build-continuation.log`,
  `browser/unit-continuation.log`, `pipeline-tests-native-mips.log`.
  Main chunk 3,836.01 kB / 947.54 kB gzip warning remains. No performance pass.
- All **249 authored scene/project/package files** match the saved baseline
  after build/migration: `editor/authored-preservation-continuation.json`.
  This is not an actual UI edit/save proof.
- README, EDITOR_MCP, ASSET_AUDIT, VERIFICATION, NATIVE_MIGRATION and SOURCE_REUSE
  were updated with these results and evidence limits.

### Current browser work

- User now explicitly requests native `20_20.unr` matching. Browser target remains
  TerrainSector106, native XY `[20480,77824]..[22528,79872]`, static origin Z
  `[-3350,-2400]`, seven scenery placements/six models. Surface candidate
  `[22336,78016,-2966.630126953125]` is not a native-verified spawn; PlayerStart0
  is underground. Child has these coordinates and recipe paths.
- `tests/browser/nativeSection.ts` snapshot now records full camera position,
  target, alpha/beta, FOV/clipping, inverse native coordinates, viewport and
  lighting. `camera.getViewMatrix(true)` updates position before recording.
  Typecheck PASSED (`browser/section-camera-typecheck.log`).
- Shared preview snapshots failed twice with
  `Preview snapshot failed: Preview automation snapshot timed out after 15000ms.`
  The error was quoted to the user and local Playwright fallback selected.
  Owned tab `tab_1r_c3d6eb77-29df-4ac6-a651-c7548b9408e1` was CLOSED.
  Root Vite session 40610 was stopped successfully.
- Focused two-case Playwright run **PASSED 2/2** in 25 seconds; session 8676
  completed. Log `browser/section-camera-tests.log`. Fresh screenshot
  `native-section-desktop.png` and `native-section-browser.json` record 423
  rendered frames, no errors, six models/seven placements and camera/lighting.
  Screenshot inspected and shown with html_preview/html_render.
- Actual Editor screenshot `editor/resumed-window.png` and historical native
  Power Strike contact sheet were shown with html_preview/html_render. Never
  dump image base64 into text; forward image blocks or tool text metadata.

### Native evidence and agents

- `reference-current/README.md` and `NEXT-AGENT-PROMPT.md` describe the initial
  read-only checkpoint. Their held-input status predates the user's new release;
  newer recovery/capture results supersede it.
- Thirteen support documents/scripts and 19 capture/sidecar files matched
  remote/local hashes. Historical native MP4s/contact sheets are under
  `reference-current/prior-controller-videos/`. MP4 is lossy; decoded PNGs do
  not recover original framebuffer precision.
- Historical Power Strike VFX is visible around frame 49 / PTS 1.633333 s;
  full attack remains unverified. Musveren death moves but loops (rises by
  4.72 s). Power Strike/run have PTS gaps about 66.667 ms despite nominal
  30 FPS; death has approximately 33.333 ms intervals. Only one particle repeat.
- IMPORTA current display was observed at 2560x1440/59 Hz, with modes through
  120 Hz enumerated. User-reported 144 Hz is separate. No display change made.
  DATABASE GTX 1060 still has max 75 Hz / active 60 Hz; no 120 FPS certification.
- Current protected INI SHA is
  `e0e4a52ee3e539472eeae49cc34852ad8845592995809a69982a2b4f056acfde`;
  older d5f490... belongs to a previous profile. Preserve it and Jump Fluid.
- `/root/native_attack_reference` COMPLETE (terrain textures/mip reader despite
  name); `/root/editor_lifecycle` COMPLETE; `/root/native_control_validation`
  COMPLETE. All returned ownership; no child is actively controlling a desktop.
  Old editor_performance_inventory agent remains errored, not working.
- Next: finish native recovery/attack/location references, actual Editor proof
  when foreground is released, source-backed matching and remaining native
  effects/attachments/materials/collision. Raw independent work can expose mip
  data for the two remaining Engine123/30 textures by reviewing their additional
  material prefix before extending the reader; never silently relax its guards.
  Native input receipt/GUI focus needs manual-test results before resuming.
  Baseline and
  optimization remain later work. Phase 2 networking is still planned.

## Older checkpoint — historical detail follows

Continue the ACTIVE tracked goal in `C:/laragon/www/l2-browser-client` on DATABASE-PC. Do not create a duplicate goal or mark it complete. Read the original user goal, `.planning/asset-integration-details.md`, README/PRODUCT and current docs. This handoff was written during the 2026-11-05 continuation; inspect latest files/messages before acting.

## User steering and coordination

- Priority: raw reusable programmatic migration first; baseline/optimization afterward. Full playable/native-parity/Editor/performance goal remains active.
- Latest user explicitly says continue, use updated native debug tools, use subagents and `/lane`/`/fleet`, send actual progress screenshots, and write a handoff when context fills.
- `/fleet` and `/lane` were found at `C:/Users/rolan/fleet/claude/skills/{fleet,lane}/SKILL.md`. Read them. Root just announced their use.
- Earlier user held native input while another agent extended controls. Latest detailed user brief now instructs reading new docs and using the updated tools; the new native-control agent first checks current ownership/state before input. Never type into the wrong window, restart unnecessarily or modify native files/INI. Keep Jump Fluid.
- Native authority: IMPORTA-PC `C:/Lineage2-client`; `Start-Debug.cmd`. Debug tools: `C:/Lineage2-client-support/debug-control`.
- Read `CONTROL.md`, `CODEC.md`, `DISPLAY.md`, `PLAYBACK.md`, `HANDOFF.md`, `controller-verification.json`, `CODEC-VERIFICATION.json` there before commands. Use Control-L2.ps1. Capabilities/Environment/State, ToggleFps (End toggle; inspect fresh screenshot), Command sv/nv/pv, PlaySkill3, PlayNpcAnimation death only with Greater Musveren already selected. Record-L2.ps1 MP4 is lossy; PNG lossless; no seeking/stepping/deterministic replay.
- Full fighter attack is still UNVERIFIED. Attack stance is insufficient. Skill viewer VFX with idle avatar is insufficient. Keep the fixed tolerance file unchanged.
- Native-v-browser performance must be same host. GTX1060 DATABASE display max75Hz/active60Hz; IMPORTA144Hz user-reported, verify active mode later. No 120FPS certification.

## Constraints

- No AGENTS.md found in project/ancestors. pnpm10.32.1, strict TS/no any. Babylon9.27.1; Editor5.5.3.
- Native files, protected l2.ini, lineagen source workspace unchanged. Write all outputs locally to ignored artifacts/public/l2; no binaries pushed/published.
- Preserve original six-entity courtyard/island behavior and GameWorldAdapter. No networking; Phase2 still planned.
- Many preexisting dirty/untracked changes. Do not revert/clean. No staged changes at last check.
- All agents share files. Respect ownership below.
- Tools never accept sandbox_permissions in this environment. Shell PowerShell; SSH remote shell bash, encode multiline PowerShell UTF16LE.
- Progress commentary at least every60sec. Use actual screenshots, never generated mockups.
- T3 shared preview must be first for interactive browser work; ordinary required Playwright tests were also run. Owned shared tab has been CLOSED. No devserver currently intentionally running. Editor may be open.

## Completed raw pipeline

`pnpm assets:migrate --prove-rebuild` and `--verify-only` passed after exact-weight/static-material repairs and native section integration:

- 140 staged authoritative files /2,480,113,923 bytes; 133 packages +7 DATs.
- Seven job rows,22 archives (12model,8texture,2audio),13 GLBs including terrain:0 Khronos errors/warnings.
-141/141 products byte-identical;7/7 cache hits,0 hits in genuinely empty `migration-clean-s9ew4rzo`.
- Evidence: `artifacts/native-parity/migration/{reproducibility,validation,coverage,products}.json`; `research/migration-section-{proof,verify}.log`.
- Latest `pnpm assets:migrate --stage-runtime` passed:7cache hits,4modelcatalogentries+1mapsection. Log `migration-stage-final.log`.
- Native input source pins and acceptance SHA unchanged: `7a0ae70c593dbdad30637fa1de7bfd446d7091cbe0f31bb97eab31c130ea2df5`.
- Last minor code change after migration: native_migration.py DEFERRED wording now says native visual acceptance of equipment/attack/death is still open. Product bytes unchanged, but next migration refreshes coverage prose.

Exact skin repair:
- `native_catalog/skeletal.py`, `native_assets_lib/weights.py` read reviewed native formats with bounded sequential readers.
- Restores exact source influence order/duplicates to `_L2_NATIVE_WEIGHTS`/`_L2_NATIVE_JOINTS`; sidecar native-weights-source.json. Source sums never normalized.
- Portable standard weights can remain a glTF-compatible derivative where native sums violate glTF rules. Babylon adapter applies exact custom attrs before load completion.
- Nine mesh objects/3,254 vertices, exact custom float error0; original buffers/rigs/geometry/binds preserved.9validatorpasses.
- Musveren redundant source streams differ on684vertices by max0.000030517578125; native renderer's stream choice UNVERIFIED.
- Evidence `research/native-weight-repair/`.

Static repair:
- `native_assets_lib/static_materials.py` resolves native indices, not short names.6models/28slots; world_obj14 indices-14/-24 exact.
- `empty_primitives.py` removes only truly empty sections/accessors/views, retains9material slots and20,896original bytes for elf_ruin02. Surviving primitive material/source sections1..8 stay mapped.
- Evidence `research/static-materials-integration.json`, `research/empty-primitive-repair/`.

Native map:
- `native_map_geometry.py`; native serialized FCoords cross-check UE2 formulas (height centre32767; Zscale/256). All256XYbounds match;35fullbounds match;221cachedZdiscrepancies retained explicitly.
- Selected TerrainSector106 exact six bounds:289vertices,512triangles,9UVlayers;7placements/6models.
- All positions/matrices RH glTF sourceX,Z,Y in metres; no recentering or fitting.
- PlayerStart0 is underground, not a surface spawn. Candidate source surface `[22336,78016,-2966.630126953125]`, glTF `[223.36,-29.66630126953125,780.16]`; origin clearance11.816m, collision unverified.
- Outputs `<migration>/sections/map-20-20-section/{map-section,map-section-models,map-section-runtime}`.
- Stager `scripts/stage_native_runtime.py`: content-addressed `/l2/maps/<manifestSHA>/` keeps original sibling-root references,65files/11,297,307bytes including editableglTF/bin/PNG/provenance.13focusedtests includingNTFSjunctionguards. Evidence `runtime-staging/verification.json`.
- Raw terrain layer semantics still unresolved: DXT1 mask channel, bUseAlpha branch and ToMaskmap sampling. Read `research/terrain-materials/README.md`; do not invent a plausible shader and certify it.

## Browser implementation and checks

New NativeActor, NativeCharacterVisual, NativeSliceAdapter, createNativeSliceRuntime, nativeParity.ts and `assets/native-parity.scene`. Route `/?world=interlude`.
-7fighterparts,4x70bones+3singleboneattachments; Musveren49bones/2primitives.
- Exact clip names, shared source-duration clock, attack once→idle, death once→hold, revival restores requested locomotion.
- item22 upper-body transaction swaps exact mesh; originalpartdisabled, rest unchanged; failedreplace retains prior, unequip works, async races guarded.
- Exactweights consumed before rendering; metadata/picking preserved; original assetunits/origins stay1:1.
- Missing/rejectedcatalog/model retains animated markerfallback. Runtime rollback/abort/scene cleanup handles pendingloads/UI/observers.
- Pause updates presentation atdt0 so selectionring/labels stillfollowcamera. Ring verticalanchor now derivedfromboundsminimum; no modeltranslationfit.
- Source shader registrations in loadEnvironment fix demonstrated dynamic shaderimport race (lightProxy/PBR/postprocess/rgbdDecode).
- NativeParityScript currently has readonly AbortController; consider lifecycle onStart→onStop→onStart in actual Editor: if same instance reused, it cannot restart. Do not edit during another agent's unsaved Editor manipulation; coordinate.

Native map inspector:
- `src/scene/world/loadNativeSection.ts`, `tests/browser/nativeSection.{html,ts,spec.ts}`.
- `/tests/browser/nativeSection.html`: real6models/7placements/512triangles; source coords/matrices/materials, hashes, embeddeddeps, lifetime/rollback. Neutral terrain, no nativecollisions/visualcertification.
-10unit tests passed; browser2cases passed. Tests reject corrupt resource thenverifycleanup. Fixed ambiguous status locator (`#section-status`); initial InfinityFPS diagnostic now showsdash.

Checks:
- `pnpm build` PASS (latest log browser/build.log); typecheck PASS. Main large-chunk warning remains.
- `pnpm test:unit`:131PASS/19files (`browser/unit.log`).
- `pnpm test:pipeline`:190PASS (`pipeline-tests-current.log`). New terraintexture work mayaddtests; rerun relevantchecksafterintegrating.
- Fullbrowserrun:24passed,1failed,1historicalskip/26cases. Failure was legacy mobilecase navigation during Editor accidental Run triggering src/scripts.ts generation. Preservedtrace `browser/reload-failure/`.
- Targetedrerun6cases: legacyfailedmobile PASSED, nativeactor3 PASSED, actualworldrender PASSED, maprollback test initially failed only ambiguousrolelocator. Fixedlocator; finalnative-section2/2PASS.
- Thus27distinctbrowsercasespassedacrossruns,1intentionalhistoricalskip. Do not say fullsingleinvocationwasgreen.
- Logs `browser/{all-browser-tests,final-targeted-tests,native-section-tests}.log`.
- Realcaptures `browser/{first-native-actors,native-desktop,native-mobile,native-death,native-section-desktop}.png` plusJSON. Shownuserprogress. SoftwareWebGL FPS isnotbaseline/120FPSproof.

Docs updated: README,PRODUCT,ROADMAP,ARCHITECTURE,SOURCE_REUSE,ASSET_AUDIT,NATIVE_MIGRATION,ASSET_PIPELINE,VERIFICATION. Historical findings kept scoped. `.assets/world-screenshots/` nowignored alongwithpublic/l2/artifacts.

## Actual Editor status and next work

- User asked latest: officialGitHubAPI checked2026-11-05, latestv5.5.3, released2026-10-29; https://github.com/BabylonJS/Editor/releases/tag/v5.5.3 . Installedversionmatches.
- Actualprojecteditingviewport opened, courtyardshown: `artifacts/native-parity/editor/editor-open-window.png` (shownuser), editor-open-ui.json.
- Native sceneopening/edit/save/rebuild stillNOTproved.
- Old `editor/handoff.json` says Dashboardonly; newer evidence supersedes viewportstatus butnotroundtrip.
- `/root/editor_performance_inventory` hit providerusage-limit error while switching scenes. Its last screenshot is `asset-scenes.png`; actualEditor maystillopen. Parentmust inspect freshstate and continue, or reassignsameproviderifavailable. Do not switchproviderunasked.
- Use `artifacts/native-parity/editor/Control-Editor.ps1` ordinaryUIA/Win32 helper; inspect beforeinputs. Remote-debugging route was rejectedpreviously; neverretry.
- Dashboard triangle runsproject. Usecarddouble-click or ellipsis→Open for editing. AccidentalRun earlier changedonlygeneratedsrc/scripts.ts at07:43:40UTC; originalscene/package/lock/configunchanged. `dashboard-run-misclick.json` recordsit.
- Baseline before currentEditorattempt: `before-native-roundtrip.json`. Onlynative-parity.scene may be edited; preserveexample.scene. Suggestedproof:leatherShirttrue, verified exact fighterIdle clipchange, smallcamera/materialchange viaEditor. Recordactualsavedvalues/hashes; runmigrationandproveauthoredhashesunchanged, buildandbrowserobserve. Effecttimingcontrol notimplemented, fullEditoracceptance remainsopen.
- Parenthadclearedbrowser/buildwork beforeEditorediting. Thereiscurrentlynointentionalserver. Confirmprocessesbeforestartingone.

## Active subagents at handoff creation

- `/root/native_control_validation`: NEW, successfullyrunning. Foundfleet/laneskills, SSHworks, staged7updateddebugdocs/reports under `artifacts/native-parity/reference-current/source-support`. Taskreadnewdocs, inspectCapabilities/Environment/State/freshscreenshot, establishfullattackreferencewithoutguessing. Reportsbackrealimages. Noappcodeownership.
- `/root/native_attack_reference`: currentlyrawterraintextureextraction task (despitename). Owns NEW `recipes/native-terrain-textures.json`, isolatedhelper/tests/researchoutputs only. ConfirmedexistingConverter supports18exactTextureidentities (9diffuse+9masks) usingexistingpinnedsourceclosure. Extractinginto `artifacts/native-parity/terrain-textures`, originalpalettes/propertyflags and PNG RGBA/channelhashes (existingpngjs7). Noalphaheuristic/sharedconverter/migration/stagingedits. Awaitresult; integrateadditionalstablejobonlyafterreviewandrerunproof/coverage.
- `/root/native_map_pipeline`: COMPLETE/frozen. Newmaploader/inspector/tests doneandparentbrowserverified.
- `/root/pipeline_inventory`: COMPLETE/frozen. Stagerandtests done.
- `/root/editor_performance_inventory`: erroredusage-limit; inspectstatebeforecontinuation. Do notassumeitstillworking.

## Next concrete actions

1. Readfleet/laneskills and followworkcoordination. Maintainthishandoffwithnewfacts.
2. Receiveupdatednativecontrolreport; fullattackreferencefirst,thenmatchedfighter/Musveren/PowerStrikecaptures. Neverclaimscreenshotcoverageequalscompleteconversion.
3. FinishactualnativeEditoropening/propertyedit/save/rebuildproof. Preserveauthoredhashesthroughmigration. CoordinateUIownership/buildstoavoidHMRinterruptions.
4. Reviewterraintextureextraction; addreusabledeclaredrecipejobandvalidate/cache/clean/stagecontractsasappropriate. Keepmasksemanticsunverifieduntilnativebranchestablished.
5. Laterimplementverifiedeffecttiming/attachments/nativeworldmaterials/collisionandvisualcomparisons,thenbaseline/optimization. Do notfakebenchmarkstageor120FPSpass.

