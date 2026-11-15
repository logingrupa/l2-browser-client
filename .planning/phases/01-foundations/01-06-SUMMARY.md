---
phase: 01-foundations
plan: 06
subsystem: default-route
status: complete
tags: [default-route, courtyard-retirement, code-built-scene, NOED-01, NOED-03]
requires:
  - phase: 01-foundations
    provides: "buildPresentationScene, referenceWorldPresentation, talkingIslandCameraOverrides, formerlyEditorAuthoredStatusLabel (plan 01-04); presentationConfigurationVariables (plan 01-05)"
provides:
  - "src/scene/loadEnvironment.ts default branch: code-built reference scene, imported Talking Island or not-staged, createWorldRuntime stopped on scene dispose"
  - "src/runtime/createWorldRuntime.ts createWorldRuntime(scene, camera, suppliedAdapter?), referenceWorldNotStagedStatus, WorldDiagnostics.environment.mode island | not-staged"
  - "src/runtime/attachScenePresentationGroup.ts attachScenePresentationGroup (shared by the default and native routes)"
affects: [plan 01-09 EDITOR_VIEWER.md scripts.ts regeneration note, plan 01-16 browser specs that still use ?world=courtyard, plan 01-17 NOED e2e verification]
actuals:
  tokens: 13842
  tasks: 2
  commits: 2
plan_head_before: c6c0c939f4a8c8317d718aa50a0e1d31bf30d94e
plan_head_after: db2242351fd0d7b561f1752d3399626fbcfc5b6a
tech-stack:
  added: []
  patterns:
    - "Every route builds its scene in code; only authored=1 reaches the Editor tools, through a dynamic import of authoredNativeWorld.ts"
    - "An unstaged reference world is a visible status and a diagnostics mode, never a procedural stand-in"
key-files:
  created:
    - src/runtime/attachScenePresentationGroup.ts
    - tests/unit/worldRuntime.test.ts
  modified:
    - src/scene/loadEnvironment.ts
    - src/runtime/createWorldRuntime.ts
    - src/runtime/attachNativeSliceWorldSheet.ts
    - src/entities/attachTargeting.ts
    - src/scene/world/loadImportedWorld.ts
    - src/scene/environmentContext.ts
    - src/scene/registerSceneShaders.ts
    - src/scene/authoredNativeWorld.ts
    - src/scene/presentationConfiguration.ts
    - src/runtime/nativeSliceDebug.ts
    - src/scripts.ts
    - docs/ARCHITECTURE.md
    - README.md
    - tests/unit/environmentRouting.test.ts
    - tests/unit/presentationConfiguration.test.ts
    - tests/unit/editorScript.test.ts
    - tests/unit/editorScene.test.ts
    - tests/unit/nativeOrProceduralCharacter.test.ts
  deleted:
    - assets/example.scene (123 tracked files)
    - src/scripts/world.ts
decisions:
  - "The default route starts createWorldRuntime from loadEnvironment and stops it on scene dispose; the Editor WorldScript is gone"
  - "Scene presentation sheet group is one shared helper (attachScenePresentationGroup) used by both the default and native routes"
  - "referenceWorldPresentation.source names the retired example scene files at commit 58ac027 (contents identical at 58ac027 and 9295a98)"
metrics:
  duration: "about 10 min"
  completed: 2026-11-08
---

# Phase 1 Plan 06: Default route on a code-built scene, courtyard retired Summary

The default route `/` now builds its scene in code from `referenceWorldPresentation`, loads the reference Talking Island when staged (with the saved camera overrides and title) or shows the persistent status "Reference world not staged: /assets/world/manifest.json is missing." with mock actors, and the Editor courtyard scene, its world script and every `?world=courtyard` path are deleted.

## What changed

- `loadEnvironment.ts` has no static Editor import. Routing: `world=interlude&authored=1` loads the Editor world through a dynamic import, `world=interlude` builds the native sandbox, anything else builds the reference scene, calls `loadImportedWorld`, applies `talkingIslandCameraOverrides` when a world returns, starts `createWorldRuntime(scene, camera)` and registers its stop on `scene.onDisposeObservable`. A failure during startup disposes the partial scene.
- `createWorldRuntime(scene, camera, suppliedAdapter?)`: no World camera name lookup, no courtyard ground; `environment.mode` is `island` or `not-staged`, `groundWidth` is the island extent or 0. Mock actors stand on `standOnNavigationSupportOrOriginPlane`. The World section of the sheet gets a "Scene presentation" group listing every reference presentation value with status `presentation` and the formerly Editor-authored label (readout test id `reference-scene-presentation`).
- `attachTargeting.ts` lost the courtyard pick branch. `loadImportedWorld.ts` and `environmentContext.ts` lost every comment; the comments became `boundedLoadWorkerCount` and `isViteIndexHtmlFallback`.
- `assets/example.scene` (123 files) and `src/scripts/world.ts` deleted; `src/scripts.ts` drops the world entry and its header comment. The `lightProxy` shader imports moved from `registerSceneShaders.ts` to `authoredNativeWorld.ts`.
- Docs: `docs/ARCHITECTURE.md` route table has `/`, `/?world=interlude`, `&character=`, `&authored=1` rows, no courtyard, and no bootstrap paragraph naming the retired `.babylon` files. README route line updated the same way. The native dev sheet `world` URL variable reads `interlude | (not set)`.

## Verification

- `pnpm typecheck`: clean (09:13 Riga).
- `pnpm vitest run tests/unit/environmentRouting.test.ts tests/unit/worldRuntime.test.ts tests/unit/importedWorld.test.ts tests/unit/world.test.ts tests/unit/appStartup.test.ts tests/unit/nativeSliceRuntime.test.ts`: pass (09:10-09:11).
- Full `pnpm test:unit` (09:14, BelowNormal): 1503 passed, 82 skipped, 4 files failing: `editorGeometryCompat.test.ts` and 2 cases of `nativeNpcProfiles.test.ts` (known pre-existing), `laneOwnership.test.ts` (owner commit d33ed5a's DECISIONS.md line, not this plan, logged in deferred-items.md) and a 5000 ms timeout in `nativeEditorTerrainAppend.test.ts`. Rerun alone with `editorScene`, `editorScript` and `presentationConfiguration`: 22 of 22 passed.
- Acceptance greps: `grep -rn "Courtyard ground" src` 0; `grep -c '"courtyard"' src/runtime/createWorldRuntime.ts` 0; `not-staged` present; `git ls-files assets/example.scene` empty; `src/scripts/world.ts` absent; `babylonjs-editor-tools` only in `authoredNativeWorld.ts`, `scripts.ts`, `scripts/nativeParity.ts`; `grep -c courtyard docs/ARCHITECTURE.md` 0.
- New tests: `environmentRouting.test.ts` covers the default route with no world (camera equals `referenceWorldPresentation`, runtime started once with that camera, Editor loader never called, runtime stopped on dispose), with a stub world (alpha `-Math.PI / 2.5`, radius 8, maxZ 4000, clear colour 0.58 0.71 0.8 1, target at spawn plus 0.5, title, world disposed with the scene) and startup failure disposal. `worldRuntime.test.ts` covers the not-staged status, diagnostics mode, ground passthrough and the presentation group.
- No Playwright run: browser specs on `/` are rewritten in plan 01-16 (this plan was told not to edit tests/browser). No dev server or e2e was started, so `src/scripts.ts` was not reordered.
- Processes: only Vitest and tsc runs were started, all foreground; `list_worktree_processes.py` found no remaining process for this worktree.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] `src/scripts/world.ts` deletion and the `src/scripts.ts` edit moved into Task 1**
- Found during: Task 1 typecheck. `world.ts` called `createWorldRuntime(scene)` with the old signature, so Task 1 could not typecheck with it present.
- Fix: deleted it and dropped its scripts map entry in the Task 1 commit. The Editor pack and compile tests that still named it were fixed in the Task 2 commit, so `editorScene.test.ts` and `editorScript.test.ts` fail at f304de7 alone and pass at db22423.
- Commits: f304de7, db22423.

**2. [Rule 2 - DRY] Shared `attachScenePresentationGroup` instead of a second copy**
- The native route already had a private "Scene presentation" group. It moved to `src/runtime/attachScenePresentationGroup.ts` and takes the configuration and labels; both routes call it. So `createWorldRuntime.ts` reaches `presentationConfigurationVariables` through that helper, not by name (the plan's key_link grep pattern names it directly).

**3. [AGENTS.md comment rule] `editorScript.test.ts` license comment became code**
- The Apache-2.0 attribution comment is now the `editorCompileContractSource` constant used in the test name; the bundler external list became `editorProvidedModules`. `editorScene.test.ts` POSIX path comment became `toEditorCliPosixPath`, and its now unused `numericArray` helper was deleted.

**4. Scope additions**
- `README.md` route line and `tests/unit/nativeOrProceduralCharacter.test.ts` describe text named the courtyard; both updated. `environmentContext.ts` had a comment about the Editor scene script; removed.
- Ledger base is c6c0c93, not 9295a98: owner commits d33ed5a and c6c0c93 landed on the branch after this plan started and before its first commit.

## Known Stubs

None.

## Deferred issues

Logged in `deferred-items.md` under "From plan 01-06": the `laneOwnership` DECISIONS.md failure from commit d33ed5a, the `nativeEditorTerrainAppend` full-suite timeout, and the browser specs (`world.spec.ts:140`, `demo.spec.ts:106`) that still expect the courtyard (plan 01-16).

## Requirements

NOED-01 and NOED-03 are not marked complete: plan 01-17 still lists both and verifies them with the full e2e suite.

## Self-Check: PASSED

- FOUND: src/runtime/attachScenePresentationGroup.ts, tests/unit/worldRuntime.test.ts
- FOUND: f304de7, db22423 in HEAD history
- MISSING as intended: assets/example.scene, src/scripts/world.ts
