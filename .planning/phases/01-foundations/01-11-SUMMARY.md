---
phase: 01-foundations
plan: 11
subsystem: world-contract
status: complete
tags: [missing-model, fallback-sentinel, url-model-loader, dead-code, ARCH-03, SAND-01]
requires:
  - phase: 01-foundations
    provides: "native runtime sheet split (plan 01-05) and the adapter contract with sandbox commands (plan 01-10)"
provides:
  - src/assets/characterBounds.ts (CharacterBounds)
  - "CharacterVisualFactory type in src/assets/CharacterVisual.ts"
  - "createCharacterVisual is the procedural character only, with no URL model branch"
affects: [plan 01-14 missing-asset diagnostic, plan 01-17 deletes tests/browser/demo.spec.ts Fallback Sentinel cases]
actuals:
  tokens: 9000
  tasks: 2
  commits: 4
plan_head_before: e484c798e15f92936f5cfa2a31da9d62c5354a7e
plan_head_after: 50b38689f25c7a1c560520cd844f0b1bfe214e17
tech-stack:
  added: []
  patterns:
    - "Character visual factories share one named type, CharacterVisualFactory, instead of typeof createCharacterVisual"
key-files:
  created:
    - src/assets/characterBounds.ts
  modified:
    - src/assets/CharacterVisual.ts
    - src/assets/characterProfiles.ts
    - src/assets/native/NativeCharacterVisual.ts
    - src/assets/native/nativeOrProceduralCharacter.ts
    - src/entities/EntityRegistry.ts
    - src/runtime/attachNativeSliceSheet.ts
    - src/ui/WorldInterface.ts
    - src/world/MockWorldAdapter.ts
    - src/world/worldTypes.ts
    - tests/unit/animation.test.ts
    - tests/unit/assets.test.ts
    - tests/unit/nativeOrProceduralCharacter.test.ts
    - tests/unit/nativeSliceAdapter.test.ts
    - tests/unit/world.test.ts
    - tests/unit/worldInterfaceSheet.test.ts
  deleted:
    - src/assets/loadCharacterModel.ts
    - src/assets/prepareCharacterModel.ts
    - src/animation/ModelAnimator.ts
    - tests/unit/assetsModel.test.ts
key-decisions:
  - "createCharacterVisual takes only scene and entity; the optional status callback lives on CharacterVisualFactory, which the native factories still use"
  - "The procedural visual reports isFallback true and modelId null as constants, since no load can replace it any more"
metrics:
  duration: 6 min
  completed: 2026-11-08
---

# Phase 1 Plan 11: Remove the missing-model demo and URL model loader Summary

The `load-missing-model` command, the Fallback Sentinel, the Missing model button and the URL model loader that only they used are gone in one commit. No adapter record can make the client fetch a character GLB by URL any more, and a missing model is no longer answered with a substitute body.

## What was built

- `src/world/worldTypes.ts`: `WorldEntity.modelUrl` and the `load-missing-model` command are removed.
- `src/world/MockWorldAdapter.ts`: the `load-missing-model` case and the `shouldUseMissingModel` parameter are removed; `spawn` still creates "Sentinel <n>".
- `src/ui/WorldInterface.ts`: the Missing model button, its command case and its status text are removed, along with all comments in the file. The sound chip's empty `catch` with a comment now re-renders and returns, with the same visible result.
- `src/runtime/attachNativeSliceSheet.ts`: no longer removes a `missing-model` button.
- `src/assets/characterProfiles.ts`: `CharacterModelProfile` and `resolveCharacterProfile` are deleted, and so is the `modelUrl` check in `nativeAppearanceProfileId`.
- `src/assets/CharacterVisual.ts`: now only the procedural character with its animator. It has no comments and exports `CharacterVisualFactory`, which `EntityRegistry` and `nativeOrProceduralCharacterFactory` now use.
- `src/assets/characterBounds.ts`: holds `CharacterBounds`, imported by CharacterVisual, NativeCharacterVisual and nativeOrProceduralCharacter.
- Deleted: `loadCharacterModel.ts`, `prepareCharacterModel.ts`, `ModelAnimator.ts`, and `tests/unit/assetsModel.test.ts`. Every case in that test loaded a URL model; its one Human-appearance case moved into `assets.test.ts` without the GLB fixture.
- `src/entities/EntityRegistry.ts`: the `modelUrl` comparison on update is removed.
- Tests: the missing-model cases in `world.test.ts` and `assets.test.ts`, the ModelAnimator cases in `animation.test.ts`, and the `modelUrl` and `resolveCharacterProfile` assertions are removed. `worldInterfaceSheet.test.ts` has a new case: the General session actions are exactly `["pause", "despawn"]`, and no `data-action="missing-model"` exists in the interface root.

## Verification

- `pnpm typecheck`: clean, after each task.
- `pnpm vitest run` on the 7 affected test files: 44 passed.
- `pnpm test:unit` after Task 2: 100 files passed, 5 skipped, 1335 tests passed. The only failures are the 2 known cases in `tests/unit/nativeNpcProfiles.test.ts` ("uses one catalog snapshot and exact hashed metadata in https:" and "in file:", "Native player body source identity mismatch"). Both are known and come before this plan.
- Acceptance greps: `load-missing-model|Fallback Sentinel|modelUrl|missing-character` in src and tests/unit returns 0 matches. The three loader files do not exist. `characterBounds.ts` contains `CharacterBounds`. The comment counts in WorldInterface.ts, EntityRegistry.ts and CharacterVisual.ts are 0, 0 and 0.
- No e2e run was planned. `tests/browser/demo.spec.ts` still contains Fallback Sentinel cases and will fail on them until plan 01-17 deletes it, as the plan requires. It was not run here.
- Processes: `list_worktree_processes.py` found no node or python process for this worktree after the runs.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Added the CharacterVisualFactory type**
- **Found during:** Task 1
- **Issue:** `createCharacterVisual` no longer uses the status callback, so it lost that parameter. `EntityRegistry` and `nativeOrProceduralCharacterFactory` typed their factories as `typeof createCharacterVisual`, which would have dropped the callback the native factories pass.
- **Fix:** export `CharacterVisualFactory` from CharacterVisual.ts and use it in both places.
- **Commit:** 1f40e0a

**2. [Rule 2 - Coverage] Human-appearance no-fetch case moved into assets.test.ts**
- **Found during:** Task 1
- **Issue:** deleting `assetsModel.test.ts` would also drop its check that a Human appearance never requests a model.
- **Fix:** the same check now lives in `assets.test.ts` with no GLB fixture.
- **Commit:** 1f40e0a

### Commit count

`commits: 4` is measured from e484c79. Two of those commits are not from this plan: 3e16d42 and 50b3868, the owner and orchestrator's DEC-OWN-9 phone-size decision, which landed during the run. This plan made 2 commits: 1f40e0a and d52df66. The per-plan ledger file could not be written at the start because the command was refused, so the base is the HEAD the plan started from.

## Requirements

ARCH-03 and SAND-01 are not ticked complete, because plan 01-14 still lists both.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/assets/characterBounds.ts
- MISSING as intended: src/assets/loadCharacterModel.ts, src/assets/prepareCharacterModel.ts, src/animation/ModelAnimator.ts
- FOUND commits: 1f40e0a, d52df66
