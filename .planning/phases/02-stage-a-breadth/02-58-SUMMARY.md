---
phase: 02-stage-a-breadth
plan: 58
subsystem: adapter-dispatch
status: complete
tags: [adapter, world-types, record-types, account-session, sandbox, d6, d1]
requires:
  - phase: 02-stage-a-breadth
    provides: equipment slot contract and sandbox command helpers (02-41), src/world/sourceFrame.ts (02-56)
provides:
  - src/world/worldTypes.ts events command-rejected, environment, move, stop, correct, teleport; commands report-position, cannot-move; optional metre origin on move-local; EntityKind npc
  - src/world/AccountSession.ts AccountSession and AccountSessionState (types only)
  - src/world/sandboxCommands.ts reportedPositionRejectionReason, commandRejectedEvent, reportedPositionNotFiniteReason, reportedHeadingNotIntegerReason
  - NativeSliceAdapter handling of report-position (stores the converted position, no event) and cannot-move (one stop event)
affects: [02-48, 02-65, 02-66, 02-67, 02-68, 02-69, phase-4-net]
tech-stack:
  added: []
  patterns:
    - "Movement records and intents carry source units (SourcePosition, integer heading); WorldEntity and move-local stay metres"
    - "A recognised command the sandbox cannot apply emits command-rejected with a named reason constant instead of throwing"
key-files:
  created:
    - src/world/AccountSession.ts
    - tests/unit/worldRecordTypes.test.ts
  modified:
    - src/world/worldTypes.ts
    - src/world/NativeSliceAdapter.ts
    - src/world/sandboxCommands.ts
    - src/entities/EntityRegistry.ts
    - tests/unit/gameWorldAdapterContract.test.ts
    - tests/unit/nativeSliceAdapter.test.ts
    - docs/parts/adapter-dispatch/EVIDENCE.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md
decisions:
  - "Plan 02-58: the sandbox adapter stores a reported position without an event, answers cannot-move with one stop and rejects a non-finite position or non-integer heading with command-rejected (OVERNIGHT-DECISIONS row 369, owner review under ARCH-02)"
  - "Plan 02-58: move-local origin is optional and ignored by the sandbox, so existing dispatchers stay valid in the contract commit (row 370)"
  - "Plan 02-58: move speeds is Readonly<Record<string, number>> and the pre-world states carry only their stage; field names wait for the Mobius classes in Phase 4 (row 371)"
  - "Plan 02-58: EntityRegistry returns for every event but update, in the contract commit (row 372)"
metrics:
  duration: 6min
  completed: 2026-11-09
  tasks: 2
  files: 12
commits: 2
plan_head_before: 903531ca2fa95f358b4a76c33210b8148d0377eb
plan_head_after: 833abfa94b9e1655162ba1a2ca093f6134ecde26
actuals:
  tokens: 14000
  tasks: 2
  commits: 2
---

# Phase 2 Plan 58: Adapter record types contract commit Summary

One contract commit adds the DEC-OWN-12 D6 records (six events, two source-unit intents, a metre origin on move-local, EntityKind npc) and the types-only pre-world `AccountSession`, with the five `GameWorldAdapter` methods unchanged and the sandbox adapter answering report-position and cannot-move.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | D6 record types and AccountSession in one commit, cannot-move through the sandbox adapter (tracer, TDD) | 2f0ed2e | src/world/worldTypes.ts, src/world/AccountSession.ts, src/world/NativeSliceAdapter.ts, src/world/sandboxCommands.ts, src/entities/EntityRegistry.ts, tests/unit/gameWorldAdapterContract.test.ts, tests/unit/worldRecordTypes.test.ts, tests/unit/nativeSliceAdapter.test.ts |
| 2 | Evidence, ownership and cleanup | 833abfa | docs/parts/adapter-dispatch/EVIDENCE.md, STATUS.md, .planning/OVERNIGHT-DECISIONS.md |

## What landed

- Events: `command-rejected {commandType, reason}`, `environment {gameMinutes, environmentType}`, `move {entityId, origin, destination, targetId?, offset?, moveType, speeds, collision {radius, height}}`, `stop {entityId, position, heading}`, `correct {entityId, position, heading}`, `teleport {entityId, position}`. Positions on the movement records are `SourcePosition` (D1).
- Commands: `report-position {position, heading}` and `cannot-move {position, heading}` in source units; `move-local` gains `origin?` in metres.
- `WorldEntity["kind"]` includes `npc`.
- `AccountSessionState` is `login | server-list | character-selection | in-world`; only `in-world` carries `world: GameWorldAdapter`. `AccountSession {state(); subscribe(listener)}`.
- `NativeSliceAdapter`: `report-position` replaces the local player's stored position via `sourcePositionToWorld` and emits nothing; `cannot-move` clears the sandbox destination, stores the position and the yaw from `sourceHeadingToWorldYaw`, and emits one `stop` with the reported source position and heading. Invalid reports emit `command-rejected` with `reported-position-not-finite` or `reported-heading-not-integer`. An unknown command type still throws `RangeError` naming the type (the exhaustive `never` default).

## Verification

- TDD red: the three new adapter cases failed (`RangeError: Unknown world command type: report-position`) before the implementation.
- `node scripts/check-machine-schedule.mjs && pnpm typecheck`: clean (expectTypeOf cases in `worldRecordTypes.test.ts` and the contract test are checked by tsc).
- `pnpm vitest run tests/unit/gameWorldAdapterContract.test.ts tests/unit/worldRecordTypes.test.ts tests/unit/nativeSliceAdapter.test.ts tests/unit/importBoundaries.test.ts`: 4 files, 33 tests pass.
- `pnpm vitest run` (full unit suite): 146 files pass, 5 skipped; 1,937 tests pass, 82 skipped, no failure.
- `grep -c` of the eight record names in `worldTypes.ts`: 8.
- `node scripts/check-lane-ownership.mjs --base 903531c --part adapter-dispatch`: lane integration, 0 foreign paths.
- `grep -c "report-position" docs/parts/adapter-dispatch/EVIDENCE.md`: 2.
- Tracer gate (auto mode): verify re-run end to end on the committed tree, passed before Task 2.

## Requirements

- MOVE-01, MAT-02, FX-01: Pending. This plan lands only the records these requirements consume (movement events and intents, the environment event, EntityKind npc); their converters and runtimes land in later plans, so none is marked complete.
- ARCH-02 (already complete): the D6 contract commit and `AccountSession` named in its text now exist.
- Prohibition MOVE-01 (no GameWorldAdapter method change): resolved by test; the contract test still pins exactly the five methods and their signatures.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] EntityRegistry narrowing in the contract commit**
- **Found during:** Task 1
- **Issue:** `EntityRegistry.apply` treated every event after spawn, despawn and skill-cast as `update` and read `event.entity`; the new events have no entity, so typecheck failed.
- **Fix:** `if (event.type !== "update") return;` replaces the skill-cast return. No behaviour change for the existing events.
- **Files modified:** src/entities/EntityRegistry.ts (integration-owned, unclaimed)
- **Commit:** 2f0ed2e. The acceptance line "the contract commit lists only `src/world/**` and `tests/unit/**`" therefore holds except for this one line (row 372).

**2. [Rule 3 - Blocking] move-local origin is optional**
- **Found during:** Task 1
- **Issue:** a required `origin` would break every dispatcher in `src/entities/attachTargeting.ts`, `src/scene/world/nativeDoorInteractions.ts`, `tests/browser/**` and `tests/support/**` inside the contract commit.
- **Fix:** `origin?: WorldPosition`; the sandbox ignores it (row 370).
- **Commit:** 2f0ed2e

**3. [Docs] Evidence size**
- The adapter-dispatch EVIDENCE was 30.6 KB before this plan; older bullets (02-59 census per-class counts, reference-overlap test lists, escalated runs, materials open runs) were condensed so the file stays near 30 KB (31.3 KB) with the 02-58 records added.

### Run-environment notes

- Heavy commands ran at normal priority: the worktree isolation refuses PowerShell wrappers, so the BelowNormal prefix could not be applied. The full unit run took 24 s.
- The GSD plan ledger in the shared `.git/worktrees` directory could not be written from this isolated session; the base `903531c` is recorded in `artifacts/plan-starts/02-58.sha` and above.

## Known Stubs

- `src/world/AccountSession.ts` is types only by design (D6 puts it in the contract commit); Phase 4 implements it against Mobius (NET-02, NET-04). No runtime consumer yet.

## Threat Flags

None. The new intents enter only the sandbox adapter (T-02-58-02); the contract test enumerates every command and event type and the five methods (T-02-58-01).

## Process cleanup

This plan started only `pnpm typecheck` and `pnpm vitest run` processes, each in the foreground and finished. No dev server, preview or browser was started. `netstat` shows no listener on 5173 or 5175; the node processes still running date from 2026-10-29 and are not from this plan.

## Self-Check: PASSED

- FOUND: src/world/AccountSession.ts, tests/unit/worldRecordTypes.test.ts, docs/parts/adapter-dispatch/EVIDENCE.md
- FOUND: 2f0ed2e, 833abfa (ancestors of HEAD)
