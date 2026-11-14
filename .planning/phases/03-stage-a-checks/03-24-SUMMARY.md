---
phase: 03-stage-a-checks
plan: 24
subsystem: world
tags: [world, materials, static-meshes, ue2-library, gap-closure, tile-batch, rerun-chain]
status: complete
gap_closure: true
requires:
  - phase: 03-stage-a-checks
    provides: "03-18 ue2Diagnostic records; 03-21 tile walk fixes; 03-23 tile minimap schema 3 on the tracer tile"
provides:
  - "scripts/world/surface_material_programs.py: one program path (resolve, graph, program, texture images) for BSP surfaces and static mesh slots"
  - "Tile step static-mesh-materials (algorithm version 1) and the tile resource kind static-mesh-materials (/l2/native-materials/static-mesh-materials-<sha256>.json)"
  - "Texture images reused from stored programs by SHA-256 before any converter.texture call"
  - "Runtime join and binding: staticMeshLibraryMaterials.ts and lighting/bindStaticMeshLibraryMaterials.ts"
  - "World lane batch: 146 static-mesh-materials units, 145 schema 3 minimaps, 143 tile manifests at version 13"
affects: [03-25, 03-08, 03-12, 03-16, 03-36]
tech-stack:
  added: []
  patterns:
    - "A derived tile step reads a sealed upstream product and the GLB extras it pins; it re-extracts nothing"
    - "A per-tile native-materials listing pins programs, graphs and textures through its files map so the union walk copies them"
key-files:
  created:
    - scripts/world/surface_material_programs.py
    - scripts/world/static_mesh_materials_step.py
    - scripts/world/native_material_listings.py
    - src/scene/world/staticMeshLibraryMaterials.ts
    - src/scene/world/lighting/bindStaticMeshLibraryMaterials.ts
    - tests/pipeline/test_static_mesh_materials_step.py
    - tests/unit/staticMeshLibraryMaterials.test.ts
    - tests/browser/world-static-mesh-materials.spec.ts
  modified:
    - scripts/world/bsp_surface_materials.py
    - scripts/world/bsp_step.py
    - scripts/world/material_texture_images.py
    - scripts/world/tile_manifest_step.py
    - scripts/world/tile_step_registry.py
    - scripts/world/tile_step_current_seals.py
    - scripts/native_store/tile_manifest_validation.py
    - scripts/native_store/gap_census.py
    - recipes/world/tile-manifest-vocabulary.json
    - src/scene/world/nativeTileManifest.ts
    - src/scene/world/lighting/attachTileLighting.ts
key-decisions:
  - "P1212: no COLOR_0 vertex colour input; no program can name one and no lighting row is reviewed, so library static mesh slots draw unlit and list library-vertex-lighting-unported"
  - "P1213: the static mesh library binding lives in the tile lighting attachment, beside the BSP binding, not in nativeModelPlacements.ts"
  - "P1214: stored texture PNGs are found from the texture image pins of the programs already in the lane store"
  - "P1215: a listed program whose compiled plan is diagnostic keeps the texture material and lists its reasons"
requirements-completed: []
requirements-addressed: [MAT-01, MAT-02]
metrics:
  duration: 1h 50m
  completed: 2026-11-14
  tasks: 3
  files: 27
estimate:
  tokens: 110000
  tasks: 3
actuals:
  tokens: 32700
  tasks: 3
  commits: 2
plan_head_before: b2f16b5da1e994c2bb52ebf7b6ee987a4dc4cd78
plan_head_after: fefbb5b
---

# Phase 3 Plan 24: Static mesh slots through the UE2 material library Summary

Static mesh slots now get UE2 material programs, as BSP surfaces already had. A new tile step derives one program per distinct slot material from the sealed static mesh products and pins them in a per-tile `static-mesh-materials` listing. At runtime each slot whose program root is ported draws through the UE2 library. On tile 20_21, 11,665 of 12,286 static mesh slots now draw through the library. The other 621 keep their texture material and list their reasons. BSP and static meshes share one program path, and the 20_21 BSP programs re-derive byte-equal through it.

## What was built

- **Shared program path (task 1, 803035d).** `surface_material_programs.py` owns the export resolve, the material graph, the program derivation, the program record and the texture images. `bsp_surface_materials.py` keeps only the BSP texture fallback and the blend rule. `bsp_step.py` gets its converter, map sources and class scripts from `world_material_sources`. Byte equality:
  - The synthetic textured, unported and missing materials give identical outcomes and store files through the pre-move module (taken from `git show HEAD`) and the shared one. The pipeline test pins the textured program at `41d9dfc9...`.
  - The 22 BSP programs of 20_21 re-derive byte-equal through the shared path, with 0 texture conversions.
- **Texture reuse.** Before any `converter.texture` call, `StoredMaterialTextureImages` looks up the texture object in the texture image pins of the programs already in the lane store. It reads the PNG back and checks it against its SHA-256. A texture with no stored image is converted once and then remembered for the rest of the process.
- **Step `static-mesh-materials`.** The step reads the sealed `meshes` product and the `nativeSourceReference` of every slot in its model GLBs, counting each material object once per tile without regard to case. It writes one program per object through the shared path. The listing `native-tile-static-mesh-materials` has these fields: `sourceObject`, `program` pin, `rootPorted`, `gapReasons`, and a `files` map that pins every program, graph and texture for the union walk.
  - Gap rows: `material-*` reasons seal as gap, decode failures as failed.
  - The seal check uses the meshes fingerprint, the converter hash and the lock records of the material packages.
  - The step is registered in the step registry, the seal checks and `GAP_CENSUS_STEP_ORDER`.
- **Manifest.** The tile manifest pins the listing as resource kind `static-mesh-materials` (vocabulary listVersion 11, the Python templates and the browser templates). It lists `static-mesh-materials` as a pending step until that step is sealed. The step algorithm version goes to 13. The surface-materials listing code moved into `native_material_listings.py`, and its bytes are unchanged: the 20_21 surface listing path is the same before and after.
- **Runtime (task 2, fefbb5b).** `staticMeshLibraryMaterials.ts` parses the listing (exact fields, the tile, no repeated object, program pins) and joins a slot material object to its program or its gap reasons. Slots without a material get `static-mesh-slot-material-none`, and unlisted objects get `static-mesh-slot-material-unlisted`.
  - `bindStaticMeshLibraryMaterials` shares one unlit library material per program. It assigns that material only to slots whose plan compiles, and updates it every frame with the tile clock and the camera fog.
  - `attachTileLighting` loads the listing. `staticMeshSlots` in the inspection now holds `gap`, `lighting`, `lightingReasons`, `meshCount`, `statusCounts` and per-object `slots`.

## Tracer and batch

- Tracer 20_21 (`convert_tile.py --step static-mesh-materials`, then `--step manifest`): pass, 148 slot materials, 148 programs with ported roots, no gap rows. The new tile manifest is `2c666179...`, which adds only the `static-mesh-materials` resource to `9b9db450...`, with the same chunks. Free bytes went from 147,323,654,144 to 147,304,501,248, a drop of 19,152,896 bytes.
- Disk projection: 145 pending tiles × 19,152,896 = 2,777,169,920 bytes, against 147.3 GB free and the 4,294,967,296-byte floor. It fits.
- Batch: `convert_tile_batch.py --client E:/Lineage2-client --eligible --limit 145`, run as one background process at BelowNormal.
  - Result: exit 0 in 52 min. Free bytes went from 147,405,283,328 to 147,023,384,576. Identical-file sharing linked 1,000,324,345 bytes of PNGs.
  - Rows: 1557 pass, 638 gap, 4 failed, 21 pending.
- Lane results:
  - 146 `static-mesh-materials` units: 105 with a listing and 41 with no slot material.
  - Across tiles: 23,146 slot materials, 9,148 distinct, all with ported roots, and 318 object gap rows.
  - Gap reasons by distinct object: ScalableRateX and ScalableRateY 107 each, VertexColor 53, Cubemap 15, decode-failed 2, Fire.WetTexture 1, TexOscillatorTriggered 1.
  - 145 minimaps resealed at schema 3. 143 tile manifests resealed at version 13, of which 105 pin the listing.
- Receipt gate (`artifacts/lane-store/world/measurements/static-mesh-materials-batch.json`, SHA-256 `71cd994d...` before the chain record was added):
  - Receipts: 2048 before (`066bdad5...`), 2194 after (`c521d6de...`).
  - In the re-run steps, 145 minimap and 143 manifest receipts changed, and 146 static-mesh-materials receipts are new.
  - Outside the re-run steps no receipt changed and none is missing (`unchangedOutsideRerunSteps: true`). The meshes, bsp and collision receipts kept their fingerprints.
  - `print_fingerprint_inputs.py` output is byte-equal before and after (`implementation_hash` `c4bf8e6c...2bd8`).

## Re-run chain

| Step | Command | Result |
| --- | --- | --- |
| 1 Lane re-run | `convert_tile_batch.py --client E:/Lineage2-client --eligible --limit 145` | exit 0. Free bytes 147,405,283,328 before, 147,023,384,576 after |
| 2 Lane catalog | `write_lane_catalog.py --lane world`, then `--plan` | exit 0 and 0. World lane catalog `cddfe152...` (143 tiles); restage base `55c12147...` |
| 3 Union rebuild | `write_lane_catalog.py --lane integration --union world --union actors --union data-ui` | **exit 1, failed**: `Existing immutable runtime asset is corrupt; preserved: ...\integration\l2\475f47eb...\model.glb`. Union catalog `e25d005e...` before and after. Free bytes 146,988,167,168 before, 147,054,370,816 after |
| 4 Touched-key sweep | - | not run: union rebuild did not exit 0 (same stderr line) |
| 5 Queue | - | not run: union rebuild did not exit 0 |
| 6 Re-capture | - | not run: no sandbox halves yet |
| 7 Ingest | - | not run: no sandbox halves yet |

Cause of the union failure, found by inspection only (no retry): the actors lane file `actors/l2/475f47eb.../model.glb` (catalog records `interlude:item:2429` and `item:4227` body-part 12, pin `modelSha256` `1c94850c...`, which equals the `model.glb` inside its own `asset.l2asset`) now holds bytes `f4dfe4cc...`. It is hard-linked to `actors/converter/475f47eb.../model.glb` and to the integration copy (`fsutil hardlink list`, 3 links). A later write to the converter output changed the store file through the link. This is an actors lane store fault, not a world lane one.

## Task commits

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Tracer: shared program path, static-mesh-materials step and resource on one tile | 803035d | 21 files (3 new modules, the step registration, the manifest, the vocabulary, the parser and the join, tests, fixture tile) |
| 2 | Runtime binding through the library | fefbb5b | bindStaticMeshLibraryMaterials.ts, attachTileLighting.ts, unit tests, browser spec |
| 3 | Tile batch, chain, receipt gate, cleanup | none (ignored lane outputs) | static-mesh-materials-batch.json, receipts before and after |

## TDD gate compliance

- Task 1: the step module draft came before its pipeline test, so the module did not first fail its own test. RED came from parity and order tests that were already in the suite and failed on the change: `test_catalog_record_shapes` (browser template missing), `test_store_file_publish` (new publisher), `test_tile_manifest_step` (version and pending steps) and `test_tile_step_current_seals` (step count). They pass now. 8 new pipeline tests and 5 join tests pass.
- Task 2: the binding tests were written first and failed with the module missing (vitest: 1 failed file, no tests). They pass now with 9 tests.
- Tracer gate: the task 1 verify was re-run after the tracer reseal and passed before task 2.

## Checks

- Task 1 verify: `test_static_mesh_materials_step.py` 8 OK; `test_*bsp*.py` 64 OK; `staticMeshLibraryMaterials.test.ts` passed.
- World-related pipeline tests (83 files, 1148 tests) pass, apart from the two parity and publisher failures above, which are now fixed. `test_converter_implementation_hash.py` passes unchanged.
- Task 2 verify: `staticMeshLibraryMaterials.test.ts` and `materialProgram.test.ts` (23 tests) pass.
- Browser checks, port 5173 free, `NATIVE_STORE_ROOT=world`:
  - `world-static-mesh-materials.spec.ts` passed before and after the batch: 11,665 library-compiled, 620 library-diagnostic (`material-feature-unported:ColorFadeType` 26 objects, one external reference) and 1 program-gap (`static-mesh-slot-material-none`). Screenshot `artifacts/ui-evidence/world-static-mesh-materials-20_21-desktop.png` at 1440 x 900; the inspection JSON is beside it.
  - `world-minimap.spec.ts` passed 8 of 8 after the batch. This was the 03-23 follow-up.
- A unit run over `tests/unit/` (242 files) passed: 2915 tests, 59 skipped. `pnpm typecheck` is clean.
- Task 3 verify: True, then `--plan` exit 0, and no listener on 5173 or 5175.
- Lane ownership: `--base b2f16b5 --part world` reports 2 foreign paths, `scripts/native_store/gap_census.py` and `scripts/native_store/tile_manifest_validation.py`. These are the expected integration edits that register the step and the resource kind. Task 2 (`--base 803035d`) reports 0 foreign paths.
- Reference overlap: no touched file lies in an overlap area (materials covers `src/materials/**`, which this plan left untouched), so no run.

## Deviations from plan

### Auto-fixed issues

1. **[CLAUDE.md, no dead code] No vertex colour input (P1212).** 21 of the 32,212 primitives of the 6,212 world lane static mesh GLBs carry COLOR_0. No program can name it, because VertexColor stays `material-class-unported`, and no `lighting-rules.json` row is reviewed. Library slots draw unlit and list `library-vertex-lighting-unported`. `fragmentChain.ts` and `loadNativeMaterial.ts` are unchanged. The task 2 commit message says that no static mesh GLB carries COLOR_0; the correct count is 21 primitives.
2. **[Design] The binding lives in the lighting attachment (P1213),** not in `nativeModelPlacements.ts`, which is unchanged.
3. **[Rule 3] Files outside the plan list:** `material_texture_images.py` (stored image lookup), `native_material_listings.py` (keeps `tile_manifest_step.py` under 400 lines), `tile_step_registry.py` and `tile_step_current_seals.py` (step registration; `convert_tile.py` takes its choices from the registry and needed no edit), `tile_manifest_validation.py`, `gap_census.py`, the fixture tile `6a82a8ee...` (regenerated for the new pending step), and the test updates in `test_world_bsp_step.py`, `test_world_store_path_refusals.py`, `attachTileLighting.test.ts` and `attachNativeTileSystems.test.ts`. The last two lost their static-mesh malformed-pin case, because static meshes no longer read glTF program pins; terrain meshes still do.
4. **[Plan] No new gap reasons.** The step needs none: the existing `material-class-unported`, `material-feature-unported`, `decode-failed` and `step-pending` reasons cover it, so `recipes/world/gap-reasons.json` is unchanged.
5. **[Rule 3] Manifest algorithm version 13** (was 12), so a sealed manifest without the new resource is never reused.

**Impact:** the vertex colour part of the must-have is stated as a listed gap rather than built. Everything else is as planned.

## Open follow-ups

- **Union rebuild blocked by the actors lane store** (chain step 3, exit 1). `actors/l2/475f47eb.../model.glb` no longer matches its catalog pin `1c94850c...`, because a later converter write changed it through its hard link to `actors/converter/475f47eb.../model.glb`. The actors lane needs that file restored from its own `asset.l2asset` and a rule that store files are never hard-linked to converter outputs that get rewritten. Then run the union `write_lane_catalog.py --lane integration --union world --union actors --union data-ui`, and chain steps 4 (touched-key sweep: every tile key whose manifest changed) and 5 (queue). The union may hold unreferenced world files from the failed copy; its catalog is unchanged.
- MAT-01 and MAT-02 stay open: static mesh vertex lighting has no colour source (the lighting payload carries StaticMeshActor light list counts, not colours), and terrain layers are 03-36.
- 03-25 reuses `surface_material_programs.py` for skeletal slots.

## Open questions (for the orchestrator)

- None from native code. No D3DDrv listing was needed; the plan derived no value from the particle material binds.

## Decision rows

Appended to `pending-decision-rows.md`: P1212 to P1215 (see key-decisions).

## Known stubs

None.

## Process cleanup

- This plan started:
  - the tracer and manifest `convert_tile.py` runs, the BSP byte check, unittest and Vitest runs, and three Playwright runs (each started its own webServer on 5173 and stopped it);
  - the batch (PIDs 43652, 88800 and 95476, exited 0), the lane catalog runs and the union rebuild (exited 1).
- One slow `grep` that this plan started was stopped by PID (33644 and its child 61124).
- `Get-CimInstance Win32_Process` filtered on `autonomous-roadmap` and `03-24` shows no remaining process. `netstat` shows no listener on 5173 or 5175.

## Self-Check: PASSED

- FOUND: the 8 created files listed under key-files.created.
- FOUND: commits 803035d and fefbb5b on `plan/autonomous-roadmap`; `git rev-list --count b2f16b5..HEAD` is 2 before this SUMMARY.
- FOUND: `artifacts/lane-store/world/measurements/static-mesh-materials-batch.json` (exitCode 0, receiptGate.unchangedOutsideRerunSteps true) and `static-mesh-materials-receipts-before.json` and `-after.json` (ignored lane outputs).
