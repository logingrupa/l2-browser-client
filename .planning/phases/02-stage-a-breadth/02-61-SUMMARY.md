---
phase: 02-stage-a-breadth
plan: 61
subsystem: world
tags: [vis-01, world-01, fx-01, bsp-visibility, zones, map-emitters, typed-payload, dec-own-12]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-30 read_level_model, typed payload writer, bsp node ranges; 02-43 actors bundle writer record functions; 02-57 reference overlap check; 02-59 class-default reader"
provides:
  - "scripts/world/level_zones.py: read_level_zones, LevelZone, outdoor_zone_indices, sky_zone_indices (the one zone table)"
  - "scripts/world/bsp_leaf_membership.py: leaf_for_point, leaves_for_box, zones_for_box, point_check_outside, solidity_disagreements"
  - "scripts/world/bsp_visibility_step.py: run_bsp_visibility_step, BSP_VISIBILITY_STEP_ALGORITHM_VERSION 3, sealed_bsp_visibility"
  - "scripts/world/map_emitter_step.py: run_map_emitter_step, MAP_EMITTER_STEP_ALGORITHM_VERSION 1, sealed_map_emitters"
  - "scripts/world/visibility_members.py, bsp_visibility_payload.py, map_emitter_records.py, actor_field_values.py, tile_json_resource.py, bsp_visibility_census.py"
  - "recipes/world/bsp-visibility.json (22 constants rows plus the census sample grid)"
  - "tile resource kinds bsp-visibility (/l2/maps/<sha>/native-tile-bsp-visibility/asset.json) and map-emitters (/l2/map-emitters/<sha>/tile-emitters.json)"
affects: [02-47, 02-62, 02-63, 02-64, 02-68, 02-69]

estimate:
  tokens: 100000
  tasks: 3
actuals:
  tokens: 23600
  tasks: 3
  commits: 3
plan_head_before: a41ece61f807ea5657c5d7e42097992cbb51802d
plan_head_after: d832e29a505538e124c1052f7f97d8aab8e80a99

tech-stack:
  added: []
  patterns:
    - "Actor fields resolve serialized first, else the class chain, with authored meaning serialized on the map actor only (actor_field_values.resolved_actor_field)"
    - "Hash-addressed tile JSON resources share one writer (tile_json_resource.write_tile_json_resource); typed payload tile resources share write_tile_typed_payload_resource"

key-files:
  created:
    - scripts/world/level_zones.py
    - scripts/world/bsp_leaf_membership.py
    - scripts/world/bsp_visibility_step.py
    - scripts/world/bsp_visibility_payload.py
    - scripts/world/visibility_members.py
    - scripts/world/map_emitter_step.py
    - scripts/world/map_emitter_records.py
    - scripts/world/actor_field_values.py
    - scripts/world/tile_json_resource.py
    - scripts/world/bsp_visibility_census.py
    - recipes/world/bsp-visibility.json
    - docs/parts/world/bsp-visibility-census.json
    - tests/pipeline/test_level_zones.py
    - tests/pipeline/test_world_bsp_visibility_step.py
    - tests/pipeline/test_world_map_emitter_step.py
    - tests/pipeline/support/bsp_room_fixture.py
    - tests/unit/nativeTileManifestResources.test.ts
  modified:
    - scripts/world/bsp_step.py
    - scripts/world/collision_step.py
    - scripts/world/convert_tile.py
    - scripts/world/level_model.py
    - scripts/world/mover_step.py
    - scripts/world/tile_manifest_step.py
    - scripts/world/typed_payload.py
    - scripts/native_store/gap_census.py
    - recipes/world/gap-reasons.json
    - recipes/world/tile-manifest-vocabulary.json
    - src/scene/world/nativeTileManifest.ts
    - tests/fixtures/lane-store/l2/tiles (fixture tile regenerated)
    - tests/pipeline/test_gap_census.py
    - tests/pipeline/test_tile_manifest_step.py
    - tests/pipeline/test_world_bsp_step.py
    - docs/parts/world/EVIDENCE.md
    - STATUS.md
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "level_zones.py is the one zone table; bsp_step reads its outdoor and sky zones from it and level_model.sky_zone_indices is deleted (row 595)"
  - "World writes the Emitter actor export; emitter records use the actors bundle writer's object_values and CONVERTED_EMITTER_CLASSES; referenced textures and meshes convert with 02-69 (row 596)"
  - "Solidity census grid 16 x 16 x 8 is a project rule outside the constants rows; one tile gap row, every point in the product (row 597)"
  - "gap_census.py step order gains emitters and bsp-visibility, the one foreign path (row 598)"
  - "Class-chain defaults map to class-default provenance; authored means serialized on the actor (row 599)"
  - "VIS-01, WORLD-01 and FX-01 stay Pending (row 600)"

requirements-completed: []

coverage:
  - id: D1
    description: "One zone table and leaf membership queries (zone locate, box leaves and zones, separate PointCheck)"
    requirement: VIS-01
    verification:
      - kind: unit
        ref: "python -B -m unittest discover -s tests/pipeline -p test_level_zones.py (7 tests)"
        status: pass
      - kind: unit
        ref: "python -B -m unittest discover -s tests/pipeline -p test_world_bsp_visibility_step.py (17 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Hash-pinned per-tile bsp-visibility typed payload for 20_21 and 20_20, pinned by the tile manifest and accepted by the browser parser"
    requirement: VIS-01
    verification:
      - kind: integration
        ref: "python -B scripts/world/convert_tile.py --client E:/Lineage2-client --map 20_21|20_20 --step bsp-visibility (complete.json present)"
        status: pass
      - kind: unit
        ref: "pnpm exec vitest run tests/unit/nativeTileManifestResources.test.ts tests/unit/nativeTileMoverManifest.test.ts"
        status: pass
      - kind: e2e
        ref: "NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-meshes.spec.ts (2 passed)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Per-tile Emitter actor export (native-tile-map-emitters v1) and emitter membership in the visibility resource"
    requirement: FX-01
    verification:
      - kind: unit
        ref: "python -B -m unittest discover -s tests/pipeline -p test_world_map_emitter_step.py (7 tests)"
        status: pass
      - kind: integration
        ref: "convert_tile.py --step emitters on 20_21 (6 placements, 0 gaps) and 20_20 (pass, no resource)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Solidity census and constants rows"
    requirement: VIS-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_world_bsp_visibility_step.py#SolidityCensusTests, #VisibilityCensusTests, #VisibilityRecipeAndRegistrationTests"
        status: pass
    human_judgment: true
    rationale: "Every reference rule runs as an unconfirmed or unknown default until POL-04 re-derives it against the Interlude binaries"

duration: 50min
completed: 2026-11-10
---

# Phase 2 Plan 61: Zone table, map emitters and BSP visibility resource Summary

**`convert_tile.py --step emitters` exports every placed Emitter actor of a tile once (20_21: 6 placements, 9 Mesh and Sprite emitters with actor rules and bundle-writer records), and `--step bsp-visibility` writes one hash-pinned typed payload per tile (NODE, BNDS, LEAF, ZONE, PORT, RNGE, MEMB) from the stored Level.Model, the one zone table in `level_zones.py` and the leaf queries of `bsp_leaf_membership.py`, with 22 sourced constants rows and a zone-locate versus PointCheck solidity census (20_21: 0 disagreements, 20_20: 12).**

## Performance

- Duration: about 50 min (00:53 to 01:44 UTC), including a background 20_20 meshes conversion, a 20_20 bsp reconversion (its unit was stale), a 3.8 min browser run and an 8.4 min `python scripts/test_pipeline.py`.
- Tasks: 3 of 3. Files: 32 changed in code commits (17 created, 15 modified), plus the docs commit.

## Accomplishments

- `level_zones.py`: one row per Level.Model zone with actor, class, connectivity and PVS masks, bSunAffect, the four ambient and four distance fog fields (serialized `authored`, else the 02-59 class chain as `class-default` or `ue-zero`, else `unresolved`), and outdoor, sky and unresolved bits. `DistanceFogColor` decodes in the R, G, B, A byte order `native_sky.py` already reads. The bsp step now reads its outdoor and sky zones from this table (20_21 still [0, 1, 5] and [5]).
- `bsp_leaf_membership.py`: zone locate (PlaneDot >= 0 front, empty slot falls back to the other slot), iterative box leaf and zone queries, and a separate PointCheck walk (PlaneDot > 0 front, outside bit from bRootOutside, csg by NumVertices > 0 and NodeFlags without 0x21).
- `bsp_visibility_step.py` (algorithm 3, ledger step `bsp-visibility`, fingerprint over the map lock plus the bsp, meshes and emitters fingerprints and the recipe hash): writes `/l2/maps/<sha>/native-tile-bsp-visibility/asset.json` and `payload.bin`. 20_21: 4,493 nodes, 2,108 bounds, 1,532 leaves, 39 zones, 62 portals, 4,222 node ranges, 2,929 members. An out-of-range model is `bsp-visibility-model-unreadable:<field>` with no resource.
- `map_emitter_step.py` (ledger step `emitters`): `/l2/map-emitters/<sha>/tile-emitters.json` with id, export index, source transform rows, seven actor rules, and per emitter the bundle writer's `object_values` plus InitialDelayRange, WarmupTicksPerSecond and RelativeWarmupTime with provenance. An emitter class outside `CONVERTED_EMITTER_CLASSES` is `emitter-class-unported:<class>`.
- Tile manifest version 7 pins the `bsp-visibility` and `map-emitters` resources; the vocabulary is listVersion 5 and the world gap reasons listVersion 7; `nativeTileManifest.ts` accepts both kinds at their own paths.

## Task commits

1. Task 1 (tracer): `3b7725b` feat(02-61): one zone table, leaf membership queries and the hash-pinned bsp-visibility resource of a tile
2. Task 2: `0c8a1b6` feat(02-61): export every placed Emitter actor of a tile once and gate visibility membership on it
3. Task 3: `d832e29` feat(02-61): cross-check zone locate against the PointCheck outside bit and commit the BSP visibility census

Tracer gate: the Task 1 verify (two unittest files) and the `tile__20_21/bsp-visibility/complete.json` check passed again before Task 2.

## Verification

- `test_level_zones.py` 7 OK; `test_world_bsp_visibility_step.py` 17 OK; `test_world_map_emitter_step.py` 7 OK; `test_tile_manifest_step.py`, `test_world_bsp_step.py`, `test_world_collision_step.py`, `test_world_mover_step.py`, `test_gap_census.py`, `test_typed_payload_writer.py`, `test_world_static_mesh_step.py` OK.
- `python -B scripts/test_pipeline.py`: 1,767 tests, 60 skipped, OK.
- `pnpm typecheck` clean; Vitest `nativeTileManifestResources.test.ts`, `nativeTileMoverManifest.test.ts`, `loadNativeTileChunks.test.ts` pass.
- Browser, 5173 free: `NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-meshes.spec.ts` 2 passed with the new tile manifest (headless SwiftShader, no FPS claim).
- Acceptance: `tile__20_21/bsp-visibility/complete.json` present; every rule row has provenance and a shared status, `emitter-clipping-range` runtimeDefault `infinity`; `grep -c map-emitters` and `grep -c bsp-visibility` on the vocabulary print 1 each; `grep -c "BSP visibility resource (02-61)" docs/parts/world/EVIDENCE.md` prints 1.
- Lane ownership: `check-lane-ownership.mjs --base a41ece6 --part world` lists one foreign path, `scripts/native_store/gap_census.py` (decision row 598).
- Reference overlap: `referenceOverlap.mjs --area bsp-visibility` reports 0 blocking and 0 unreviewed runs (607 reviewer runs, all reviewed or signed off); its globs cover the TypeScript visibility files only, none of the Python this plan wrote.
- Restage: `write_lane_catalog.py --lane world --plan` prints the merge command recorded as `Needs Human (plan 02-61)`; world lane catalog `deb324fb...`.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] The gap census refused the new step names**
- Found during: Task 1 (first 20_21 run).
- Issue: the world coverage refresh failed because `GAP_CENSUS_STEP_ORDER` had no `bsp-visibility` or `emitters`.
- Fix: both steps added after `movers` in `scripts/native_store/gap_census.py`; `test_gap_census.py` checks them. Foreign path, decision row 598.
- Commit: `3b7725b`.

**2. [Rule 3 - Blocking] The browser tile manifest parser refused unknown resource kinds**
- Found during: Task 1.
- Issue: `src/scene/world/nativeTileManifest.ts` accepted only `native-tile-collision` and `movers`, so a restaged tile manifest would fail to load.
- Fix: one path pattern per kind, including `bsp-visibility` and `map-emitters`; `nativeTileManifestResources.test.ts`.
- Commits: `3b7725b`, `0c8a1b6`.

**3. [Rule 2 - DRY] Shared writers and resolvers instead of copies**
- `write_collision_asset` moved to `typed_payload.write_tile_typed_payload_resource`; `write_tile_movers_manifest` became `tile_json_resource.write_tile_json_resource`; zone and emitter fields share `actor_field_values.resolved_actor_field`; `level_model.sky_zone_indices` and `zone_actor_export` moved into `level_zones.py`. No output changed, so no version bump for bsp, collision or movers.

**4. [Rule 1 - Bug] Class-chain defaults were tagged authored**
- The 02-59 reader tags a value the actor's own class sets as `authored`; zone and emitter fields now map it to `class-default` (row 599).

**5. Solidity disagreements: one gap row per tile**
- Gap rows are keyed one per tile and step, so every disagreeing point is listed in the step product (`solidity.disagreements`) and the census, and the tile gets one `bsp-visibility-solidity-disagreement` row (row 597).

**6. 20_20 inputs reconverted in the lane**
- 20_20 had no meshes unit and a stale bsp unit, so both ran in the world lane store before the visibility step. 20_20 collision is still not run.

**Total deviations:** 6 (2 blocking, 1 DRY, 1 bug, 2 scope notes). **Impact:** no change to existing outputs; two shared files outside `scripts/world` (the gap census order, the browser manifest parser) move with the new kinds.

## Known stubs

None. The emitter export does not convert the textures and meshes its emitter records reference; 02-69 owns map emitter playback (Open follow-ups).

## Process cleanup

Playwright and its 5173 dev server exited with the run; the background meshes, bsp and pipeline runs exited 0. No listener on 5173 or 5175, and no python, node or browser process started by this plan remains (only processes started on Oct 29 and Nov 7 run).

## Next

Ready for the next plan in wave 11; 02-63 consumes the visibility resource and 02-69 the map emitter export.

## Self-Check: PASSED

- Files: all created files above exist on disk.
- Commits: `3b7725b`, `0c8a1b6`, `d832e29` are ancestors of HEAD.
