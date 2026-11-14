---
phase: 03-stage-a-checks
plan: 21
subsystem: world
tags: [world, movement, tile-walk, anchor, collision, gap-closure]
status: complete
gap_closure: true
requires:
  - phase: 03-stage-a-checks
    provides: "03-18 native slice snapshot read-outs"
provides:
  - "Walk trace in snapshot().world and in every failed walk record (physics mode, floor hit, last move result with blocking hit, fall start, end position, level bottom, resident cells)"
  - "Tile anchor on the chunk plan footprint and the first collision hit below the authored PlayerStart (tile-anchor-has-no-floor otherwise)"
  - "aCis swim speed in the sandbox move record"
  - "Walk spec checks: start chunk BSP pin, walk ends on a floor or swimming, no rest on the level bottom"
affects: [03-08, 03-16, 03-17, 03-26]
tech-stack:
  added: []
  patterns: ["one anchor owner with a floor probe for both tile routes", "diagnostic walk trace read through GameWorldAdapter-fed presenter state only"]
key-files:
  created:
    - tests/unit/tileWalkTrace.test.ts
  modified:
    - src/scene/world/movement/movementPresenter.ts
    - src/scene/world/movement/core/collisionWorld.ts
    - src/scene/world/nativeTileChunkContents.ts
    - src/scene/world/loadNativeTileChunks.ts
    - src/scene/world/streamNativeTileChunks.ts
    - src/scene/world/nativeTileResidencyTiles.ts
    - src/runtime/nativeSliceDiagnostics.ts
    - src/runtime/worldMovementWiring.ts
    - src/world/NativeSliceAdapter.ts
    - tests/browser/world-tile-walk.spec.ts
    - tests/browser/support/tileWalkRecords.ts
    - tests/browser/support/loadCheckRecordFile.ts
    - tests/unit/loadNativeTileChunks.test.ts
    - tests/unit/streamNativeTileChunks.test.ts
    - tests/unit/tileWalkRecords.test.ts
    - tests/unit/loadCheckRecordFile.test.ts
    - tests/unit/nativeSliceAdapter.test.ts
    - tests/unit/nativeSliceAdapterSpeed.test.ts
key-decisions:
  - "Tile anchor: the chunk whose plan footprint holds the authored PlayerStart XY and the first collision hit below the authored location, probed to maxStepHeight below the lowest loaded terrain or resident BSP point; no hit fails the load with tile-anchor-has-no-floor (P1205, P1210)"
  - "The sandbox move record carries the aCis swim speed 50 as swimWalk and swimRun (humanFighter.xml swimSpd, UserInfo.java) (P1208)"
  - "The walk spec drops the render terrain minimum and maximum checks: a walk must end walking on a floor or swimming and not rest on the level bottom (P1207, P1211)"
  - "The non-streaming tile route keeps its loader and builds a local collision world for the anchor instead of being deleted (P1206)"
requirements-completed: []
duration: 5h 50m
completed: 2026-11-14
metrics:
  tasks: 3
  files: 19
actuals:
  tokens: 12100
  tasks: 3
  commits: 5
plan_head_before: 1850c82f950b9a6915fa25866ac38945e39f2fc0
plan_head_after: 07f65fe
---

# Phase 3 Plan 21: Tile walk trace, root-cause fixes and the collision floor anchor Summary

Every tile walk now records why it failed, and 139 of the 143 world lane tiles walk on catalog ba87e45c, up from 61 of the 136 that walked before. Three root causes behind 74 of the 75 failed walks are fixed: no swim speed in the move record, a spawn point on the render terrain surface, and a fixed BSP count check. The 7 tiles that could not anchor now load.

## What was built

- **Walk trace (task 1, 78c3615).** `walkTrace` gives the physics mode, the floor hit (primitive kind and cell), the last move result (advanced, held with its reason, or cannot-move with the blocking hit and distance), the fall start, the end position, the resident cell ids and, since 07f65fe, `restsOnLevelBottom`. It comes from `createMovementPresenter` through `WorldMovement.localWalkTrace()` into `snapshot().world`. A failed walk record keeps the trace, its failure class, the collision load state, the source spawn and the tile anchor beside its first failure line. `loadCheckRecordFile` accepts a `walkTrace` on failed records only.
- **Classification run** (78c3615, 75 tiles, `measurements/tile-walk-failure-classes.json`, every tile has a trace):

| Class before | Tiles | Trace evidence | Root cause | Fix | After (final run) |
| --- | --- | --- | --- | --- | --- |
| held-speed-unresolved | 45 | pawn held `speed-unresolved`, position unchanged, start in a water volume | The sandbox move record held no swim speed | `NativeSliceAdapter` sends aCis `swimSpd` 50 as `swimWalk` and `swimRun` | 44 pass, 1 fail (23_24 now cannot-move) |
| below-terrain-minimum | 20 | `fallStartPosition` equals the spawn. The pawn rests on `bsp-tree` at z -16380.65 (the level bottom) | The spawn stood the feet exactly on the terrain surface, so the floor sweep started touching the one-sided terrain and missed it | Anchor on the first collision hit below the PlayerStart (ray hit with native backoff) | 20 pass |
| bsp-mesh-count | 9 | No pawn yet. `bspMeshes` is 0 | The spec required more than 0 BSP meshes for tiles whose start chunk pins no BSP | `startChunkBspFailure` compares with the BSP resource the anchor chunk manifest pins | 9 pass |
| cannot-move | 1 | blocked by `bsp-tree` at distance 0 | A BSP wall 0.76 m along +x from the PlayerStart | Named reason | 1 fail (19_21) |
| anchor (load check 43a5132d) | 7 | `The tile anchor lies outside every chunk terrain.` | The terrain-only render ray missed (17_22, 20_18, 21_16, 22_19, 22_22, 24_14, 24_16) | Plan footprint plus first collision hit | 7 pass |

- **Anchor rule (1ab83a1, e5dc314).** `anchorOnChunkFloor`, `collisionFloorBelow` and `tileSpawnAnchor` in `nativeTileChunkContents.ts` own the rule for both routes. The streaming route uses the startup-resident chunks (selected tile and neighbours) and the runtime collision world. The non-streaming route reads `readResidencyTile` and builds a local world (`loadResidencyTileCollisionWorld`). The anchor records `anchorChunk`, `floorPosition`, `floorPrimitiveKind` and `authoredHeightAboveFloorMetres`, and keeps the authored Z. `anchorOnChunkTerrain` and its refusal case are deleted. 15_21.PlayerStart5 lies in tile 15_20, and its anchor chunk is 15_20/chunk-3-3.
- **Walk spec.** The render terrain minimum and maximum checks are gone. They failed walks that stand 0.5 units above the render maximum on flat tiles, BSP floors below the terrain, and a 0.36 m ledge drop (17_21). `walkEndFailure` now fails a walk that does not end walking on a floor or swimming, and a walk that rests within maxStepHeight of the lowest resident BSP point (`fell-to-level-bottom`).

## Final walk run

`NATIVE_STORE_ROOT=world WALK_TILE_IDS=<all 143 catalog tiles>` on 07f65fe ran for 2.2 h: 278 viewport tests passed, 4 failed and 4 did not run. `measurements/tile-walks-ba87e45c....json` holds 143 records, all written by this run, 139 pass and 4 failed, and each failure carries its trace. The Task 3 gate prints `True 143 143`.

Remaining failures for 03-16:

| Tile | Class | Reason |
| --- | --- | --- |
| 19_21 | cannot-move | Blocked by `bsp-tree` 0.76 m along +x from 19_21.PlayerStart2 (BSP wall, source geometry) |
| 23_24 | cannot-move | Blocked by static mesh 23_24/chunk-1-2 (placement 348, export 3285) 0.84 m along +x (source geometry) |
| 24_25 | fell-to-level-bottom | 24_25.PlayerStart2 (z -3514.55) lies about 85 units under the visible terrain quad 932 of chunk-1-0 (corners about -3423 to -3439), so the first collision below it is the level bottom at -16383.5 (source condition) |
| 25_14 | tile-did-not-start | "The browser lost its graphics connection while loading" (SwiftShader WebGPU device loss during actor assembly). 25_14 passed on b4d451dc. No retry was run |

## Deviations from Plan

### Auto-fixed issues

1. **[Rule 1 - Bug] The anchor probe ended at the terrain minimum.** The first full run (stopped by PID at 49 tiles) gave 9 tiles `tile-anchor-has-no-floor`: BSP or static-mesh floors below the terrain minimum, and flat sea floors where the probe ended exactly on the surface. Fixed in e5dc314. The probe now ends maxStepHeight below the lower of the terrain minimum and the lowest resident BSP point, the same margin `collisionSurfaceHeightsAt` uses.
2. **[Rule 1 - Bug] The terrain minimum check failed a legitimate ledge drop.** The second full run (stopped by PID at 31 tiles) failed 17_21. Fixed in 07f65fe with a level bottom check: `CollisionWorld.lowestBspPointZ()` and `restsOnLevelBottom` in the trace.
3. **[Rule 1 - Bug] The terrain maximum check failed the fixed spawn.** Feet end 0.5 units above the render maximum on flat tiles. The check was replaced by the floor check in 1ab83a1.
4. **[Rule 3] Shared record validator.** `tests/browser/support/loadCheckRecordFile.ts` accepts `walkTrace`, but on failed records only.
5. **[Rule 3] File changes outside the plan.** `src/world/NativeSliceAdapter.ts`, `src/scene/world/nativeTileResidencyTiles.ts`, `src/scene/world/movement/core/collisionWorld.ts` and `src/runtime/worldMovementWiring.ts` hold the root-cause fixes and the trace wiring. `pawnWalking.ts` and `nativeTileChunkFootprints.ts` needed no change: the walking core was not at fault, and the footprints come from `ResidencyChunk.footprint`.
6. **Run split.** The final walk outlived the 2 h background limit of the tool, but its processes kept running to the end (2.2 h, one run, all 143 tiles).

### Tracking

GP7 says gap plans write no STATE.md, but the executor prompt asks for the STATE.md position and decision. Only position, metrics, decision and session were written. REQUIREMENTS.md is untouched, and WORLD-01 and WORLD-05 stay open: 4 tiles still fail.

## Checks

- Unit: `tileWalkTrace`, `tileWalkRecords`, `loadNativeTileChunks`, `pawnWalking`: 59 passed. 47 test files that import the changed modules: 538 passed. `pnpm typecheck` is clean.
- Browser: classification run of 75 tiles on 78c3615; samples after each fix (8, 4, 5 and 3 tiles); the final run of 143 tiles, all behind the port check and the schedule check.
- Lane ownership (`--base 1850c82 --part world`): the foreign paths are `src/runtime/nativeSliceDiagnostics.ts`, `src/runtime/worldMovementWiring.ts` and `src/world/NativeSliceAdapter.ts` (integration, the expected cross-lane trace and adapter edits), plus `tools/reference-overlap/*` from 6a2654c, another agent's commit.
- Reference overlap, area movement: blocking 4 and unreviewed 154 (95 in `movementPresenter.ts`, 59 in `collisionWorld.ts`, with generic cache, loop and read lines at `collisionWorld.ts` 44-56). The report is `C:/laragon/l2b-orchestration/autonomous-roadmap/03-21/reference-overlap-movement.json`. Left for the orchestrator's independent review, per the run rules.
- Frozen sources: none touched; no converter ran.

## Open questions

- Water surface: offline traces of 15_26 and 24_26 under the old spawn alternate between falling and swimming at the water surface (z about -3815). Both pass now, but how APawn physSwimming handles the surface is not in the `verified-*.md` facts.
- `collision.terrainHoles` (status unknown) and `movement.floorBand` (unconfirmed) still come from the reference rules, not Interlude facts.

## Process cleanup

The two stopped full runs were ended with `taskkill /T /PID` on their own `run_below_normal.py` PIDs (62300, 114492). The final run exited on its own (PID 57256). A stuck draft shell (PIDs 32692 and 19308, command line holding the 03-21 drafts path) was stopped by PID. After the last run nothing listens on 5173 or 5175, and no process other than this shell has the worktree path in its command line.

## Self-Check: PASSED

- FOUND: tests/unit/tileWalkTrace.test.ts, artifacts/lane-store/world/measurements/tile-walk-failure-classes.json (ignored), tile-walks-ba87e45c....json (ignored)
- FOUND: 78c3615, 1ab83a1, e5dc314, 07f65fe
