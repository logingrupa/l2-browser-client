---
phase: 03-stage-a-checks
plan: 18
subsystem: runtime-diagnostics
tags: [typescript, babylon, ue2-materials, native-slice, playwright, vitest, stage-a]
requires:
  - phase: 03-stage-a-checks
    provides: nativeSliceDiagnostics.ts with setCameraPose and the capture tile framing spec (03-02)
provides:
  - ue2Diagnostic metadata {root, unportedClass, reasons} on every UE2 diagnostic material, the same record its inspect() returns
  - visibleDiagnosticMaterials(scene), the sorted unique list of that record over enabled visible meshes
  - snapshot().diagnosticMaterials on window.__nativeSlice
  - tests/browser/captureTileRoute.ts, the one owner of the capture tile route (/?map=20_20 on NATIVE_STORE_ROOT=integration)
affects: [03-08, 03-09, 03-11]
actuals:
  tokens: 2700
  tasks: 2
  commits: 2
plan_head_before: fd91244c2424fa88bd4e25f11bb1fcd490195ce5
plan_head_after: e229d10c5c3891eb35cd2afaa982e8fab730965e
tech-stack:
  added: []
  patterns:
    - "A runtime read-out reads material metadata set from the same record the material's inspect() returns, never a second derivation"
key-files:
  created:
    - src/materials/ue2/babylon/visibleDiagnosticMaterials.ts
    - tests/browser/nativeSliceDiagnosticMaterials.spec.ts
    - tests/browser/captureTileRoute.ts
    - tests/unit/visibleDiagnosticMaterials.test.ts
  modified:
    - src/materials/ue2/babylon/material.ts
    - src/runtime/nativeSliceDiagnostics.ts
    - tests/browser/nativeSliceFraming.spec.ts
key-decisions:
  - "P1203: diagnosticMaterials is optional in the global __nativeSlice snapshot type, like its sibling fields; the runtime always sets it"
  - "P1204: the diagnostic spec has a default-route test (main-checkout store) and a capture tile test (integration store, /?map=20_20); the capture tile route helper is shared with the framing spec"
patterns-established:
  - "Sandbox-half captures read magenta or unresolved diagnostics from snapshot().diagnosticMaterials, not from pixels (P17)"
requirements-completed: []
requirements-addressed: [CHECK-01, CHECK-04]
duration: 13min
completed: 2026-11-14
status: complete
---

# Phase 3 Plan 18: Diagnostic materials read-out summary

**Every UE2 diagnostic material now carries a `ue2Diagnostic` record built from the values its `inspect()` returns. `window.__nativeSlice.snapshot().diagnosticMaterials` lists that record once per root, sorted by root, for enabled visible meshes only. A sandbox half can therefore record each magenta or unresolved diagnostic it shows from the runtime (P17).**

## Performance

- **Duration:** 13min
- **Started:** 2026-11-14T07:34Z
- **Completed:** 2026-11-14T07:47Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- `createDiagnosticMaterial` builds one `DiagnosticMaterialRecord` (`root`, `unportedClass`, `reasons`). It sets that record as material metadata `{ ue2Diagnostic }`, and `inspect()` reads its `root`, `reasons` and `unportedClass` from the same record. There is one source.
- `visibleDiagnosticMaterials(scene)` keeps meshes that are enabled (`isEnabled()`, ancestors included) and `isVisible` and whose material carries the record. It lists each root once, sorted by code-unit order to match the spec's check, and returns copies.
- `nativeSliceSnapshot` and the global `__nativeSlice` type have `diagnosticMaterials`.
- Browser check: on the default sandbox route (main-checkout store) and on the capture tile `/?map=20_20` (integration store, manifest SHA-256 checked against the union catalog), the list is an array whose entries carry exactly `root`, `unportedClass` and `reasons`, sorted with no repeated root.
- **Entry counts:** default route 0, capture tile route 0. The 0 is expected for tile geometry, because `bindTileLighting.ts` disposes a diagnostic library material and marks the surface `library-diagnostic` without binding it to a mesh. Skeletal materials (`nativeSkeletalMaterials.ts`) are the runtime path that can bind a diagnostic, so actor keys in 03-08 and 03-09 are where non-empty lists are expected.

## Task commits

1. **Task 1 (tracer): diagnostic material to snapshot().diagnosticMaterials in a browser**: `5d4e59d` (feat)
2. **Task 2: visible, unique and sorted rules under NullEngine tests**: `e229d10` (test)

## Verification

- `node scripts/check-machine-schedule.mjs`: DATABASE-PC, no active window, at every run.
- `pnpm typecheck`: clean.
- `pnpm test:e2e tests/browser/nativeSliceDiagnosticMaterials.spec.ts tests/browser/nativeSliceFraming.spec.ts` (port 5173 free, BelowNormal):
  - default store: 1 passed (default route diagnostic test), 1 skipped (framing, which needs the integration store).
  - `NATIVE_STORE_ROOT=integration`: 2 passed (capture tile diagnostic test and framing), 1 skipped (default route test, which is for the main-checkout store).
- Tracer gate: Task 1's verify was re-run end to end and passed before Task 2.
- `pnpm vitest run tests/unit/visibleDiagnosticMaterials.test.ts tests/unit/materialProgram.test.ts tests/unit/nativeSliceRuntimeCancellation.test.ts`: 3 files, 33 tests passed.
- `node scripts/check-lane-ownership.mjs --base fd91244 --part adapter-dispatch`: `lane integration: 0 foreign paths`.
- Acceptance greps: `grep -cw ue2Diagnostic src/materials/ue2/babylon/material.ts` prints 2. `grep -c diagnosticMaterials src/runtime/nativeSliceDiagnostics.ts` prints 2.

## TDD gate compliance

Task 2 is `tdd="true"`, but the plan has Task 1 build the collector before Task 2 writes its tests. All four behaviour tests passed on their first run, so no failing RED run was possible and no correction to `visibleDiagnosticMaterials` was needed. RED for the feature as a whole came from Task 1's browser spec, which was written first and depends on a field that did not exist yet.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] A required `diagnosticMaterials` broke the typecheck of a partial snapshot fake**
- **Found during:** Task 1
- **Issue:** `tests/unit/nativeSliceRuntimeCancellation.test.ts` assigns a partial `__nativeSlice` fake, so a required field failed `tsc`.
- **Fix:** Made the field optional in the global type, as its sibling read-out fields are (P1203). The runtime snapshot always sets it.
- **Files modified:** src/runtime/nativeSliceDiagnostics.ts
- **Commit:** 5d4e59d

**2. [Rule 3 - Blocking] The default sandbox route does not load on the integration store**
- **Found during:** Task 1
- **Issue:** Under `NATIVE_STORE_ROOT=integration`, `/` stops at "Native terrain materials failed: Native preview texture catalog identity/hash/path is invalid." The capture store had no default-route run of the new spec.
- **Fix:** Added a second test on the capture tile route, which is the store and route 03-08 and 03-09 capture on. Moved the capture tile helper from `nativeSliceFraming.spec.ts` into `tests/browser/captureTileRoute.ts`, so both specs share one owner (P1204). The default-route test runs on the main-checkout store.
- **Files modified:** tests/browser/nativeSliceDiagnosticMaterials.spec.ts, tests/browser/captureTileRoute.ts, tests/browser/nativeSliceFraming.spec.ts
- **Commit:** 5d4e59d

## Open follow-ups

- The default sandbox route `/` on `NATIVE_STORE_ROOT=integration` fails at the terrain preview texture catalog check in `src/scene/world/nativeTerrainPreview.ts` (identity, hash or path invalid, or a repeated asset id). This was not investigated, because it is outside this plan. The capture tile route is not affected.

## Known stubs

None.

## Needs Human

None.

## Process cleanup

- Playwright started its own `pnpm dev` webServer on 5173 for each run and stopped it when the run ended. No listener remains on 5173 or 5175.
- `Get-CimInstance Win32_Process` filtered on `autonomous-roadmap` shows only this session's own shell. No dev server, browser, Vitest worker or Python run remains.

## Self-Check: PASSED

- FOUND: src/materials/ue2/babylon/visibleDiagnosticMaterials.ts, tests/browser/nativeSliceDiagnosticMaterials.spec.ts, tests/browser/captureTileRoute.ts, tests/unit/visibleDiagnosticMaterials.test.ts
- FOUND: 5d4e59d, e229d10
