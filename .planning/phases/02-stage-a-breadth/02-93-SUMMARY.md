---
phase: 02-stage-a-breadth
plan: 93
subsystem: adapter-dispatch
tags: [integration, gap-closure, move-01, arch-03, vis-01, speed-unresolved, reference-overlap, python-scanner]
status: complete
requires:
  - phase: 02-stage-a-breadth
    provides: 02-55 lane store, 02-57 and 02-67 native slice speed and overlap tooling
provides:
  - NativeSliceSpeedProfile as a sourced or unresolved union, with isNativeSliceAdapterWithSourcedSpeed and NativeSliceAdapterWithSourcedSpeed
  - move-local refusal command-rejected speed-unresolved:<profile id> for an unresolved profile
  - tools/reference-overlap/pythonSourceTokens.mjs (normalisePythonSourceTokens) and scanner choice by file extension
  - bsp-visibility and movement overlap areas that scan the converter Python the area notes name
affects: [02-89 STATE rewrite (follow-ups, row 49 review with P810), the independent overlap review after the wave]
tech-stack:
  added: []
  patterns: [discriminated union on isSourced so an unresolved speed holds no number, type guard narrows the adapter for the gait card, one token vocabulary across the TypeScript and Python scanners]
key-files:
  created:
    - tools/reference-overlap/pythonSourceTokens.mjs
  modified:
    - src/world/NativeSliceAdapter.ts
    - src/runtime/attachNativeSliceSheet.ts
    - tests/unit/nativeSliceAdapterSpeed.test.ts
    - tests/unit/nativeSliceAdapter.test.ts
    - tests/browser/nativeSpeed.spec.ts
    - tests/fixtures/movement/pawnWorldFixtures.ts
    - tests/unit/nativeDoors.test.ts
    - tests/unit/nativeLocomotion.test.ts
    - tests/unit/nativeLocomotionControls.test.ts
    - tests/unit/nativeSpecialAttackPreview.test.ts
    - tests/unit/worldMovementWiring.test.ts
    - tools/reference-overlap/referenceOverlap.mjs
    - tools/reference-overlap/referenceOverlap.d.mts
    - tools/reference-overlap/sourceTokens.mjs
    - tools/reference-overlap/overlapAreas.json
    - tests/unit/referenceOverlapTokens.test.ts
    - tests/unit/referenceOverlap.test.ts
decisions:
  - "P960: the unresolved speed profile carries isSourced false, playerProfileId and source and no number; an adapter given no speed holds no-speed-profile and refuses with speed-unresolved:no-speed-profile"
  - "P961: movement scans scripts/world/collision_*.py, static_collision_sources.py and terrain_collision_source.py (the realised names of the collision steps 03-movement.md lists)"
  - "P962: the Python scanner drops string-only statements (docstrings) and import and from statements to their logical line end, and newlines emit no token"
  - "P963: the unreachable speed unresolved branch of src/ui/nativeLocomotionControls.ts (data-ui lane) stays unedited and is listed for 02-89"
metrics:
  duration: 15min
  completed: 2026-11-11
commits: 2
plan_head_before: 64f8c63b2a3d569670af5a95960958f9dbd0f39d
plan_head_after: e1ed85d35e71773bbf703081bcacda38c8e1cc86
actuals:
  tokens: 46900
  tasks: 2
  commits: 2
---

# Phase 2 Plan 93: speed-unresolved refusal and Python converters in the overlap check Summary

Unsourced player classes now hold an unresolved speed profile with no numbers and get a `speed-unresolved:<profile id>` refusal on move-local. The 70 UU/s stand-in is deleted. The clean-room overlap check now tokenises the Python converters that the bsp-visibility and movement notes name, using the same token rules as the TypeScript scanner.

## Tasks

| Task | Name | Commit | Key files |
| ---- | ---- | ------ | --------- |
| 1 | Tracer: an unsourced mystic profile is refused move-local with speed-unresolved, end to end | b9818d1 | src/world/NativeSliceAdapter.ts, src/runtime/attachNativeSliceSheet.ts, tests/browser/nativeSpeed.spec.ts |
| 2 | Python converters in the clean-room overlap check, counts and cleanup | e1ed85d | tools/reference-overlap/pythonSourceTokens.mjs, referenceOverlap.mjs, overlapAreas.json |

## What changed

- `NativeSliceSpeedProfile` is now `SourcedNativeSliceSpeedProfile | UnresolvedNativeSliceSpeedProfile`, split on `isSourced`. The unresolved member holds `playerProfileId` and `source` only. `SYNTHETIC_SLICE_SPEED` and its 0.7 m/s and 70 UU/s values are gone. `nativeSliceSpeedProfile` returns the unresolved member for every profile except `human-male-fighter` and `human-female-fighter`, which keep the aCis 80 and 115 UU/s. An adapter given no speed holds the unresolved member `no-speed-profile`.
- `moveLocalPlayer` emits `command-rejected` with reason `speed-unresolved:<profile id>` for an unresolved profile and sends no move record. The check comes after the existing collision and move-type refusals. `set-locomotion` behaves as before. The adapter refuses; it computes no outcome.
- Sheet: `attachSourcedGaitCard` mounts `attachNativeLocomotionControls` only behind `isNativeSliceAdapterWithSourcedSpeed`. For an unresolved profile the gait group shows a warning note, `native-speed-unresolved`, that reads `speed-unresolved: <source>`, and `movement.speed` reads `speed-unresolved: move-local is refused` with the source text. No readout prints a speed for an unresolved profile. `createNativeSliceRuntime.ts` already narrowed on `isSourced` and needed no edit. `src/runtime/nativeSliceDiagnostics.ts` and `src/ui/nativeLocomotionControls.ts` are unedited and typecheck unchanged.
- `tools/reference-overlap/pythonSourceTokens.mjs` exports `normalisePythonSourceTokens`. Identifiers and strings (including the r, b, f, u, t prefixes and triple quotes) become the shared placeholders. Python keywords and operators are kept. `#` comments, string-only statements (docstrings) and `import`/`from` statements are dropped up to their logical line end, which follows bracket depth, backslash continuations and `;`. Numbers go through `readNumericLiteral`, now exported from `sourceTokens.mjs`, so a Python literal and the same JavaScript literal give the same canonical token. `referenceOverlap.mjs` picks the scanner by file extension (`.py` gets the Python scanner, everything else the TypeScript one).
- `overlapAreas.json`: bsp-visibility adds `scripts/world/bsp_visibility*.py`, `scripts/world/bsp_leaf_membership.py` and `scripts/world/level_zones.py`. Movement adds `scripts/world/collision_*.py`, `scripts/world/static_collision_sources.py` and `scripts/world/terrain_collision_source.py`.

## Overlap counts after the change (for the independent overlap review)

Command: `node tools/reference-overlap/referenceOverlap.mjs --area <area> --reference-root C:/laragon/www/l2-browser-client`. The reports are at `artifacts/reference-overlap-02-93/bsp-visibility.json` and `artifacts/reference-overlap-02-93/movement.json` in this worktree. Every unreviewed run is in a Python converter. Before this change both areas had 0 unreviewed runs (the TypeScript sources are unchanged). This plan signs nothing off and added no rows to `signedOffRuns.json` or `reviewedRuns/`.

| Area | Source files (Python) | Reviewer runs | Signed off | Reviewed | Unreviewed (all Python) | Blocking (all Python) | Stale |
| ---- | --------------------- | ------------- | ---------- | -------- | ----------------------- | --------------------- | ----- |
| bsp-visibility | 23 (5) | 4238 | 300 | 3810 | 128 | 3 | 0 |
| movement | 39 (4) | 7861 | 328 | 7370 | 163 | 1 | 0 |

Blocking runs (20 or more tokens) for the independent review:
- bsp-visibility: `scripts/world/bsp_visibility_census.py:23-24` at 20, 22 and 24 tokens, against `.assets/reference/lineage2js/src/assets/unreal/skills/native-effects.ts:450-454`. These are dictionary literal keys and subscripts in `tile_census_row`.
- movement: `scripts/world/collision_step.py:299-300` at 20 tokens, against `.assets/reference/lineage2js/src/physics/collision-primitive.ts:661`. This is the argument list of `chunk_collision_records`.

Both command runs exit 1 on these blocking runs. Under the run rules that is not a stop: the orchestrator's independent review handles them after the wave.

## Verification

- `pnpm vitest run tests/unit/nativeSliceAdapterSpeed.test.ts tests/unit/nativeSliceAdapter.test.ts tests/unit/gameWorldAdapterContract.test.ts` plus the movement, doors, locomotion, special attack, wiring, controls, equip, visual, environment and sandbox command files: 14 files, 156 tests pass.
- `pnpm vitest run tests/unit/referenceOverlapTokens.test.ts tests/unit/referenceOverlap.test.ts tests/unit/referenceOverlapReviewedRuns.test.ts`: 3 files, 83 tests pass.
- Full `pnpm test:unit` (no other suite was running, BelowNormal): 224 files pass, 3 skipped; 2752 tests pass, 59 skipped.
- `pnpm typecheck` passes. The stand-in grep (`SYNTHETIC_SLICE_SPEED|runSourceUnitsPerSecond: 70` in NativeSliceAdapter.ts) finds nothing.
- `pnpm test:e2e tests/browser/nativeSpeed.spec.ts` (port 5173 was free, BelowNormal): 3 passed in 1.3 min. The fighter at 1440 x 900 shows `1.15 m/s (walk speed for the first 0.4 s)` and sends a move record. The mystic at 1440 x 900 and at 932 x 430 (isMobile, hasTouch) shows the speed-unresolved note and no gait card, its snapshot speed is the unresolved profile, and move-local leaves `movement.lastLocalDestination` null. Screenshots: `artifacts/native-speed/mystic-speed-unresolved-desktop.png` and `artifacts/native-speed/mystic-speed-unresolved-mobile.png` (checked: the Walk / run group shows the note). Headless SwiftShader, so no FPS claim.
- `node scripts/check-lane-ownership.mjs --base 64f8c63 --part adapter-dispatch`: lane integration, 0 foreign paths.

## Requirements

- MOVE-01 (with ARCH-03): the slice-14 finding on `NativeSliceAdapter.ts:187` is closed. Unsourced classes are held as speed-unresolved. The requirement status is unchanged (owner review of provisional IDs is pending, 02-89 rewrites statuses).
- VIS-01 (with MOVE-01): the slice-14 finding on `overlapAreas.json:35` is closed. The converters are scanned, and the new runs wait for the independent review. Status unchanged.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Movement tests relied on the deleted 70 UU/s default**
- Found during: Task 1
- Issue: `nativeDoors`, `nativeLocomotion`, `nativeSpecialAttackPreview`, `worldMovementWiring` and `nativeSliceAdapter` built moving adapters without a speed. They now get the refusal, so 15 tests failed.
- Fix: `tests/fixtures/movement/pawnWorldFixtures.ts` exports `sourcedHumanFighterSpeed` (the sourced aCis profile), and those adapters take it. `nativeSliceAdapter.test.ts` now expects speeds walk 80 and run 115.
- Commit: b9818d1

**2. [Rule 3 - Blocking] The gait card test passed an adapter whose speed is now a union**
- Found during: Task 1
- Issue: `tests/unit/nativeLocomotionControls.test.ts` would not typecheck, and its unresolved-readout case pinned 0.70 m/s.
- Fix: the test builds sourced fighter adapters narrowed by `isNativeSliceAdapterWithSourcedSpeed`. The unresolved readout case is deleted along with the stand-in (P963). `src/ui/nativeLocomotionControls.ts` is unedited.
- Commit: b9818d1

**3. [Rule 3 - Blocking] The tool-file count in referenceOverlap.test.ts**
- Found during: Task 2
- Issue: the text-only test counts the `.mjs` tool files (8). The new scanner makes 9.
- Fix: the count is now 9. The new file passes the same no-execution pattern check.
- Commit: e1ed85d

**4. [Plan wording] The unresolved profile holds the profile id as well as its source**
- The refusal reason `speed-unresolved:<profile id>` needs the id, and the adapter knows no profile id. The unresolved member therefore carries `playerProfileId` (a string, no number). Recorded as P960.

## Decisions logged

OVERNIGHT-DECISIONS rows 960 to 963 (P960 to P963) are listed in the frontmatter.

## Open follow-ups (for 02-89)

- `src/ui/nativeLocomotionControls.ts` (data-ui lane) keeps an `isSourced` field on `NativeLocomotionSpeeds` and a `, speed unresolved` readout branch that no runtime path reaches now that the card mounts only for a sourced profile. The data-ui owner deletes both (P963).
- The Python converter overlap runs in the table above (bsp-visibility 128 unreviewed, 3 blocking; movement 163 unreviewed, 1 blocking) wait for the independent overlap review.
- The row 49 owner review stays in Needs Human and now includes P810. The owner may restore a labelled stand-in there.

## Known Stubs

None. No stand-in values remain. An unresolved speed is shown as unresolved.

## Threat Flags

None. No new endpoint or trust boundary. The scanner reads reference clone files as text only, and the no-execution test covers the new file.

## Process cleanup

The Playwright web server and browsers from the e2e run exited with the run. After it, no listener was on 5173 or 5175, and no process with this worktree path in its command line remained apart from the executor's own shell. The Vitest runs exited normally. A final check runs before return.

## Self-Check: PASSED

- FOUND: tools/reference-overlap/pythonSourceTokens.mjs
- FOUND: b9818d1, e1ed85d (ancestors of HEAD)
