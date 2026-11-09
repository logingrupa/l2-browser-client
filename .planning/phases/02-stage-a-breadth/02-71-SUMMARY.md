---
phase: 02-stage-a-breadth
plan: 71
subsystem: world
tags: [world-01, conv-01, legacy-cut, oracle, raw-step, migration, stage-runtime]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-12 world oracle and freezer; 02-14 raw step; 02-15 chunk and terrain steps with the extrapolated mask rule; 02-16 tile manifests and load checks; 02-29 Task 3 model append cut; 02-52 reviewed reader layouts"
provides:
  - "recipes/world/oracle/20_20/expected.json also freezes worldAudio (map-20-20-ambience, map-20-20-music) and stepSounds (stepsound-deco-grass-20-20, stepsound-surfaces) by manifest SHA-256, size and pin counts"
  - "scripts/world/raw_map_extraction.py: build_map, RAW_MAP_GAPS, RAW_MAP_MANIFEST_SCHEMA_VERSION (no section branch); RAW_MAP_STEP_ALGORITHM_VERSION 2"
  - "scripts/world/bsp_reader_binding.py: READER_SHA, pinned_bytes, PackageAdapter, reviewed_reader"
  - "scripts/native_assets_lib/sound_export_guards.py: the thirteen lock, path and receipt guards shared by both sound exporters"
  - "tests/pipeline/ue2_package_fixture.py and sound_package_fixture.py: neutral synthetic package fixtures"
  - "recipes/native-flame-material-graph.json and assets job flame-native-material-graph"
  - "stage_native_runtime.stage_runtime keeps every catalog record the migration does not produce"
affects: [02-30, 02-31, 02-45, 02-47, 02-54, integration restage]

estimate:
  tokens: 180000
  tasks: 6
actuals:
  tokens: 230000
  tasks: 6
  commits: 6
plan_head_before: e763bc5a233532921781617c413a64528b62a7f1
plan_head_after: 234449283a10464d2be7327d0d4cb3ec49fd3083

tech-stack:
  added: []
  patterns:
    - "A moved converter keeps a byte pin of its plan-start products (test_world_raw_map_extraction.py PLAN_START_PRODUCT_SHA256)"
    - "A stager merges into the current catalog per slice: same id replaced in place, new ids appended, unknown slices kept"

key-files:
  created:
    - scripts/world/raw_map_extraction.py
    - scripts/world/bsp_reader_binding.py
    - scripts/native_assets_lib/sound_export_guards.py
    - recipes/native-flame-material-graph.json
    - tests/pipeline/ue2_package_fixture.py
    - tests/pipeline/sound_package_fixture.py
    - tests/pipeline/test_world_bsp_reader_binding.py
    - tests/pipeline/test_world_raw_map_extraction.py
    - tests/pipeline/test_world_map_actor_properties.py
    - tests/pipeline/test_world_terrain_numerics.py
    - tests/pipeline/test_world_static_placement.py
    - tests/pipeline/test_world_map_sources_lock.py
    - tests/pipeline/test_world_ambience_fields.py
    - tests/pipeline/test_world_music_helpers.py
  modified:
    - scripts/world/freeze_world_oracle.py
    - recipes/world/oracle/20_20/expected.json
    - scripts/world/raw_map_step.py
    - scripts/native_migration.py
    - scripts/stage_native_runtime.py
    - scripts/native_batch_adapters.py
    - scripts/export-native-map-audio.py
    - scripts/export-native-sounds.py
    - scripts/world/terrain_layers.py
    - recipes/native-migration.json
    - tests/pipeline/test_stage_native_runtime.py
    - tests/pipeline/test_native_migration.py
    - .planning/lanes.json

key-decisions:
  - "Foreign world and actors paths accepted under rows 373 and 380; scripts/world/reader_cross_check_rows.py re-pointed outside the file list (row 505)"
  - "--stage-runtime kept with a carry-over rule instead of deleted (row 506)"
  - "Flame preserve-native-graph request moved to assets job flame-native-material-graph, copied from the sealed 20_20 raw request (row 507)"
  - "RAW_MAP_STEP_ALGORITHM_VERSION raised to 2 and every world unit resealed; world lane catalog 34b83e83 to 108c17b9 (row 508)"
  - "Sound and migration fingerprints changed once with no compatibility path (row 509)"
  - "Deco-grass chain cut with no planned replacement; its served record stays frozen by the oracle (row 510)"
  - "Movement overlap rows went stale on the rotator provenance edit; left to the independent review (row 511)"

patterns-established:
  - "Live tests of kept code never import a module a scheduled plan deletes"

requirements-completed: []
requirements-advanced: [WORLD-01, CONV-01]

coverage:
  - id: D1
    description: "Served 20_20 world-audio and step-sound manifests frozen in the oracle; a fresh freeze equals the committed file"
    requirement: WORLD-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_world_oracle.py (16 tests, fresh-freeze case ran against catalog 55c12147)"
        status: pass
    human_judgment: false
  - id: D2
    description: "build_map moved to scripts/world/raw_map_extraction.py; whole-tile products byte-identical to plan start except the dropped section gap; real 20_20 map keeps 4,183 StaticMeshActors, 13,248 exports, 2,622 ambient objects, 106 sound references and matches the Java oracle"
    requirement: WORLD-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_world_raw_map_extraction.py"
        status: pass
      - kind: other
        ref: "python -B artifacts/plan-checks/02-71/real_twenty_twenty_check.py on E:/Lineage2-client (javaOracle 4183/4183, 0 mesh mismatches, worst delta 5.0e-05, heightmap equal)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Shared BSP reader binding and sound export guards; no script loads another script's file for helpers"
    requirement: CONV-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_world_bsp_reader_binding.py; test_native_sounds.py and test_native_map_audio.py implementation cases; test_native_batch_adapters.py test_every_adapter_pins_only_files_that_exist"
        status: pass
    human_judgment: false
  - id: D4
    description: "Legacy chain cut (40 files) and world units resealed; tile:20_21 walk and meshes browser checks pass on lane catalog 108c17b9"
    requirement: WORLD-01
    verification:
      - kind: e2e
        ref: "NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-walk.spec.ts tests/browser/world-tile-meshes.spec.ts (4 passed)"
        status: pass
      - kind: unit
        ref: "python scripts/test_pipeline.py (1640 tests, 79 skipped, OK); pnpm test:unit (2,239 passed, 72 skipped)"
        status: pass
    human_judgment: false
  - id: D5
    description: "--stage-runtime keeps every record the migration does not produce"
    requirement: WORLD-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_stage_native_runtime.py test_keeps_every_record_the_migration_does_not_produce_and_replaces_same_id_models_in_place"
        status: pass
    human_judgment: false

duration: 80min
completed: 2026-11-09
---

# Phase 2 Plan 71: Legacy 20_20 chain cut Summary

**The 20_20 oracle now pins the served world-audio and step-sound manifests, build_map serves the raw step from `scripts/world/raw_map_extraction.py`, the BSP reader binding and sound guards are shared modules, and the raw map, section, terrain patch, Editor append and deco-grass chain is deleted with its tests while the served store stays catalog 55c12147.**

## Performance

- **Duration:** about 80 min
- **Started:** 2026-11-09T16:12Z
- **Completed:** 2026-11-09T17:32Z
- **Tasks:** 6 of 6
- **Files modified:** 113 (1,863 insertions, 9,490 deletions)

## Accomplishments

- Oracle freeze: worldAudio `map-20-20-ambience` 106 pinned files / 21,664,812 B, `map-20-20-music` 18 / 19,414,492 B; stepSounds `stepsound-deco-grass-20-20` 1 / 130,050 B, `stepsound-surfaces` 93 / 1,936,384 B. Section, sky, environment and movers fields unchanged.
- Fixtures and live tests moved to kept modules with an unchanged count (1,693 tests, 96 skipped after Task 1). The mask UV case runs on `extrapolated_mask_uv_rule()` with the 735 positions and both SHA-256 pins; the `restore_l2_ogg` evidence row points at `test_world_music_helpers.py:43`.
- `scripts/world/bsp_reader_binding.py` and `scripts/native_assets_lib/sound_export_guards.py`; `export-native-sounds.py` imports the guards; both exporter fingerprints and the sky adapter pin set name only existing files.
- Deleted 40 files: `native_map.py`, `native_map_geometry.py`, `world/section_static_models.py`, `world/surface_spawn_candidate.py`, four section recipes, seven terrain and audit scripts, six Editor scripts and two capture modules, the deco-grass chain, and 13 test files. `selected_by_origin`, `glb_structure`, `rectangle_source_points`, `qualified_mask_uv_rule`, `QUALIFIED_MASK_UV_SOURCE_SHA256`, `MASK_UV_LAYER_PAIRS`, `section_files` gone; `terrain_mask_uv` requires its rule.
- Migration recipe jobs: human-male-fighter, fighter-equipment, musveren, native-npc-profiles, map-20-20-textures, flame-native-material-graph, power-strike-source-dispatch.
- Reseal: 20_20 raw, chunks, terrain and 20_21 raw, chunks, terrain, meshes, manifest sealed again (raw receipts algorithmVersion 2); world lane catalog `108c17b9...`, load-check `tile:20_21` pass.

## Task Commits

1. **Task 1: Freeze the served 20_20 world-audio and step-sound manifests into the oracle** - `9c163b9` (feat)
2. **Task 2: Move shared fixtures and tests of kept code out of the legacy test files** - `c932def` (test)
3. **Task 3: Move the vendored reader binding and the sound export guards** - `b1c1a0b` (refactor)
4. **Task 4: Delete the legacy leaves** - `4c69a7b` (refactor)
5. **Task 5: Cut native_map.py, native_map_geometry.py, the section recipes and the map migrate jobs** - `1be8675` (refactor)
6. **Task 6: Records, lanes, suites, served-store and grep checks** - `2344492` (docs)

## Decisions Made

OVERNIGHT-DECISIONS rows 505 to 511 (see key-decisions).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Three more importers of moved names re-pointed**
- **Found during:** Tasks 2, 3 and 5
- **Issue:** `tests/pipeline/world_reader_fixture_packages.py` imported the fixtures from `test_native_map_audio.py` and `HAS_STACK` from `native_map`; `scripts/world/reader_cross_check_rows.py` and `tests/pipeline/test_world_reader_licensees.py` imported `build_map` (the latter also listed `scripts/native_map.py` in `GATE_FILES`).
- **Fix:** import lines re-pointed to the shared fixture, `world.map_actor_properties` and `world.raw_map_extraction`; `GATE_FILES` names `scripts/world/raw_map_extraction.py`. Recorded in row 505.
- **Commits:** `c932def`, `b1c1a0b`, `1be8675`

**2. [Rule 3 - Blocking] Ambient-object build_map case moved in Task 5, not Task 2**
- **Found during:** Task 2
- **Issue:** the case calls `build_map`, which had no kept module until Task 5, and the Task 2 acceptance forbids a `native_map` import in the kept modules.
- **Fix:** it stayed in `test_native_map.py` through Task 2 and moved to `test_world_raw_map_extraction.py` in Task 5 (recipe without a section, patch target `world.raw_map_extraction.MapSources`). The `explicit_properties` assertion of the deleted section-boundary case moved to `test_world_map_actor_properties.py`, and the raw recipe equality of the deleted `validate_recipe` case stayed in `test_world_raw_step.py`.

**3. [Rule 1 - Bug] Map audio test read FormatError through the exporter module**
- **Found during:** Task 3
- **Fix:** `test_native_map_audio.py` imports `FormatError` from `native_catalog.ue2`; `test_native_sounds.py` reads `REFERENCE` and `files_receipt` from the exporter's module namespace.

**4. [Rule 2 - Correctness] terrain_mask_uv checks its required rule**
- **Found during:** Task 5
- **Issue:** a required argument the body never read would be dead.
- **Fix:** the function refuses a rule whose formula is not `QUALIFIED_MASK_UV_FORMULA`; tested.

**5. [Rule 1 - Hazard noted] RealTileRawUnitTests writes the real lane store**
- **Found during:** Task 5
- **Issue:** after the raw version bump, the first run of `test_world_raw_step.py` reopened the sealed 20_21 raw unit (fingerprint mismatch) before its patched `build_map` raised. The reseal rebuilt it; the test passes on the resealed unit. The test still writes the real unit whenever the fingerprint changes; the world part owns a read-only rewrite.

### Not done as written

- `test_world_raw_map_extraction.py` `StagedTwentyTwentyRawMapTests` skips in this checkout (no `artifacts/native-parity/inputs/IMPORTA-PC/maps/20_20.unr`). The same assertions and the Java oracle comparison were run once on `E:/Lineage2-client` 20_20 through `artifacts/plan-checks/02-71/real_twenty_twenty_check.py` and all held.
- `NativeFlameGraphTests` need the main checkout's migration output; they pass after the integration thread runs `pnpm assets:migrate` (STATE restage line).

## Issues Encountered

- `pnpm test:editor`: `tests/editor/editorGeometryCompat.test.ts` fails on its CRLF-checked-out fixture (4,686 bytes against the 4,597-byte pin); pre-existing, untouched, recorded in `deferred-items.md`. 142 of 142 tests pass.
- `src/materials/ue2/model/constants/combinerConstants.ts:43` cites a stale `scripts/native_sky.py` line; recorded in `deferred-items.md`.
- Reference overlap: area movement, `--require-reviewed` exits 1 with 12 unreviewed reviewer runs, 12 stale reviewed rows and 0 blocking runs after the `src/shared/math/rotator.ts` provenance edit; report `artifacts/plan-checks/02-71/overlap-movement.log`. No rows added (row 511).
- `scripts/native_batch_adapters.py` is 464 lines after the cut, over the 400-line guide before this plan too; not split here.

## Checks

- Pipeline `python scripts/test_pipeline.py`: plan start 1,688 tests / 96 skipped; final 1,640 / 79 skipped, OK.
- `pnpm test:unit`: 163 files passed, 4 skipped; 2,239 tests passed, 72 skipped. `pnpm typecheck` clean. `pnpm test:editor` 142 passed (one pre-existing fixture file failure).
- Served store: `public/l2/catalog.json` SHA-256 `55c12147db306264...` before and after; `find -L public -newer plan-start.marker -type f` empty.
- Every deleted file name: no citation outside `.planning` (`artifacts/plan-checks/02-71/deleted_name_citations.py`, 0 citations). `.planning/lanes.json` parses and names no deleted file.
- Lane ownership: 20 foreign paths (18 world, 2 actors, none data-ui) in `artifacts/plan-checks/02-71/foreign-paths.txt`, accepted in row 505.
- Process cleanup: the Playwright web server and every Python run were started by this plan and exited; no node, python or browser process with this worktree path, `:5173` or `:5175` in its command line remains, and nothing listens on 5173 or 5175.

## Requirements

WORLD-01 and CONV-01 advance but stay Pending in `.planning/REQUIREMENTS.md`, as for 02-16, 02-29 and 02-70: WORLD-01 needs all 153 tiles through tile-general steps, and the BSP, mover, sky and audio converters of 20_20 still leave in 02-30, 02-31 and 02-45.

## Next Phase Readiness

02-30, 02-31 and 02-45 delete the remaining BSP, mover, sky and audio converters once their replacements pass the oracle subset; 02-47 sweeps. The integration thread runs `pnpm assets:migrate` then `pnpm assets:migrate --verify-only` in the main checkout after the merge.

## Self-Check: PASSED
