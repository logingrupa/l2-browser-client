---
phase: 01-foundations
plan: 10
subsystem: world-contract
status: complete
tags: [game-world-adapter, contract-test, sandbox, spawn-npc, equip-item, cast-skill, ARCH-02, SAND-01]
requires:
  - phase: 01-foundations
    provides: "native runtime split with the shirt buttons in attachNativeSliceCharacterSheet.ts (plan 01-05)"
provides:
  - tests/unit/gameWorldAdapterContract.test.ts (type-level and runtime contract test for the five frozen methods)
  - src/world/sandboxCommands.ts (isLineageIdentifier, createSpawnedNpcEntity, entityWithClampedHealth, entityWithEquippedItem, skillCastEvent)
  - "WorldCommand spawn-npc, equip-item, cast-skill; WorldEvent skill-cast; WorldEntity npcId; EquipmentSlot"
affects: [plan 01-11 missing-asset diagnostic and load-missing-model removal, plan 01-14 sandbox sheet section, plan 01-15 import-boundary checks, Phase 4 server adapters]
actuals:
  tokens: 12100
  tasks: 2
  commits: 2
plan_head_before: 596237b4a1a581f86f77e47f676d239a5164849d
plan_head_after: 015190186823ec157c9345b935a332f16663c3d2
tech-stack:
  added: []
  patterns:
    - "Both adapters share pure command helpers in src/world/sandboxCommands.ts that take the entity map and a command and return the new entity or event, or null to emit nothing"
    - "The adapter contract is guarded by expectTypeOf in a test file, so pnpm typecheck fails when GameWorldAdapter changes"
key-files:
  created:
    - src/world/sandboxCommands.ts
    - tests/unit/gameWorldAdapterContract.test.ts
    - tests/unit/sandboxCommands.test.ts
  modified:
    - src/world/GameWorldAdapter.ts
    - src/world/worldTypes.ts
    - src/world/MockWorldAdapter.ts
    - src/world/NativeSliceAdapter.ts
    - src/entities/EntityRegistry.ts
    - src/runtime/attachNativeSliceCharacterSheet.ts
    - tests/unit/nativeSliceAdapter.test.ts
    - tests/unit/nativeLocomotion.test.ts
    - tests/unit/nativeSpecialAttackPreview.test.ts
    - tests/unit/navigationContact.test.ts
    - .planning/OVERNIGHT-DECISIONS.md
key-decisions:
  - "Command handling shared by both adapters lives in src/world/sandboxCommands.ts as pure functions, so the two adapters cannot drift"
  - "spawn-npc entity ids are npc-<npcId>-<n> with a per-adapter counter that advances only when a spawn is emitted"
  - "Equipping the item already in a slot, or clearing an empty slot, emits nothing"
  - "MockWorldAdapter now handles set-health through the clamp it shares with NativeSliceAdapter (OVERNIGHT-DECISIONS row 31)"
  - "NativeSliceAdapter without navigation places the n-th NPC 1.4 m times n along x from the player, reusing the Musveren spacing as sandboxActorSpacingMetres (row 31)"
metrics:
  duration: 12 min
  completed: 2026-11-08
---

# Phase 1 Plan 10: Adapter contract test and by-ID sandbox commands Summary

The five `GameWorldAdapter` methods are now pinned by an `expectTypeOf` contract test that `pnpm typecheck` enforces, and both adapters handle `spawn-npc`, `equip-item` and `cast-skill` by L2 ID with no server. They emit a spawned entity carrying `npcId`, an update with equipment by slot, and a `skill-cast` record. Neither adapter computes damage or stats.

## What was built

- `tests/unit/gameWorldAdapterContract.test.ts`: `expectTypeOf<keyof GameWorldAdapter>()` equals the five names, and one `toEqualTypeOf` per method signature. A runtime case types `MockWorldAdapter` and `NativeSliceAdapter` as `GameWorldAdapter` and calls all five methods once. Unsubscribe stops delivery, `advance(0)` works, and `dispatch` after `dispose` emits nothing.
- Negative check, done once and reverted before the commit: adding `sixthContractProbe?(): void` to the interface made `pnpm typecheck` fail with `error TS2344` at `gameWorldAdapterContract.test.ts(14,58)`.
- `worldTypes.ts`: `EquipmentSlot = "upper"`, `WorldEntity.npcId`, `equipment: Readonly<Partial<Record<EquipmentSlot, number>>>`, the commands `spawn-npc`, `equip-item` (replaces `equip-upper`) and `cast-skill`, and the event `skill-cast`. The wrong "left-handed" header and every other comment are gone.
- `src/world/sandboxCommands.ts`: validation and record building shared by both adapters. IDs must be safe non-negative integers and the level must be at least 1. The equip target is `entityId` or the local player. A cast needs a living local caster and, when `targetId` is given, a living target.
- `EntityRegistry.apply` ignores `skill-cast` because no presentation for it exists yet.
- The native sheet's Leather shirt and Starter shirt buttons dispatch `equip-item` with slot `upper`, and their variable source text names the new command.
- `NativeSliceAdapter.ts` has no comments left. The APawn notes became `velocityWithoutAccelerationRampRoutine` and `runStartAtWalkSpeedRoutine`, now part of the shown `ACIS_HUMAN_FIGHTER_SPEED.source` text together with the humanFighter.xml provenance that was in the removed comment. `moveTimer` became `secondsMovingSinceRest`, and `atWalk` became `secondsAtWalkSpeed`.

## Verification

- `pnpm typecheck`: 0 errors.
- Focused run, 8 files and 80 tests passed: `sandboxCommands`, `nativeSliceAdapter`, `nativeLocomotion`, `gameWorldAdapterContract`, `nativeSpecialAttackPreview`, `navigationContact`, `world` and `nativeSliceAdapterSpeed`.
- `pnpm test:unit` (BelowNormal): 113 files passed, 5 skipped, 2 failed. The 2 failing files are the known pre-existing failures: `editorGeometryCompat.test.ts` at collection and 2 cases of `nativeNpcProfiles.test.ts`. Tests: 1488 passed, 82 skipped, 2 failed.
- Playwright `tests/browser/nativeSlice.spec.ts` with `DEV_PORT=5175` (SwiftShader): 3 passed in 2.3 min. That includes the Leather Shirt equipment case driven by the new `equip-item` button.
- Acceptance greps: `equip-upper` in src and tests 0; `"skill-cast"` and `"cast-skill"` in worldTypes 1 each; "left-handed" in worldTypes 0; comment lines in GameWorldAdapter, worldTypes, MockWorldAdapter, NativeSliceAdapter, sandboxCommands and EntityRegistry 0.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `EntityRegistry.apply` assumed every non-spawn, non-despawn event was an update**
- **Found during:** Task 2 (the first typecheck with `skill-cast` in `WorldEvent`)
- **Issue:** TS2339 on `event.entity` in `src/entities/EntityRegistry.ts`
- **Fix:** return early on `skill-cast`. Every comment in the file was removed under AGENTS.md, and the update loop's locals were renamed to `interpolatedPosition`, `supportedPosition` and `pivotClearanceAboveSupport`.
- **Commit:** 0151901

**2. [Rule 2 - Missing functionality] MockWorldAdapter ignored the contract command `set-health`**
- **Found during:** Task 2 (the dead-target and dead-caster cast cases must run on both adapters)
- **Fix:** both adapters handle it through `entityWithClampedHealth`, keeping the native clamp unchanged (OVERNIGHT-DECISIONS row 31)
- **Commit:** 0151901

**3. [Rule 3 - Blocking] Two more tests dispatched `equip-upper`**
- `tests/unit/nativeSpecialAttackPreview.test.ts` and `tests/unit/navigationContact.test.ts` were moved to `equip-item`, and their comments were removed.
- **Commit:** 0151901

**4. Shared helper module not listed in the plan**
- `src/world/sandboxCommands.ts` holds the validation both adapters need, following the AGENTS.md DRY rule. It imports only `./worldTypes`.

**5. NativeSliceAdapter comment removal moved into Task 1**
- Task 1 already touched the file, so AGENTS.md required removing its comments then. The public getter `currentSpeed` kept its name, because renaming it would pull `attachNativeSliceSheet.ts` and `nativeSliceDiagnostics.ts` into this plan. The speed profile type already says metres per second.

## Known Stubs

None. `skill-cast` has no presentation yet (EntityRegistry ignores it). The plan scopes only the adapter records, and the sheet and visual response belong to plan 01-14 and Phase 2.

## Requirements

ARCH-02 also belongs to plan 01-15, and SAND-01 to plans 01-11 and 01-14, so neither is ticked in REQUIREMENTS.md by this plan.

## Processes

The Playwright run started its own `pnpm dev` on port 5175 and stopped it on exit. The Vitest runs exited normally. Afterwards `list_worktree_processes.py` found no node or python process for this worktree, and nothing listened on 5173 or 5175. `pnpm dev` had reordered `src/scripts.ts`, which was restored with `git checkout -- src/scripts.ts`.

## Self-Check: PASSED

- FOUND: src/world/sandboxCommands.ts, tests/unit/gameWorldAdapterContract.test.ts, tests/unit/sandboxCommands.test.ts
- FOUND: ef427e1, 0151901 (both ancestors of HEAD)
