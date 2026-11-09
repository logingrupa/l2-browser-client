---
phase: 02-stage-a-breadth
plan: 31
subsystem: world
tags: [world-01, move-01, movers, tile-movers, collision, legacy-cut]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-14 raw step and MapSources; 02-16 tile manifest step, vocabulary file and tile loader; 02-29 static mesh Converter, gate and lane-store model layout; 02-30 decide_placement_collision, collision step and typed payload writer; 02-59 class-default reader"
provides:
  - "scripts/world/mover_class_defaults.py: qualified_classes, MoverDefaults, load_mover_class_defaults, mover_class_evidence (unit class:Engine.Mover step class-defaults)"
  - "scripts/world/mover_records.py: read_mover_actor, MoverUnsupportedError, MOVER_UNSUPPORTED_TOKENS, endpoint_matrix, indexed_properties"
  - "scripts/world/mover_step.py: run_mover_step, MOVER_STEP_ALGORITHM_VERSION 1, sealed_movers; convert_tile.py --step movers"
  - "native-tile-movers v1 manifest at /l2/movers/<sha>/tile-movers.json, tile resource kind movers (vocabulary listVersion 3)"
  - "collision step version 2 with the MOVR group; tile manifest step version 5 with the movers resource"
  - "src/scene/world: parseNativeTileMoverManifest, createNativeMoverTargets, loadNativeTileMovers; tile inspection moverCount, moverCollisionMeshCount, movers"
affects: [02-45, 02-47, 02-48, 02-65]

estimate:
  tokens: 100000
  tasks: 4
actuals:
  tokens: 46000
  tasks: 4
  commits: 5
plan_head_before: e200f52296e310bd38e75790a4ac0fed1ff9c356
plan_head_after: c602b83fabec61dc7d4ae90261da5a99b3d5f141

tech-stack:
  added: []
  patterns:
    - "A shared class evidence unit (class:<Class> step class-defaults) sealed once and pinned by every tile unit that reads it"
    - "A tile resource manifest pins the class evidence product SHA-256, not a receipt with timestamps, so forced rebuilds are byte-identical"

key-files:
  created:
    - scripts/world/mover_class_defaults.py
    - scripts/world/mover_records.py
    - scripts/world/mover_step.py
    - src/scene/world/nativeMoverTargets.ts
    - src/scene/world/loadNativeTileMovers.ts
    - tests/pipeline/test_world_mover_step.py
    - tests/pipeline/support/converted_model_fixture.py
    - tests/unit/nativeTileMoverManifest.test.ts
    - tests/browser/world-tile-movers.spec.ts
  modified:
    - scripts/world/collision_step.py
    - scripts/world/collision_payload_groups.py
    - scripts/world/static_collision_sources.py
    - scripts/world/convert_tile.py
    - scripts/world/tile_manifest_step.py
    - recipes/world/tile-manifest-vocabulary.json
    - src/scene/world/nativeMoverManifest.ts
    - src/scene/world/loadNativeMovers.ts
    - src/scene/world/loadNativeTileChunks.ts
    - src/scene/world/loadNativeSection.ts
    - src/scene/world/nativeTileManifest.ts
    - tests/unit/nativeMoverLoader.test.ts
    - tests/unit/loadNativeTileChunks.test.ts
    - tests/unit/nativeTileChunkManifest.test.ts
    - tests/pipeline/test_world_collision_step.py
    - tests/pipeline/test_tile_manifest_step.py
    - tests/pipeline/test_client_entry_points.py
    - docs/NATIVE_DOOR_MOVERS.md
    - docs/research/INDEX.md
    - docs/parts/world/EVIDENCE.md
    - STATUS.md
    - .planning/lanes.json
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md
  deleted:
    - scripts/native_map_movers.py
    - scripts/derive-native-map-movers.py
    - scripts/stage-native-movers.py
    - tests/pipeline/test_native_map_movers.py
    - tests/pipeline/test_native_mover_stage.py

key-decisions:
  - "Tile movers are the native-tile-movers v1 manifest at /l2/movers/<sha>/tile-movers.json, tile resource kind movers; vocabulary listVersion 2 to 3 (row 550)"
  - "Class evidence: moved DefaultReader route with unchanged qualified_classes, sealed once as class:Engine.Mover class-defaults; collision flags through the 02-59 reader (row 551)"
  - "Tile mover collision only from the 02-30 decision, MOVR per listed slot in the chunk of the actor Location; all 11 movers are gap rule-disagreement:bStatic (row 552)"
  - "The manifest pins the class-evidence product SHA-256 so forced rebuilds are byte-identical (row 553)"
  - "Lane ownership base is e200f52, a foreign commit that landed after the recorded start cd0ab58 (row 554)"
  - "Stale 20_21 meshes and bsp units rebuilt before the collision version 2 rerun (row 555)"
  - "Task 3 foreign paths accepted under rows 373 and 380 (row 556)"
  - "WORLD-01 and MOVE-01 stay Pending (row 557)"

requirements-completed: []

coverage:
  - id: D1
    description: "Generic movers step: every Engine.Mover of a tile converted or one mover-unsupported gap, served as a native-tile-movers resource"
    requirement: WORLD-01
    verification:
      - kind: unit
        ref: "python -B -m unittest discover -s tests/pipeline -p test_world_mover_step.py (21 tests)"
        status: pass
      - kind: integration
        ref: "python -B scripts/world/convert_tile.py --client E:/Lineage2-client --map 20_20|20_21 --step movers, --step manifest"
        status: pass
    human_judgment: false
  - id: D2
    description: "20_20 superset: the eight oracle movers with identical matrices, keys, MoveTime, server ids and model GLBs"
    requirement: WORLD-01
    verification:
      - kind: integration
        ref: "tests/pipeline/test_world_mover_step.py#OracleMoverSubsetTests (real client E:, ran)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Tile movers placed closed on ?map=20_20 with no collision mesh"
    requirement: WORLD-01
    verification:
      - kind: unit
        ref: "pnpm vitest run tests/unit/nativeTileMoverManifest.test.ts tests/unit/nativeMoverLoader.test.ts tests/unit/loadNativeTileChunks.test.ts"
        status: pass
      - kind: e2e
        ref: "NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-movers.spec.ts (2 passed, load-check tile:20_20 pass on lane catalog dee3ceb0)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Mover collision as the MOVR group from the 02-30 declared-source decision"
    requirement: MOVE-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_world_mover_step.py#MoverCollisionGroupTests; test_world_collision_step.py"
        status: pass
    human_judgment: true
    rationale: "Every real mover is a gap under the bStatic cross-check row, which is a WORLD-08 owner-review rule"
  - id: D5
    description: "Legacy 20_20 mover exporter chain deleted with its tests and citations"
    requirement: WORLD-01
    verification:
      - kind: unit
        ref: "python scripts/test_pipeline.py (1699 tests, 61 skipped, OK)"
        status: pass
    human_judgment: false

duration: 41min
completed: 2026-11-10
---

# Phase 2 Plan 31: Movers on every tile Summary

**`convert_tile.py --step movers` reads every exact `Engine.Mover` export of a tile with the moved 20_20 qualification rules, converts its mesh through the 02-29 Converter and writes a `native-tile-movers` resource listed in the tile manifest; on 20_20 it reproduces the eight served oracle movers byte for byte in matrices, keys, MoveTime, server ids and model GLBs, `/?map=20_20` places them closed, and the 20_20 mover exporter chain is deleted.**

## Performance

- Duration: about 41 min (21:50 to 22:31 UTC), including a 10 min background rebuild of the stale 20_21 meshes, bsp and collision units and a 7 min `python scripts/test_pipeline.py`.
- Tasks: 4 of 4. Files: 38 changed (9 created, 24 modified, 5 deleted).

## Accomplishments

- `mover_class_defaults.py` holds `qualified_classes`, `MoverDefaults` and `load_mover_class_defaults` (moved unchanged) plus the shared unit `class:Engine.Mover` step `class-defaults`; `mover_records.py` holds `indexed_properties`, `numeric_struct`, `endpoint_matrix` and `read_mover_actor`, which raises `MoverUnsupportedError` with one of the ten listed tokens.
- `mover_step.py`: every Engine.Mover export in export order is converted or one gap row; meshes pass the reviewed-layout gate and convert once; two movers sharing a mesh share one model; the step refuses a tile whose movers are not each classified once. 20_20: 8 converted, 0 gaps. 20_21: 3 converted (two share `oren_curumadungeon_npc1`), 0 gaps.
- Collision: each mover keeps its `decide_placement_collision` decision; the collision step (version 2, after movers) writes one MOVR record per listed slot with closed and open matrices in source units. All 11 real movers are `gap` (`rule-disagreement:bStatic`), so no MOVR record and one `collision-unreadable` row each.
- Browser: `parseNativeTileMoverManifest` binds ids to the manifest tile; `createNativeMoverTargets` is the one instancing owner for the 20_20 catalog path and tiles and disposes what it made on failure; `loadNativeTileChunks` loads the movers resource and reports `moverCount`, `moverCollisionMeshCount` and the mover inspections.
- Deleted: `native_map_movers.py`, `derive-native-map-movers.py`, `stage-native-movers.py` and their two test modules; the resolution and class-evidence rejection cases moved to `test_world_mover_step.py`.

## Task commits

1. Task 1 (tracer): `b3d454f` feat(02-31): convert every Engine.Mover of a tile through one generic movers step and place the 20_20 movers closed on ?map
2. Task 2: `e8c18fc` feat(02-31): classify every Engine.Mover once as converted or a named mover-unsupported gap and keep reruns byte-identical
3. Extra test: `93fcbb0` test(02-31): load a tile movers resource through the tile chunk loader with every mover closed and no mover collision mesh
4. Task 3: `6eac6a9` refactor(02-31): delete the 20_20 mover exporter chain now that the tile-general movers step reproduces the eight oracle movers
5. Task 4: `c602b83` docs(02-31): record the movers evidence, the world status, the restage handoff and the retired mover lane rows

Tracer gate: the Task 1 verify (both unittest modules, typecheck, Vitest, browser) passed end to end before Task 2.

## Verification

- `test_world_mover_step.py` 21 OK (the oracle and ledger-skip cases ran on E:); `test_world_tile_general_steps.py` OK; `test_world_collision_step.py` 14 OK; `test_tile_manifest_step.py` 18 OK.
- `python scripts/test_pipeline.py` after Task 3: 1699 tests, 61 skipped, OK. `pnpm typecheck` clean. `pnpm test:unit`: 2310 passed, 72 skipped, 0 failed. `laneOwnership.test.ts` 36 passed.
- Forced rebuild: moving the sealed 20_20 movers unit aside and rerunning wrote a byte-identical `movers.json` product.
- Browser, 5173 free: `NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-movers.spec.ts tests/browser/world-tile-meshes.spec.ts` 4 passed on the final lane catalog `dee3ceb0f862998868b2ea65d77623abe215fe1de7ef7036939eb27528630d21`; load-checks tile:20_20 and tile:20_21 pass (00:28 Riga). Headless SwiftShader: no FPS claim. The screenshots show the tile at its anchor; the movers are checked by data, not in view.
- Acceptance: `tile__20_20/movers/complete.json` present, its product lists 8 movers; the 20_20 tile manifest lists one `movers` resource and the manifest step exited 0; vocabulary prints `1 3 ['native-tile-collision', 'movers'] []`; `hasTouch` in the spec; each deleted file name greps empty outside `.planning`; no `native_map_movers` import remains; EVIDENCE has one "Movers (02-31)" (30.6 KB); STATE has one `Needs Human (plan 02-31)`; lanes.json parses.
- Lane ownership from e200f52: before the docs commit exactly the four paths of `artifacts/plan-checks/02-31/foreign-paths.txt`; after the docs commit removed the lanes.json rows, the deleted `scripts/native_map_movers.py` belongs to no lane and is listed too (same as 02-29).
- Reference overlap: no DEC-OWN-12 area glob covers the files this plan wrote (scripts/world Python and `src/scene/world` mover and tile files), so no run applies.

## Deviations from plan

### Auto-fixed issues

1. **[Contract] Vocabulary file pre-existed.** 02-16 created it and 02-30 added `native-tile-collision`, so the acceptance print `1 1 ['movers'] []` and the single-add commit check are stale; `movers` was appended with listVersion 2 to 3 (row 550).
2. **[Rule 3 - Blocking] Class defaults route.** DefaultReader is not rerouted (rows 204, 403) and `qualified_classes` needs the retained scripts, so the class evidence unit uses the moved DefaultReader route; the collision flags use the 02-59 reader (row 551).
3. **[Rule 3 - Blocking] Circular import.** `static_mesh_selectors` moved from `collision_step.py` to `static_collision_sources.py` so the mover step can use it.
4. **[Contract] Browser parser outside the file list.** `nativeTileManifest.ts` accepts the `movers` resource kind at `/l2/movers/<sha>/tile-movers.json`, at most one per kind; `loadNativeSection.ts` types the new inspection fields.
5. **[Contract] Tile mover collision meshes.** The tile result exposes `moverTargets` and the inspection `moverCollisionMeshCount` (0), not a collision mesh list, because tile mover meshes carry no `worldCollision`.
6. **[Rule 1 - Bug] Receipt-pinned manifests were not rebuild-stable.** The manifest now pins the class-evidence product SHA-256 (row 553).
7. **[Rule 3 - Blocking] Stale 20_21 units.** Its meshes and bsp units no longer matched the converter hash after later commits; rebuilt with collision version 2 and the manifest (row 555). The rebuilt meshes unit converts 194 models and 2,923 placements with 282 gap rows (the 123/12 rows of 02-29 now convert after 02-53).
8. **[Process] Foreign commit in range.** e200f52 landed on the branch after the recorded start cd0ab58; the ledger and ownership check use e200f52 (row 554). A first test commit accidentally carried the staged Task 3 deletions; it was soft-reset and recommitted alone before Task 3 (`93fcbb0`).
9. **[Tests touched outside the list]** `test_world_collision_step.py` (version 2, fixture moved to `support/converted_model_fixture.py`), `test_tile_manifest_step.py` (version 5, `sealed_movers` patch), `nativeTileChunkManifest.test.ts` (message), `loadNativeTileChunks.test.ts` (movers case).
10. **[Not needed] Gap reasons.** The seed pattern `mover-unsupported:<reason>` already admits every token, so `recipes/world/gap-reasons.json` is unchanged.

**Total deviations:** 10 (1 bug, 3 blocking, 6 contract, scope or process notes). **Impact:** the plan's truths hold; the mover collision rule result stays visible as named gaps.

## Known stubs

- None. Every real mover has a `gap` collision decision, so the MOVR group is empty on 20_20 and 20_21; that is the declared-source result, recorded as `collision-unreadable` rows, not a stub.

## Threat flags

None beyond the register: T-02-311 (lane store writes through `lane_store_root`, `verify_store_destinations` and `immutable_write`; nothing under `public/l2`), T-02-312 (`UELIB_SHA256` pin and `qualified_classes` unchanged, rejection tests on the sealed evidence), T-02-313 (parser guards, ids bound to the tile, rigid matrices, SHA-256 and length pins), T-02-314 (per-actor `MoverUnsupportedError` rows), T-02-315 (vocabulary lists only the two kinds).

## Needs Human

- `Needs Human (plan 02-31):` the world lane restage command printed by `write_lane_catalog.py --lane world --plan` (STATE.md).

## Open follow-ups

- Door interaction for tile movers (open and close through the runtime) is wired by integration.
- The bStatic cross-check row of the collision declaration rules gaps every Engine.Mover; it is a WORLD-08 owner-review rule.

## Process cleanup

- Started: movers, manifest, meshes, bsp and collision conversions, lane catalog and coverage runs, unittest runs, the full pipeline and unit suites, Vitest runs and three Playwright runs (each started and stopped `pnpm dev` on 5173).
- Check at 00:30 Riga: `netstat -ano | grep -E ':(5173|5175) .*LISTENING'` empty; `ps -W` shows only node.exe from Oct 29 and python.exe from Nov 7, none started by this plan; no chrome, headless shell or Playwright process. Nothing started by this plan remains.

## Self-Check: PASSED

- FOUND: all 9 created files exist; the 5 deleted files are gone.
- FOUND commits on plan/autonomous-roadmap: b3d454f, e8c18fc, 93fcbb0, 6eac6a9, c602b83.
