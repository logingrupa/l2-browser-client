---
phase: 02-stage-a-breadth
plan: 67
subsystem: adapter-dispatch
tags: [move-01, mat-02, vis-01, world-05, runtime-wiring, collision-world, movement-presenter, calc-behind-view, environment-clock, transparent-order, dec-own-12]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-37 sandbox runtime actions; 02-48 collision world, cell loader and collisionCellContext; 02-63 tile visibility binding reading camera.maxZ; 02-64 world environment clock and camera environment; 02-66 movement presenter, CalcBehindView and the click trace"
provides:
  - "src/runtime/worldMovementWiring.ts: wireWorldMovement (collision world context, presenter on adapter records, intents, click trace, follow camera, collisionCells snapshot field, collisionSurfaceHeightsAt, groundBelow, isStraightWalkBlocked)"
  - "src/runtime/tileCollisionCells.ts: loadTileCollisionCells, collisionCellTerrainFootprint"
  - "src/runtime/worldEnvironmentWiring.ts: wireWorldEnvironment, cameraFarPlane, cameraFogOnZoneChange"
  - "src/runtime/transparentRenderingOrder.ts: installTransparentRenderingOrder, compareTransparentSubMeshes"
  - "src/runtime/collisionWorldNavigation.ts, src/runtime/footstepSurfaceContact.ts, src/runtime/committedMovementRules.ts"
affects: [02-49, 02-55, 02-69, phase-4-net, perf-02, pol-03]

estimate:
  tokens: 110000
  tasks: 3
actuals:
  tokens: 105000
  tasks: 3
  commits: 4
plan_head_before: 95b61b0ec4528db414bc73d7e1fa1efcdb604a4b
plan_head_after: 7bd8338

tech-stack:
  added: []
  patterns:
    - "Adapter answers commands with records; the presenter alone moves pawns and its intents leave after the frame"
    - "Runtime queries over the collision world are reused while their inputs and the world revision are unchanged"
    - "Browser harness reads WebGPU pixels through a 2D canvas copy at engine end of frame"

key-files:
  created:
    - src/runtime/worldMovementWiring.ts
    - src/runtime/tileCollisionCells.ts
    - src/runtime/committedMovementRules.ts
    - src/runtime/worldEnvironmentWiring.ts
    - src/runtime/transparentRenderingOrder.ts
    - src/runtime/collisionWorldNavigation.ts
    - src/runtime/footstepSurfaceContact.ts
    - tests/unit/worldMovementWiring.test.ts
    - tests/unit/tileCollisionCells.test.ts
    - tests/unit/worldEnvironmentWiring.test.ts
    - tests/unit/transparentRenderingOrder.test.ts
    - tests/unit/footstepSurfaceContact.test.ts
    - tests/browser/world-movement-port.spec.ts
    - tests/browser/translucent-order.spec.ts
    - tests/browser/harness/translucent-order.html
    - tests/browser/harness/translucentOrderHarness.ts
  modified:
    - src/world/NativeSliceAdapter.ts
    - src/world/GameWorldAdapter.ts
    - src/world/sourceFrame.ts
    - src/entities/EntityRegistry.ts
    - src/entities/attachTargeting.ts
    - src/runtime/createNativeSliceRuntime.ts
    - src/runtime/loadNativeSliceWorld.ts
    - src/runtime/nativeSliceDiagnostics.ts
    - src/runtime/attachNativeSliceSheet.ts
    - src/runtime/attachNativeSliceWorldSheet.ts
    - src/scene/world/movement/core/decodeNativeTileCollision.ts
    - tests/browser/nativeSlice.spec.ts
    - tests/browser/world-tile-walk.spec.ts
    - tests/browser/nativeBsp.spec.ts
    - tests/unit/nativeDoors.test.ts
    - tests/unit/nativeBspSupport.test.ts
    - docs/parts/adapter-dispatch/EVIDENCE.md
    - STATUS.md
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md
  deleted:
    - src/world/syntheticMovement.ts
    - src/scene/navigation/meshNavigation.ts
    - tests/unit/navigation.test.ts
    - tests/unit/navigationContact.test.ts
    - tests/unit/navigationDynamic.test.ts

key-decisions:
  - "The runtime loads every chunk cell of the selected tile (tile 20_20 on /) with footprints from the decoded terrain heightmap points and holds the presenter until resident; 02-49 replaces it with the ring (row 718)"
  - "decodeNativeTileBspTree checks only vertex entries a node pool references; converted tiles hold unreferenced out-of-range entries (row 719)"
  - "move-local becomes one move record in source units with sourced speeds, moveType 0/1 and the profile cylinder; preview-action and set-animation of a moving local player send a stop (row 720)"
  - "The sandbox server mirrors accepted report-position and cannot-move into its entity and emits update (row 721)"
  - "Pawns with movement records are presented at the presenter pose, run while moving; doors read the presented player (row 722)"
  - "Orbit radius is the unobstructed CalcBehindView distance; the behind view is reused while its inputs are unchanged (row 723)"
  - "Camera maxZ follows fogEnd while fog is on, else the presentation far plane (row 724, owner review)"
  - "Camera fog re-read from the lighting inspection on camera zone change (row 725)"
  - "WorldNavigation.ts kept for its lane importers; everything else retired or moved to the collision world (row 726)"
  - "VIS-01 closes; MAT-02, MOVE-01 and WORLD-05 stay Pending (row 730)"

requirements-completed: [VIS-01]

coverage:
  - id: T1
    description: "A click or tap on tile 20_21 walks the player through the MOVE-01 port on adapter move records over the 16 resident collision cells, with report-position intents sent and no missing cell"
    requirement: MOVE-01
    verification:
      - kind: unit
        ref: "pnpm vitest run tests/unit/worldMovementWiring.test.ts tests/unit/nativeSliceAdapter.test.ts tests/unit/tileCollisionCells.test.ts"
        status: pass
      - kind: e2e
        ref: "NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-movement-port.spec.ts (1440 x 900, 932 x 430, portrait no-scroll)"
        status: pass
    human_judgment: false
  - id: T2
    description: "Adapter environment events move the tile environment clock; camera maxZ follows fogEnd or the presentation far plane"
    requirement: MAT-02
    verification:
      - kind: unit
        ref: "pnpm vitest run tests/unit/worldEnvironmentWiring.test.ts"
        status: pass
    human_judgment: false
  - id: T3
    description: "One transparent comparator by distance then emitter ordinal; a Power Strike in front of and behind a translucent sheet draws in distance order"
    requirement: VIS-01
    verification:
      - kind: unit
        ref: "pnpm vitest run tests/unit/transparentRenderingOrder.test.ts"
        status: pass
      - kind: e2e
        ref: "NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/translucent-order.spec.ts"
        status: pass
    human_judgment: false
  - id: T4
    description: "Synthetic movement and mesh navigation retired; the default route and 20_21 still walk"
    requirement: WORLD-05
    verification:
      - kind: unit
        ref: "pnpm test:unit"
        status: pass
      - kind: e2e
        ref: "NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/nativeSlice.spec.ts tests/browser/world-tile-walk.spec.ts"
        status: pass
    human_judgment: false

duration: 105min
completed: 2026-11-11
---

# Phase 2 Plan 67: Runtime wiring for movement, environment and translucent order summary

**The sandbox now has one movement path: `NativeSliceAdapter` answers `move-local` with a `move` record and the 02-66 presenter walks the pawn over the tile's converted collision cells, which the runtime loads and provides through `provideCollisionCellContext`; clicks use the zero-extent click trace, the follow camera uses CalcBehindView, adapter environment events drive the tile clock, fog sets the far plane, one comparator orders transparent meshes, and synthetic movement and mesh navigation are deleted.**

## Performance

- Duration: about 105 minutes (2026-11-10 22:55 to 2026-11-11 00:45 Riga)
- Tasks: 3 of 3
- Files: 55 changed in the task commits (16 created, 5 deleted)

## Accomplishments

- `wireWorldMovement` creates the collision world, provides it with the player focus, loads all 16 chunk cells of 20_21 (or of 20_20 on `/`), applies adapter `move`, `stop`, `correct`, `teleport` and `despawn` records to the presenter, dispatches its `report-position` and `cannot-move` intents after each frame and counts refused records. The snapshot carries `collisionCells` and `movement`; `window.__nativeSlice.collisionSurfaceHeightsAt(x, z)` answers a vertical zero-extent trace.
- `NativeSliceAdapter` no longer moves anyone and takes no navigation; `GameWorldAdapter` has four methods. The registry presents presenter poses; doors and footsteps read the presented player.
- `wireWorldEnvironment` and `installTransparentRenderingOrder` are installed once per scene; the World sheet gained the `world.visibility.culling` switch.
- The 02-48 BSP tree decoder accepted no converted tile (13,188 of 88,409 vertex entries of 20_21 name no point, none referenced); it now checks only referenced entries.

## Task commits

1. Task 1, walk tile 20_21 through the port (tracer): `d62ef44` Walk tile 20_21 through the MOVE-01 port from adapter move records
2. Task 2, environment clock, far plane and the transparent comparator: `284cd48` Drive the game clock from adapter environment events, the far plane from fog and transparency from one comparator
3. Task 3, retirement: `4864bc3` Retire synthetic movement and mesh navigation: one movement path through the MOVE-01 port
4. Task 3, evidence: `7bd8338` Record the 02-67 runtime wiring evidence, the adapter-dispatch status line, decision rows 718 to 730 and the lane handoffs

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] BSP tree decoder refused every converted tile**
- Found during: Task 1 (the spec reported `BSPT.vertexPoints[17934] = 7554 is outside 0 to 7553`)
- Fix: check only vertex entries a node pool references, with a unit case; the one foreign path (`src/scene/world/**`, world lane), row 719
- Commit: d62ef44

**2. [Rule 3 - Blocking] No cell loader feeds the collision world before 02-49**
- Fix: `src/runtime/tileCollisionCells.ts` loads the whole selected tile (row 718)
- Commit: d62ef44

**3. [Rule 2 - Correctness] Click-to-move and door wiring moved in Task 1, not Task 3**
- `attachTargeting` and the door actor port had to follow the presenter for the tracer to walk; the adapter `advance` removal touched the shared adapter tests in Task 1.

**4. [Rule 1 - Bug] Behind-view box trace every frame slowed the default route**
- Found during: Task 3 (`nativeSlice.spec.ts` timed out with every click near 4 s)
- Fix: reuse the behind view and ground queries while inputs and the collision revision are unchanged (row 723); open follow-up for trace culling
- Commit: 4864bc3

**5. [Scope] WorldNavigation.ts kept**
- The plan stop rule applies: four lane files import it (actors and world lanes); handoff in STATE and EVIDENCE (row 726).

**6. [Rule 1 - Stale tests] Browser expectations**
- `world-tile-walk.spec.ts` expected 0 BSP meshes on 20_21 (02-30 converted them); `nativeSlice.spec.ts` compared grounding against the old mesh surface (row 728).

**Total deviations:** 4 auto-fixed, 2 scope notes. **Impact:** one world-lane decoder line changed; no behaviour beyond the plan otherwise.

## Reference overlap (DEC-OWN-12)

`node tools/reference-overlap/referenceOverlap.mjs --area movement --reference-root C:/laragon/www/l2-browser-client` exits 0: 0 blocking runs, 12 unreviewed reviewer runs (`src/world/sourceFrame.ts` 9, `decodeNativeTileCollision.ts` 3), 7 stale reviewed runs. Report: local `artifacts/plan-starts/02-67-reference-overlap-movement.json` (ignored). No signed-off or reviewed rows were added; the orchestrator runs the independent review.

## Verification

- `pnpm typecheck` clean; `pnpm test:unit` (2026-11-11 00:32 Riga, nice 10): 201 files pass, 3 skipped; 2,549 tests pass, 59 skipped.
- Tracer gate: the Task 1 verify (schedule, typecheck, the two unit files, `world-movement-port.spec.ts`) ran again after the commit and passed before Task 2.
- `NATIVE_STORE_ROOT=world pnpm test:e2e` (5173 free): `world-movement-port.spec.ts` 2 passed, `translucent-order.spec.ts` 2 passed (in front: brightest red 116, 0 red pixels; behind: 231, 73), `world-tile-walk.spec.ts` 2 passed, `nativeSlice.spec.ts` 3 passed. Screenshots and walk records in `test-results/` (ignored). Headless SwiftShader: no frame rate claim.
- Acceptance: `grep -c "provideCollisionCellContext(scene" src/runtime/worldMovementWiring.ts` = 1; `grep -c moveTowards src/world/NativeSliceAdapter.ts` = 0; `git grep -n "alphaIndex *=" -- src` empty; `syntheticMovement.ts` and `meshNavigation.ts` gone and `git grep -n -i "meshNavigation\|syntheticMovement" -- src` empty.
- `check-lane-ownership.mjs --base 95b61b0 --part adapter-dispatch`: 1 foreign path, `src/scene/world/movement/core/decodeNativeTileCollision.ts` (row 719).
- Process cleanup: Playwright started and stopped its own dev server per run; the Vitest runs exited. After the last run no process with this worktree path in its command line remains and nothing listens on 5173 or 5175.

## Known stubs

None. The whole-tile cell load is a working loader that 02-49 replaces with the residency ring.

## Threat flags

None beyond the register. T-02-67-01: the presenter moves pawns only on adapter records and positions leave as intents. T-02-67-02: `collisionSurfaceHeightsAt` refuses non-finite input with a RangeError and only reads.

## Self-Check: PASSED

- All 16 created files exist; the 5 deleted files are gone.
- Commits d62ef44, 284cd48, 4864bc3 and 7bd8338 are ancestors of HEAD.
