# Native world import continuation — 2026-11-05, latest checkpoint

**Superseded by [editor-roundtrip-continuation.md](editor-roundtrip-continuation.md).**
Actual Editor save/rebuild/browser proof and the source-backed Musveren support
repair are now verified. The commands/processes below are historical; read the
new handoff before acting. The tracked goal remains active.

The existing tracked goal remains ACTIVE. Work stays on DATABASE-PC at
`C:/laragon/www/l2-browser-client`; no duplicate goal, reset, cleanup or binary
publication. User prioritizes visible world/assets and reusable scripts before
optimization. They also ask how another reverse-engineering agent can help.

## Latest completed work

- Default `recipes/native-migration.json` now selects
  `recipes/native-map-debug-location.json`: source-backed PlayerStart10 area,
  nine sectors, 2,352 vertices/4,512 triangles, 61 models/151 placements.
- `pnpm assets:migrate --prove-rebuild --stage-runtime` PASS: 297/297 identical
  products, 25/25 cache hits, zero cache hits in `migration-clean-k77ohz4i`,
  95 archives (67 models/26 textures/two audio), 68 GLBs without errors/warnings.
  Main stage has four actor/equipment entries, one section, 18 source textures.
  Runtime manifest SHA: `67a9ba819cf63a87801b7600ed4edb0392e5382061073f35da665c2cbb73d22d`.
- `--verify-only` PASS. Main coverage now merges runtime coverage and lists
  `unsupportedRuntimeMaterials`; a reporting-only patch did not change products.
  The subsequent cached migration passed all 25 jobs again.
- Flame conversion is complete as RAW DATA: one source model/12 placements,
  23-node graph/9 class definitions/18 PNGs/16 DDS. Runtime material stays
  diagnostic and native shader/billboarding/texture-animation timing unsupported.
  The view says `12 effects pending`. Never silently omit it or claim parity.
- Read-only independent review found no blocker. A future terrain-only rectangle
  needs an aligned empty-model contract (converter allows it, staging/runtime
  reject it); this populated section is unaffected.
- 266 pipeline tests passed. After the fog fix, 151 unit tests/23 files passed.
  Build/typecheck passed; main chunk 3,857.45 kB/953.46 kB gzip, existing warning.
- Initial expanded world browser checks passed5/5, and the broader legacy run
  passed23 with1 historical skip. These were separate invocations.
- The manual main-route wide view exposed real fog failure: authored
  config.fog.fogEnabled=false, packer omits switch but exports mode3/start32/end85,
  live Babylon defaults fogEnabled=true; buildings become opaque sky color.
  Live diagnostic toggle alone restored them at the identical camera.
- Fixed `pnpm generate` to run `scripts/preserve-native-editor-fog.mjs` after
  official pack. Only native generated fogMode maps to0 when authored disabled;
  enabled edits retain authored mode. No live Editor setting override. Source
  assets/config unchanged. Regression checks saved false→true and idempotence.
  Snapshot now exposes fog values; browser test checks mode0 and captures wide.
- 248/249 prior authored/project/package files remain unchanged. The sole
  intentional change is package.json's generation command. Receipts are
  `editor/authored-preservation-debug-location{,-fog}.json`.

## Final browser verification and running preview

Root's final five native cases after fog fix PASSED5/5 in3.1minutes; exec14440
finished and its test-owned server closed. Log:
`artifacts/native-parity/browser/native-debug-location-fog-e2e.log`.
All manually owned preview tabs and manual Vite session52408 were closed.
The user-facing local `pnpm dev` is intentionally RUNNING in exec session11097,
log `browser/dev-visible-world.log`, at http://127.0.0.1:5173/?world=interlude.
Stop only this owned server before future generation/browser tests, which require
exclusive5173; do not stop other lineagen servers or services.

Final captures are saved in `artifacts/native-parity/browser/debug-location-20261105/`:
five refreshed native desktop/mobile/wide/death/section PNGs, three JSONs, retained
shared desktop/fog defect/temporary override views, plus capture-manifest.json.
Final wide comes from normal generation, not the override. The final wide,
desktop and mobile gallery was shown via html_preview/html_render.
Renderer observed ANGLE SwiftShader; screenshots' FPS is SOFTWARE diagnostic,
never GTX1060 benchmark or a 120FPS result. Source scale/placement remain intact.

## Remaining and coordination

- Screenshots, docs/VERIFICATION.md, ASSET_AUDIT, NATIVE_WORLD, NATIVE_MIGRATION,
  ARCHITECTURE, ROADMAP, SOURCE_REUSE, README/PRODUCT, EDITOR_MCP and screenshot
  guide are updated. git diff --check passed. No commit/push/binary publication.
- Subagents weapon_attachment, world_conversion_audit, reverse_engineering_scope
  all completed; no outstanding file ownership or native input. No current native
  desktop control has been claimed in this continuation.
- External investigator brief was refreshed at
  `artifacts/native-parity/research/REVERSE_ENGINEERING_HANDOFF.md`: first terrain
  renderer semantics in Engine.dll/D3DDrv.dll, second fullattack/PowerStrike
  dispatch, third sword matrix. Use existing pinned UELib/Capstone/tools first;
  no broad tool installation needed. Coordinate any live native input.
- Actual live pawn/camera still unverified; PlayerStart10 is conditional source
  startup evidence. Latest native read-only screenshot033 has nighttime lighting,
  visible FPS and viewer panels. Native files/protected INI/Jump stay unchanged.
- Babylon Editor5.5.3 opened original courtyard; native edit/save/rebuild proof
  remains incomplete. Saved asset preservation is NOT that proof.
- Full fighter attack reference, PowerStrike coordination, native material
  semantics, sword composition, collision, matched videos/diffs and hardware
  baseline/optimization remain open. DATABASE maximum75Hz cannot certify120Hz;
  IMPORTA hardware tests remain separately labeled. GameWorldAdapter preserved;
  Phase2 networking remains planned.

## Historical checkpoint — 2026-11-05 13:10 +02 (superseded)

The tracked native-pipeline goal is ACTIVE. Do not create a duplicate goal or
discard the dirty workspace. Latest user wants the world matching the debug
location in L2.exe visible in the browser with FPS. They also ask how an external
reverse engineering agent can help; root answered and linked the focused brief.

## Current work and ownership

- `/root/weapon_attachment` owns offline rectangle expansion and exact additional
  StaticMesh material package-version support. All geometry changes and tests
  are implemented. It is now investigating one remaining Combiner material in
  `FX_E_S.Flameset.Default_Flame01`. Do not silently omit that placement or flatten
  its graph. Ask for its latest findings before touching converter files.
- `/root/world_conversion_audit` completed the native runtime, new terrain preview
  module and grounding regressions; frozen. Root reviewed and integrated them.
- `/root/native_control_validation` completed source-location research and the
  external-agent brief; no native input was sent during this continuation.
- Root owns runtime integration, staging standalone textures, browser validation,
  final migration recipe selection, documentation and handoff.

## Findings

Source startup selects **20_20.PlayerStart10**, native XYZ
`[10536,95034,-3374.786376953125]`, under the reviewed Engine.GameInfo and custom
controller behavior. Native navigation chain is PlayerStart10 → 34 → 0; equal
ratings keep the first. The actual live pawn/camera remains unverified. Reports:
`artifacts/native-parity/research/native-location/README.md` and
`artifacts/native-parity/research/REVERSE_ENGINEERING_HANDOFF.md`.

The initial Sector106 section is the wrong location for this startup candidate.
The new `recipes/native-map-debug-location.json` selects nine source sectors
around Sector229: grid origins [64,208] through [96,240], native XY
[8192,92160]..[14336,98176]. The shorter last row is retained. Geometry has
2,352 vertices / 4,512 triangles; 151 placements / 61 source meshes, none excluded
by declared Z[-4000,-2500]. Native triangle ground at the exact PlayerStart10 XY
is -3455.286376953125. Authoritative PlayerStart Z stays separately recorded.

Initial export failed 20 meshes on unsupported UE123 licensees16/22/23/25/31.
The agent independently verified 280 tagged material slots, then supported only
those exact versions. Retry now exports60/61 meshes; one native flame Combiner
still needs a source-preserving adapter or explicit unsupported representation.
Outputs/logs: `artifacts/native-parity/research/world-debug-location/`.
Do not stage the partial manifest as if it were complete.

Rectangle policy requires exact native XY and retains all cached Z discrepancies
at the unchanged0.001 tolerance, reconstructing original samples without fitting.
6/9 selected cached Z bounds differ. This is metadata provenance, not a relaxed
visual acceptance. Original single-sector recipe remains supported unchanged.

## Root runtime changes already made

- Main `/?world=interlude` loads the source section before actors, terrain support,
  follow/frame controls, original native actors/equipment/death, FPS and diagnostics.
- Fixed real Editor packer bug: packed scene declares LH despite initial RH flag.
  `NativeParityScript.onStart` sets RH after parsing, before native GLBs; browser
  environment also sets RH after loadScene. Earlier world was silently falling back.
- Diagnostics now retain `worldFailure`; async asset messages cannot hide cause.
- Camera `setTarget(...,false,false,true)` preserves authored angles and radius
  when jumping from inspection origin to source-world coordinates.
- Native models have centered pivots (fighter idle minY≈-.26046). `groundClearance`
  is measured once in idle; EntityRegistry places the entity root above the local
  terrain support point only with a ground hook. No rig/node/key/geometry rebasing,
  per-frame floor correction or scale fitting. Native collision remains unverified.
  MFighter native collisionheight23uu is known; PlayerStart80.5uu is NOT its offset.
- `nativeTerrainPreview.ts`: optional candidate shader uses source diffuse matrices,
  exact PNG pixels and9 ordered source layers. Direct PNG decoding avoids canvas
  alpha premultiplication. Seven equal-size masks byte-packed into2RGBA textures,
 512mask separate, constant-white base;12samplers total. No resampling. Unlit raw
  encoded color, ordered mixing, shared maskUV and mip0 bilinear remain candidates.
- Neutral/source texture controls retained. Failed material preview retains neutral
  terrain with `materialFailure`; abort/scene/model failures dispose ownership.
- Loader restores retained GLB mesh extras by exact primitive pointer because the
  optional Editor metadata extension was absent. Original metadata merged intact.
- Runtime staging now copies18 standalone texture archives/PNGs plus catalog IDs,
  source identities, lengths and hashes. One catalog snapshot supplies section and
  textures, avoiding mismatched revisions during concurrent staging.
- Manifest limits128models/4096placements; resource/hash/transform checks retained.

## Verification and active commands

Root built successfully (latest `browser/build-native-world-textures.log`, main
chunk3,856.38kB/954.44gzip; existing warning). Subsequent changes included one
catalog-snapshot fix, tests and no scene-generation changes; finalbuild still due.
New terrain module8 tests passed, grounding3 new cases passed, focused runtime25
passed before those additions, staging15passed. Full suites still due.

Root started `pnpm exec playwright test tests/browser/nativeSlice.spec.ts
tests/browser/nativeSection.spec.ts` in exec session2749; log
`artifacts/native-parity/browser/native-world-small-e2e.log`. Check completion.
Do not stage/change public files or run build/generate while it is running.
Tests now require actual source-textured terrain, no world/material fallback,
fixed ground clearance, movement/equipment/death/mobile and cleanup. Section test
reads expected staged geometry/counts instead of hardcoding old6/7/512.

Shared preview WORKED. Initial actual textured screenshot was shown through
html_preview/html_render and saved as
`artifacts/native-parity/browser/world-first-textured.png`. Actual renderer was
ANGLE SwiftShader and approximately5FPS. This is not GTX1060 evidence.
All root-owned shared tabs and the manual Vite exec76654 were closed.

## Next steps

1. Resolve/expose the one remaining flame material without silently dropping data.
2. Switch migration's section recipe to native-map-debug-location.json once ready.
3. Run full migration --prove-rebuild --stage-runtime after offline code freezes;
   current public/l2 still contains oldSector106 plus18 source textures.
4. Run build/unit/pipeline checks and native desktop/mobile/section browser checks
   sequentially relative to scene generation and staging. Show new location views.
5. Update docs/ASSET_AUDIT.md, NATIVE_MIGRATION, ROADMAP, ARCHITECTURE, VERIFICATION,
   README and main handoff with actual results. Preserve historical evidence.

Remaining larger goal: exact live camera/native reference/fullattack/PowerStrike,
native terrain shader/material semantics, sword composition, native collision,
Editor UI save/rebuild proof, video comparisons, hardware baseline/optimization
and120FPS acceptance. DATABASE monitor max75Hz; IMPORTA144Hz does not certify
GTX1060. Preserve GameWorldAdapter; Phase2 networking remains planned.
