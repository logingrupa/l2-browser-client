---
phase: 01-foundations
plan: 05
subsystem: native-runtime
status: complete
tags: [native-route, runtime-split, world-source, dev-sheet, provenance, NOED-01, ARCH-03]
requires:
  - phase: 01-foundations
    provides: "code-built native route (buildPresentationScene, startNativeSandboxRuntime), typed presentation and sandbox configs with formerlyEditorAuthoredStatusLabel (plan 01-04)"
provides:
  - src/runtime/nativeSliceWorldSource.ts (NativeSliceWorldSource, catalogNativeSliceWorldSource)
  - src/editor/authoredNativeWorldSource.ts (authoredNativeWorldSource)
  - src/runtime/loadNativeSliceWorld.ts (loadNativeSliceWorld, NativeSliceFlames)
  - src/runtime/loadNativeSliceAudio.ts (beginNativeSliceAudioLoads, loadNativeSliceAudio, createNativeSliceCombatAudio)
  - src/runtime/createNativeSliceEffects.ts (createNativeSliceEffects)
  - src/runtime/nativeSliceDiagnostics.ts (attachNativeSliceDiagnostics, window.__nativeSlice global type)
  - src/runtime/attachNativeSliceSheet.ts, attachNativeSliceCharacterSheet.ts, attachNativeSliceWorldSheet.ts
  - src/runtime/presentationConfigurationVariables.ts (presentationConfigurationVariables, nativeSandboxSettingVariables)
affects: [plan 01-06 default route and courtyard retirement, plan 01-09 Editor test move, NOED-02 import-graph checks]
actuals:
  tokens: 63643
  tasks: 3
  commits: 3
plan_head_before: 76ac5b285443fd6eb92d2b473963bcbc072d4184
plan_head_after: 118defe92fc9c19e1348f4b5f8cc05448866adeb
tech-stack:
  added: []
  patterns:
    - "The native runtime is a composition root: it receives its camera and a NativeSliceWorldSource, and each startup stage is a module with explicit inputs and an addRelease callback, so release order stays one reverse list"
    - "Editor-only world handling (material restore, authored section attach, left-handed camera mirror) lives in src/editor/authoredNativeWorldSource.ts and is passed only by NativeParityScript"
    - "Presentation provenance on the sheet: each variable has status presentation and source `<tracked path> - presentation, formerly Editor-authored, not L2`"
key-files:
  created:
    - src/runtime/nativeSliceWorldSource.ts
    - src/editor/authoredNativeWorldSource.ts
    - src/runtime/loadNativeSliceWorld.ts
    - src/runtime/loadNativeSliceAudio.ts
    - src/runtime/createNativeSliceEffects.ts
    - src/runtime/nativeSliceDiagnostics.ts
    - src/runtime/attachNativeSliceSheet.ts
    - src/runtime/attachNativeSliceCharacterSheet.ts
    - src/runtime/attachNativeSliceWorldSheet.ts
    - src/runtime/presentationConfigurationVariables.ts
    - tests/unit/nativeSliceWorldSource.test.ts
    - tests/unit/presentationConfigurationVariables.test.ts
  modified:
    - src/runtime/createNativeSliceRuntime.ts
    - src/runtime/startNativeSandboxRuntime.ts
    - src/runtime/nativeSliceSheet.ts
    - src/runtime/nativeSliceDebug.ts
    - src/scene/loadEnvironment.ts
    - src/scene/presentationConfiguration.ts
    - src/scripts/nativeParity.ts
    - tests/unit/nativeSliceRuntime.test.ts
    - tests/unit/environmentRouting.test.ts
    - tests/unit/nativeParityScript.test.ts
    - tests/unit/presentationConfiguration.test.ts
    - tests/browser/nativeSlice.spec.ts
    - .planning/OVERNIGHT-DECISIONS.md
    - .planning/phases/01-foundations/deferred-items.md
decisions:
  - "authoredNativeWorldSource falls back to the catalog section when the Play scene has no saved world root, as the runtime did before the split (OVERNIGHT-DECISIONS row 28)"
  - "PresentationConfiguration.source is named files (camera, skyLight, sunlight, config) so each sheet variable cites its tracked file without index lookups (row 28)"
  - "nativeSandboxSettingVariables reads the settings the runtime received and cites unsavedCodeDefaults or savedScriptValues per field (row 29)"
  - "The dev sheet keeps remembering its last tab; nativeSlice.spec clicks the General tab before Resume (row 30)"
metrics:
  duration: 25min
  completed: 2026-11-08
---

# Phase 1 Plan 05: Native runtime split and presentation provenance Summary

The 914-line native runtime is now a 292-line composition root that receives its camera and an injected world source. The default `?world=interlude` path loads the section from the catalog with no Editor code on it. The sheet shows every presentation value and sandbox setting labelled `presentation, formerly Editor-authored, not L2` (NOED-01, ARCH-03).

## What was built

- `createNativeSliceRuntime(scene, camera, settings, signal, { requireWorld?, onProgress?, worldSource? })`. The camera is validated as not disposed. `worldSource` defaults to `catalogNativeSliceWorldSource`. The runtime no longer looks up `"World camera"` and no longer imports `restoreEditorAuthoredMaterials` or `attachAuthoredNativeSection`. The courtyard mesh hide-and-restore loop is deleted.
- `startNativeSandboxRuntime` passes the camera from `buildPresentationScene` and the catalog source. `NativeParityScript.onStart` checks the scene's `World camera` is an ArcRotateCamera ("The authored native scene has no World camera.") and passes `authoredNativeWorldSource`.
- `src/editor/authoredNativeWorldSource.ts` restores Editor materials, attaches the authored section and mirrors the left-handed camera when `removedZReflection` is set. Its release restores the camera and the materials.
- `loadNativeSliceWorld` owns the section, movers, navigation, spawn origin, flames (`NativeSliceFlames`) and sky, plus their abort and release order. A missing section with `requireWorld` still rejects with "The native world section is unavailable" (ARCH-03).
- `loadNativeSliceAudio` (mixer, cues, footsteps, step sounds, deco grass, world audio, combat bundle), `createNativeSliceEffects` (components, init, shot, Power Strike) and `attachNativeSliceDiagnostics` (`window.__nativeSlice` and its unchanged `declare global` block). Await order and failure texts are unchanged.
- `attachNativeSliceSheet` (HUD cards, audio, movement, combat, effects, debug and asset inspector), `attachNativeSliceCharacterSheet` (equipment, aliases, new "Sandbox settings" group) and `attachNativeSliceWorldSheet` (camera, sky, flames, new "Scene presentation" group). Both new groups show their variables on hover-cards.
- `presentationConfigurationVariables(configuration)` returns 35 variables (`presentation.camera.*`, `presentation.lights.sky.*`, `presentation.lights.sun.*`, `presentation.clearColor`, `presentation.ambientColor`, `presentation.fog.*`). `nativeSandboxSettingVariables(settings)` returns 17 `sandbox.*` variables. Every one has status `presentation` and source `<tracked path> - presentation, formerly Editor-authored, not L2`.
- No comments are left in any file under `src/runtime` or in any other file this plan touched. `nativeSliceDebug.ts` helpers were renamed (`currentQueryParameters`, `formatFinite`, `urlVariable`, `addWorldReloadButton`), and its URL hints now say the native route builds its scene in code.

## Verification

- `pnpm typecheck` is clean (BelowNormal, 08:27 Riga).
- Task 1: nativeSliceRuntime, nativeSliceWorldSource, environmentRouting and nativeParityScript passed, 107 tests in 4 files.
- Task 2: the same files plus nativeCombatAudio and nativeEffectComponentPreview passed, 142 tests in 6 files.
- Task 3: nativeSliceRuntime (85, including a new case that the sheet lists the received sandbox settings and the scene presentation with the label), presentationConfigurationVariables (3), presentationConfiguration, environmentRouting, nativeParityScript and nativeSliceWorldSource all passed.
- Full `pnpm test:unit` at 08:29 Riga: 110 files passed, 5 skipped, 3 failed; 1468 tests passed, 3 failed. Two failures are known and pre-existing: `editorGeometryCompat` at collection and `nativeNpcProfiles` (2 cases). The third, a `nativeEditorBspAppend` case, timed out at 5000 ms under full-suite load. That file passes alone together with nativeEffectStage and nativePowerStrikeSource (77 tests), and it imports nothing this plan changed. It is logged in deferred-items.
- Playwright `tests/browser/nativeSlice.spec.ts` with `DEV_PORT=5175` (SwiftShader WebGPU, staged store through `public/l2`): 3 passed in 3.1 min. That includes the main case that used to fail at line 273. The run now opens the World tab and sees `native-scene-presentation`, then the Character tab and sees `native-sandbox-settings`, each with "presentation, not L2".
- Acceptance greps: in createNativeSliceRuntime.ts and loadNativeSliceWorld.ts, `restoreEditorAuthoredMaterials|attachAuthoredNativeSection` matches 0 and `getCameraByName("World camera")` matches 0. `authoredNativeWorldSource` appears 2 times in nativeParity.ts and `__nativeSlice` 3 times in nativeSliceDiagnostics.ts. `declare global` appears 0 times in the root, and `formerlyEditorAuthoredStatusLabel` 2 times in presentationConfigurationVariables.ts. The largest file in `src/runtime` has 292 lines (the root; the sheet module has 291). No file under `src/runtime` has a comment line, and none imports `src/editor` or the authored section loader.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] The authored path kept its catalog fallback**
- **Found during:** Task 1
- **Issue:** Before the split, the runtime used `attachAuthoredNativeSection(...) ?? loadNativeSection(...)`. A pure authored source would have dropped the catalog fallback for authored=1 scenes that have no saved world root.
- **Fix:** `authoredNativeWorldSource` calls `catalogNativeSliceWorldSource` when no authored root exists, and releases both (OVERNIGHT-DECISIONS row 28).
- **Commit:** 725ca02

**2. [Rule 2 - Explicit inputs] Named presentation source files**
- **Found during:** Task 3
- **Issue:** Per-value provenance needs the camera, sky light, sunlight and config file of each set. `source` was a positional array.
- **Fix:** `PresentationSourceFiles` with named fields. The parity test uses that type instead of its own duplicate interface.
- **Commit:** 118defe

**3. [Rule 3 - Blocking] Deferred e2e failure on the sheet tab**
- **Found during:** Task 3 (the split touches the sheet wiring, so the dispatch asked for this fix)
- **Fix:** `nativeSlice.spec.ts` clicks `dev-tab-general` before Resume and checks both new groups. Touching the spec meant removing all of its comments. The Musveren clearance and bounds literals became named constants.
- **Commit:** 118defe

**4. Test changes beyond the plan**
- `tests/unit/nativeSliceRuntime.test.ts` grew by about 15 lines, against the plan's assumption that it would not grow. The growth is a `startRuntime` helper that passes the camera and the current world source (the authored fixtures select `authoredNativeWorldSource`), a recorded sheet-group map, and one new sheet provenance case. The courtyard-hiding assertions now check that a code-built mesh stays enabled.
- `nativeParityScript.test.ts` now asserts the camera and `authoredNativeWorldSource` it passes, and adds a missing-camera case. `environmentRouting.test.ts` asserts the code-built camera and the catalog source.
- `PRESENTATION_CHOICE` uses a plain hyphen: "presentation choice - native rule unverified" (AGENTS text rule).

## Deferred issues

- Test timeouts under full-suite load in `nativeEditorBspAppend`, `nativeEffectStage` and `nativePowerStrikeSource`. These files run staging scripts against temp folders. Logged in deferred-items.
- `nativeSlice.spec.ts` `authoredState()` still reads the saved scene JSON (carried over from plan 01-04, owner plan 01-06 or 01-09).

## Known Stubs

None.

## Threat Flags

None. `window.__nativeSlice` has the same shape and content (T-01-11 accepted). No new network, file or server surface was added.

## Processes

The Playwright run started its own `pnpm dev` server on port 5175 and stopped it on exit. The Vitest runs exited normally. Afterwards `list_worktree_processes.py` found no node or python process for this worktree, and nothing listened on 5173. Port 5175 showed a LISTENING entry owned by PID 0 (System Idle) plus TIME_WAIT sockets, meaning no live process held it. The Editor pack inside `pnpm dev` reordered `src/scripts.ts`, which was restored with `git checkout -- src/scripts.ts`.

## Self-Check: PASSED

- FOUND: all 12 created files listed in key-files.created
- FOUND: commits 725ca02, cd6a936, 118defe on plan/autonomous-roadmap
