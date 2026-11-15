---
phase: 03-stage-a-checks
plan: 02
subsystem: adapter-dispatch
tags: [typescript, sandbox, world-command, camera, environment, playwright, stage-a]
requires:
  - phase: 02-stage-a-breadth
    provides: NativeSliceAdapter, wireWorldEnvironment and the environment clock, the __nativeSlice snapshot camera read-out
provides:
  - set-environment WorldCommand member (15-member contract) answered with the existing environment event
  - nativeSliceCameraPose.ts with applyNativeSliceCameraPose and assertNativeSliceCameraPoseWithinLimits
  - window.__nativeSlice.setCameraPose, routed through the follow camera owner in createNativeSliceRuntime
  - tests/browser/nativeSliceFraming.spec.ts on the integration 20_20 capture route
affects: [03-07, 03-08, 03-09, 03-18]
actuals:
  tokens: 8300
  tasks: 2
  commits: 2
plan_head_before: 059717d4f9fcb8c21ac036764535861b8365cbca
plan_head_after: 82b94c352838e260dce00630c72242c025d31f1d
tech-stack:
  added: []
  patterns:
    - "Sandbox world state enters only as an adapter event; validation stays with the clock"
    - "A diagnostic camera setter validates the whole pose before any write and leaves follow mode through the follow camera owner"
key-files:
  created:
    - src/runtime/nativeSliceCameraPose.ts
    - tests/unit/nativeSliceSetEnvironment.test.ts
    - tests/unit/nativeSliceCameraPose.test.ts
    - tests/browser/nativeSliceFraming.spec.ts
  modified:
    - src/world/worldTypes.ts
    - src/world/NativeSliceAdapter.ts
    - src/runtime/nativeSliceDiagnostics.ts
    - src/runtime/createNativeSliceRuntime.ts
    - tests/unit/gameWorldAdapterContract.test.ts
    - docs/parts/adapter-dispatch/EVIDENCE.md
    - STATUS.md
key-decisions:
  - "P614: the framing spec runs on NATIVE_STORE_ROOT=integration at /?map=20_20, the capture route, because the default route's main-checkout store has no lighting resource for its section"
  - "P615: setCameraPose validates, releases effect inspection, leaves follow mode, then applies, in createNativeSliceRuntime; the pose holds until Follow fighter"
patterns-established:
  - "Sandbox halves set their hour with dispatch({type: set-environment}) and their framing with setCameraPose(snapshot().camera pose)"
requirements-completed: []
requirements-addressed: [CHECK-01]
duration: 26min
completed: 2026-11-11
status: complete
---

# Phase 3 Plan 02: Sandbox framing command and camera pose setter summary

**A `set-environment` sandbox command that sets the hour only through the adapter's environment event, and a `window.__nativeSlice.setCameraPose` that applies a snapshot camera read-out exactly or refuses it with the field or limit it breaks.**

## Performance

- **Duration:** 26 min
- **Started:** 2026-11-11T07:42Z
- **Completed:** 2026-11-11T08:08Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments

- `WorldCommand` has 15 members: `set-environment {gameMinutes, environmentType}`. `NativeSliceAdapter` answers it with `{type: "environment", ...}`, which `wireWorldEnvironment` applies to the clock. The adapter writes no second range check: the clock refuses bad values and the wiring counts the rejection (T-03-04: no clock setter on `__nativeSlice`).
- `applyNativeSliceCameraPose(camera, pose)` checks the three target components, alpha, beta and radius for finite numbers, then radius and beta against the camera's own limits. A null limit means no bound. It writes target, alpha, beta and radius only after every check passes and never clamps (T-03-05).
- `setCameraPose` is on the diagnostics object, its input and the global `__nativeSlice` type (3 occurrences).
- The adapter-dispatch EVIDENCE contract line and the STATUS line say 15 members and name `set-environment` (P22). EVIDENCE is 30,690 bytes, under the 30,720 limit.

## Seam: follow camera owner (plan Task 2)

While `followFighter` is true, the per-frame observer in `createNativeSliceRuntime.ts` rewrites `camera.target`, and `movement.constrainFollowCamera()` rewrites the radius. Writing the Babylon camera directly would be undone on the next frame. So `setCameraPose` lives next to `frameWorld` and `frameFlame` in the runtime. It runs `assertNativeSliceCameraPoseWithinLimits` first, which leaves a refused pose with both follow state and camera unchanged. Then it releases any effect-inspection focus, sets `followFighter = false` and calls `applyNativeSliceCameraPose`. The pose holds until the sheet's Follow fighter button. Today no movement command turns follow mode back on (P615).

## Task commits

1. **Task 1: set-environment from dispatch through the adapter to the clock, with the contract doc** - `803034d`
2. **Task 2: camera pose setter, Playwright framing check, ownership check and cleanup** - `82b94c3`

## Verification

- `pnpm vitest run` on nativeSliceSetEnvironment, nativeSliceCameraPose, gameWorldAdapterContract, nativeSliceAdapter and laneOwnership: 5 files, 65 tests passed. `pnpm typecheck` is clean.
- Tracer gate (Task 1): the verify was re-run end to end and passed before Task 2.
- Playwright, after checking that port 5173 was free each time:
  - `NATIVE_STORE_ROOT=integration pnpm test:e2e tests/browser/nativeSliceFraming.spec.ts`: 1 passed. The pose round-trips with alpha + 0.5. A radius 1 m above `upperRadiusLimit` is refused and the pose stays the same. `set-environment` with the current environment type and 720 minutes raises `appliedEventCount` by one, leaves `rejectedEventCount` unchanged and sets the clock `source` to `environment-event`.
  - `pnpm test:e2e tests/browser/nativeSliceFraming.spec.ts tests/browser/nativeCamera.spec.ts` on the default store: both `nativeCamera.spec.ts` tests passed with this plan's code. On the default route the framing spec failed at the environment step: the clock was absent (see deviation 1). The camera steps had already passed there.
- `node scripts/check-lane-ownership.mjs --base 059717d --part adapter-dispatch` and `--base 803034d`: `lane integration: 0 foreign paths`.
- Reference overlap: no DEC-OWN-12 area (`materials`, `bsp-visibility`, `movement`, `particles`, `network`) covers the files this plan wrote, so no overlap run applies.
- The self-contained repo name check (DEC-OWN-11) is empty for everything this plan wrote.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] The framing spec runs on the integration capture route instead of the default route**
- **Found during:** Task 2, first Playwright run
- **Issue:** The default route serves `public/l2`, the main-checkout store, which still waits for the main-checkout restage. Its 20_20 section pins no `lighting` resource, so `section.environmentClock` is null. `set-environment` therefore ends as `environment-clock-absent` and cannot reach a clock.
- **Fix:** The spec opens `/?map=20_20` on `NATIVE_STORE_ROOT=integration`, the store that the index's sandbox-half captures run on. That union tile manifest pins `lighting`. The spec checks the served manifest SHA-256 against the union catalog, and it is skipped on any other store. `nativeCamera.spec.ts` stays on the default route.
- **Files modified:** tests/browser/nativeSliceFraming.spec.ts
- **Commit:** 82b94c3 (decision row P614)

**2. [Rule 2 - Seam] `createNativeSliceRuntime.ts` edited (not in the plan's file list)**
- **Found during:** Task 2
- **Issue:** The follow camera rewrites target and radius every frame. The plan's action said to route the pose through the follow camera's owner in that case.
- **Fix:** Added `setCameraPose` to the runtime and passed it to the diagnostics (file at 367 lines).
- **Commit:** 82b94c3 (decision row P615)

## Decisions logged

P614 and P615 are in `C:/laragon/l2b-orchestration/autonomous-roadmap/pending-decision-rows.md` (provisional, owner review).

## Needs Human

None.

## Open follow-ups

- The default-route store has no environment clock until the main-checkout restage (the existing Needs Human restage command). After the restage, the framing spec can also run on the default route.
- docs/parts/adapter-dispatch/EVIDENCE.md is at 30,690 of 30,720 bytes. Plans 03-17 and 03-18 must trim before they add text.

## Process cleanup

The two Playwright runs (each with its own `pnpm dev` webServer on 5173) exited by themselves. A stray background `grep -r` that this executor started was stopped by PID (26788, 3584, 22672). A `bash.exe.stackdump` written to the worktree root during the e2e run was deleted, along with the `test-results/nativeSliceFraming-*` failure artifacts. Final check: no listener on 5173 or 5175, and `Get-CimInstance Win32_Process` shows no node, chrome, msedge, headless, python or vite process with `autonomous-roadmap` in its command line.

## Self-Check: PASSED

- FOUND: src/runtime/nativeSliceCameraPose.ts, tests/unit/nativeSliceSetEnvironment.test.ts, tests/unit/nativeSliceCameraPose.test.ts, tests/browser/nativeSliceFraming.spec.ts
- FOUND: 803034d, 82b94c3 (ancestors of HEAD)
- `grep -c "set-environment" src/world/worldTypes.ts` = 1; `grep -c "15-member sandbox command contract" STATUS.md` = 1; `grep -c "setCameraPose" src/runtime/nativeSliceDiagnostics.ts` = 3
