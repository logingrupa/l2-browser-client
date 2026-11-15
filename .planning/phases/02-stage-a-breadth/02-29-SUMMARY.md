---
phase: 02-stage-a-breadth
plan: 29
subsystem: world
tags: [world-01, static-meshes, tile-chunks, tile-route, oracle, legacy-cut]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-12 tile census and 20_20 oracle; 02-14 raw step and MapSources; 02-15 chunk plan, terrain chunks and the split placement functions; 02-16 tile and chunk manifests, ?map route and load-check records; 02-01 to 02-04 ledger, gap rows, store writer and tile manifest validators"
provides:
  - "scripts/world/static_placement_plan.py: ChunkRectangle, chunk_rectangles, chunk_for_origin, static_mesh_actors, plan_static_placements"
  - "scripts/world/static_mesh_step.py: STATIC_MESH_STEP_ALGORITHM_VERSION 2, run_static_mesh_step, sealed_static_meshes, static_mesh_outcomes, tile_static_mesh_row"
  - "convert_tile.py --step meshes; the manifest step fills chunk models from a sealed meshes unit (TILE_MANIFEST_STEP_ALGORITHM_VERSION 2) and replaces its own earlier tile record"
  - "src/scene/world/nativeModelPlacements.ts: instantiateNativeModelPlacements, disposeNativeModelInstances (one owner for sections and tile chunks)"
  - "parseNativeTileChunkManifest model placements; loadNativeTileChunks loads each model archive pinned by SHA-256 and reports modelCount, placementCount, meshGapCount"
  - "tests/browser/world-tile-meshes.spec.ts with a tile:20_21 load-check record; tests/pipeline/test_world_tile_general_steps.py tile identity scan"
  - "World gap reasons placement-outside-chunk-grid, placement-material-override-unsupported, static-mesh-reference-unresolved (listVersion 3)"
  - "Lane store (ignored): 20_21 meshes unit, 160 model archives, tile bd0c781b..., lane catalog 34b83e83..."
affects: [02-30, 02-31, 02-45, 02-46, 02-47, 02-70, 02-71]

estimate:
  tokens: 105000
  tasks: 4
actuals:
  tokens: 30000
  tasks: 4
  commits: 5
plan_head_before: badd0a244a5219e52f77919ed4e2ae8476025922
plan_head_after: beeecfb88825b97d0d86c9613d3ce4b4e710f448

tech-stack:
  added: []
  patterns:
    - "Per-object gap rows live in the unit receipt and product; the lane gap-row file keeps one tile row per step"
    - "A world step reads its upstream products through the sealed upstream unit and fingerprints the lock eSha256 of every source file it requests"

key-files:
  created:
    - scripts/world/static_placement_plan.py
    - scripts/world/static_mesh_step.py
    - src/scene/world/nativeModelPlacements.ts
    - tests/pipeline/test_world_static_mesh_step.py
    - tests/pipeline/test_world_tile_general_steps.py
    - tests/pipeline/glb_document_fixture.py
    - tests/unit/nativeModelPlacements.test.ts
    - tests/browser/world-tile-meshes.spec.ts
  modified:
    - scripts/world/convert_tile.py
    - scripts/world/tile_manifest_step.py
    - recipes/world/gap-reasons.json
    - src/scene/world/loadNativeSection.ts
    - src/scene/world/loadNativeTileChunks.ts
    - src/scene/world/nativeTileChunkManifest.ts
    - tests/pipeline/test_tile_manifest_step.py
    - tests/pipeline/test_native_map_lock.py
    - tests/pipeline/test_native_bsp_floor.py
    - tests/pipeline/test_native_bsp_building.py
    - tests/pipeline/test_client_entry_points.py
    - tests/pipeline/test_converter_independence.py
    - tests/unit/loadNativeTileChunks.test.ts
    - tests/unit/nativeTileChunkManifest.test.ts
    - tests/browser/world-tile-walk.spec.ts
    - docs/OUTPUT_CONTRACT.md
    - docs/NATIVE_WORLD.md
    - docs/research/INDEX.md
    - docs/parts/world/EVIDENCE.md
    - STATUS.md
    - .planning/lanes.json
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md
  deleted:
    - scripts/native_map_overlap.py
    - scripts/derive-native-map-overlap.py
    - scripts/derive-native-map-model.py
    - scripts/restore-native-static-normals.py
    - scripts/native_assets_lib/static_normals.py
    - tests/pipeline/test_native_map_overlap.py
    - tests/pipeline/test_native_map_overlap_derivation.py
    - tests/pipeline/test_native_map_model_append.py
    - tests/pipeline/test_native_static_normals.py

key-decisions:
  - "Half-open native chunk rectangles from the sector quads through TerrainInfo toWorld; no Z window (row 452)"
  - "Material-override placements stay unplaced as placement-material-override-unsupported (row 453)"
  - "20_20 oracle compared by exact 3x3 columns and one common translation difference, matrices from the hash-checked served manifest (row 454)"
  - "Per-object gap rows in the meshes receipt and product; one tile row in gap-rows/meshes.json (row 455)"
  - "Shared converter cache work/static-mesh-converter; unit config holds chunksFingerprint and converterSha256 (row 456)"
  - "Chunk placements carry modelId equal to the parent model; browser cap 1024 models and 4096 placements per chunk (row 457)"
  - "Chunk model GLB read from inside the pinned archive (row 458)"
  - "Manifest step replaces its own earlier valid tile record; version 2 (row 459)"
  - "Tile identity scan allows reader_licensee_layouts.py and terrain_layers.py besides the census, oracle and fixture modules (row 460)"
  - "Task 3 foreign paths accepted under rows 373 and 380 (row 461)"
  - "WORLD-01 stays Pending (row 462)"

requirements-completed: []

coverage:
  - id: D1
    description: "Tile-general meshes step: chunk assignment, header gate, one conversion per mesh, sealed product and per-object gap rows"
    requirement: WORLD-01
    verification:
      - kind: unit
        ref: "python -B -m unittest discover -s tests/pipeline -p test_world_static_mesh_step.py (22 tests)"
        status: pass
      - kind: integration
        ref: "python -B scripts/world/convert_tile.py --client E:/Lineage2-client --map 20_21 --step meshes, --step manifest; write_lane_catalog.py --lane world"
        status: pass
    human_judgment: false
  - id: D2
    description: "Generic 20_20 plan is a superset of the frozen oracle"
    requirement: WORLD-01
    verification:
      - kind: integration
        ref: "OracleSectionSubsetTests (real client E:, run, not skipped)"
        status: pass
    human_judgment: false
  - id: D3
    description: "/?map=20_21 renders the converted static placements with a recorded load-check"
    requirement: WORLD-01
    verification:
      - kind: e2e
        ref: "NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-meshes.spec.ts (2 passed; load-check tile:20_21 pass on lane catalog 34b83e83)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Legacy 20_20 model append chain deleted with its tests and citations"
    requirement: WORLD-01
    verification:
      - kind: unit
        ref: "python scripts/test_pipeline.py (1652 tests, 96 skipped, OK); test_source_preservation_contract.py OK"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-11-09
---

# Phase 2 Plan 29: Static meshes per chunk Summary

**`convert_tile.py --step meshes` puts every StaticMeshActor of a tile into the 4x4-sector chunk whose half-open native rectangle holds its serialized origin, converts each reviewed mesh once through the imported `Converter`, and seals models, chunk placements and one gap row per unplaced object; the manifest step writes them into the chunk manifests and `/?map=20_21` renders 2,324 textured placements with a passing load-check. The generic 20_20 plan holds all 157 oracle placements, so the 20_20 model append chain is deleted.**

## Performance

- Duration: about 35 min of work (15:30 to 16:06 Riga), plus two background conversions of 162 meshes (about 6 and 10 min)
- Tasks: 4 of 4
- Commits: 5

## Accomplishments

- 20_21: 3,205 StaticMeshActor exports, 196 mesh requests; 160 models converted, 2,324 placements in 16 chunk manifests (largest `chunk-2-1`: 122 models, 740 placements), 881 per-object gap rows: `static-material-layout-unreviewed:123/12` 596 (cruma_s.usx), `decode-failed:ValueError:UModel cannot safely select this duplicate leaf name` 279, `static-material-layout-unreviewed:123/14` 3, `decode-failed:ValueError:Expected exactly one exported payload for dion_curumadungeon_t.Cm_inner_deco11` 3. No placement is outside the chunk grid and none has material overrides.
- Placement accounting: placed plus gapped objects equal the StaticMeshActor exports with a StaticMesh reference; otherwise the step returns a failed row and seals nothing.
- Rerun: a second `--step meshes` is a ledger skip (1 s). The Converter cache is shared at `artifacts/lane-store/world/work/static-mesh-converter`.
- Store: tile `/l2/tiles/bd0c781bd48fc16341029f410306b4fcacae5846a9d3d395f84f84c5258267c7/tile.json`, model archives at `/l2/<archiveSha256>/asset.l2asset` with `model.glb` beside them, lane catalog `34b83e8370b9cf2030a0bf8afa36ee1899e7b8f3acda06ac4e74c9fc7d18a741`. World lane coverage: 1/163 converted, 124 gap, 38 pending, loads 1 pass.
- 20_20 oracle subset: 157 of 157 oracle placements among 4,183 planned, same sourceMesh, identical 3x3 columns, one translation difference (0, 0, 0); all 62 oracle models requested.
- Browser: `instantiateNativeModelPlacements` serves `loadNativeSection.ts` and `loadNativeTileChunks.ts`; the tile loader fetches each archive pinned by SHA-256 (128 MiB cap), reads it with `readAssetPackage` and disposes every template and instance on failure. Screenshot `test-results/world-tile-meshes-20_21-desktop.png` shows the textured Cruma tower meshes on the tile.

## Task commits

1. Task 1 (tracer): `3e6df05` feat(02-29): convert every static mesh placement of a tile into its chunk manifests and render them on ?map
2. Task 2: `96fe35a` test(02-29): refuse a tile identity literal in any world step module and prove the 20_20 oracle subset
3. Task 3: `96649cb` refactor(02-29): delete the 20_20 model append chain now that the tile-general meshes step holds the oracle placements
4. Fix: `98b2878` fix(02-29): keep a static mesh conversion failure reason to its sentence so reruns elsewhere write the same rows
5. Task 4: `beeecfb` docs(02-29): record the static meshes per chunk evidence, the world status, the restage handoff and the retired lane rows

The tracer gate re-ran the Task 1 verify end to end (unittest OK, typecheck clean, Vitest pass, browser 2 passed) before Task 2.

## Verification

- `python -B -m unittest discover -s tests/pipeline -p test_world_static_mesh_step.py`: 22 OK, the oracle case ran. `-p test_world_tile_general_steps.py`: 3 OK. `-p test_tile_manifest_step.py`: 18 OK. `-p test_source_preservation_contract.py`: 27 OK.
- `python scripts/test_pipeline.py` at BelowNormal after Task 3: 1652 tests, 96 skipped, OK.
- `pnpm typecheck`: clean. `pnpm test:unit`: 2077 passed, 82 skipped (159 files). Targeted: `nativeTileChunkManifest`, `nativeModelPlacements`, `loadNativeTileChunks`, `nativeSection`: 60 passed after the loader tests were added; `laneOwnership.test.ts` 36 passed after the lanes edit.
- Browser, 5173 free: `NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-meshes.spec.ts` 2 passed (desktop 54.5 s, phone 37.5 s) on lane catalog `34b83e83`, load-check `artifacts/lane-store/world/load-checks/34b83e8370b9cf2030a0bf8afa36ee1899e7b8f3acda06ac4e74c9fc7d18a741.json` `{key: tile:20_21, status: pass}`; `world-tile-walk.spec.ts` 2 passed with the placements loaded (lane catalog `b5b525d5`, before the Task 3 reconversion). Headless SwiftShader: no FPS claim.
- Acceptance one-liners: `meshes/complete.json` present; `instantiateNativeModelPlacements` in both loaders; spec contains `hasTouch` and `430`, no 844 x 390 viewport; `git grep -n "native-tools" -- scripts` lists the `UMODEL` default; the two new step modules name no tool file; every deleted file name greps empty outside `.planning`; no `native_map_overlap` import remains; `grep -c static_normals docs/OUTPUT_CONTRACT.md` prints 0; EVIDENCE has one "Static meshes per chunk (02-29)" section (24.4 KB); STATE has one `Needs Human (plan 02-29)` line.
- Lane ownership: before the docs commit `check-lane-ownership.mjs --base badd0a2 --part world` listed exactly the six paths of `artifacts/plan-checks/02-29/foreign-paths.txt`. After the docs commit removed the four retired rows from `lanes.json`, the two deleted world scripts no longer belong to any lane, so the check lists eight; the two extra paths are deletions this plan made.
- Reference overlap: no DEC-OWN-12 area covers the files this plan wrote (materials, bsp-visibility, movement, particles, network), so no run applies.

## Deviations from plan

### Auto-fixed issues

1. **[Rule 3 - Blocking] Repeated tile key in one gap-row step.** `write_gap_rows` refuses a key twice per step, so per-object rows live in the meshes receipt and product, and `gap-rows/meshes.json` keeps one tile row (row 455).
2. **[Rule 3 - Blocking] The receipt holds only config, inputs, outputs and gapRows.** Models and chunk placements are a sealed product `static-meshes.json`.
3. **[Rule 1 - Bug] The manifest step refused its own reseal** (`catalog tiles record 20_21 differs; preserved`). It now replaces an existing record that pins a valid tile manifest of the same tile in this store, and merges the catalog before `begin` so a refusal no longer wipes the unit (row 459).
4. **[Rule 1 - Bug] The manifest step would overwrite the meshes tile row with `pending`.** Pending steps drop `meshes` once the meshes unit is sealed.
5. **[Rule 1 - Bug] Machine paths in failure reasons.** Converter messages name absolute paths; the reason keeps the sentence before the first colon or semicolon, version 2 (`98b2878`).
6. **[Signature] `chunk_for_origin(rectangles, x, y)`** takes the rectangles derived from the chunk plan and the native sector quads, because the chunk plan holds sector origins but not the last sector's quads (row 452).
7. **[Shared cache] Converter output** is `work/static-mesh-converter`, not the unit folder, because `UnitLedger.begin` wipes the unit folder (row 456).
8. **[Contract] Chunk placements add `modelId`**, the browser model cap rises to 1024 (row 457), and the GLB is read from the pinned archive (row 458).
9. **[DRY] `run_at_below_normal_priority` and `require_batch_preflight`** run once in `convert_tile.py` main for every step, not again inside the step.
10. **[Tests touched outside the list]** `test_tile_manifest_step.py` (version 2 and the sealed-meshes patch), `loadNativeTileChunks.test.ts` (model loading cases) and `world-tile-walk.spec.ts` (no longer asserts zero placements).
11. **[Order] Task 2 behaviours landed with Task 1.** The accounting, unresolved-reference, rerun and oracle tests are in the Task 1 commit; the Task 2 commit adds the tile identity scan. The 20_20 raw and chunk steps were already sealed (ledger skips).
12. **[Rebuild] Deleting `static_normals.py` changed `implementation_hash()`,** so the 20_21 meshes unit was reconverted, the manifest resealed and the browser check re-run on the final lane catalog `34b83e83`.

### Not done as planned

- None.

## Known stubs

- None. `loadNativeTileChunks` still returns `setTerrainPreview() {}` from 02-16 (terrain-material pending).

## Threat flags

None beyond the plan register: T-02-291 (every store write through `lane_store_root`, `verify_store_destinations` and `immutable_write`), T-02-292 (parser guards, SHA-256 and the 128 MiB cap before `readAssetPackage` and `validateSectionGlb`), T-02-293 (header gate before conversion, per-object failed rows), T-02-294 (load-check from `testInfo.status`, pinned to the served lane catalog), T-02-295 (synthetic fixtures only).

## Needs Human

- `Needs Human (plan 02-29):` the restage command printed by `write_lane_catalog.py --lane world --plan` (STATE.md).

## Process cleanup

- Started: two background meshes conversions, manifest and lane catalog runs, pipeline unittest runs and the full pipeline suite, Vitest runs, four Playwright runs (each started `pnpm dev` on 5173 and stopped it at exit).
- Check at 16:06 Riga: `netstat -ano | grep -E ':(5173|5175) .*LISTENING'` empty; `ps -W` shows only node.exe from Oct 29 (WINPID 5700, 5704, 25728) and python.exe from Nov 7 (29876), none started by this plan; no chrome, headless shell or Playwright process. Nothing started by this plan remains.

## Self-Check: PASSED

- FOUND: scripts/world/static_placement_plan.py, scripts/world/static_mesh_step.py, src/scene/world/nativeModelPlacements.ts, tests/pipeline/test_world_static_mesh_step.py, tests/pipeline/test_world_tile_general_steps.py, tests/pipeline/glb_document_fixture.py, tests/unit/nativeModelPlacements.test.ts, tests/browser/world-tile-meshes.spec.ts
- FOUND commits on plan/autonomous-roadmap: 3e6df05, 96fe35a, 96649cb, 98b2878, beeecfb
