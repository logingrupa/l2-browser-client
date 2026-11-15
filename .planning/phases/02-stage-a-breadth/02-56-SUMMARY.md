---
phase: 02-stage-a-breadth
plan: 56
subsystem: shared-core
status: complete
tags: [shared, typed-payload, source-frame, math, rotator, random, clock, fixed-step, golden-trace, import-boundary]
requires:
  - phase: 02-stage-a-breadth
    provides: the lane ownership check, the machine schedule check and the measured red baseline (02-01, 02-02)
provides:
  - src/shared/typedPayload.ts readTypedPayload, TypedPayload and TypedPayloadError over asset.json plus one little-endian payload
  - tests/fixtures/typed-payload/ synthetic golden, written by tests/support/typedPayloadFixture.ts writeTypedPayloadFixture
  - src/world/sourceFrame.ts sourcePositionToWorld, worldPositionToSource, sourceRotationToWorld, sourceHeadingToWorldYaw, worldYawToSourceHeading
  - src/shared/math/ vector3, affineMatrix (inverse and inverse-transpose) and plane (N.P - W)
  - src/shared/math/rotator.ts rotatorUnitsToRadians, rotatorSineFromTable, rotatorSineExact, ROTATOR_CONSTANTS, ROTATOR_RULE_BY_USE
  - src/shared/random.ts createRandomStream, deriveStreamSeed, randomRange, randomUnitVector, RANDOM_STREAM_DOMAINS, RANDOM_REFERENCE_RULES
  - src/shared/presentationClock.ts createPresentationClock and src/shared/fixedStep.ts createFixedStepAccumulator
  - src/shared/referenceConstant.ts ReferenceConstantRow, the one constants row shape
  - tests/support/goldenTrace.ts writeGoldenTrace, readGoldenTrace, compareFloat32ByUlp
  - tests/unit/importBoundaries.shared.test.ts
affects: [02-30, 02-48, 02-60, 02-61, 02-63, 02-65, 02-66, 02-68, 02-69]
tech-stack:
  added: []
  patterns:
    - "Every reference rule is a ReferenceConstantRow with status unconfirmed, provenance and interludeEvidence null until POL-04"
    - "src/shared imports only src/shared; src/world/sourceFrame.ts imports nothing"
    - "Typed payload arrays sit in list order at 4-byte boundaries with zero padding and no trailing bytes"
key-files:
  created:
    - src/shared/typedPayload.ts
    - src/shared/referenceConstant.ts
    - src/shared/math/vector3.ts
    - src/shared/math/affineMatrix.ts
    - src/shared/math/plane.ts
    - src/shared/math/rotator.ts
    - src/shared/random.ts
    - src/shared/presentationClock.ts
    - src/shared/fixedStep.ts
    - src/world/sourceFrame.ts
    - tests/support/typedPayloadFixture.ts
    - tests/support/goldenTrace.ts
    - tests/fixtures/typed-payload/asset.json
    - tests/fixtures/typed-payload/payload.bin
    - tests/unit/typedPayload.test.ts
    - tests/unit/sourceFrame.test.ts
    - tests/unit/nativeSliceDebugPosition.test.ts
    - tests/unit/sharedMath.test.ts
    - tests/unit/sharedRandom.test.ts
    - tests/unit/presentationClock.test.ts
    - tests/unit/goldenTrace.test.ts
    - tests/unit/importBoundaries.shared.test.ts
  modified:
    - src/runtime/nativeSliceDebug.ts
    - src/runtime/nativeSliceDiagnostics.ts
    - .gitattributes
    - docs/parts/adapter-dispatch/EVIDENCE.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md
key-decisions:
  - "Typed payload layout: list order from byte 0, each array at the next 4-byte boundary, byteLength exactly count times element size, zero padding, no trailing bytes, names <GROUP>.<field> (row 150)"
  - "Heading 0 along source +X and 16384 along source +Y, converted to Babylon rotation.y as -heading * pi / 32768 (row 151)"
  - "Placement follows the sine table like scripts/native_map_geometry.py, not the exact rule the plan named; the half-turn entry is its own unconfirmed row (row 152)"
  - "Random domains emitter, light-flicker, tex-jitter, test; sfc32 seeded through splitmix32; string ids allowed for placement ids (row 153)"
  - "The PlayerStart10 round trip uses the committed section corners and Z window of recipes/native-map-debug-location.json (row 154)"
  - "No Co-Authored-By trailer on 02-56 commits, per the plan text (row 155)"
  - "MOVE-01, VIS-01, MAT-01 and FX-01 stay Pending (row 156)"
requirements-completed: []
coverage:
  - id: D1
    description: "Typed payload reader with the committed synthetic golden and every refusal"
    requirement: "MOVE-01"
    verification:
      - kind: unit
        ref: "tests/unit/typedPayload.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "One source frame for positions, rotations and headings, used by the runtime debug readout and diagnostics sourceSpawn"
    requirement: "MOVE-01"
    verification:
      - kind: unit
        ref: "tests/unit/sourceFrame.test.ts"
        status: pass
      - kind: unit
        ref: "tests/unit/nativeSliceDebugPosition.test.ts"
        status: pass
      - kind: unit
        ref: "tests/unit/nativeSliceRuntimeStartup.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Vector, affine matrix, plane and rotator math with unconfirmed constants rows"
    requirement: "VIS-01"
    verification:
      - kind: unit
        ref: "tests/unit/sharedMath.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Seeded domain-tagged random streams, presentation clock and fixed step"
    requirement: "FX-01"
    verification:
      - kind: unit
        ref: "tests/unit/sharedRandom.test.ts"
        status: pass
      - kind: unit
        ref: "tests/unit/presentationClock.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "Golden-trace writer and float32 ulp comparator for every lane"
    requirement: "MAT-01"
    verification:
      - kind: unit
        ref: "tests/unit/goldenTrace.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "src/shared import boundary and the import-free source frame"
    verification:
      - kind: unit
        ref: "tests/unit/importBoundaries.shared.test.ts"
        status: pass
      - kind: unit
        ref: "tests/unit/importBoundaries.test.ts"
        status: pass
    human_judgment: false
duration: 17min
completed: 2026-11-08
commits: 3
plan_head_before: 005fedf512afd16e7513134cfcc50c102f0a6962
plan_head_after: 34b5fea
actuals:
  tokens: 19800
  tasks: 3
  commits: 3
---

# Phase 2 Plan 56: Shared Babylon-free modules and the source frame Summary

**One typed payload container with a byte-exact synthetic golden, one source-to-scene frame wired into the runtime diagnostics, and Babylon-free math, rotator, seeded random, clock, fixed-step and golden-trace homes, all behind an enforced `src/shared` import boundary.**

## Performance

- **Duration:** 17 min
- **Started:** 2026-11-08T17:13:09Z
- **Completed:** 2026-11-08T17:30:00Z
- **Tasks:** 3 of 3
- **Files:** 28 (22 created, 6 modified)

## Accomplishments

- `readTypedPayload(assetJson, payloadBytes)` returns float32, int32, uint32 and uint8 views by name over the given bytes, and refuses units, axes, SHA-256, converter version, name pattern, type, count, alignment, layout gap, padding, overrun, trailing bytes and repeated names with `TypedPayloadError` naming the array.
- The golden `tests/fixtures/typed-payload/` (52 bytes, synthetic) equals `writeTypedPayloadFixture(goldenTypedPayloadArrays, goldenTypedPayloadMetadata)`; `.gitattributes` keeps it byte-exact for the 02-30 Python byte compare.
- `src/world/sourceFrame.ts` is the one transform: `world = (x, z, y) * 0.01`, `source = (X, Z, Y) * 100`, rotation conjugation by the same swap, headings at 65536 per turn as Babylon `rotation.y`. The debug native position and diagnostics `sourceSpawn` go through it; no `* 100` remains in `src/runtime`.
- `src/shared/math/rotator.ts` has the float32 sine table (with the reference half-turn entry) and the exact rule; the largest table-to-exact difference over all 65536 inputs is pinned at 0.0002876213937629265, and the placement converter's table differs only at units 32768 to 32771.
- `src/shared/random.ts` streams are deterministic per session seed, domain and ids, and no two domains share a first draw for the same ids over 500 ids; first draws are pinned.
- `presentationClock` and `fixedStep` own level seconds, dt, pause, seek and the capped step with the backlog dropped; values are parameters.
- `compareFloat32ByUlp` reports the largest ulp distance and the first index past a limit, across zero and signed zeros.

## Task commits

1. Task 1, typed payload reader and source frame: `63c98e2` feat(02-56): read the typed payload container from a golden payload and convert runtime positions through the one source frame
2. Task 2, math, rotator, random, clock, fixed step and golden traces: `e8cf7a9` feat(02-56): add the Babylon-free math, rotator, seeded random, presentation clock, fixed step and golden-trace helper
3. Task 3, shared import boundary: `34b5fea` test(02-56): keep src/shared free of outside modules, packages and DOM globals, and sourceFrame free of imports

The docs commit (EVIDENCE, STATUS, OVERNIGHT-DECISIONS, this SUMMARY, STATE and ROADMAP) follows.

## Verification

- Tracer gate: Task 1 `<verify>` re-run green (typecheck clean; typedPayload, sourceFrame, nativeSliceDebugUrlParameters and nativeSliceDebugPosition pass) before Task 2 started.
- `pnpm typecheck`: clean.
- Task 2 and Task 3 `<verify>`: all pass; `check-lane-ownership --part adapter-dispatch`: lane integration, 0 foreign paths.
- `pnpm test:unit` (at `nice -n 10`): the second run showed only the known red baseline, the 2 `nativeNpcProfiles.test.ts` cases (1499 passed, 82 skipped). The first run also hit load-dependent 5000 ms timeouts (one in `nativeTerrainPreview.test.ts`, 4 failures in 3 files), which did not recur.
- Acceptance: `grep -c "\* 100\b"` prints 0 for both runtime files; `grep -rc "@babylonjs" src/shared` prints 0 for every file; rotator.ts has 7 rows, each with `status` and `provenance`; EVIDENCE names `src/shared`.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] Placement follows the sine table, not the exact rule**
- Found during: Task 2
- Issue: the plan named placement as exact, but `scripts/native_map_geometry.py` rotation_rows already builds static placement matrices from the 16384-entry float32 table.
- Fix: `placement.rotator-conversion` is `sine-table`, pinned by a test against the converter formula; row 152.
- Commit: `e8cf7a9`

**2. [Rule 2 - Missing critical] Half-turn sine table entry**
- Found during: Task 2
- Issue: the reference notes give the half-turn entry as 1.2246063538223773e-16, which is not the float32 of `Math.sin(pi)`.
- Fix: `fx.sine-table-half-turn` unconfirmed row used by the table; the placement converter's 4.05e-21 difference is recorded as open in EVIDENCE.
- Commit: `e8cf7a9`

**3. [Rule 3 - Blocking] PlayerStart10 location**
- Found during: Task 1
- Issue: the exact PlayerStart10 XYZ is only in the ignored research oracle, not in committed test data.
- Fix: the round trip uses the section corners and Z window committed in `recipes/native-map-debug-location.json`; row 154.
- Commit: `63c98e2`

**4. [Rule 2 - Missing critical] Byte-exact fixtures and extra checks**
- `.gitattributes` marks `tests/fixtures/typed-payload/**` as `-text` so `core.autocrlf` cannot change the golden.
- The reader also refuses axes other than `ue2-z-up`, a bad SHA-256 or converter version, layout gaps, non-zero padding, trailing bytes, an unaligned payload start and a big-endian host.
- `tests/unit/nativeSliceDebugPosition.test.ts` pins the debug native position, because no test covered it.
- Additive exports beyond the plan list: `ROTATOR_CONSTANTS`, `RANDOM_REFERENCE_RULES`, `ReferenceConstantRow`, `readGoldenTrace`, and the vector, matrix and plane helpers, each with a test caller.
- Added the `camera-direction` use row named by the 03-movement notes.

**Total deviations:** 4 (1 bug, 2 missing critical, 1 blocking). **Impact:** the shared contracts match the in-repo converter and the reference notes; no Lineage II value was invented.

## Decisions made

OVERNIGHT-DECISIONS rows 150 to 156: container layout, heading convention, one rotator rule per use, stream domains and generator, the PlayerStart10 data, the commit trailer and the Pending requirements.

## Known stubs

None.

## Next phase readiness

Ready for 02-57. Consumers: 02-30 (Python writer byte compare), 02-48 and 02-65 (collision and movement), 02-60 (materials), 02-61 and 02-63 (BSP visibility), 02-68 and 02-69 (particles). `nativeFlameBillboards.ts` and `nativePowerStrikeSource.ts` move to `sourceFrame` in 02-63 and 02-68.

## Process cleanup

This plan started only Vitest runs, tsc, the lane check and two short node scripts under `artifacts/02-56/`, and each one exited. Nothing listens on port 5175. The only node processes running date from Oct 29, so this plan did not start them. No dev server, Vite preview, Playwright or browser was started.

## Self-Check: PASSED

- All 22 created files exist; commits `63c98e2`, `e8cf7a9` and `34b5fea` are on `plan/autonomous-roadmap`.
