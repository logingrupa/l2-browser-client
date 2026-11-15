---
phase: 02-stage-a-breadth
plan: 68
subsystem: actors
tags: [fx-01, act-06, particles, emitter-simulation, golden-trace, fixed-step, import-boundary, dec-own-12]
status: complete
requires:
  - phase: 02-43
    provides: skill effect bundles whose components carry effectiveProperties with the Interlude class defaults, and the emitter-class coverage recipe
  - phase: 02-56
    provides: src/shared random streams, fixedStep, presentationClock, rotator sine table, referenceConstant rows, sourceFrame and tests/support/goldenTrace.ts
  - phase: 02-57
    provides: the particles area of tools/reference-overlap and the vendor import boundary
provides:
  - "src/effects/particles/sim/emitterRecords.ts: parseEmitterRecord, parseEmitterActorRecord, EmitterRecordError, per-field provenance"
  - "src/effects/particles/sim/spriteEmitter.ts createSpriteEmitterSimulation and meshEmitter.ts createMeshEmitterSimulation, meshMaterialRoute"
  - "src/effects/particles/sim/emitterActor.ts createEmitterActorSimulation, EmitterActorSimulation, createEmitterSimulation"
  - "src/effects/particles/effectScheduler.ts createEffectScheduler, EffectScheduler"
  - "src/effects/particles/sim/emitterConstants.ts PARTICLE_CONSTANTS (48 rows with the two random.ts rows in the doc) and PARTICLE_SIMULATOR_VERSION"
  - "docs/parts/skills-effects/PARTICLE_SEMANTICS.md constants registry"
  - "gap reason emitter-feature-unported:<property> (actors listVersion 6)"
  - "tests/fixtures/particles synthetic fixtures, golden traces and power-strike.hashes.json"
affects: [02-69, 02-70, 02-61, POL-04, CHECK-01]
tech-stack:
  added: []
  patterns:
    - "Emitter records are typed through one UE field table per class; a class-default field missing from effectiveProperties is a named refusal"
    - "Particle columns are Float32Array; every write rounds through Math.fround; one emitter-domain stream per emitter keyed by session seed, effect serial and ordinal"
    - "Golden traces regenerate only with PARTICLE_GOLDEN_WRITE=1 and otherwise compare at 0 ulp"
    - "Host-global boundary checks use an esbuild define probe with a positive control"
key-files:
  created:
    - src/effects/particles/sim/emitterRecords.ts
    - src/effects/particles/sim/emitterConstants.ts
    - src/effects/particles/sim/particleState.ts
    - src/effects/particles/sim/particleCurves.ts
    - src/effects/particles/sim/particleRotation.ts
    - src/effects/particles/sim/particleSpawn.ts
    - src/effects/particles/sim/particleUpdate.ts
    - src/effects/particles/sim/particleEmitter.ts
    - src/effects/particles/sim/spriteEmitter.ts
    - src/effects/particles/sim/meshEmitter.ts
    - src/effects/particles/sim/emitterActor.ts
    - src/effects/particles/effectScheduler.ts
    - docs/parts/skills-effects/PARTICLE_SEMANTICS.md
    - tests/unit/spriteEmitter.test.ts
    - tests/unit/meshEmitter.test.ts
    - tests/unit/emitterActor.test.ts
    - tests/unit/importBoundaries.particles.test.ts
    - tests/unit/support/particleFixtures.ts
    - tests/fixtures/particles/synthetic-class-defaults.json
    - tests/fixtures/particles/synthetic-sprite.json
    - tests/fixtures/particles/synthetic-sprite.trace.json
    - tests/fixtures/particles/synthetic-mesh.json
    - tests/fixtures/particles/synthetic-mesh.trace.json
    - tests/fixtures/particles/power-strike.hashes.json
  modified:
    - src/effects/nativePowerStrikeSource.ts
    - recipes/actors/gap-reasons.json
    - docs/parts/skills-effects/EVIDENCE.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md
key-decisions:
  - "02-68: the shared UE2 emitter core lives in particleEmitter, particleSpawn, particleUpdate, particleCurves and particleRotation; Sprite and Mesh wrap it (row 486)"
  - "02-68: fx.simulation-step 1/60 s (unknown) and fx.simulation-step-cap 8 (unconfirmed), backlog dropped; effectScheduler.ts owns particle stepping (row 487)"
  - "02-68: the Power Strike real-client case reads POWER_STRIKE_EFFECT_SOURCE and skips with a reason without it; hashes only (row 488)"
  - "02-68: Independent and Spray particles are stored in world space after birth (row 489)"
  - "02-68: atlas blend holds at SubdivisionEnd when set (row 490); MaxParticles 0 to 16384 and 64 respawn passes are our guards (row 491)"
  - "02-68: rotator axes from the shared sine table, row fx.rotator-axes (row 492); natives, triggers, deferred spawns, sounds and bounds wait for 02-69 (row 493)"
  - "02-68: nativePowerStrikeSource derives its source-to-glTF matrix from sourcePositionToWorld (row 494); the host-global check is an esbuild define probe (row 495)"
  - "02-68: overlap report recorded, not rewritten (row 496); FX-01 and ACT-06 stay Pending (row 497)"
requirements-completed: []
coverage:
  - id: D1
    description: "Deterministic SpriteEmitter simulation with record parsing, provenance, refusals and a 0 ulp golden trace"
    requirement: FX-01
    verification:
      - kind: unit
        ref: "tests/unit/spriteEmitter.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "MeshEmitter simulation, material route and emitter-feature-unported gaps"
    requirement: FX-01
    verification:
      - kind: unit
        ref: "tests/unit/meshEmitter.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Emitter actor rules and the fixed-step scheduler"
    requirement: ACT-06
    verification:
      - kind: unit
        ref: "tests/unit/emitterActor.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Power Strike hash-only traces from the converter output"
    requirement: FX-01
    verification:
      - kind: unit
        ref: "POWER_STRIKE_EFFECT_SOURCE=<main checkout effect-source.json> pnpm vitest run tests/unit/emitterActor.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "Particle core import boundary"
    requirement: FX-01
    verification:
      - kind: unit
        ref: "tests/unit/importBoundaries.particles.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "Clean-room overlap of the particles area"
    requirement: FX-01
    verification:
      - kind: other
        ref: "node tools/reference-overlap/referenceOverlap.mjs --area particles --reference-root C:/laragon/www/l2-browser-client"
        status: fail
    human_judgment: true
    rationale: "110 blocking and 2,508 unreviewed structural runs; the independent reviewer review runs after the wave (run rules DEC-OWN-12)."
actuals:
  tokens: 81000
  tasks: 3
  commits: 4
commits: 4
plan_head_before: 2d6be4aebae761acff91ea2fad6a07c81ab18339
plan_head_after: 315028b112302df9a0e5d8b1efe0cea2824985e2
duration: 25min
completed: 2026-11-09
---

# Phase 2 Plan 68: Emitter simulation core Summary

**Our own deterministic UE2 emitter port in plain TypeScript: Sprite and Mesh emitters on float32 columns with seeded per-emitter streams, the Emitter actor rules, a 1/60 s fixed-step scheduler on the presentation clock, 0 ulp synthetic golden traces, hash-only Power Strike traces, a 48-row constants registry and named feature gaps.**

## Performance

- Started 2026-11-09 17:35 Riga, finished 17:59 Riga.
- Tasks: 3 of 3. Commits: 4. Files: 29 changed, 24 of them new.

## Accomplishments

- `parseEmitterRecord` and `parseEmitterActorRecord` read bundle `effectiveProperties` through one field table per class. They keep `authored`, `class-default` or `ue-zero` provenance per field, and refuse a wrong value type, a missing Interlude class default, an unsimulated class and an out-of-range MaxParticles with `EmitterRecordError`.
- The simulator runs the 04-particles reference loop as unconfirmed defaults: rate selection with automatic initial spawning, spread birth ages, the shape draws (box, sphere, polar, all), sibling location and velocity, rotation sources, velocity direction modes, respawn with the double InitialTimeRange draw, Euler motion, quantized revolution, size, velocity, revolution and colour curves with repeats, fades, opacity, the MaxAbsVelocity clamp, velocity loss and the dead rule.
- Sprites add PTDU_None uniform size, Z roll and column-major atlas cells with a byte blend weight. Meshes add the spin rotator and the material route (`UseMeshBlendMode=false` gives the DrawStyle particle material and `RenderTwoSided` from the record).
- `createEmitterActorSimulation` runs GlobalOffset, initial delay, warmup, AutoReset, AutoDestroy with the bNoDelete and bStatic refusal, SpeedRate, bRotEmitter and LifeSpan. It lists AutoReplay, VisibleLimit, non-unit DrawScale3D and CoordinateSystem=Absolute as unresolved and never applies DrawScale.
- `createEffectScheduler` steps live effects through `createFixedStepAccumulator` (1/60 s, cap 8, backlog dropped) on `clock.frameDeltaSeconds`. Each effect gets the next serial, so spawning another effect does not change an existing trace.
- With the main checkout's converter output, both Power Strike actors compile with no feature gaps and only AutoReplay unresolved: p_u004_a is destroyed after 19 steps (peak 11 live), s_u002_a after 101 steps (peak 9 live).
- `nativePowerStrikeSource.ts` no longer holds `SOURCE_TO_GLTF`; it derives the same column-major matrix from `sourcePositionToWorld`.

## Task commits

1. Task 1 (tracer): `44d465e` feat(02-68): simulate one SpriteEmitter record deterministically with a golden trace. The tracer gate re-ran typecheck and `spriteEmitter.test.ts` (8 passed) before Task 2.
2. Task 2: `4c9e9b7` feat(02-68): run Mesh emitters under the Emitter actor rules on a fixed-step scheduler
3. Task 3: `4779477` test(02-68): keep the particle simulator and scheduler inside src/shared with no packages or host globals; docs `315028b` docs(02-68): FX-01 simulator evidence, the skills-effects status line and decision rows 486 to 497

## Verification

- `pnpm typecheck`: clean.
- `pnpm test:unit`: 163 files passed, 5 skipped; 2,240 tests passed, 83 skipped. No red.
- Task verifies: `spriteEmitter.test.ts` 8 passed; `meshEmitter.test.ts`, `emitterActor.test.ts` and `nativePowerStrikeSource.test.ts` 70 passed, 1 skipped (the Power Strike case without the env var); `importBoundaries.particles.test.ts` 16 passed.
- With `POWER_STRIKE_EFFECT_SOURCE=C:/laragon/www/l2-browser-client/artifacts/native-parity/migration/effects/power-strike-source-dispatch/effect-source.json`: the Power Strike case passes against `power-strike.hashes.json`.
- Acceptance:
  - `grep -rc "@babylonjs" src/effects/particles/sim` prints 0 for every file.
  - `grep -c "emitter-feature-unported" recipes/actors/gap-reasons.json` prints 1.
  - `grep -c "SOURCE_TO_GLTF" src/effects/nativePowerStrikeSource.ts` prints 0.
  - `grep -c "PARTICLE_SEMANTICS" docs/parts/skills-effects/EVIDENCE.md` prints 2.
  - The overlap report shows blocking runs (see below), so this criterion waits for the independent review.
- `node scripts/check-lane-ownership.mjs --base 2d6be4a --part skills-effects`: lane actors, 0 foreign paths.
- Overlap, area `particles`: 110 blocking runs, 2,508 unreviewed reviewer runs (2,724 reviewer runs in all). Report `artifacts/reference-overlap/02-68-particles.json`. The largest runs (31 to 39 tokens) are typed field tables and interface field lists matched against `l2js-core/src/unreal/un-array.ts` and conf-file readers, so they are structural. No code was rewritten to dodge the tokenizer and no sign-off rows were added.

## Deviations from plan

### Auto-fixed issues

1. **[Rule 2 - Missing critical] Shared core modules beyond the six named files.**
   - Found during Task 1. Sprite and Mesh share every spawn and update rule.
   - Fix: `particleEmitter.ts`, `particleSpawn.ts`, `particleUpdate.ts`, `particleCurves.ts` and `particleRotation.ts` hold the one core, and `tests/unit/support/particleFixtures.ts` holds the fixture and trace helpers. Row 486. Commit `44d465e`.
2. **[Rule 3 - Blocking] TypeScript 7.0.2 has no JS compiler API.**
   - Found during Task 3. The planned no-DOM compile check could not run, and the shared regex would flag every `location` variable.
   - Fix: an esbuild `define` probe with a positive control. Row 495. Commit `4779477`.
3. **[Rule 1 - Bug] The atlas next cell stopped at cell 2 for Start 2, End 3.**
   - Found during Task 1 by the atlas test.
   - Fix: the blend holds at SubdivisionEnd when set. Row 490. Commit `44d465e`.
4. **[Rule 2 - Missing critical] Guards for threat T-02-68-01.**
   - MaxParticles 0 to 16384 and a 64-pass respawn guard, each with its own constants row. Row 491. Commit `44d465e`.

### Not done as written

- **`--client`.** The Power Strike case reads `POWER_STRIKE_EFFECT_SOURCE` (path to the converter's `effect-source.json`) because Vitest has no `--client` flag. Row 488.
- **Overlap.** The acceptance "no blocking run" is not met by this plan; per the run rules the independent review after the wave settles it.

### Process deviations

- Task 2 tests were written in the same edit pass as the modules and passed after two test fixes (mesh steps until the first spawn), so there is no separate RED commit.

**Total deviations:** 4 auto-fixed (1 Rule 1, 2 Rule 2, 1 Rule 3) and 2 scope adjustments, each with a decision row.

## TDD gate compliance

There are no separate RED commits: each task's tests landed in the same commit as its code. The synthetic golden traces were written once with `PARTICLE_GOLDEN_WRITE=1` and then compared at 0 ulp in a fresh run.

## Needs Human

None.

## Known stubs

None. The simulator is not yet rendered or wired into the Power Strike preview; 02-69 does that, and the closed-form preview modules stay until then (EVIDENCE Open).

## Threat flags

None beyond the plan register:
- T-02-68-01: MaxParticles bounds every pool (0 to 16384), and a non-finite value fails the field check.
- T-02-68-02: every read field is type-checked with a named error.

## Process cleanup

- Started by this plan: Vitest runs, `tsc`, the machine-schedule and lane-ownership scripts, the overlap tool, and short esbuild and node scratch scripts under `artifacts/scratch/02-68/`. Each one exited, and the scratch folder was removed.
- `netstat -ano | grep LISTENING | grep -E ":(5173|5175) "` prints nothing.
- `ps -W` shows only node and Edge processes from Oct 29 to Nov 5, which predate this plan. No dev server, Vite preview, Playwright or browser was started.

## Next phase readiness

02-69 renders the frames (`columns`, `liveSlots`, `atlasCell`, `spriteRoll`, `meshRotator`, `materialRoute`, `storageSpace`), adds RibbonEmitter and the L2 natives, switches the Power Strike preview to the simulator, deletes the closed-form modules, and extends `emitter-class-coverage.json` with `simulatedEffectEmitterClasses`.

## Self-Check: PASSED

- FOUND: all 24 created files listed above.
- FOUND on HEAD: 44d465e, 4c9e9b7, 4779477, 315028b.
