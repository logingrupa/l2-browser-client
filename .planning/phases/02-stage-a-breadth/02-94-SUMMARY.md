---
phase: 02-stage-a-breadth
plan: 94
subsystem: skills-effects
tags: [act-06, fx-01, emitter-features, census, gap-closure, particles]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-72 named emitter gap rule (emitter-class-unported and emitter-feature-unported reasons count as converted gaps); 02-43 emitter-class-coverage recipe precedent; 02-69 particle material binding"
provides:
  - "recipes/actors/emitter-feature-coverage.json (schemaVersion 1, listVersion 1, source, features [{property, emitterClasses, when}]) with the closed rule vocabulary is-true, is-false, is-nonzero, at-least, equals, not-in, all-of, any-of; leaf conditions carry classDefault and, for compared constants, the TypeScript constant name"
  - "scripts/actors/emitter_feature_coverage.py read_emitter_feature_rules(project_root) and unported_emitter_feature_reasons(component, feature_rules), the one Python reader and evaluator of that recipe"
  - "skill_effect_conversion.py converted_root_outcome: status gap, reason emitter-feature-unported:<property>, converted true, emitterFeatureGaps [{emitter, reason}]; finish() summary emitterFeatureGapRoots {reason: roots}"
  - "particleEmitter.ts listEmitterFeatureChecks(record), emitterFeatureGapReason(property), CAMERA_FACING_DIRECTION_USAGES; UseMeshBlendMode for a MeshEmitter in the one feature list"
  - "particleMaterialBinding.ts bindParticleMaterial returns ParticleMaterialOutcome { drawn: true, binding } | { drawn: false, reason }"
  - "loadEffectComponent: a not-drawn component releases its source meshes and textures, renders 0, never marks the emitter drawn, inspection().notDrawnReason"
affects: [02-79, 03-13]

tech-stack:
  added: []
  patterns: ["a census recipe mirrors a TypeScript list and a Vitest compares their verdicts on synthetic records", "an emitter the runtime cannot draw is skipped and listed, never a load failure"]

key-files:
  created:
    - recipes/actors/emitter-feature-coverage.json
    - scripts/actors/emitter_feature_coverage.py
    - tests/unit/emitterFeatureCoverage.test.ts
  modified:
    - src/effects/particles/sim/particleEmitter.ts
    - scripts/actors/skill_effect_conversion.py
    - tests/pipeline/test_skill_effect_root_outcomes.py
    - src/effects/particles/render/particleMaterialBinding.ts
    - src/effects/loadEffectComponent.ts
    - tests/unit/particleMaterialBinding.test.ts
    - tests/unit/loadEffectComponent.test.ts
    - tests/unit/fogViewDepth.test.ts
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "992: one gap row per skill key and step, so the key row names the first feature reason (component order, then recipe order); the root outcome lists every feature as emitterFeatureGaps and the batch summary counts roots per reason"
  - "993: an unported class keeps the emitter-class-unported reason; features are still listed"
  - "994: a missing non-class-default feature field reads as UE zero, a missing class-default field is refused; classDefault flags and constants are checked by the Vitest"
  - "995: bindParticleMaterial owns the not-drawn decision; loadEffectComponent releases the loaded sources and reports notDrawnReason; emitterActor.ts unchanged since featureGaps already gathers the feature list"

requirements-completed: []

duration: 30min
completed: 2026-11-11
plan_head_before: 77b538b4ac1eb0e9fd581bb913ec65dfc3beb0ac
plan_head_after: 2bde0ccbd6ee2d5a4df17094d7ccaeb6a79747f8
commits: 2

actuals:
  tokens: 26000
  tasks: 2
  commits: 2
---

# Phase 2 Plan 94: Emitter feature census and the UseMeshBlendMode gap Summary

The skills census now reads `recipes/actors/emitter-feature-coverage.json`, a recipe that a Vitest keeps equal to `listEmitterFeatureChecks`. It marks a converted skill root with an unported emitter feature as an `emitter-feature-unported:<property>` gap with converted true. A MeshEmitter with `UseMeshBlendMode` true now loads as a listed feature gap that is not drawn, and no longer throws.

## What was built

- **Task 1, tracer (dba7369).** `UseMeshBlendMode` for a MeshEmitter joins the one feature list (`listMeshFeatureChecks`, called by `listEmitterFeatureChecks`). `listUnportedEmitterFeatures` filters that list. The recipe mirrors the list in order, with one rule per property over `effectiveProperties`. `scripts/actors/emitter_feature_coverage.py` reads it, checks its shape with guard clauses and evaluates it. In `converted_root_outcome` the census applies the recipe to every staged component after the class verdict. Tests:
  - 10 new Python tests: the UseCollision and UseMeshBlendMode gaps, the class verdict kept when no feature is unported, every feature listed in order, the atlas-blend and direction-usage rules, refused missing class-default fields, refused wrong types and refused recipe vocabulary.
  - 19 Vitest cases. Property order per class is checked against `listEmitterFeatureChecks`. Constants are checked against `ROTATION_SOURCE`, `COORDINATE_SYSTEM` and `CAMERA_FACING_DIRECTION_USAGES`, and classDefault flags against `parseEmitterRecord`. The recipe verdict equals `listUnportedEmitterFeatures` on every candidate combination of each rule's fields, for the synthetic sprite, mesh and ribbon records, and on a record with every feature on at once.
  - A mutation check (UseRotationFrom value 2) failed 3 cases and was reverted.
- **Task 2 (2bde0cc).** `bindParticleMaterial` returns `{ drawn: false, reason: "emitter-feature-unported:UseMeshBlendMode" }` for the mesh-materials route and creates no material. `loadEffectComponent` stops binding on that outcome and disposes the loaded source meshes and textures. The component renders 0 instances, never calls `markDrawn` (so the native Inactive gate stays set) and reports `notDrawnReason` in its inspection. The playback actor still loads: its sprite emitter draws and `inspect().featureGaps` lists `Effects.Actor.MeshEmitter1 emitter-feature-unported:UseMeshBlendMode`, from the same `listUnportedEmitterFeatures` path as the other features. New tests:
  - binding outcome, not drawn and drawn
  - component load, release and no markDrawn
  - a playback with a sprite emitter and a mesh-materials emitter, using the real loader

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_skill_effect_root_outcomes.py" -v`: 13 passed. `test_skill_*.py`: 35 passed. `test_world_map_emitter_step.py`: 11 passed.
- `pnpm vitest run` on emitterFeatureCoverage, particleMaterialBinding, loadEffectComponent, fogViewDepth, emitterActor, importBoundaries.particles, emitterActorPlayback, skillCastPresentation and meshEmitter: 89 passed, 1 skipped (already skipped before this plan). nativeEffectComponentPreview, nativeEffectInitPreview, nativeEffectRetained, castSkillIndex, spriteEmitter and ribbonEmitter: 89 passed.
- `pnpm typecheck`: clean.
- `node scripts/check-lane-ownership.mjs --base 77b538b --part skills-effects`: lane actors, 0 foreign paths.
- No Playwright run. This plan changes no UI surface, and the browser harnesses that load effects take the same `loadEffectComponent` path that the unit tests above cover.

## Reference overlap (DEC-OWN-12)

`node tools/reference-overlap/referenceOverlap.mjs --area particles --reference-root C:/laragon/www/l2-browser-client`, report saved at `C:/laragon/l2b-orchestration/autonomous-roadmap/overlap-02-94-particles.json`. Counts for area particles:
- **Blocking runs: 2.** Both are on the emitter ordinal guard of `bindParticleMaterial`, `particleMaterialBinding.ts` lines 136-138 (20 tokens) and 138-139 (24 tokens). The guard is old code that was signed off before. Its token runs changed because the return type next to it changed, which leaves 4 stale sign-offs on that file with no matching run.
- **Unreviewed reviewer runs: 97.** 58 are in `particleMaterialBinding.ts` and 28 in `particleEmitter.ts`, mostly on lines this plan rewrote. The other 11 are in `emitterActorPlayback.ts`, which this plan did not touch.
- **Stale reviewed rows: 86.**

I added no sign-off or reviewed row (run rules). These counts go to the orchestrator's independent overlap review.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] `src/effects/loadEffectComponent.ts` and `tests/unit/fogViewDepth.test.ts` changed, outside the plan file list**
- **Found during:** Task 2
- **Issue:** `loadEffectComponent` is the only runtime caller of `bindParticleMaterial`. It has to handle the not-drawn outcome, or the emitter cannot be skipped. `fogViewDepth.test.ts` called the old return shape.
- **Fix:** handle the outcome in the loader (decision row 995) and unwrap the binding in the fog test helper.
- **Commit:** 2bde0cc

**2. [Plan file list] `src/effects/particles/sim/emitterActor.ts` unchanged**
- `featureGaps` already gathers `listUnportedEmitterFeatures`, which now lists UseMeshBlendMode, so a second path would have duplicated the owner. The actor-level test is in `tests/unit/loadEffectComponent.test.ts`, which holds the real-loader fixture. `tests/unit/emitterActorPlayback.test.ts` stubs the loader.

## Known Stubs

None.

## Open follow-ups

- 02-79 runs the skill batch and census and restages the skills gap rows in the actors lane store. `el_ice_bolt_ta` and every other converted root with an unported feature then move from pass to an `emitter-feature-unported:<property>` gap. This plan ran no batch.

## Process cleanup

This plan started only short-lived `pnpm vitest run`, `pnpm typecheck`, Python unittest and node overlap runs, and each one exited. A final check found no process with this worktree path in its command line, other than the checking shell itself, and no listener on 5173 or 5175.

## Self-Check: PASSED

- FOUND: recipes/actors/emitter-feature-coverage.json, scripts/actors/emitter_feature_coverage.py, tests/unit/emitterFeatureCoverage.test.ts
- FOUND: dba7369, 2bde0cc in HEAD history
