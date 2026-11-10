---
phase: 02-stage-a-breadth
plan: 48
subsystem: movement-geodata
tags: [world-04, move-01, collision-world, typed-payload, native-tile-collision, dec-own-12, import-boundary]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-30 native-tile-collision resources (BSPT per map; VOLS, SMSH, PLAC, TERR, MOVR per chunk) and the chunk and tile manifest records; 02-56 readTypedPayload, the typed payload fixture writer, sourceFrame and the static import graph helper"
provides:
  - "src/scene/world/movement/core/collisionWorld.ts: createCollisionWorld, CollisionWorld (requireCell, addCell, removeCell, isReady, setTileBspTree, tileBspTree, residentCells, inspection, clear), CollisionCellFootprint, CollisionWorldError"
  - "src/scene/world/movement/core/collisionCell.ts: CollisionCell, CollisionBspTree and the decoded volume, static mesh, placement, mover and terrain records in float32 source units"
  - "src/scene/world/movement/core/decodeNativeTileCollision.ts: decodeNativeTileCollisionCell, decodeNativeTileBspTree"
  - "src/scene/world/movement/loadCollisionCells.ts: loadCollisionCell, loadTileBspTree, nativeTileCollisionCellId"
  - "src/scene/world/movement/collisionCellContext.ts: provideCollisionCellContext, collisionCellContextFor, collisionFocusSourcePosition, CollisionCellContext"
  - "src/scene/world/loadNativeSection.ts: decodeNativeJsonResource (one owner of the UTF-8 JSON decode for native resources)"
  - "tests/support/nativeTileCollisionFixture.ts: synthetic chunk and BSPT payload arrays"
affects: [02-49, 02-65, 02-67]

estimate:
  tokens: 70000
  tasks: 3
actuals:
  tokens: 24000
  tasks: 3
  commits: 3
plan_head_before: 58c6e0910cb0f991670ee77299d5df13e330b33e
plan_head_after: 2531124d754517a3070034d92912607894d41a0d

tech-stack:
  added: []
  patterns:
    - "A Babylon-free core proves it reaches no DOM global by type-checking against the ES2022 library alone (TypeScript 7 has no JS compiler API)"
    - "A shared per-tile resource is loaded once per world through a pending-load map and set in the same tick as the cell that needed it"

key-files:
  created:
    - src/scene/world/movement/core/collisionCell.ts
    - src/scene/world/movement/core/collisionWorld.ts
    - src/scene/world/movement/core/decodeNativeTileCollision.ts
    - src/scene/world/movement/loadCollisionCells.ts
    - src/scene/world/movement/collisionCellContext.ts
    - tests/support/nativeTileCollisionFixture.ts
    - tests/unit/decodeNativeTileCollision.test.ts
    - tests/unit/collisionWorldCells.test.ts
    - tests/unit/loadCollisionCells.test.ts
    - tests/unit/importBoundaries.movement.test.ts
  modified:
    - src/scene/world/loadNativeSection.ts
    - src/scene/world/loadNativeTileChunks.ts
    - src/scene/world/loadNativeTileMovers.ts
    - docs/parts/movement-geodata/EVIDENCE.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md
    - .planning/phases/02-stage-a-breadth/deferred-items.md
    - .planning/STATE.md

key-decisions:
  - "Lane handoff: 02-48 is world, movement-geodata; no cell support in meshNavigation.ts, WorldNavigation.ts or syntheticMovement.ts, which 02-67 retires (row 587)"
  - "requireCell kept beside addCell, removeCell and isReady because readiness needs declared cells (row 588)"
  - "Footprints and positions are float32 source units on the UE2 horizontal axes; the binding converts the metre focus through sourceFrame (row 589)"
  - "The collision resource is asset.json plus payload.bin pinned inside it, as 02-30 writes it, not a .l2asset (row 590)"
  - "loadCollisionCell(world, {chunk, tileCollision}, signal) and loadTileBspTree(tileId, tileCollision, signal); one tile tree load per world and tile (row 591)"
  - "The movement boundary test type-checks the core with --lib es2022 instead of a DOM-name regex that flags the UE2 field location (row 592)"
  - "decodeNativeJsonResource replaces two copies in the tile chunk and mover loaders (row 593)"
  - "WORLD-04 and MOVE-01 stay Pending: the mechanism lands, the runtime wiring is 02-67, the ring 02-49, the traces 02-65 (row 594)"

requirements-completed: []

coverage:
  - id: D1
    description: "A synthetic chunk collision payload decodes into a cell with its declared sources and source-unit values unchanged; the per-map BSP tree decodes exactly; every malformed count, index and code throws CollisionWorldError naming the owner, group and field"
    requirement: MOVE-01
    verification:
      - kind: unit
        ref: "pnpm vitest run tests/unit/decodeNativeTileCollision.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "requireCell, addCell, removeCell and isReady with revisions, guards, sorted missingCellIds, the shared-edge rule, float32 footprints and one BSP tree per tile released with its last cell"
    requirement: WORLD-04
    verification:
      - kind: unit
        ref: "pnpm vitest run tests/unit/collisionWorldCells.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Pinned cell loader (SHA-256 and length pins, payload pin, units and axes, /l2/ paths, one tile tree load for two chunks, abort adds nothing) and the scene-keyed context"
    requirement: WORLD-04
    verification:
      - kind: unit
        ref: "pnpm vitest run tests/unit/loadCollisionCells.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "src/scene/world/movement/core imports only itself and src/shared, no package, and type-checks with the ES2022 library alone"
    requirement: MOVE-01
    verification:
      - kind: unit
        ref: "pnpm vitest run tests/unit/importBoundaries.movement.test.ts (a probe file using location.href fails it)"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-11-10
---

# Phase 2 Plan 48: Cell-aware collision world summary

The MOVE-01 collision world now takes decoded native-tile-collision cells per streaming cell, drops them per cell and reports not ready inside any required cell that is still missing. A pinned loader fetches and decodes the 02-30 resources, and a scene-keyed context hands the world and the player focus to the world loader. The runtime does not use any of it yet: 02-67 wires it in.

## Performance

- Duration: about 20 minutes (2026-11-10 02:35 to 02:55 Riga)
- Tasks: 3 of 3
- Files: 10 created, 8 modified

## Accomplishments

- `createCollisionWorld()` holds required footprints, resident cells and one BSP tree per tile. `isReady(position)` is false inside the closed footprint of any required cell that is not resident, so an edge shared by two cells needs both. `removeCell` drops a cell's primitives and its requirement in one revision. `inspection()` returns the counts, the sorted `missingCellIds` and the revision. Every guard throws `CollisionWorldError` with the cell id: empty id, non-finite or inverted footprint, a second require with another footprint, add without a require, add twice, a decoded cell for another id, remove of an unknown id, and a second tree for a tile or a tree for a tile with no resident cell.
- `decodeNativeTileCollisionCell` reads the VOLS, SMSH, PLAC, MOVR and TERR groups, and `decodeNativeTileBspTree` reads BSPT, both through `readTypedPayload`. Packed ranges, child and mesh indices, vertex pools, collision bounds, codes and bits are all guarded. Values stay as float32 source units, and the arrays are views over the payload.
- `loadCollisionCell(world, {chunk, tileCollision}, signal)` fetches `asset.json` by its pin, then `payload.bin` by the payload pin inside it. It decodes both and adds the cell through `addCell` in the same tick that it sets the tile tree. Two chunks of one tile fetch the tree only once.
- `provideCollisionCellContext`, `collisionCellContextFor` and `collisionFocusSourcePosition` follow the scene WeakMap pattern: a second provider is refused, the context withdraws when the scene is disposed, and the focus is converted from metres with `worldPositionToSource`.
- `tests/unit/importBoundaries.movement.test.ts` enforces the core boundary.

## Task commits

1. Task 1, one collision cell end to end: `599e7ef` feat(02-48): decode one native-tile-collision cell into the MOVE-01 collision world
2. Task 2, cell rules, pinned loader and scene context: `808e7eb` feat(02-48): load pinned collision cells into the world and hand it to the scene
3. Task 3, import boundary, evidence and ownership: `2531124` test(02-48): enforce the movement core import boundary and record the collision world evidence

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] The collision resource is not a `.l2asset`**
- Found during: Task 2
- Issue: the plan says to open a `.l2asset` with the asset package reader, but 02-30 writes `asset.json` plus `payload.bin` in a hash-addressed folder (row 518).
- Fix: the loader fetches `asset.json` by its pin and `payload.bin` by the payload pin inside it, then calls `readTypedPayload`. That call also refuses units other than `source` and axes other than `ue2-z-up` (row 590).
- Commit: 808e7eb

**2. [Rule 3 - Blocking] Loader signatures**
- Found during: Task 2
- Issue: `loadCollisionCell(chunkRecord, signal)` has no world to call `addCell` on (the plan's own key link) and no tile resource for the shared BSP tree. `loadTileBspTree(tileResource, signal)` has no tile id.
- Fix: `loadCollisionCell(world, {chunk, tileCollision}, signal)` and `loadTileBspTree(tileId, tileCollision, signal)`. `nativeTileCollisionCellId(tileId, chunkId)` names the cell id that 02-49 requires (row 591).
- Commit: 808e7eb

**3. [Rule 1 - Bug] The DOM-global regex flags the UE2 field `location`**
- Found during: Task 3
- Issue: the shared boundary test's word regex matched the `location` properties and locals that mirror UE2 `Location`.
- Fix: the movement boundary test type-checks the core with `--lib es2022` and no types. A probe using `location.href` fails it (row 592).
- Commit: 2531124

**4. [Rule 2 - DRY] One JSON decode owner**
- Found during: Task 2
- Issue: the tile chunk and tile mover loaders each held a copy of the UTF-8 JSON decode, and the collision loader needed a third.
- Fix: `decodeNativeJsonResource` sits beside `fetchVerifiedNativeResource`, and both copies are deleted (row 593).
- Commit: 808e7eb

**5. [Scope] Added tests/support/nativeTileCollisionFixture.ts and `tileBspTree(tileId)`**
- The synthetic payload arrays are shared by three test files, so they live in one helper. `tileBspTree` is the read side the loader and 02-65 need. Neither is outside the world lane.

## Reference overlap (DEC-OWN-12)

`node tools/reference-overlap/referenceOverlap.mjs --area movement --reference-root C:/laragon/www/l2-browser-client` exits 1.

- Area: movement.
- Blocking runs: 108, all in code this plan wrote: decodeNativeTileCollision.ts 74, collisionWorld.ts 27, loadCollisionCells.ts 6, collisionCellContext.ts 1.
- Unreviewed reviewer runs: 1,732 of 1,895.
- Report: local `artifacts/plan-starts/02-48-reference-overlap-movement.json` (gitignored; rerun the command to reproduce it).
- Example: the one run in collisionCellContext.ts (lines 13 to 14, 23 tokens) matches a config parser in `un-conf-hair.ts`, which is generic guard tokens.
- No rows were added to signedOffRuns or reviewedRuns. The orchestrator runs the independent review.

## Verification

- `pnpm typecheck` clean.
- The four new Vitest files pass, 70 tests in all: 30 decode cases, 19 world cases, 15 loader and context cases, and 6 boundary cases.
- `grep -rc "@babylonjs" src/scene/world/movement/core` prints 0 for every file. `grep -rn -i "recast\|navmesh\|moveWithCollisions\|checkCollisions" src/scene/world/movement` prints nothing.
- `pnpm test:unit` (2026-11-10 02:48 Riga, below-normal priority): 2,430 passed, 72 skipped, 1 failed. The one failure is `laneOwnership.test.ts` "has an evidence doc for player-characters", because the actors-lane `docs/parts/player-characters/EVIDENCE.md` from 02-40 has no `## Evidence` heading. This plan did not cause it; it is logged in deferred-items.md and under Open follow-ups.
- `check-lane-ownership.mjs --part movement-geodata` names 3 foreign paths: STATUS.md, `.planning/OVERNIGHT-DECISIONS.md` and the phase `deferred-items.md`. These are the integration-owned process files that the plan's files_modified lists, accepted as in row 525. Every code and doc path is in the world lane.
- Process cleanup: this plan started no dev server, preview, Playwright or browser. Vitest and tsc ran in the foreground and exited. `ps -W` shows only the three node.exe services that have run since Oct 29.

## Known stubs

None. Nothing in the runtime calls the context or the loader until 02-67 and 02-49 wire them, as the plan states. Readiness is the only query until 02-65.

## Threat flags

None beyond the plan's threat register. T-02-48-01 is mitigated by the pins, the units and axes check and the guarded decode. T-02-48-03 is mitigated by the WeakMap, the refused second provider and the withdrawal on dispose.

## Self-Check: PASSED

- All 10 created files exist.
- Commits 599e7ef, 808e7eb and 2531124 are ancestors of HEAD.
