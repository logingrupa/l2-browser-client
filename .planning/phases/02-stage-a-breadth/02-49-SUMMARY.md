---
phase: 02-stage-a-breadth
plan: 49
subsystem: world
tags: [world-04, move-01, residency, streaming, collision-world, null-level-lod, tile-border, baseline]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-16 tile route and chunk manifests; 02-29 and 02-30 chunk meshes, BSP and collision resources; 02-47 eleven converted tiles in the world lane store; 02-48 collision world and cell loader; 02-67 runtime movement wiring and collisionSurfaceHeightsAt"
provides:
  - "docs/parts/world/streaming-baseline.json: headless 20_21 baseline before and with residency (counts, bytes, load time, fpsMeasured false)"
  - "src/scene/world/worldResidencyRing.ts: settings guard, chunk-edge presentation radii, footprint distance, deterministic plan, neighbouring tile ids"
  - "src/scene/world/nativeTileChunkResidency.ts: residency controller (require before load, at most 3 loads, null-level culling on visual meshes, remove cells before disposal, failures kept without retry)"
  - "src/scene/world/streamNativeTileChunks.ts with nativeTileResidencyTiles.ts, loadResidencyChunk.ts, nativeTileChunkFootprints.ts, nativeTileChunkContents.ts, attachNativeTileSystems.ts and nativeTileSectionInspection.ts: the streamed tile route"
  - "scripts/measure-native-world.mjs --map=XX_YY"
  - "tests/browser/world-streaming-baseline.spec.ts and tests/browser/world-tile-border.spec.ts"
affects: [02-55, 02-69, perf-02, world-05, move-01]

estimate:
  tokens: 90000
  tasks: 3
actuals:
  tokens: 98000
  tasks: 3
  commits: 7
plan_head_before: 50424a5c478a6c8ca1993935ddbb020f37eac59d
plan_head_after: 105e551

tech-stack:
  added: []
  patterns:
    - "Residency plan is a pure function of chunk footprints, focus and settings; the controller tracks which cells it required so a repeat plan makes no collision world call"
    - "Chunk footprints are derived per tile from one probe collision cell and checked against every loaded cell"
    - "Per-tile caches (model templates, BSP tree) load on the section lifetime signal, so an aborted chunk never fails a sibling"

key-files:
  created:
    - docs/parts/world/streaming-baseline.json
    - src/scene/world/worldResidencyRing.ts
    - src/scene/world/nativeTileChunkResidency.ts
    - src/scene/world/streamNativeTileChunks.ts
    - src/scene/world/nativeTileResidencyTiles.ts
    - src/scene/world/loadResidencyChunk.ts
    - src/scene/world/nativeTileChunkFootprints.ts
    - src/scene/world/nativeTileChunkContents.ts
    - src/scene/world/attachNativeTileSystems.ts
    - src/scene/world/nativeTileSectionInspection.ts
    - tests/unit/worldResidencyRing.test.ts
    - tests/unit/collisionInputsFromCellsOnly.test.ts
    - tests/unit/nativeTileChunkFootprints.test.ts
    - tests/browser/world-streaming-baseline.spec.ts
    - tests/browser/world-tile-border.spec.ts
  modified:
    - scripts/measure-native-world.mjs
    - src/scene/world/loadNativeTileChunks.ts
    - src/scene/world/loadNativeSection.ts
    - src/scene/world/movement/loadCollisionCells.ts
    - src/runtime/createNativeSliceRuntime.ts
    - src/runtime/worldMovementWiring.ts
    - src/runtime/tileCollisionCells.ts
    - tests/unit/loadCollisionCells.test.ts
    - tests/unit/worldMovementWiring.test.ts
    - docs/parts/world/EVIDENCE.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md
    - .planning/STATE.md
  deleted:
    - tests/unit/tileCollisionCells.test.ts

key-decisions:
  - "Null-level culling only; LOD derivatives stay lod-derivative-unplanned (row 734)"
  - "Rings of 1, 2 and 3 chunk edges and a culling distance of 1 chunk edge, presentation, owner review (row 735)"
  - "At most 3 concurrent chunk loads, aborted on collision-ring exit (row 736)"
  - "Residency centred on the runtime local player, the anchor until it exists; failed chunks stay required with no retry (row 737)"
  - "The runtime provides the collision cell context before the world loads; three runtime files changed (row 738)"
  - "Chunk footprints from one probe cell per tile and the sector range, checked on every load (row 739)"
  - "Tile systems bind the selected tile's startup chunks; templates and the BSP tree cached per tile (row 740)"
  - "The vertical probe spans the loaded bounds plus the step height; loaded bounds follow the resident terrain (row 741)"
  - "Border walk uses the first edge-sharing pair, 17_12 and 18_12 (row 742)"
  - "The 128-unit tile seam drops the player; recorded, not invented away (row 743)"
  - "WORLD-04 and MOVE-01 stay Pending (row 744)"

requirements-completed: []

coverage:
  - id: T1
    description: "Headless baseline of 20_21 before residency, and a --map option for the hardware measurement"
    requirement: WORLD-04
    verification:
      - kind: e2e
        ref: "NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-streaming-baseline.spec.ts"
        status: pass
      - kind: command
        ref: "Task 1 verify: node --check, --map=2021 exits with Invalid map, baseline has beforeResidency and no frame-rate key"
        status: pass
    human_judgment: false
  - id: T2
    description: "Ring maths and the chunk residency controller with collision inputs from decoded cells only"
    requirement: WORLD-04
    verification:
      - kind: unit
        ref: "pnpm vitest run tests/unit/worldResidencyRing.test.ts tests/unit/collisionInputsFromCellsOnly.test.ts tests/unit/collisionWorldCells.test.ts"
        status: pass
    human_judgment: false
  - id: T3
    description: "Streamed tile route, border walk and the with-residency baseline"
    requirement: WORLD-04
    verification:
      - kind: unit
        ref: "pnpm test:unit"
        status: pass
      - kind: e2e
        ref: "world-tile-walk, world-tile-meshes, world-movement-port, nativeSlice, world-tile-lighting, world-bsp-visibility, world-tile-movers, world-streaming-baseline"
        status: pass
      - kind: e2e
        ref: "NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-border.spec.ts"
        status: fail
    human_judgment: true
    rationale: "The border walk passes every residency assertion but fails its grounding check at the 128-unit tile seam (row 743); the seam is an open source question"

duration: 72min
completed: 2026-11-11
---

# Phase 2 Plan 49: Streaming baseline and chunk residency summary

**The tile route now streams the selected tile and its converted neighbours in player-centred rings: chunk footprints come from one probe collision cell per tile, every chunk in the 163.84 m collision ring is required in the MOVE-01 collision world before it loads, decoded cells (never meshes) are added on load and removed before the chunk's container is disposed beyond 245.76 m, model and BSP meshes get one null level of detail at 81.92 m, and a committed headless baseline records 20_21 before and with residency; a border walk from 17_12 into 18_12 keeps nearby cells and disposes the far start chunks, but drops the player through the 128-unit strip between tiles that no converted data covers.**

## Performance

- Duration: about 72 minutes (2026-11-11 00:46 to 01:58 Riga)
- Tasks: 3 of 3
- Files: 28 changed in the task commits (15 created, 1 deleted)

## Accomplishments

- Baseline before residency (Task 1, committed before any residency code): 20_21 headless, 48,687 ms to ready, 532 `/l2/` responses, 370,129,764 bytes, 16 of 16 chunks, 12,427 meshes, 760,817 vertices, 16 resident cells. With residency: 66,458 ms, 635 responses, 473,121,010 bytes, 19 chunks (16 of 20_21 and 3 of 20_20 inside the collision ring), 13,590 meshes, 931,916 vertices, 19 cells. Mode `headless-swiftshader`, `fpsMeasured` false; the times are not a performance measurement.
- `measure-native-world.mjs --map=XX_YY` validates the id before the hardware check, builds `/?map=` with `URLSearchParams` and checks the selected tile, no missing cell and a non-fallback local player.
- `worldResidencyRing.ts` (no Babylon import) and `nativeTileChunkResidency.ts` (250 lines, one `addLODLevel(`) with 10 ring tests and 9 controller tests.
- The runtime creates the collision world and provides the context before the world loads; `loadNativeTileChunks` streams through the residency when the context exists and keeps the whole-tile path for callers without one (unit tests, harness).
- Border walk: 16 hops of 8 m east from the 17_12 anchor, all on the straight line; no hop ended with a focus cell missing, loaded plus loading stayed at or below retained, and the 4 `chunk-0-*` cells of 17_12 left the retain ring and were disposed; the end inspection reads 48 known, 21 loaded, 28 retained, 4 disposed, 0 failed.

## Task commits

1. Task 1 (tracer), baseline before residency: `ff075ae` Record the headless streaming baseline of tile 20_21 before residency and let the hardware measurement target a tile
2. Task 2 (TDD red): `5a829e2` Add failing tests for the residency ring maths and the chunk residency collision inputs
3. Task 2 (green): `13d62ff` Plan chunk residency in player-centred rings and feed the collision world decoded cells only
4. Task 3, wiring and specs: `9018f24` Stream the tile route in a player-centred chunk residency and walk a tile border
5. Task 3, evidence: `105e551` Record the 02-49 residency evidence, the world status line, decision rows 734 to 743, the hardware measurement and the tile seam follow-up

Two orchestrator commits landed on the branch during the plan (`67761d0`, `8b2b4f1`); they are in the measured range but are not 02-49 work.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] The collision cell context did not exist when the tile loaded**
- Found during: Task 3. 02-67 provides the context inside `wireWorldMovement`, after `loadNativeSliceWorld`, so `collisionCellContextFor(scene)` was always null for the tile loader.
- Fix: the runtime creates the world and provides the context before the world loads; `wireWorldMovement` takes the world; the tile route's cell loader resolves `null`; the default route keeps `loadTileCollisionCells`. Three `src/runtime/**` files changed against the plan's lane rule (row 738).
- Commit: 9018f24

**2. [Rule 3 - Blocking] No manifest field gives a chunk footprint before its cell loads**
- Fix: one probe cell per tile gives heightmap size and quads per sector; every chunk footprint follows from its sector range; the probe and every loaded cell are checked against the rule (row 739).
- Commit: 9018f24

**3. [Rule 1 - Bug] A shared load aborted by one chunk would fail its siblings**
- Found during: Task 3 design review of the 02-48 shared tile tree load and the model template load. Both now load on the section lifetime signal, cached per tile; `loadCollisionCell` (add inside the loader) became `loadChunkCollisionCell`, and the residency adds cells itself.
- Commit: 9018f24

**4. [Rule 1 - Bug] The vertical probe found nothing on a flat tile**
- Found during: Task 3 border walk (17_12 terrain is flat at -47.03 m, so the probe segment had zero length).
- Fix: the probe spans the loaded bounds plus `movement.maxStepHeight`, and the loaded bounds follow the resident terrain (row 741), with a unit case.
- Commit: 9018f24

**5. [Scope] Border pair and grounding**
- The pair is the first edge-sharing one (row 742). The spec gained a soft grounding check against the walked collision surface (band from the committed `movement.maxStepHeight` and `movement.floorBand.maximum` rows), which is what exposed the seam.

**6. [Scope] Section terrain meshes**
- The streamed section returns empty `terrainMeshes` and `supportMeshes` as planned; the ground contact diagnostic therefore reports streamed terrain as outside the section. The tile inspection still counts the selected tile's resident terrain.

**Total deviations:** 4 auto-fixed, 2 scope notes. **Impact:** three runtime files outside the world lane changed; behaviour on `/` unchanged.

## Verification

- `pnpm typecheck` clean; `pnpm test:unit` (2026-11-11 01:40 Riga, nice 10): 203 files pass, 3 skipped; 2,570 tests pass, 59 skipped.
- Tracer gate: the Task 1 verify passed after its commit and before Task 2.
- Task 2 red run saved to `artifacts/tdd-red/02-49-red.txt` (both files fail on the missing modules), then 36 tests pass with `collisionWorldCells.test.ts`.
- `NATIVE_STORE_ROOT=world pnpm test:e2e` (5173 free each time): `world-streaming-baseline.spec.ts` passed twice (before and with residency); `world-tile-walk.spec.ts` 2 passed, `world-tile-meshes.spec.ts` 2 passed (the first walk run lost one test to Vite's first-sight dependency reload, the rerun passed); `world-movement-port.spec.ts` 2, `nativeSlice.spec.ts` 3, `world-tile-lighting.spec.ts` 2, `world-bsp-visibility.spec.ts` 2, `world-tile-movers.spec.ts` 2 passed. Headless SwiftShader: no frame rate claim.
- `world-tile-border.spec.ts`: failed. Every residency assertion passes; the soft grounding check fails on hops 15 and 16 (116.77 m below the walked surface after crossing x -656.64 to -655.36 m). Walk record `test-results/world-tile-border-17_12-18_12.json` (ignored).
- Acceptance: `grep -c "collisionCellContextFor(scene" src/scene/world/loadNativeTileChunks.ts src/scene/world/loadNativeSection.ts` totals 1; `grep -c "addLODLevel(" src/scene/world/nativeTileChunkResidency.ts` is 1; `grep -c "@babylonjs" src/scene/world/worldResidencyRing.ts` is 0; `grep -c "Invalid map" scripts/measure-native-world.mjs` is 1; `world=interlude` absent from the script and both specs; no line comment in the script; the baseline has both records; STATE holds the 02-49 Needs Human line with `--map=20_21`.
- `check-lane-ownership.mjs --base 50424a5 --part world` exits 1: foreign paths `src/runtime/createNativeSliceRuntime.ts`, `src/runtime/tileCollisionCells.ts`, `src/runtime/worldMovementWiring.ts` (row 738), plus `.planning/OVERNIGHT-DECISIONS.md` and `tools/reference-overlap/reviewedRuns/movement.json` from the two orchestrator commits.
- Process cleanup: Playwright started and stopped its own dev server per run; the Vitest runs exited; the debug dev server on 5175 (PID 27840) was stopped by PID. After the last run no process with this worktree path and vitest, vite, playwright, chrome or `--port` in its command line remains, and nothing listens on 5173 or 5175.

## Reference overlap (DEC-OWN-12)

`node tools/reference-overlap/referenceOverlap.mjs --area movement --reference-root C:/laragon/www/l2-browser-client` exits 1 on 5 stale sign-offs that are not this plan's: 0 blocking runs, 2 unreviewed reviewer runs (both in `src/scene/world/movement/loadCollisionCells.ts`, 12 tokens, lines this plan only shortened), 111 stale reviewed runs. Report: `artifacts/plan-starts/02-49-reference-overlap-movement.json` (ignored). The residency modules sit in no overlap area. No signed-off or reviewed rows were added.

## Needs Human

- Plan 02-49: after the restage that includes the world lane tiles, outside machine windows on the GTX 1060: `pnpm build && WORLD_HARDWARE_TEST=1 node scripts/measure-native-world.mjs --label=tile-20-21-residency --map=20_21 --route=source`.

## Open follow-ups

- Tile seam (row 743): the 128-unit strip between converted tiles has no terrain, BSP or cell; the world lane finds how the reference client closes it.
- Chunk-incremental tile systems (row 740).

## Known stubs

None. The whole-tile loader without a runtime context is the plan's kept path for harness callers.

## Threat flags

None beyond the register. T-02-49-01: neighbour ids come from `neighbouringTileIds`, pass `^\d{2}_\d{2}$` and the catalog slice, and their URLs come from catalog records. T-02-49-02: footprints are checked against decoded cells and `requireCell` refuses non-finite or inverted ones. T-02-49-03: at most 3 loads, abort on ring exit, the spec asserts the loaded bound. T-02-49-04: `fpsMeasured` false and the spec refuses a frame-rate key. T-02-49-05: `--map` is validated before the hardware check.

## Self-Check: PASSED

- All 15 created files exist; `tests/unit/tileCollisionCells.test.ts` is gone (moved into `nativeTileChunkFootprints.test.ts`).
- Commits ff075ae, 5a829e2, 13d62ff, 9018f24 and 105e551 are ancestors of HEAD.
