---
phase: 02-stage-a-breadth
plan: 66
subsystem: movement-geodata
tags: [move-01, world-05, apawn, step-up, falling, swimming, flying, calc-behind-view, click-trace, movement-presenter, golden-trace, dec-own-12]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-58 move, stop, correct, teleport events and report-position, cannot-move commands in source units; 02-65 moveActor, singleLineCheck, volumesContaining, the rules parser and the movement fixtures"
provides:
  - "src/scene/world/movement/movementPresenter.ts: createMovementPresenter, MovementPresenter, MovementPresenterError, MovementIntent, MovementPawnInspection"
  - "src/scene/world/movement/core/pawnPhysics.ts: advancePawnSimulation, PawnSimulation, PawnTraits, PawnMoveGoal"
  - "src/scene/world/movement/core/pawnWalking.ts: walkPawn; pawnStepUp.ts: stepUpPawn, twoWallAdjust, slideAlongSurface; pawnFalling.ts: fallPawn; pawnSwimming.ts: swimPawn; pawnFlying.ts: flyPawn"
  - "src/scene/world/movement/core/pawnVelocity.ts: calculatePawnVelocity, currentPawnSpeed, hasPawnArrived, PawnSpeeds; pawnRotation.ts: headingOfDirection, yawStepForTick, turnYawTowards"
  - "src/scene/world/movement/core/positionReports.ts: advancePositionReports"
  - "src/scene/world/movement/core/behindViewCamera.ts: calculateBehindView; clickTrace.ts: traceClickDestination"
  - "recipes/world/movement-native-rules.json: 69 rows (40 new pawn, report, camera and click rows)"
affects: [02-67, phase-4-net, pol-04]

estimate:
  tokens: 100000
  tasks: 3
actuals:
  tokens: 70000
  tasks: 3
  commits: 4
plan_head_before: 213277a6d579fefef179bf487a92315d695e0fbb
plan_head_after: 59d6f10

tech-stack:
  added: []
  patterns:
    - "Pawn modes are pure functions (context, body, velocity, dt) -> {body, unusedSeconds}; pawnPhysics owns the substep loop and nests mode changes"
    - "Synthetic pawn worlds are BlockingVolume and PhysicsVolume boxes built by tests/fixtures/movement/pawnWorldFixtures.ts"
    - "The presenter keeps all pawn state inside itself and leaves only through reportIntent and inspection()"

key-files:
  created:
    - src/scene/world/movement/movementPresenter.ts
    - src/scene/world/movement/core/pawnBody.ts
    - src/scene/world/movement/core/pawnPhysics.ts
    - src/scene/world/movement/core/pawnWalking.ts
    - src/scene/world/movement/core/pawnStepUp.ts
    - src/scene/world/movement/core/pawnFalling.ts
    - src/scene/world/movement/core/pawnSwimming.ts
    - src/scene/world/movement/core/pawnFlying.ts
    - src/scene/world/movement/core/pawnVelocity.ts
    - src/scene/world/movement/core/pawnRotation.ts
    - src/scene/world/movement/core/positionReports.ts
    - src/scene/world/movement/core/behindViewCamera.ts
    - src/scene/world/movement/core/clickTrace.ts
    - tests/unit/pawnWalking.test.ts
    - tests/unit/pawnPhysicsModes.test.ts
    - tests/unit/behindViewCamera.test.ts
    - tests/unit/movementPresenter.test.ts
    - tests/fixtures/movement/pawnWorldFixtures.ts
    - tests/fixtures/movement/pawn-walking-turn.golden.json
    - tests/fixtures/movement/pawn-step-up.golden.json
    - tests/fixtures/movement/pawn-falling-ledge.golden.json
    - tests/fixtures/movement/pawn-swimming.golden.json
    - tests/fixtures/movement/pawn-flying.golden.json
  modified:
    - src/scene/world/movement/core/movementRules.ts
    - recipes/world/movement-native-rules.json
    - tests/fixtures/movement/movementCollisionFixtures.ts
    - tests/unit/importBoundaries.movement.test.ts
    - docs/parts/movement-geodata/EVIDENCE.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "The presenter reads speeds walk and run (required) and swimWalk, swimRun, flyWalk, flyRun, nonAttackSpeedRate (optional); a pawn without speeds for its environment is held as speed-unresolved (row 671)"
  - "moveType 1 reads as run (PMT_FAST) through row movement.runMoveType until Phase 4 (row 672)"
  - "Record positions are feet and collision.height is the half-height; the centre is the position plus H (row 673)"
  - "stop snaps a remote pawn beyond 200 units, correct snaps, teleport raises the feet by H + 10 and falls; timers and floor search stay MOVE-02 (row 674)"
  - "Every containing PhysicsVolume counts as water until VOLS carries WaterVolumes (row 675)"
  - "A pawnTraits callback supplies the local player flag, the run start frames and flying (row 676)"
  - "pawnBody, pawnPhysics and positionReports join the core; all rows and falling landed in Task 1 (row 677)"
  - "stepUp ceiling faces, the hit-check-only CalcBehindView and the MoveTimer read before the tick follow the reference notes (row 678)"
  - "Movement overlap: 121 blocking and 2,546 unreviewed runs recorded for the orchestrator review (row 679)"
  - "MOVE-01 and WORLD-05 stay Pending until 02-67 wires the port (row 680)"

requirements-completed: []

coverage:
  - id: T1
    description: "A move event on a synthetic floor walks the pawn to its goal through moveActor and the floor band, turning at the fixed yaw rate; report-position every second plus one after the stop; one cannot-move when a wall blocks; collision-not-ready holds the pawn; stop, correct, teleport and the remote snap; malformed records and unknown entities refused"
    requirement: MOVE-01
    verification:
      - kind: unit
        ref: "pnpm vitest run tests/unit/movementPresenter.test.ts tests/unit/pawnWalking.test.ts"
        status: pass
    human_judgment: false
  - id: T2
    description: "stepUp climbs a 10-unit step and is blocked by a 20-unit one, slides along a wall, resolves a corner without tunnelling; a 300-unit ledge fall lands in the floor band; swimming in a water volume, water entry and exit; flying ignores the floor probe and steps over a low obstacle; five golden traces at 0 ulp"
    requirement: MOVE-01
    verification:
      - kind: unit
        ref: "pnpm vitest run tests/unit/pawnPhysicsModes.test.ts tests/unit/pawnWalking.test.ts"
        status: pass
    human_judgment: false
  - id: T3
    description: "calculateBehindView puts the camera at min(D, h) - 30 in front of a wall and at D - 30 with no hit; traceClickDestination returns the floor hit, null for the sky, and the ray end while swimming or flying"
    requirement: MOVE-01
    verification:
      - kind: unit
        ref: "pnpm vitest run tests/unit/behindViewCamera.test.ts"
        status: pass
    human_judgment: false
  - id: T4
    description: "The core, now 28 modules, imports only itself and src/shared and type-checks with the ES2022 library alone"
    requirement: MOVE-01
    verification:
      - kind: unit
        ref: "pnpm vitest run tests/unit/importBoundaries.movement.test.ts"
        status: pass
    human_judgment: false
  - id: T5
    description: "The sandbox walks a converted tile through the MOVE-01 port"
    requirement: WORLD-05
    verification:
      - kind: e2e
        ref: "02-67 runtime wiring"
        status: pending
    human_judgment: false

duration: 20min
completed: 2026-11-10
---

# Phase 2 Plan 66: Pawn physics, follow camera and movement presenter summary

The MOVE-01 port now moves pawns in the movement core: APawn walking with the floor probe and the floor gap band, stepUp with the wall slide and twoWallAdjust, falling, swimming and flying, calcVelocity with no ramp, GetCurSpeed with the MoveTimer run start and fixed-rate yaw, all on raw frame `dt` with the native substeps and every step through `moveActor`. CalcBehindView pulls the camera in front of walls, the click trace casts into the same collision world, and the movement presenter applies the server's move, stop, correct and teleport records per entity and sends position reports as intents. Nothing in the runtime calls it yet: 02-67 wires it.

## Performance

- Duration: about 20 minutes (2026-11-10 11:12 to 11:32 Riga)
- Tasks: 3 of 3
- Files: 23 created, 7 modified

## Accomplishments

- `advancePawnSimulation` caps the frame at 0.4 s and 8 iterations, gives walking the whole remainder (split into `min(0.05, rest / 2)` for the local player) and other modes `min(0.05, rest / 2)`, resolves flying and water first, and continues a mode change with the unused time under the 0.0003 s and 7-call limits.
- Walking moves through `moveActor`, runs stepUp on a hit, probes 12 units down with the pawn box and settles the gap into [1.9, 2.4] at 2.15, slides down steep floors it moves into and hands its unused time to falling when the floor ends.
- stepUp lifts 10 on step faces, recurses on near-vertical hits, slides and runs twoWallAdjust, and steps down. Falling uses the volume gravity rows and lands, slides or enters water. Swimming moves in 3D and leaves the water with the exit speed. Flying ignores the floor probe and steps over low near-vertical hits.
- `calculateBehindView` uses the float32 sine table direction and the 0.1 box hit check. `traceClickDestination` reaches the loaded bounds or 10000 units while swimming or flying.
- `createMovementPresenter({collisionWorld, rules, reportIntent, pawnTraits})` guards every record field, refuses unknown entities by name, snaps remote pawns beyond 200 units, holds pawns on unloaded collision as `collision-not-ready`, and emits `report-position` (every second plus one after the stop) and one `cannot-move` (under 2 units in 0.6 s) for the local pawn. It never writes entity state; `inspection()` exposes position, heading, mode and floor.
- 40 rule rows join `recipes/world/movement-native-rules.json`, all unconfirmed, ue2-data or unknown. Five golden traces pin walking with the run start, the step climb, the ledge fall, swimming and flying on synthetic box-volume worlds.

## Task commits

1. Task 1, one move event walks a pawn to its goal through the port (tracer): `96ef1f9` feat(02-66): walk a pawn to its server move goal through the MOVE-01 port
2. Task 2, stepUp, falling, swimming, flying, the follow camera and the click trace: `4c49a4d` feat(02-66): add stepUp, falling, swimming, flying, CalcBehindView and the click trace to the movement core
3. Task 3, overlap check, evidence, ownership and cleanup: `59d6f10` docs(02-66): record the pawn physics, follow camera and movement presenter evidence, the movement-geodata status line and decision rows 671 to 680

Two orchestrator review commits (`a707ee6`, `cbd9a86`) landed on the branch between the plan start and Task 1; they touch only `tools/reference-overlap/**` and `.planning/STATE.md`.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 2 - Single responsibility] Three more core modules**
- Found during: Task 1
- Issue: the nine named modules had no shared home for the pawn body types, the substep loop or the reporter, and the presenter would otherwise hold physics logic.
- Fix: `pawnBody.ts`, `pawnPhysics.ts` and `positionReports.ts` (row 677).
- Commits: 96ef1f9, 4c49a4d

**2. [Rule 3 - Blocking] Falling and every rule row landed in Task 1**
- Found during: Task 1
- Issue: walking hands its unused time to falling, and the rules parser reads all rows as one document.
- Fix: a basic `fallPawn` and all 40 rows in Task 1; Task 2 added water entry and twoWallAdjust to falling and wired stepUp into walking (row 677).
- Commit: 96ef1f9

**3. [Rule 1 - Bug] Teleport raise and run start timing**
- Found during: Task 1
- Issue: the teleport raised the feet by 10 instead of H + 10, and reading MoveTimer after the tick increment started the run one tick early (101.58 instead of 101 units).
- Fix: the feet rise by `H + teleportRaise`, and GetCurSpeed reads the MoveTimer value before the tick (row 678).
- Commit: 96ef1f9

**4. [Rule 2 - No dead code] The click reach row has a caller**
- Found during: Task 2
- Issue: `click.pickLength` would only be read by tests if the caller passed the ray length.
- Fix: `traceClickDestination` takes `loadedBoundsLength` and `swimsOrFlies` and uses the row itself, returning the ray end when nothing is hit while swimming or flying.
- Commit: 4c49a4d

**5. [Scope] The flying mode is entered through pawnTraits**
- No movement record selects flying yet, so the presenter takes it from `pawnTraits(entityId).flies` (row 676).

**Total deviations:** 4 auto-fixed plus 1 scope note. **Impact:** no behaviour beyond the plan.

## Reference overlap (DEC-OWN-12)

`node tools/reference-overlap/referenceOverlap.mjs --area movement --reference-root C:/laragon/www/l2-browser-client` exits 1 (2026-11-10 11:31 Riga).

- Area: movement.
- Blocking runs: 121, all in 02-66 files: pawnStepUp.ts 38, movementPresenter.ts 26, pawnPhysics.ts 16, pawnWalking.ts 13, clickTrace.ts 6, behindViewCamera.ts 5, pawnFlying.ts 5, pawnBody.ts 3, pawnRotation.ts 3, positionReports.ts 3, pawnVelocity.ts 2, pawnFalling.ts 1.
- Unreviewed reviewer runs: 2,546, all in 02-66 files.
- Longest runs: 31 tokens in movementPresenter.ts (guard and signature shapes) against `collision-octree.ts:130` and `un-conf-hair.ts:45`; 29 tokens in positionReports.ts and movementPresenter.ts (the 3D distance helper) against `bsp-collider.ts:135`. Most matches are generic shapes in unrelated reference files (skill effect placement, animation mixers, shadow projectors); 9 runs match `pawn-movement-component.ts`.
- Report: local `artifacts/plan-starts/02-66-reference-overlap-movement.json` (gitignored; rerun the command to reproduce it).
- No rows were added to signedOffRuns or reviewedRuns. The orchestrator runs the independent review.

## Verification

- `pnpm typecheck` clean.
- `pnpm vitest run tests/unit/pawnWalking.test.ts tests/unit/pawnPhysicsModes.test.ts tests/unit/behindViewCamera.test.ts tests/unit/movementPresenter.test.ts tests/unit/importBoundaries.movement.test.ts`: 66 tests pass.
- TDD red: both task test sets failed on the missing modules before the implementation.
- Tracer gate: the Task 1 verify (schedule check, typecheck, the two test files, `grep -c "moveActor(" pawnWalking.ts` = 3) ran again after the Task 1 commit and passed before Task 2.
- `grep -c -E "maxStepHeight|minFloorZ" recipes/world/movement-native-rules.json` prints 2; `grep -c "movement presenter" docs/parts/movement-geodata/EVIDENCE.md` prints 4.
- `pnpm test:unit` (2026-11-10 11:29 Riga, nice 10): 191 files pass, 3 skipped; 2,514 tests pass, 59 skipped, none failed.
- `check-lane-ownership.mjs --base 213277a --part movement-geodata` names 7 foreign paths. `.planning/OVERNIGHT-DECISIONS.md`, `.planning/STATE.md` and `STATUS.md` are the integration-owned process files in the plan's files_modified, accepted as in row 525. `tools/reference-overlap/reviewedRuns/{bsp-visibility,movement,particles}.json` and `tools/reference-overlap/signedOffRuns.json` (and the earlier STATE line) come from the orchestrator commits a707ee6 and cbd9a86, not from this plan. Every code, test, fixture, recipe and doc path of this plan is in the world lane.
- The prohibition holds: the wall test pins the pawn at `y = 0` in front of the wall, so the client adds no route around it.
- Process cleanup: this plan started no dev server, preview, Playwright or browser. The full unit suite ran in the background and exited (exit 0); typecheck and the targeted Vitest runs ran in the foreground and exited. Nothing listens on 5173 or 5175, and the only node processes are three pre-existing service-session processes that this plan did not start.

## Known stubs

None. The presenter has no runtime caller yet, as the plan states: 02-67 wires it.

## Threat flags

None beyond the plan's register. T-02-66-01 is mitigated by finite and range guards on positions, headings, moveType, the cylinder, the offset, every speed and the frame time, and by `MovementPresenterError` naming an unknown entity. T-02-66-02 is mitigated because the presenter holds pawn state internally and only emits intents through `reportIntent`.

## Self-Check: PASSED

- All 23 created files exist.
- Commits 96ef1f9, 4c49a4d and 59d6f10 are ancestors of HEAD.
