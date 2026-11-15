---
phase: 02-stage-a-breadth
plan: 15
subsystem: world
tags: [world-01, chunk-plan, terrain-chunks, native-map-geometry-split, hand-chosen-windows]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-14 raw step, convert_tile.py and record_tile_step_gap_row; 02-04 CHUNK_SECTOR_SPAN, sectorRange and chunk order rules; 02-11 WORLD-07 layer-order verdicts and fixture"
provides:
  - "scripts/world/tile_chunk_plan.py: CHUNK_PLAN_STEP_ALGORITHM_VERSION 1, first_enabled_player_start, plan_tile_chunks, run_chunk_plan_step, sealed_chunk_plan"
  - "scripts/world/terrain_chunk_step.py: TERRAIN_CHUNK_STEP_ALGORITHM_VERSION 1, extrapolated_mask_uv_rule, tile_layer_summaries, build_tile_terrain_chunks, run_terrain_chunk_step"
  - "scripts/world/terrain_rectangle_mesh.py: build_terrain_rectangle_gltf, shared by build_geometry and the terrain step"
  - "Split modules: world/terrain_coordinates.py, native_terrain_sectors.py, terrain_layers.py, gltf_builder.py, static_placement.py, surface_spawn_candidate.py, section_static_models.py"
  - "convert_tile.py --step chunks and --step terrain"
  - "Sealed units (ignored): artifacts/lane-store/world/work/tile__20_21/{chunks,terrain}, tile__20_20/{raw,chunks,terrain}"
affects: [02-16, 02-29, 02-30, 02-31, 02-45, 02-47, 02-50]

estimate:
  tokens: 130000
  tasks: 3
actuals:
  tokens: 42000
  tasks: 3
  commits: 3
plan_head_before: e36ceca918b6d35aded6a9a486803ee070bdb186
plan_head_after: 3cd27dfe5c8b2e40be3fc36a99351aa44819c5d4

tech-stack:
  added: []
  patterns:
    - "A tile step reads its parent unit only after recomputing the parent fingerprint and calling is_sealed; the child fingerprint config holds that parent fingerprint"
    - "Shared mesh code takes its glTF generator name from the caller, so provenance names the writer"

key-files:
  created:
    - scripts/world/tile_chunk_plan.py
    - scripts/world/terrain_chunk_step.py
    - scripts/world/terrain_rectangle_mesh.py
    - scripts/world/terrain_coordinates.py
    - scripts/world/native_terrain_sectors.py
    - scripts/world/terrain_layers.py
    - scripts/world/gltf_builder.py
    - scripts/world/static_placement.py
    - scripts/world/surface_spawn_candidate.py
    - scripts/world/section_static_models.py
    - tests/pipeline/synthetic_terrain_fixture.py
    - tests/pipeline/test_tile_chunk_plan.py
    - tests/pipeline/test_terrain_chunk_step.py
  modified:
    - scripts/native_map_geometry.py
    - scripts/world/convert_tile.py
    - scripts/world/raw_map_step.py
    - scripts/extract-native-terrain-patch.py
    - tests/pipeline/test_native_map_geometry.py
    - tests/pipeline/test_native_terrain_patch.py
    - tests/pipeline/test_native_terrain_runtime_migration.py
    - tests/pipeline/test_unresolved_section_windows.py
    - tests/pipeline/test_client_entry_points.py
    - docs/parts/world/EVIDENCE.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "4x4-sector chunks chunk-<column>-<row>, side from CHUNK_SECTOR_SPAN (row 335)"
  - "sectorRange in sector indices and (column, row) order; native corner offsets kept as sectorRectangle (row 336)"
  - "Every chunk labelled extrapolated, 20_20 chunks too (row 337)"
  - "bEnabled from the tag or the Engine.PlayerStart class chain; unresolved gives a null anchor (row 338)"
  - "The chunk planner replaces the hand-chosen 20_20 XY windows; the old rectangle is a printed cross-check (row 339)"
  - "Per-chunk gap rows name the first failing qualified sector, not the chunk id (row 340)"
  - "Empty serialized layer slots stay listed with emptySlot true (row 341)"
  - "Static model functions moved to world/section_static_models.py for the 400-line limit (row 342)"
  - "GltfBuilder takes its generator; chunk GLBs name terrain_chunk_step.py (row 343)"
  - "The entry point guard scan follows re-exported names (row 344)"
  - "WORLD-01 stays Pending (row 345)"

requirements-completed: []

coverage:
  - id: D1
    description: "TerrainInfo-derived 4x4-sector chunk plan with frame and first enabled PlayerStart anchor, sealed for 20_21 and 20_20"
    requirement: WORLD-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_tile_chunk_plan.py (16 tests)"
        status: pass
      - kind: integration
        ref: "python -B scripts/world/convert_tile.py --client E:/Lineage2-client --map 20_21 --step chunks"
        status: pass
    human_judgment: false
  - id: D2
    description: "Per-chunk terrain GLBs from source height samples, labelled extrapolated, with adjacency, empty, failed-chunk and layer-order rules"
    requirement: WORLD-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_terrain_chunk_step.py (14 tests)"
        status: pass
      - kind: integration
        ref: "python -B scripts/world/convert_tile.py --client E:/Lineage2-client --map 20_21 --step terrain"
        status: pass
    human_judgment: false
  - id: D3
    description: "native_map_geometry.py split under 400 lines with legacy 20_20 section bytes unchanged and every foreign importer resolving"
    verification:
      - kind: other
        ref: "build_geometry on native-map-debug-location, native-map-section and native-map-section-3x3-candidate over E:, 39 files compared before and after"
        status: pass
      - kind: unit
        ref: "python -B -m unittest discover -s tests/pipeline -p test_native_*.py (671 OK, 94 skipped)"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-11-09
---

# Phase 2 Plan 15: Tile chunks and per-chunk terrain Summary

**`convert_tile.py --step chunks` now plans any eligible tile as 4x4-sector chunks from its own TerrainInfo, and `--step terrain` writes one GLB per chunk from the source height samples, labelled `extrapolated`. Both run through one shared mesh builder with the legacy 20_20 section, whose bytes are unchanged. 20_21 and 20_20 are sealed, and `native_map_geometry.py` is down from 1,041 to 381 lines.**

## Performance

- **Duration:** about 40 min
- **Started:** 2026-11-09T03:21:00Z
- **Completed:** 2026-11-09T04:02:00Z
- **Tasks:** 3
- **Files modified:** 25 code, test and docs files

## Accomplishments

- The chunk plan holds the frame `{terrainInfo, location, terrainScale, heightmapDimensions, sectorGrid, sourceToGltf}`, the anchor and the chunks in `(column, row)` order. Each chunk has `sectorRange` in sector indices (the 02-04 rule passes for 8x8, 6x5, 16x16 and 1x1 grids), `sectorRectangle` in native corner offsets and `sectorObjects` in native `(y, x)` order. A raw unit without TerrainInfo or a height texture gives `terrain-height-package-missing` and writes no plan. An unsealed raw unit is refused.
- Real 20_21 against research 5.1 and the probe:

| Measure | 20_21 | Cross-check |
|---|---|---|
| Sector grid | 16x16, 16 chunks | 256 sectors |
| Frame | `20_21.TerrainInfo0`, [16384, 114688, 160.65], scale [128, 128, 76] | Probe `(x-20)*32768` = X 0, the tile's west edge (16384 - 128 x 256 / 2); not used as the frame |
| Anchor | `20_21.PlayerStart2` [18160, 112972, -6527], first in export order, `bEnabled=True` from `Engine.PlayerStart` | The probe hand-picked `PlayerStart4`; not used |
| GLBs written | 16 of 16, 129,966 triangles, 42 hidden quads | - |
| Cached Z mismatches | 238 under `require-xy-preserve-z-discrepancies` | Research: 238 of 256 |
| Layers | 9, index order 0..8 | - |

- 20_20 (census eligible): raw, chunks and terrain sealed. 16 chunks, all written, 129,994 triangles, 28 hidden quads, 221 Z mismatches (the legacy 35 of 256 match), 11 serialized layers (9 filled, slots 9 and 10 empty), anchor `20_20.PlayerStart0` [19172.80, 79583.47, -4295.06].
- Overlap one-liner (cross-check only, never read back): `python -B -c "...chunk-plan.json ... recipes/native-map-debug-location.json ..."` printed `['chunk-1-3'] {'minOffset': [64, 208], 'maxOffset': [96, 240]}`. `chunk-1-3` covers corner offsets [64, 192]..[112, 240].
- Determinism: after removing both 20_21 seals, the rerun gave 18 byte-identical products (chunk plan, 16 GLBs, index). A rerun of the sealed terrain unit after the split left all 20 files of the unit unchanged (paths, sizes, mtimes).
- Legacy bytes: `build_geometry` over E: on the three 20_20 section recipes wrote the same 39 files (13 each, receipt excluded) before the plan, after Task 1, after Task 3 and after the generator change.
- Layer-order verdict: W07-01 to W07-06 are `adopted` in "WORLD-07 review". The fixture test was added: the seven-layer order [0, 2, 3, 4, 5, 6, 7] survives into the chunk records and the GLB extras.
- Split: `native_map_geometry.py` 381 lines. The world modules are all under 400 lines (largest `tile_chunk_plan.py` at 200). No world module imports or names `native_map_geometry`. `implementation_hash()` lists the ten world modules. All 11 names in the plan's import check resolve, as do `SOURCE_TO_GLTF`, `static_matrix` and `resolved_static_values` for the movers and overlap scripts. No name had to stay defined in `native_map_geometry.py`. `bit`, `gltf_placement` and `read_class_evidence` resolve because `build_geometry` uses them.

## Task commits

1. **Task 1: chunk plan and per-chunk terrain through one shared mesh builder**: `71250e1` (feat)
2. **Task 2: adjacency, empty and failed chunks, layer order, 20_20 window replacement**: `82ba004` (feat)
3. **Task 3: finish the split under 400 lines**: `3cd27df` (refactor)

**Plan metadata:** the docs commit that holds this SUMMARY.

## Verification

- `test_tile_chunk_plan.py` 16 OK. `test_terrain_chunk_step.py` 14 OK. `test_unresolved_section_windows.py` 4 OK. `test_native_map_geometry.py` OK with its original expectations (8 local cases skip, as before, because their staged inputs are absent).
- `python -B -m unittest discover -s tests/pipeline -p "test_native_*.py"`: 671 OK, 94 skipped. `-p "test_t*_chunk_*.py"`: OK.
- Full pipeline (`scripts/test_pipeline.py` at BelowNormal): 1463 OK, 103 skipped, exit 0. 02-14 ended at 1397 OK and 103 skipped, so there is no new failure.
- Import check: `missing []`. `grep -l native_map_geometry scripts/world/*.py`: empty. `grep -lE "native-map-"` over the three step modules: empty.
- `node scripts/check-lane-ownership.mjs --base e36ceca --part world`: `lane world: 0 foreign paths`.
- `docs/parts/world/EVIDENCE.md`: one "Tile chunks and terrain" section with "Hand-chosen windows replaced", 29,562 bytes.
- No `assets:*`, `world:stage`, `stage_*`, `derive-*`, `migrate-*` or preview command ran. `public/l2` was not touched. `scripts/native_assets_lib/**`, `scripts/derive-native-map-model.py` and `scripts/native_migration.py` were not edited.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 1 - Bug] Per-chunk gap rows cannot carry the chunk id as `sourceIdentity.object`**
- **Found during:** Task 1
- **Issue:** `validate_gap_row` requires a qualified object name, so `chunk-1-1` would make `UnitLedger.seal` refuse the receipt.
- **Fix:** The row names the first chunk sector that fails the XY oracle. The chunk record keeps the chunk id (row 340). 02-16 plans the same field for `terrain-quads-all-hidden` and needs the same choice.
- **Commit:** 71250e1

**2. [Rule 1 - Bug] 20_20 serializes two empty layer slots**
- **Found during:** Task 2, first 20_20 terrain run (`failed`, records [0..8] against serialized [0..10])
- **Fix:** `tile_layer_summaries` lists every serialized layer in index order. Empty slots (no Texture, no AlphaMap) get `emptySlot: true` and no UVs. A layer that names only one of the two fails (row 341). The stale 20_21 terrain unit from Task 1 was removed and rebuilt.
- **Commit:** 82ba004

**3. [Rule 3 - Blocking] The entry point guard scan did not follow re-exports**
- **Found during:** Task 1, full pipeline run
- **Fix:** `test_client_entry_points.py` resolves a re-exported name to its defining module, and a synthetic case covers it (row 344).
- **Commit:** 71250e1

**4. [Rule 3 - Blocking] 414 lines after the planned moves**
- **Fix:** The static model functions moved to `world/section_static_models.py` (row 342). Moving the static placement collection would have left foreign-imported names unused. `verify_geometry` cannot move without a cycle.
- **Commit:** 3cd27df

**5. [Rule 2 - Provenance] The shared builder hard-coded `native_map_geometry.py` as glTF generator**
- **Fix:** `GltfBuilder(generator)`. The legacy build passes its own file name, so its bytes are unchanged. Chunk GLBs name `terrain_chunk_step.py`, and the extract script passes its own string (row 343). The 20_21 and 20_20 terrain units were rebuilt once, and the determinism proof was redone.
- **Commit:** 3cd27df

**6. [DRY] Shared helpers beyond the plan's list**
- `read_height_samples`, `read_topology_words` and `source_backed_terrain_points` (native_terrain_sectors), `require_terrain_not_inverted` (static_placement), `rectangle_source_points` (terrain_rectangle_mesh), and `tile_step_row` (raw_map_step, which replaces `raw_step_row`) serve both the legacy build and the new steps.
- `plan_tile_chunks` takes `tile_id` first, and `build_terrain_rectangle_gltf` takes `sector_rectangle` and `generator`.

**7. [Process] TDD order**
- Tests were written right after each implementation, not as a failing commit first. Every behaviour case has a named test, and they all pass.

**Total deviations:** 5 auto-fixed (2 bugs, 2 blocking, 1 provenance), plus 2 recorded process notes. None widens the scope.

## Flagged for the integration thread

- `scripts/native_batch_adapters.py:139` lists `native_map_geometry.py` in an implementation file set but not the world modules (as noted in the plan and in 02-14).
- `native_map_geometry.implementation_hash()` now covers the world modules. Main-checkout geometry receipts therefore refuse `verify_geometry` until the integration thread re-migrates or retires the 20_20 chain. The output bytes themselves are unchanged. This is the same Needs Human item 02-14 recorded.
- 02-16 adds `player-start-missing` to `recipes/world/gap-reasons.json`. This plan only stores it in `anchorGap`.

## Known stubs

None. Terrain GLBs keep the neutral inspection material by design. Converted layer textures are a pending step in 02-16.

## Process cleanup

- Processes started: unittest and pipeline runs, `convert_tile.py` runs for 20_21 and 20_20 (raw, chunks, terrain), UELib class-default decompiles (PowerShell, through `read_class_defaults`), and scratch snapshot scripts. All ran in the foreground and exited.
- Check: `Get-CimInstance Win32_Process` filtered on `*autonomous-roadmap*` found 4 processes (the session's own shells), and none matches `convert_tile`, `unittest`, `test_pipeline`, `extract_ue_defaults`, `vitest`, `playwright` or `vite`. Nothing listens on port 5175, and no dev server was started. Nothing started by this plan remains.

## Next phase readiness

- 02-16 reads `tile__XX_YY/chunks/products/chunk-plan.json` and `tile__XX_YY/terrain/products/{terrain-chunks.json, <chunkId>/terrain.glb}`, and checks both seals through `sealed_chunk_plan` and the terrain ledger.
- WORLD-01 stays Pending (row 345).

## Self-Check: PASSED

- FOUND: scripts/world/tile_chunk_plan.py, scripts/world/terrain_chunk_step.py, scripts/world/terrain_rectangle_mesh.py, scripts/world/surface_spawn_candidate.py, scripts/world/section_static_models.py, tests/pipeline/test_tile_chunk_plan.py, tests/pipeline/test_terrain_chunk_step.py, artifacts/lane-store/world/work/tile__20_21/{chunks,terrain}/complete.json, artifacts/lane-store/world/work/tile__20_20/{raw,chunks,terrain}/complete.json
- FOUND commits: 71250e1, 82ba004, 3cd27df

---
*Phase: 02-stage-a-breadth*
*Completed: 2026-11-09*
