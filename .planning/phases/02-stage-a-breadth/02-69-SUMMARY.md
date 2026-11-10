---
phase: 02-stage-a-breadth
plan: 69
subsystem: actors
tags: [fx-01, act-06, mat-01, particles, thin-instances, ribbon-emitter, emitter-natives, map-emitters, skeletal-materials, dec-own-12]
status: complete
requires:
  - phase: 02-58
    provides: EntityKind npc in the adapter contract
  - phase: 02-60
    provides: particleFragmentChain, createNativeMaterial and selectTextureFrame from src/materials/ue2/babylon/material.ts
  - phase: 02-61
    provides: per-tile map emitter placements (tile-emitters.json)
  - phase: 02-68
    provides: the Sprite and Mesh emitter simulator, the Emitter actor rules and createEffectScheduler
provides:
  - "src/effects/particles/render/particleInstances.ts writeParticleInstances, attachParticleInstanceBuffers, uploadParticleInstances"
  - "src/effects/particles/render/particleMaterialBinding.ts bindParticleMaterial with metadata nativeEmitterOrdinal"
  - "src/effects/particles/render/emitterActorPlayback.ts loadEmitterActorPlayback"
  - "src/effects/particles/render/mapEmitterPlayback.ts playTileMapEmitters, mapEmitterOwnerKey"
  - "src/effects/particles/sim/ribbonEmitter.ts createRibbonEmitterSimulation, attachWeaponTrail"
  - "src/effects/particles/sim/emitterNatives.ts applyEmitterNative, EMITTER_NATIVE_NAMES"
  - "src/assets/native/nativeSkeletalMaterials.ts bindSkeletalSlotMaterials; src/assets/native/nativeSessionSeed.ts drawNativeSessionSeed"
  - "EffectScheduler.removeEffect; emitter-class coverage listVersion 2 with Engine.RibbonEmitter"
affects: [02-64, 02-67, 02-70, POL-04, CHECK-01]
tech-stack:
  added: []
  patterns:
    - "One thin-instance mesh per emitter primitive; instance buffers grow with the emitter columns"
    - "Particle materials come only from particleFragmentChain; DrawStyle 3 and 6 stay at the shipped pairs"
    - "Emitter records and particle columns on a live runtime are replaceable, so natives act on live emitters"
key-files:
  created:
    - src/effects/particles/render/particleInstances.ts
    - src/effects/particles/render/particleMaterialBinding.ts
    - src/effects/particles/render/emitterActorPlayback.ts
    - src/effects/particles/render/mapEmitterPlayback.ts
    - src/effects/particles/sim/ribbonEmitter.ts
    - src/effects/particles/sim/emitterNatives.ts
    - src/effects/nativeEffectTexture.ts
    - src/assets/native/nativeSkeletalMaterials.ts
    - src/assets/native/nativeSessionSeed.ts
    - tests/unit/particleMaterialBinding.test.ts
    - tests/unit/ribbonEmitter.test.ts
    - tests/unit/emitterNatives.test.ts
    - tests/unit/mapEmitterPlayback.test.ts
    - tests/unit/nativeSkeletalMaterials.test.ts
    - tests/fixtures/particles/synthetic-ribbon.json
    - tests/fixtures/particles/synthetic-ribbon.trace.json
  modified:
    - src/effects/loadEffectComponent.ts
    - src/effects/nativeEffectComponentPreview.ts
    - src/effects/nativeEffectInitPreview.ts
    - src/effects/nativeEffectShotPreview.ts
    - src/effects/nativeEffectComponents.ts
    - src/effects/particles/effectScheduler.ts
    - src/effects/particles/sim/emitterActor.ts
    - src/effects/particles/sim/emitterConstants.ts
    - src/effects/particles/sim/emitterRecords.ts
    - src/effects/particles/sim/particleEmitter.ts
    - src/effects/particles/sim/particleSpawn.ts
    - src/effects/particles/sim/particleState.ts
    - src/effects/particles/sim/particleUpdate.ts
    - src/effects/particles/sim/spriteEmitter.ts
    - src/effects/particles/sim/meshEmitter.ts
    - src/assets/native/NativeActor.ts
    - recipes/actors/emitter-class-coverage.json
    - tests/browser/sandbox-skill-cast.spec.ts
    - tests/browser/harness/nativeSkillEffectHarness.ts
    - tests/browser/harness/loadCheckHarness.ts
    - docs/parts/skills-effects/PARTICLE_SEMANTICS.md
    - docs/parts/skills-effects/EVIDENCE.md
    - STATUS.md
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md
  deleted:
    - src/effects/nativeEffectInitTimeline.ts
    - src/effects/nativeEffectShotTimeline.ts
    - src/effects/nativeEffectParticlePool.ts
    - src/effects/nativeEffectMaterial.ts
    - tests/unit/nativeEffectInitTimeline.test.ts
    - tests/unit/nativeEffectShotTimeline.test.ts
    - tests/unit/nativeEffectParticlePool.test.ts
    - tests/unit/nativeEffectMaterial.test.ts
key-decisions:
  - "02-69: the init, shot and component previews keep their exported shape and play through emitterActorPlayback; the closed-form timelines, the slot pool and nativeEffectMaterial are deleted (row 642)"
  - "02-69: particle fragment colour is texel times particle colour into particleFragmentChain; AlphaTest discards alpha <= 0 (fx.particle-alpha-test) (row 643)"
  - "02-69: thin instances in browser axes, mesh node transforms baked into vertices, sprites billboarded in the vertex stage, identity owner pose with the owner transform from the parent anchor (row 644)"
  - "02-69: every mesh primitive gets its own library material; AnimNext follows selectTextureFrame (row 645); drawNativeSessionSeed per load (row 646)"
  - "02-69: the Power Strike cast check runs on the harness page against the shared store (row 647)"
  - "02-69: ribbons simulate with UE-zero ribbon fields and unconfirmed rows but do not draw (ribbon-texture-unstaged) (row 648); attachWeaponTrail skips EntityKind npc (row 649)"
  - "02-69: natives from a closed list with no caller yet; EL_LifeSpan unresolved (row 650); playTileMapEmitters takes parsed records and both gates (row 651)"
  - "02-69: skeletal slots bind through createNativeMaterial when extras carry nativeMaterialProgram; skinned slots keep their material (row 652); two library imports beyond material.ts logged (row 653)"
  - "02-69: overlap recorded, not rewritten (row 654); FX-01, ACT-06 and MAT-01 stay Pending (row 655)"
requirements-completed: []
coverage:
  - id: D1
    description: "Power Strike skill 3 level 1 plays through the simulator and the UE2 particle material in the sandbox harness"
    requirement: FX-01
    verification:
      - kind: e2e
        ref: "DEV_PORT=5175 pnpm test:e2e tests/browser/sandbox-skill-cast.spec.ts (Power Strike from the shared native store, 4 passed)"
        status: pass
      - kind: screenshot
        ref: "artifacts/skill-evidence/skill-3-1-cast-1440x900.png, artifacts/skill-evidence/skill-3-1-cast-932x430.png"
        status: pass
    human_judgment: false
  - id: D2
    description: "Particle material through particleFragmentChain with the shipped PTDS 3 and 6 pairs, nativeEmitterOrdinal metadata and thin-instance buffers"
    requirement: MAT-01
    verification:
      - kind: unit
        ref: "tests/unit/particleMaterialBinding.test.ts"
        status: pass
      - kind: unit
        ref: "tests/unit/loadEffectComponent.test.ts, tests/unit/nativeEffectRetained.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "RibbonEmitter simulation with a 0 ulp golden trace and the NPC weapon-trail rule"
    requirement: FX-01
    verification:
      - kind: unit
        ref: "tests/unit/ribbonEmitter.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "The five L2 emitter natives on live emitters and the closed name list"
    requirement: FX-01
    verification:
      - kind: unit
        ref: "tests/unit/emitterNatives.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "Tile map emitter playback gated by isPlacementVisible and the frustum test"
    requirement: ACT-06
    verification:
      - kind: unit
        ref: "tests/unit/mapEmitterPlayback.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "Skeletal slot materials through createNativeMaterial with the magenta diagnostic"
    requirement: MAT-01
    verification:
      - kind: unit
        ref: "tests/unit/nativeSkeletalMaterials.test.ts"
        status: pass
    human_judgment: false
  - id: D7
    description: "Clean-room overlap of the particles area"
    requirement: FX-01
    verification:
      - kind: other
        ref: "node tools/reference-overlap/referenceOverlap.mjs --area particles --reference-root C:/laragon/www/l2-browser-client"
        status: fail
    human_judgment: true
    rationale: "547 blocking and 2,552 unreviewed runs; the independent reviewer review runs after the wave (run rules DEC-OWN-12)."
estimate:
  tokens: 100000
  tasks: 3
actuals:
  tokens: 122000
  tasks: 3
  commits: 4
commits: 4
plan_head_before: eb35eec138c58b82a6f1aed70f05b972a8eff0a7
plan_head_after: 22a2492e2e916ce67aaeb34e1f2f5a99ae210408
duration: 45min
completed: 2026-11-10
---

# Phase 2 Plan 69: Particle playback, natives, ribbons and library materials Summary

**Power Strike now plays through our own particle simulator as thin instances on the UE2 particle material (shipped PTDS 3 and 6 pairs, nativeEmitterOrdinal metadata); RibbonEmitter, the five L2 natives and tile map emitter playback run in the simulator; skeletal slots bind converted programs through createNativeMaterial; the closed-form timelines, slot pool and preview material are deleted.**

## Performance

- Started 2026-11-10 07:20 Riga, finished 08:05 Riga.
- Tasks: 3 of 3. Commits: 4 (3 task commits and 1 docs commit). Files: 56 changed, 16 new, 8 deleted.

## Accomplishments

- `particleInstances.ts` writes each live simulator slot as one thin instance (matrix, colour, atlas cell, sprite half extent and roll) in browser axes; `particleMaterialBinding.ts` builds the material from `particleFragmentChain` with the record's depth, culling and alpha test and tags each mesh with `nativeEmitterOrdinal`. No effect mesh sets `alphaIndex`.
- `loadEffectComponent.ts` loads one emitter's geometry (GLB node transforms baked into the vertices, or a unit sprite quad) and its AnimNext texture chain, with one library material per mesh primitive; the old single-texture refusal is gone. `emitterActorPlayback.ts` runs a whole emitter actor on `createEffectScheduler`.
- The init, shot and component previews keep their exported shape (src/runtime and src/ui unchanged) and play through the simulator; an AutoDestroy actor completes the preview.
- `ribbonEmitter.ts` samples, interpolates, drops and decays ribbon points; `attachWeaponTrail` applies fx.weapon-trail and gives NPC casters no trail. `emitterNatives.ts` applies AdjustparticleLife, SetSizeScale, SetDelayed, Kill and Trigger to live emitters and refuses any other name. Eleven new constants rows (plus fx.particle-alpha-test) mirror in PARTICLE_SEMANTICS.md.
- `playTileMapEmitters` spawns each placement on the scheduler and shows it only while `isPlacementVisible` and the frustum test pass.
- `nativeSkeletalMaterials.ts` binds slots whose GLB extras carry `nativeMaterialProgram` through `createNativeMaterial` and is called from `NativeActor.loadModel`.

## Task commits

1. Task 1 (tracer): `2581c55` feat(02-69): play Power Strike through the particle simulator and the UE2 particle material. Tracer gate: typecheck, the effect unit suites (228 passed) and the skill-cast spec (4 passed) re-ran green before Task 2.
2. Task 2: `e5c9250` feat(02-69): simulate RibbonEmitter, the five L2 emitter natives and tile map emitter playback
3. Task 3: `ed3d08e` feat(02-69): bind skeletal slot programs through createNativeMaterial; docs `22a2492` docs(02-69): record the FX-01 playback, natives and ribbon evidence, the skills-effects status line and decision rows 642 to 655

## Verification

- `pnpm typecheck`: clean.
- `pnpm test:unit`: 185 files passed, 3 skipped, 1 failed; 2,441 tests passed, 59 skipped, 1 failed. The failure is the recorded red baseline `laneOwnership.test.ts` world evidence size (row 640, docs/parts/world/EVIDENCE.md 30,917 bytes, not touched here).
- Sprite and mesh golden traces unchanged at 0 ulp after the core refactor; `POWER_STRIKE_EFFECT_SOURCE=<main checkout effect-source.json> pnpm vitest run tests/unit/emitterActor.test.ts`: 11 passed, so the Power Strike hashes hold.
- `python -B -m unittest discover -s tests/pipeline -p "test_skill*.py"`: 22 OK; `test_gap_rows.py`: 12 OK.
- Browser (headless SwiftShader, no FPS claim): `DEV_PORT=5175 pnpm test:e2e tests/browser/sandbox-skill-cast.spec.ts` 4 passed (Power Strike block, shared store), and with `NATIVE_STORE_ROOT=actors` 5 passed (actors lane block). Screenshots `artifacts/skill-evidence/skill-3-1-cast-1440x900.png` and `skill-3-1-cast-932x430.png` show the live particles at the harness camera distance; portrait 430 x 932 has no horizontal scroll.
- Acceptance:
  - `git grep -n "alphaIndex" -- src/effects` prints nothing.
  - `grep -c "RibbonEmitter" recipes/actors/emitter-class-coverage.json` prints 1.
  - `grep -c "createNativeMaterial" src/assets/native/nativeSkeletalMaterials.ts` prints 2.
  - The overlap report shows blocking runs (below), so that criterion waits for the independent review.
- `node scripts/check-lane-ownership.mjs --base eb35eec --part skills-effects`: lane actors, 3 foreign paths, exactly the plan's integration-owned docs files (`.planning/OVERNIGHT-DECISIONS.md`, `.planning/STATE.md`, `STATUS.md`); every code, test and recipe path is in the actors lane or shared.
- Overlap, area `particles`: 547 blocking runs, 2,552 unreviewed reviewer runs (5,626 reviewer runs), 4 stale sign-offs. Report `artifacts/reference-overlap/02-69-particles.json`. 479 blocking runs are the GLSL line array of `particleMaterialBinding.ts` against string arrays in `un-particle-emitter.ts`; the largest ribbon run (88 tokens) is the cubic Hermite basis line in `ribbonEmitter.ts` against the reference cubic point, written after reading the reference mechanism and named for the reviewers. No code was rewritten to dodge the tokenizer and no sign-off rows were added.

## Deviations from plan

### Auto-fixed issues

1. **[Rule 3 - Blocking] src/runtime and src/ui may not change.** The runtime and UI wire the Power Strike previews. Fix: the previews keep their exported shape and move onto `emitterActorPlayback.ts` (a render module the plan did not list); `nativeEffectTexture.ts` replaces `nativeEffectMaterial.ts`. Row 642. Commit `2581c55`.
2. **[Rule 3 - Blocking] Skill 3 level 1 is a gap in the actors lane store.** The cast check runs against the shared store in a describe block of its own, and the harness plays every dispatch actor of the bundle. Row 647. Commit `2581c55`.
3. **[Rule 1 - Bug] A sprite quad built before its material created the scene default material.** The quad is now an empty mesh that receives its plane vertex data after the library material binds. Commit `2581c55`.
4. **[Rule 2 - Missing critical] Natives need live records.** Emitter records, particle columns and the actor record became replaceable, KillPending and SpawnOnTrigger joined the counters, and `EffectScheduler.removeEffect` lets map emitter playback release its effects. Golden traces unchanged. Commit `e5c9250`.
5. **[Rule 2 - Missing critical] Skinned slots.** The library vertex stage has no bones, so skinned slots keep their converted material and report `library-vertex-stage-unskinned` instead of drawing in bind pose. Row 652. Commit `ed3d08e`.
6. **[Rule 3 - Blocking] `nativeSliceRuntimeStartup.test.ts` read the component preview's old `loaded` field.** It now reads `playback`. Commit `ed3d08e`.

### Not done as written

- Ribbons do not draw: the staged manifest binds no RibbonEmitter texture (`ribbon-texture-unstaged`), so `loadEffectComponent` refuses them. Row 648.
- `particleMaterialBinding.ts` imports `FOG_DISABLED` from `model/fog` and `NativeActor.ts` imports `loadNativeMaterial`, beyond material.ts. Row 653.
- No map emitter texture or mesh was converted; the tile-emitters records carry no class defaults, so the world binding merges them. Row 651.
- Skeletal slot tests live in `tests/unit/nativeSkeletalMaterials.test.ts` rather than in `particleMaterialBinding.test.ts`, beside the module they test.
- FX-01, ACT-06 and MAT-01 stay Pending (row 655), so `requirements-completed` is empty.

### Process deviations

- Tests were written in the same pass as each module and committed with it, so there are no separate RED commits.

**Total deviations:** 6 auto-fixed (1 Rule 1, 2 Rule 2, 3 Rule 3) and 5 scope adjustments, each with a decision row.

## TDD gate compliance

No separate RED commits: each task's tests landed in its commit. The synthetic ribbon golden trace was written once with `PARTICLE_GOLDEN_WRITE=1` and then compared at 0 ulp in a fresh run.

## Needs Human

None.

## Known stubs

None that hide the plan goal. The open items are named gaps with decision rows and Open follow-ups in STATE.md: ribbon drawing, the adapter-event caller for the natives and weapon trail, the 02-64 tile wiring, slot program conversion and library skinning.

## Threat flags

None beyond the plan register:
- T-02-69-01: instance buffers grow only to the emitter columns, which `parseEmitterRecord` and `forcedMaximumParticles` bound by the 16384 guard; more live slots than instances is a named error.
- T-02-69-02: `parseEmitterNativeCall` accepts only the five names with finite arguments.

## Process cleanup

- Started by this plan: Vitest runs, `tsc`, two Playwright e2e passes with their `pnpm dev` server on port 5175 (Playwright stopped it at the end of each run), the overlap tool, the lane-ownership and machine-schedule scripts, Python unittest runs and node scratch scripts under `artifacts/scratch/02-69/` (ignored path).
- `netstat -ano | grep LISTENING | grep -E ":(5173|5175) "` prints nothing.
- `ps -W` shows only node and Edge WebView processes from Oct 29, which predate this plan; no dev server, Vite preview, Playwright or headless browser from this worktree remains.

## Next phase readiness

02-64 calls `playTileMapEmitters` with the 02-63 memberVisible and merges class defaults into the tile emitter records; 02-67 reads `metadata.nativeEmitterOrdinal`; the adapter-event placement layer calls `applyEmitterNative` and `attachWeaponTrail`.

## Self-Check: PASSED

- FOUND: all 16 created files listed above.
- FOUND on HEAD: 2581c55, e5c9250, ed3d08e, 22a2492.
