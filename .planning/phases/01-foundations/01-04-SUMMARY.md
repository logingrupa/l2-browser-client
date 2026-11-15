---
phase: 01-foundations
plan: 04
subsystem: scene-startup
status: complete
tags: [native-route, presentation-config, readiness-barrier, dynamic-import, NOED-01]
requires:
  - phase: 01-foundations
    provides: "readiness barrier (requireSceneStartup / registerSceneStartup), createNativeSliceRuntime, saved Editor scenes assets/native-parity.scene and assets/example.scene"
provides:
  - src/scene/presentationConfiguration.ts (PresentationConfiguration, nativeSandboxPresentation, referenceWorldPresentation, talkingIslandCameraOverrides, formerlyEditorAuthoredStatusLabel)
  - src/scene/buildPresentationScene.ts (buildPresentationScene)
  - src/scene/registerSceneShaders.ts (side-effect shader and loader registration)
  - src/scene/authoredNativeWorld.ts (loadAuthoredNativeWorld, dynamic import target)
  - src/scene/documentTitles.ts (nativeSliceDocumentTitle, talkingIslandDocumentTitle)
  - src/runtime/nativeSandboxConfiguration.ts (NativeSandboxConfiguration, nativeSandboxConfiguration)
  - src/runtime/startNativeSandboxRuntime.ts (startNativeSandboxRuntime)
affects: [plan 01-05 runtime split, plan 01-06 default route and courtyard retirement, plan 01-09 Editor test move, NOED-02 import-graph checks]
actuals:
  tokens: 13197
  tasks: 2
  commits: 2
plan_head_before: 89205db581fd58e79a2a5e43365e52a0c140915e
plan_head_after: edde1352a20188c43efe4574cdcdbb5c865a942d
tech-stack:
  added: []
  patterns:
    - "Presentation values carried from Editor scenes live as plain tuples in a Babylon-free module, each set labelled `presentation, formerly Editor-authored, not L2` with its source JSON paths; only buildPresentationScene converts them to Babylon types"
    - "A parity test reads the saved Editor JSON and compares the typed config field by field, so a carried value cannot drift"
    - "The router starts the native runtime itself through the readiness barrier, the same contract the Editor script uses"
    - "The Editor loader on the native route is reached only through `await import(\"./authoredNativeWorld\")` under authored=1"
key-files:
  created:
    - src/scene/presentationConfiguration.ts
    - src/scene/buildPresentationScene.ts
    - src/scene/registerSceneShaders.ts
    - src/scene/authoredNativeWorld.ts
    - src/scene/documentTitles.ts
    - src/runtime/nativeSandboxConfiguration.ts
    - src/runtime/startNativeSandboxRuntime.ts
    - tests/unit/presentationConfiguration.test.ts
    - tests/unit/environmentRouting.test.ts
  modified:
    - src/scene/loadEnvironment.ts
    - src/scripts/nativeParity.ts
    - tests/unit/environmentLoading.test.ts
    - tests/unit/nativeParityScript.test.ts
    - .planning/phases/01-foundations/deferred-items.md
    - .planning/OVERNIGHT-DECISIONS.md
decisions:
  - "The document titles moved to src/scene/documentTitles.ts so the router and the authored module share one owner (OVERNIGHT-DECISIONS row 27)"
  - "loadEnvironment is split into loadNativeSandboxWorld, loadAuthoredNativeWorldOnDemand and loadReferenceWorld; the default and courtyard routes keep their Editor load until plan 01-06"
  - "startNativeSandboxRuntime always passes requireWorld true, because only the app route calls it"
metrics:
  duration: 15min
  completed: 2026-11-08
---

# Phase 1 Plan 04: Native route without an Editor scene Summary

`?world=interlude` now builds its scene in code from a typed presentation config that equals the saved Editor JSON field by field, and starts the native runtime through the readiness barrier; `authored=1` reaches the Editor loader only through a dynamic import (NOED-01, native-route half).

## What was built

- `src/scene/presentationConfiguration.ts`: plain-data camera (every saved non-default ArcRotateCamera field), Sky light and Sunlight, clear colour, ambient colour and fog for both Editor scenes. Native route fog mode 0, reference route fog mode 3. Talking Island runtime overrides from `loadEnvironment.ts` at commit 58ac027. Every set carries `formerlyEditorAuthoredStatusLabel` and its source paths. No Babylon imports.
- `src/scene/buildPresentationScene.ts`: new right-handed Scene, ArcRotateCamera "World camera" set active, two lights, colours and fog from a config.
- `src/scene/registerSceneShaders.ts`: the side-effect shader and loader imports that `loadEnvironment.ts` carried with comments.
- `src/runtime/nativeSandboxConfiguration.ts`: the saved NativeParityScript values (Wait_1HS_MFighter, leatherShirt true, tint 0.45 1 0.6 behind materialOverrideEnabled false, roughness 0.45) plus the unsaved code defaults (playerProfileId, flame replay fields), with sources.
- `src/runtime/startNativeSandboxRuntime.ts`: requires the `native-world` startup, starts `createNativeSliceRuntime` with an AbortController lifetime, registers the ready promise, aborts and stops on scene disposal, and stops a runtime that finishes starting after disposal.
- `src/scene/authoredNativeWorld.ts`: the only native-route module importing `babylonjs-editor-tools` and `../scripts`; holds the incremental full-loading flag around the guarded `native-world.babylon` load and restores it in `finally`.
- `src/scene/loadEnvironment.ts`: no comments; three named route functions. `native-parity.babylon` is no longer loaded by the app.
- `src/scripts/nativeParity.ts`: every decorated field initialised from `nativeSandboxConfiguration`; all comments removed (the error-reporting condition is now named `isCurrentStart` and `isEditorPlayWithoutApp`).

## Verification

- `pnpm typecheck`: clean (BelowNormal, 07:55 Riga).
- `pnpm vitest run` on presentationConfiguration, environmentRouting, environmentLoading, nativeParityScript, appStartup, sceneStartup: 6 files, 39 tests passed.
- `pnpm test:unit`: 109 files passed, 5 skipped, 2 failed; 1461 tests passed, 2 failed. The failures are the known pre-existing ones from deferred-items (`editorGeometryCompat` collection, `nativeNpcProfiles` 2 cases). No new failure.
- Acceptance greps: `native-parity.babylon` in loadEnvironment.ts 0; `@babylonjs` in the two config modules 0; `Wait_1HS_MFighter` in nativeSandboxConfiguration.ts 1; comment lines in loadEnvironment.ts 0 and in nativeParity.ts 0; `import("./authoredNativeWorld")` in loadEnvironment.ts 1; `native-world.babylon` in loadEnvironment.ts 0 and in authoredNativeWorld.ts 1; `nativeSandboxConfiguration` in nativeParity.ts 18.
- Browser check (Playwright, `DEV_PORT=5175`, SwiftShader WebGPU, staged store through `public/l2`): `tests/browser/nativeSlice.spec.ts` mobile viewport case and missing-catalog retry case passed (2 passed, 1.4 min). The main case passed every step through ready state, saved camera alpha, beta and radius, rigs, Leather Shirt, material override, `fog.mode` 0, death and attack, then failed at line 273 on a developer-sheet tab step unrelated to this plan (deferred item). Screenshots: `C:/Users/rolan/AppData/Local/Temp/l2b-autonomous/evidence-01-04/native-wide.png`, `native-desktop.png`, `native-death.png`; the wide screenshot shows the code-built route with terrain, buildings, trees and both actors.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Obsolete environmentLoading rows in Task 1**
- **Found during:** Task 1
- **Issue:** three `tests/unit/environmentLoading.test.ts` rows expected `?world=interlude` (and `authored=0`) to load `native-parity.babylon`, the behaviour this plan removes.
- **Fix:** removed the rows in Task 1; Task 2 rewrote the file to test `loadAuthoredNativeWorld` directly, and `environmentRouting.test.ts` covers `authored=0` on the code-built route.
- **Commit:** 3c0e0dc

**2. [Rule 2 - DRY] Shared document titles**
- **Found during:** Task 2
- **Issue:** the native slice title would be duplicated in the router and the authored module.
- **Fix:** `src/scene/documentTitles.ts`. OVERNIGHT-DECISIONS row 27.
- **Commit:** edde135

**3. Additional tests beyond the plan**
- `environmentRouting.test.ts` also covers a runtime that finishes starting after scene disposal, an authored load failure disposing the partial scene, and the reference route staying on the Editor loader for `?world=courtyard`, `?world=courtyard&authored=1` and `?authored=1`. `nativeParityScript.test.ts` gained a case asserting every field default equals `nativeSandboxConfiguration`.

## Deferred issues

- `nativeSlice.spec.ts` main case fails at the developer-sheet Resume step (sheet reopens on the Combat tab). Logged in `deferred-items.md`.
- `nativeSlice.spec.ts` `authoredState()` still reads the saved scene JSON instead of the typed config; values are equal and pinned by the parity test. Logged in `deferred-items.md`.

## Known Stubs

None.

## Threat Flags

None. Route selection compares query values to the fixed literals "interlude" and "1"; the dynamic import specifier is a fixed literal (T-01-09, T-01-10).

## Processes

The two Playwright runs started their own `pnpm dev` web server on port 5175 and stopped it on exit. Afterwards `list_worktree_processes.py` found no node or python process for this worktree and nothing listened on 5173 or 5175. The Editor pack inside `pnpm dev` reordered the tracked `src/scripts.ts`; it was restored with `git checkout -- src/scripts.ts` after each run.

## Self-Check: PASSED

- FOUND: all nine created files listed in key-files.created
- FOUND: 3c0e0dc, edde135 on HEAD
