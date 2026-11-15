---
phase: 01-foundations
plan: 15
subsystem: world-contract
status: complete
tags: [import-boundary, architecture-invariants, ARCH-01, ARCH-02, ARCH-04]
requires:
  - phase: 01-foundations
    provides: "static import graph helper (plan 01-09), adapter contract and skill-cast event (plan 01-10)"
provides:
  - src/scene/navigation/meshNavigation.ts (createWorldNavigation, moved out of src/world)
  - "NativeLocomotionControlTarget and NativeLocomotionSpeeds in src/ui/nativeLocomotionControls.ts"
  - tests/support/sourceImportSpecifiers.ts (listTypeScriptModules, readSourceImports)
  - tests/unit/importBoundaries.test.ts
  - tests/unit/architectureInvariants.test.ts
  - "Server boundary and presentation invariants section in docs/ARCHITECTURE.md"
affects: [phase 2 lanes and the phase 4 adapter rely on src/world staying Babylon-free]
actuals:
  tokens: 5000
  tasks: 2
  commits: 2
plan_head_before: a7b6bad8c3ad75cc6ae2415aa94ceb29a239bfc0
plan_head_after: 8a1df8b
tech-stack:
  added: []
  patterns:
    - "Import boundaries are checked twice: a source-text scan of specifiers (catches type-only imports esbuild elides) and an esbuild static closure per module"
    - "UI that drives an adapter takes a narrow structural interface, not the concrete adapter class"
key-files:
  created:
    - tests/support/sourceImportSpecifiers.ts
    - tests/unit/importBoundaries.test.ts
    - tests/unit/architectureInvariants.test.ts
  modified:
    - src/scene/navigation/meshNavigation.ts (renamed from src/world/meshNavigation.ts)
    - src/runtime/loadNativeSliceWorld.ts
    - src/runtime/createWorldRuntime.ts
    - src/ui/nativeLocomotionControls.ts
    - tests/unit/navigation.test.ts
    - tests/unit/navigationContact.test.ts
    - tests/unit/navigationDynamic.test.ts
    - tests/unit/nativeBspSupport.test.ts
    - docs/ARCHITECTURE.md
decisions:
  - "ARCH-04 stays pending: plan 01-14 still carries an ARCH-04 edge truth (presentation keys built from adapter integer IDs), so only ARCH-01 and ARCH-02 are ticked"
metrics:
  duration: 5 min
  completed: 2026-11-08
---

# Phase 1 Plan 15: Import boundary and architecture invariants Summary

src/world is now Babylon-free (mesh navigation moved to src/scene/navigation), the locomotion controls take a narrow `NativeLocomotionControlTarget`, and two tests plus an ARCHITECTURE.md section make ARCH-01, ARCH-02 and ARCH-04 mechanical.

## What changed

- Task 1 (commit ba9925b): `git mv src/world/meshNavigation.ts src/scene/navigation/meshNavigation.ts`, imports fixed to `../../world/...`, all comments removed (the mirrored-winding comment became the `placementMirrorsWinding` name). Importers updated: `loadNativeSliceWorld.ts`, `createWorldRuntime.ts` and four navigation tests. `attachNativeLocomotionControls` now takes `NativeLocomotionControlTarget` (`Pick<GameWorldAdapter, "dispatch" | "subscribe">` plus `locomotionMode` and a `NativeLocomotionSpeeds` shape); `NativeSliceAdapter` satisfies it structurally and the file's doc comment is gone. `importBoundaries.test.ts` checks: no `@babylonjs` specifier in src/world (text scan), every src/world specifier resolves inside src/world, none reaches src/assets, audio, effects, scene, ui, entities, camera, engine or runtime, each src/world module's esbuild closure has no packages and only src/world modules, and only src/runtime (plus the adapter files) imports `MockWorldAdapter` or `NativeSliceAdapter`.
- Task 2 (commit 8a1df8b): `architectureInvariants.test.ts` fails if any src/ui or src/runtime specifier contains `scripts/`, `native_catalog`, `weapongrp`, `armorgrp` or `skillgrp`, and pins the `skill-cast` event to exactly `type`, `casterId`, `skillId`, `level`, `targetId` through `expectTypeOf` (enforced by `pnpm typecheck`). docs/ARCHITECTURE.md gained "Server boundary and presentation invariants" with a table naming the test behind each ARCH line, the metres / Y up / right-handed frame, the new navigation location and the narrow-interface rule.

## Verification

- `pnpm typecheck`: clean (after each task).
- `pnpm vitest run` on importBoundaries, navigation, navigationContact, navigationDynamic, nativeBspSupport, nativeLocomotionControls: 6 files, 56 tests passed.
- `pnpm vitest run tests/unit/architectureInvariants.test.ts`: 3 passed.
- `pnpm test:unit`: 102 files passed, 5 skipped; 2 failures, both the known `nativeNpcProfiles.test.ts` "uses one catalog snapshot and exact hashed metadata" cases (pre-existing, in deferred-items.md).
- Acceptance greps: `grep -rl "@babylonjs" src/world | wc -l` = 0; moved file exists and old path is gone; `NativeSliceAdapter` count in nativeLocomotionControls.ts = 0; section heading count = 1; ARCH-01/ARCH-04 lines = 2.
- Process cleanup: `list_worktree_processes.py` found no node or vitest process left under this worktree.
- No `pnpm build` in this plan.

## Deviations from Plan

**1. [Rule 3 - Blocking] Shared specifier scanner in tests/support**
- Both new tests need the same source-text scan, so it lives once in `tests/support/sourceImportSpecifiers.ts` (DRY) instead of being duplicated in each test file. Commit ba9925b.

**2. Requirement ticking**
- ARCH-04 left pending because plan 01-14 still lists an ARCH-04 edge truth; ARCH-01 and ARCH-02 are ticked.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/scene/navigation/meshNavigation.ts, tests/unit/importBoundaries.test.ts, tests/unit/architectureInvariants.test.ts, tests/support/sourceImportSpecifiers.ts
- FOUND: ba9925b, 8a1df8b on HEAD
