---
phase: 01-foundations
plan: 09
subsystem: build
tags: [editor, vite, vitest, esbuild, noed]
status: complete
requires:
  - phase: 01-foundations
    provides: code-built default route and dynamic-only authored route (01-06)
provides:
  - dev and build scripts that run only stage-webgpu-compilers before Vite
  - optional generate:editor and test:editor scripts
  - staticImportClosure esbuild metafile walker for static import graph tests
  - default entry graph test and Editor independence test
affects: [01-15, 01-16, 01-17]
tech-stack:
  added: []
  patterns:
    - "Static import graph test: esbuild metafile with packages external, walked along import-statement edges only"
    - "Editor-path tests live in tests/editor and run under vitest.editor.config.ts"
key-files:
  created:
    - tests/support/staticImportGraph.ts
    - tests/unit/defaultEntryImportGraph.test.ts
    - tests/unit/editorIndependence.test.ts
    - tests/editor/authoredEnvironmentRouting.test.ts
    - vitest.editor.config.ts
  modified:
    - package.json
    - tests/unit/environmentRouting.test.ts
    - README.md
    - docs/ARCHITECTURE.md
    - docs/EDITOR_VIEWER.md
    - docs/SOURCE_REUSE.md
    - tests/editor/*.test.ts (17 files moved from tests/unit, content unchanged)
key-decisions:
  - "The two authored-route cases of environmentRouting.test.ts move to tests/editor/authoredEnvironmentRouting.test.ts with the Editor loader mocks, so tests/editor holds 18 files"
  - "The tests/unit Editor scan checks Editor packages and src/scripts only; splitting the authored cases of nativeSliceRuntime.test.ts is deferred (OVERNIGHT-DECISIONS row 34)"
requirements-completed: []
duration: 8min
completed: 2026-11-08
commits: 2
plan_head_before: 58c3718
plan_head_after: caf9879
actuals:
  tokens: 9000
  tasks: 2
  commits: 2
---

# Phase 1 Plan 09: Editor off the build path Summary

`pnpm dev` and `pnpm build` now run only `stage-webgpu-compilers` before Vite, the Editor pack and repair chain moved unchanged to the optional `pnpm generate:editor`, Editor-path tests run only under `pnpm test:editor`, and an esbuild metafile test proves `src/main.ts` statically reaches no Editor package, no `src/scripts.ts` and no authored world module.

## Performance

- Duration: about 8 min (09:18 to 09:26 Riga, before the 10:00 relay window)
- Tasks: 2 of 2
- Files: 5 created, 6 modified, 17 moved

## Accomplishments

- package.json: `dev` is `node scripts/stage-webgpu-compilers.mjs && vite --host 127.0.0.1`, `build` is `node scripts/stage-webgpu-compilers.mjs && pnpm typecheck && vite build`, `generate` renamed to `generate:editor` with its command unchanged, new `test:editor`, description "Lineage II Interlude browser client on Babylon.js WebGPU". `assets:editor`, `renderer:ensure` and the `l2-editor-webgpu-compat` devDependency stay (optional viewer, NOED-05).
- `tests/support/staticImportGraph.ts` exports `staticImportClosure(entryPoint)`: one esbuild build with `packages: "external"`, walking `metafile.inputs` along `import-statement` edges; externals go to `packages`, `dynamic-import` targets are recorded and not followed.
- `tests/unit/defaultEntryImportGraph.test.ts` (4 cases): no `babylonjs-editor-tools`, `babylonjs-editor-cli`, `l2-editor-webgpu-compat` or `@babylonjs/inspector` package; no `src/scripts.ts`, `src/scripts/`, `src/editor/`, `loadAuthoredNativeSection.ts` or `authoredNativeWorld.ts` module; `src/scene/authoredNativeWorld.ts` is a dynamic import target. Negative check: pointing the same test at `src/scene/authoredNativeWorld.ts` failed all 4 cases, naming `babylonjs-editor-tools`, `src/scripts.ts`, `src/scripts/nativeParity.ts`, `src/editor/*` and `loadAuthoredNativeSection.ts` (scratch file deleted, not committed).
- `tests/unit/editorIndependence.test.ts` (7 cases): dev and build contain `stage-webgpu-compilers` and no Editor step; `generate:editor`, `assets:editor` and `project.bjseditor` exist; `.planning/lanes.json` and `STATUS.md` name neither optional Editor script; `test:editor` and both Vitest includes are pinned; no default unit test names an Editor package or `src/scripts"`.
- The 17 Editor-path tests moved with `git mv` to `tests/editor/` (same depth, imports unchanged).
- Docs: README, docs/ARCHITECTURE.md and docs/EDITOR_VIEWER.md describe the Editor-free dev and build, `generate:editor` and `test:editor`; EDITOR_VIEWER states the Addons 9.27.1 and Recast 0.43.0 pins become removable once nothing in the default entry needs them, an owner decision. docs/SOURCE_REUSE.md points at the moved `tests/editor/editorScript.test.ts`.

## Task commits

1. Task 1: dev and build without Editor steps, static graph test - `e24fbc7`
2. Task 2: Editor-path tests under test:editor, docs - `caf9879`

## Verification

- `pnpm typecheck`: exit 0 (after each task).
- `pnpm vitest run tests/unit/defaultEntryImportGraph.test.ts tests/unit/editorIndependence.test.ts`: 2 files, 9 tests passed (task 1); with environmentRouting after task 2: 3 files, 19 passed.
- `pnpm test:unit` (09:22 Riga): 101 files passed, 5 skipped, 1 failed; 1348 tests passed, 82 skipped, 2 failed. The 2 failures are the known pre-existing `nativeNpcProfiles.test.ts` cases (`Native player body source identity mismatch.`, store identity through the `public/l2` junction). `editorGeometryCompat.test.ts` no longer runs here. Log: `C:/Users/rolan/AppData/Local/Temp/l2b-autonomous/plan-01-09-unit.log`.
- `pnpm test:editor` (09:23 Riga): 17 files passed, 1 failed; 168 tests passed. The failure is the known pre-existing `editorGeometryCompat.test.ts` collection error (`Installed Editor writer fixture changed.`), now isolated to the optional suite. Log: `C:/Users/rolan/AppData/Local/Temp/l2b-autonomous/plan-01-09-editor.log`.
- Acceptance: the dev+build regex check exits 0; `generate:editor` and `test:editor` exist; `grep -cE "pnpm generate([^:]|$)" README.md` prints 0; `grep -c "generate:editor" docs/EDITOR_VIEWER.md` prints 2.
- `pnpm build`, `pnpm dev` and `pnpm generate:editor` were not run, as the plan says (build in plan 01-15, dev cold start in plan 01-16).
- Processes: every Vitest and tsc run was foreground through `run_below_normal.py` and exited; `list_worktree_processes.py` found no node or python process with `autonomous-roadmap` in its command line.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] environmentRouting.test.ts mocked the Editor loader**
- Found during: Task 2 (the planned `tests/unit` scan matched it)
- Issue: two authored-route cases mocked `babylonjs-editor-tools` and `../../src/scripts` inside a default unit test.
- Fix: those two cases and their mocks moved to `tests/editor/authoredEnvironmentRouting.test.ts`; the unit file lost the mocks and its `loadEditorScene` not-called assertions (the code-built route assertions stay). `tests/editor` therefore holds 18 files, not 17.
- Commit: `caf9879`

**2. [Rule 3 - Blocking] Scan markers narrowed**
- Found during: Task 2
- Issue: `tests/unit/nativeSliceRuntime.test.ts` imports `src/editor/authoredNativeWorldSource.ts` and parameterises about 20 cases over the authored and catalog world sources; the plan's `src/editor/` and `authoredNativeWorld` markers would fail on it, and splitting a 900-line interleaved test is outside this plan.
- Fix: the scan checks the Editor packages and `src/scripts"`; that module imports no Editor package. Recorded in OVERNIGHT-DECISIONS row 34 and deferred-items.md.
- Commit: `caf9879`

**3. Docs beyond the plan's list**
- docs/SOURCE_REUSE.md named the old path of `editorScript.test.ts`; updated to `tests/editor/`.

## Deferred issues

- `tests/editor/editorGeometryCompat.test.ts` still fails at collection (writer fixture hash). Pre-existing; now only in the optional suite.
- Split the authored cases of `tests/unit/nativeSliceRuntime.test.ts` into `tests/editor/` and add the `src/editor/` and `authoredNativeWorld` markers to the scan.

## Requirements

NOED-02 and NOED-05 are not ticked: plan 01-17 still lists both.

## Next phase readiness

Plan 01-15 can run `pnpm build` (no Editor step in it now); plan 01-16 can measure the dev cold start.

## Self-Check: PASSED

- FOUND: tests/support/staticImportGraph.ts, tests/unit/defaultEntryImportGraph.test.ts, tests/unit/editorIndependence.test.ts, tests/editor/authoredEnvironmentRouting.test.ts, vitest.editor.config.ts
- FOUND: e24fbc7, caf9879
