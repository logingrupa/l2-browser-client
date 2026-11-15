---
phase: 02-stage-a-breadth
plan: 65
subsystem: movement-geodata
tags: [move-01, world-08, move-actor, line-check, point-check, volume-containment, bsp-collision, dec-own-12, golden-trace]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-48 collision world (createCollisionWorld, residentCells, tileBspTree) and decoded VOLS, SMSH, PLAC, MOVR, TERR and BSPT records; 02-56 goldenTrace and typed payload fixtures; 02-57 reference overlap tool and vendor boundary"
provides:
  - "src/scene/world/movement/core/moveActor.ts: moveActor, MoveActorHit, MoveActorResult, MovingActor"
  - "src/scene/world/movement/core/lineCheck.ts: singleLineCheck, LineCheckHit, LineCheckQuery, traceCollisionWorld, WorldSweepHit"
  - "src/scene/world/movement/core/pointCheck.ts: pointCheck, PointCheckQuery, PointCheckHit"
  - "src/scene/world/movement/core/volumeContainment.ts: volumesContaining, ContainingVolume"
  - "src/scene/world/movement/core/movementRules.ts: parseMovementNativeRules, MovementNativeRules, backoffDistance, MovementRulesError"
  - "src/scene/world/movement/core/collisionTrace.ts: CollisionPrimitive, CollisionHitSource, CollisionSurroundings, PawnCylinder, MoverCollisionState"
  - "recipes/world/movement-native-rules.json: 29 reference rows, including movement.maxStepHeight and movement.minFloorZ for 02-66"
affects: [02-64, 02-66, 02-67]

estimate:
  tokens: 100000
  tasks: 3
actuals:
  tokens: 33000
  tasks: 3
  commits: 4
plan_head_before: 54c8bf92011398d8d9efb4494f2eb1dcde7f6c3b
plan_head_after: e1d6efa5725a0ed25d5ea4b72e4e0cef94e98108

tech-stack:
  added: []
  patterns:
    - "One SolidCollisionTree interface serves the tile BSPT (LeafHulls hulls) and brush volumes (path-plane hulls) for rays, box sweeps and point checks"
    - "residentPrimitives fixes one registration order so line and point checks share tie rules"
    - "Movement golden traces live beside their fixtures in tests/fixtures/movement and are rewritten only with MOVEMENT_GOLDEN_WRITE=1"

key-files:
  created:
    - src/scene/world/movement/core/moveActor.ts
    - src/scene/world/movement/core/lineCheck.ts
    - src/scene/world/movement/core/pointCheck.ts
    - src/scene/world/movement/core/volumeContainment.ts
    - src/scene/world/movement/core/movementRules.ts
    - src/scene/world/movement/core/bspCollisionTrace.ts
    - src/scene/world/movement/core/cylinderTrace.ts
    - src/scene/world/movement/core/volumeTrace.ts
    - src/scene/world/movement/core/staticMeshTrace.ts
    - src/scene/world/movement/core/terrainTrace.ts
    - src/scene/world/movement/core/collisionTrace.ts
    - src/scene/world/movement/core/convexHullClip.ts
    - src/scene/world/movement/core/residentPrimitives.ts
    - recipes/world/movement-native-rules.json
    - tests/unit/moveActor.test.ts
    - tests/unit/movementLineCheck.test.ts
    - tests/unit/movementPointCheck.test.ts
    - tests/fixtures/movement/movementCollisionFixtures.ts
    - tests/fixtures/movement/move-actor-bsp-wall.golden.json
    - tests/fixtures/movement/line-check-mixed-primitives.golden.json
  modified:
    - tests/support/nativeTileCollisionFixture.ts
    - tests/unit/importBoundaries.movement.test.ts
    - docs/parts/movement-geodata/EVIDENCE.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md
    - .planning/STATE.md

key-decisions:
  - "The core parses the rules document with guards; tests read the recipe file, and the ?raw runtime binding lands with the first runtime caller (row 632)"
  - "collisionTrace.ts, convexHullClip.ts and residentPrimitives.ts join the ten named core modules (row 633)"
  - "Mover state input is moverStates: exportIndex to closed or open, closed by default (row 634)"
  - "Brush volume box sweeps clip path-plane hulls with the brush box from 8 transformed corners (row 635)"
  - "volumesContaining returns every containing PhysicsVolume until VOLS carries the water flag (row 636)"
  - "Rules rows use the reference constant ids, movement.maxStepHeight and movement.minFloorZ among them (row 637)"
  - "Movement overlap: 83 blocking and 2,727 unreviewed runs recorded for the orchestrator review (row 638)"
  - "Tile clipping, MoveActor touches and actor flags stay open in EVIDENCE (row 639)"
  - "MOVE-01 and WORLD-08 stay Pending: the traces land, pawn physics is 02-66 and the runtime wiring 02-67 (row 641)"

requirements-completed: []

coverage:
  - id: D1
    description: "moveActor sweeps a cylinder against converted BSP collision with the 2-unit extension and the BSP box backoff, returns the full delta on a miss, moves a near-zero delta without a sweep, stops at a pawn cylinder, and pins five declared moves in a float32 golden trace reproduced byte for byte"
    requirement: MOVE-01
    verification:
      - kind: unit
        ref: "pnpm vitest run tests/unit/moveActor.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "singleLineCheck hits the nearest of a blocking volume, a static mesh triangle and a terrain quad; a hidden quad passes; EdgeTurnBitmap picks the split; movers collide closed by default and open on request; BSP rays split with the splitter normal; a box lands on lifted terrain; seven declared checks are pinned in a golden trace"
    requirement: MOVE-01
    verification:
      - kind: unit
        ref: "pnpm vitest run tests/unit/movementLineCheck.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "pointCheck sends an on-plane point to the back child, starts the outside bit at bRootOutside, overlaps box hulls, volumes, triangles, movers, terrain and pawns; volumesContaining returns the rotated, scaled physics volume and nothing outside it"
    requirement: MOVE-01
    verification:
      - kind: unit
        ref: "pnpm vitest run tests/unit/movementPointCheck.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every recipe row has a provenance and a shared status, none confirmed; malformed rows are refused"
    requirement: MOVE-01
    verification:
      - kind: unit
        ref: "pnpm vitest run tests/unit/moveActor.test.ts (movement native rules recipe)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The core imports only itself and src/shared, no package, and type-checks with the ES2022 library alone"
    requirement: MOVE-01
    verification:
      - kind: unit
        ref: "pnpm vitest run tests/unit/importBoundaries.movement.test.ts"
        status: pass
    human_judgment: false

duration: 27min
completed: 2026-11-10
---

# Phase 2 Plan 65: Movement core traces and MoveActor summary

Our own ULevel::MoveActor, SingleLineCheck, PointCheck and volume containment now run in float32 source units over the 02-48 collision world, across BSP trees, brush volumes, static mesh placements, movers, terrain heightmaps and pawn cylinders. Every numeric rule is an unconfirmed row in `recipes/world/movement-native-rules.json`, and synthetic golden traces pin the results. Nothing in the runtime calls the traces yet: 02-66 builds the pawn physics on them and 02-67 wires them in.

## Performance

- Duration: about 27 minutes (2026-11-10 06:51 to 07:18 Riga)
- Tasks: 3 of 3
- Files: 20 created, 6 modified

## Accomplishments

- `moveActor(world, actor, delta, rules, surroundings)` rounds the delta to float32 and skips the sweep when every component is under `collision.nearZeroDelta`. Otherwise it sweeps the actor box `(R, R, H)` along the delta lengthened by 2 units and converts the hit distance minus 2 back to the delta. A converted time over 1 counts as no hit. It returns the float32 location and the hit time, normal, primitive and declared source.
- `singleLineCheck` runs the same world sweep without the extension. Each primitive kind backs off by its row: BSP ray 0.5, BSP box `clamp(0.1 L', 0.1, 4)`, static mesh `clamp(0.1 L', 0.1, 1)`, terrain 0.5, pawn 0. The smallest backed-off time wins, and a tie goes to the primitive registered first.
- One tree walk serves the tile BSPT and brush volumes, carrying the bRootOutside outside bit. A ray enters the first solid region with the last splitter's normal facing the start. A box sweep collects the hull of the node just left, then clips it against the hull, box and bevel planes. BSPT hulls come from LeafHulls (flip bit, terminator, six box words). Volume hulls are the path planes plus the brush box from 8 transformed corners, with the brush in world space through the UE2 actor transform.
- Static mesh placements and movers clip each triangle against its bounds, both face planes and its edge planes. A ray takes the double-sided plane hit. Movers collide at the closed matrix unless `moverStates` marks them open.
- Terrain runs in heightmap space through the converter's CalcCoords. Triangles are lifted by the extent, only downward motion hits, EdgeTurnBitmap picks the split, and a QuadVisibilityBitmap 0 quad drops collision.
- `pointCheck` goes to the front child only when `d > 0` and stays separate from the visibility zone locate. A box point check walks hulls with the 1.1 push-out. `volumesContaining` returns the PhysicsVolumes around a point.
- Two golden traces cover five declared MoveActor moves against a synthetic BSP wall and seven declared line checks on a mixed chunk. Both compare at 0 float32 ulp.

## Task commits

1. Task 1, MoveActor of one cylinder against one BSP wall: `6345710` feat(02-65): sweep a cylinder against converted BSP collision through our own MoveActor port
2. Task 2, volumes, static meshes, terrain, line and point checks, containment: `c479252` feat(02-65): answer line, point and extent checks over volumes, static meshes, movers and terrain, and volume containment
3. Rule id alignment: `ea59f54` refactor(02-65): name the movement rules rows by the reference constant ids
4. Task 3, overlap check, evidence and ownership: `e1d6efa` docs(02-65): record the trace and MoveActor evidence, the movement-geodata status line and decision rows 632 to 640

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] The core cannot import the recipe**
- Found during: Task 1
- Issue: the plan has `movementRules.ts` load the recipe through a typed import. The movement boundary test refuses any import from the core outside itself and `src/shared`, and it type-checks the core with no Vite `?raw` support.
- Fix: `parseMovementNativeRules(document)` in the core guards every row. The tests read the recipe file. The `?raw` runtime binding comes with its first runtime caller (row 632).
- Commit: 6345710

**2. [Rule 2 - DRY] Three shared core modules**
- Found during: Tasks 1 and 2
- Issue: the BSP, volume and mesh traces share hull clipping, the trace types and one primitive order for ties.
- Fix: added `collisionTrace.ts`, `convexHullClip.ts` and `residentPrimitives.ts`. `lineCheck.ts` was created in Task 1 because `moveActor` needs the world sweep (row 633).
- Commits: 6345710, c479252

**3. [Rule 1 - Bug] Negated normals carried -0**
- Found during: Task 2
- Issue: `negateVector` turned 0 into -0, so a static mesh normal read `{x: -0, y: -0, z: 1}`.
- Fix: negation subtracts from 0.
- Commit: c479252

**4. [Rule 1 - Consistency] Rule ids**
- Found during: Task 3
- Issue: the first recipe used kebab ids, while the plan, `docs/NATIVE_BSP_FLOOR.md` and the reference table name `movement.maxStepHeight` and `movement.minFloorZ`.
- Fix: the recipe uses the reference ids (row 637).
- Commit: ea59f54

**5. [Scope] Shared fixture helpers**
- `tests/support/nativeTileCollisionFixture.ts` now exports `boxHalfExtent`, `boxPlanes` and `boxFacePolygon`, so the movement fixtures build volumes with the same box.

**Total deviations:** 4 auto-fixed plus 1 scope note. **Impact:** no behaviour beyond the plan. The rules binding moves to the first runtime caller.

## Reference overlap (DEC-OWN-12)

`node tools/reference-overlap/referenceOverlap.mjs --area movement --reference-root C:/laragon/www/l2-browser-client` exits 1.

- Area: movement.
- Blocking runs: 83, all in 02-65 files. bspCollisionTrace.ts has 31, volumeTrace.ts 11, cylinderTrace.ts 8, collisionTrace.ts 7, staticMeshTrace.ts 6, terrainTrace.ts 6, convexHullClip.ts 3, lineCheck.ts 3, moveActor.ts 3, movementRules.ts 3, pointCheck.ts 1 and volumeContainment.ts 1.
- Unreviewed reviewer runs: 2,727 in 02-65 files, out of 2,734 in the area.
- Report: local `artifacts/plan-starts/02-65-reference-overlap-movement.json` (gitignored; rerun the command to reproduce it).
- Most matches are generic token shapes in unrelated reference files, such as skill effect hosts, fishing floats and animation mixers. The largest run is 39 tokens: the float32 vector rounding in collisionTrace.ts against un-model.ts and zone-object.ts. bspCollisionTrace.ts lines 59 to 61 (34 tokens, the near and far child choice of the ray split) match `src/physics/volume-bsp.ts:61`.
- No rows were added to signedOffRuns or reviewedRuns. The orchestrator runs the independent review.

## Verification

- `pnpm typecheck` clean.
- `pnpm vitest run tests/unit/moveActor.test.ts tests/unit/movementLineCheck.test.ts tests/unit/movementPointCheck.test.ts tests/unit/importBoundaries.movement.test.ts`: 42 tests pass. Together with the three 02-48 collision tests, 106 movement tests pass.
- Tracer gate: the Task 1 verify ran again after the Task 1 commit and passed before the expansion work.
- `grep -rn -i "recast\|navmesh\|moveWithCollisions\|rapier" src/scene/world/movement` prints nothing.
- Every recipe row has a provenance and a shared status, checked by the recipe test. There are 29 rows: unconfirmed, ue2-data or unknown, with no confirmed row.
- `grep -c "MoveActor" docs/parts/movement-geodata/EVIDENCE.md` prints 5.
- `pnpm test:unit` (2026-11-10 07:14 Riga, low priority): 2,543 passed, 59 skipped, 1 failed. The failure is `laneOwnership.test.ts` "has an evidence doc for world under 30 KB": `docs/parts/world/EVIDENCE.md` has been 30,917 bytes since 02-63, and this plan did not touch it. It is logged under Open follow-ups (row 640).
- `check-lane-ownership.mjs --base 54c8bf9 --part movement-geodata` names 3 foreign paths: `.planning/OVERNIGHT-DECISIONS.md`, `.planning/STATE.md` and `STATUS.md`. These are the integration-owned process files listed in the plan's files_modified, accepted as in row 525. Every code, test, fixture, recipe and doc path is in the world lane.
- Process cleanup: this plan started no dev server, preview, Playwright or browser. Vitest and tsc ran in the foreground and exited. No process has `autonomous-roadmap` in its command line, and nothing listens on 5173 or 5175.

## Known stubs

None. The traces have no runtime caller yet, as the plan states: 02-66 and 02-67 add the callers.

## Threat flags

None beyond the plan's register. T-02-65-01 is mitigated by finite and non-negative input guards, the walk depth bounded by the node count, the hull plane limit and the LeafHulls terminator and box guards. T-02-65-02 is mitigated because every numeric rule is a row with a provenance and a status, and the parser refuses anything else.

## Self-Check: PASSED

- All 20 created files exist.
- Commits 6345710, c479252, ea59f54 and e1d6efa are ancestors of HEAD.
