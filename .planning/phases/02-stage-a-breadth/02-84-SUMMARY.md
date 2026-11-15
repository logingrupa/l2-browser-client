---
phase: 02-stage-a-breadth
plan: 84
subsystem: effects
tags: [act-06, fx-01, skills-effects, skill-cast, emitter-natives, named-gaps, gap-closure]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-72 named emitter gap rule (converted true, status gap, emitter-class-unported:<class>); 02-68 and 02-69 emitter simulation, emitter actor playback and emitterNatives"
provides:
  - "src/effects/skillCastPresentation.ts createSkillCastPresentation({ scene, catalogIndex, castSkillIndex, anchors, signal }) with present(skill-cast event), advance(elapsedSeconds), dispose(); SkillCastInspection { key, casterId, targetId, catalogStatus, reason, emitterActors, placements, notDrawn, featureGaps, namedGaps }"
  - "src/effects/skillEffectPlacements.ts recordedSkillEffectPlacements(manifest): SkillAction_LocateEffect stage rows to caster or target placements with unappliedFields"
  - "src/effects/nativeEffectComponents.ts loadCastSkillEffectBundle(record, signal) and the validated optional EffectManifest.stages (EffectStageRecord)"
  - "EmitterActorPlayback.applyNative(call) delegating to applyEmitterNative on the started simulation"
  - "NativeCatalogLookup converted answers carry namedGaps; describeNativeCatalogLookup names them"
  - "Not-drawn reasons skill-effect-placement-unresolved, skill-effect-anchor-unavailable:<side>, emitter-class-unported:<class>; superseded cast reason skill-cast-superseded"
affects: [02-87, 02-79, 02-94, 03-05, 03-19]

tech-stack:
  added: []
  patterns: ["one presentation per caster, disposed by a newer cast of that caster", "placement read from recorded stage rows only; unported placement fields listed, never guessed"]

key-files:
  created:
    - src/effects/skillCastPresentation.ts
    - src/effects/skillEffectPlacements.ts
    - tests/unit/skillCastPresentation.test.ts
  modified:
    - src/effects/nativeEffectComponents.ts
    - src/effects/particles/render/emitterActorPlayback.ts
    - src/assets/native/nativeCatalogIndex.ts
    - docs/parts/skills-effects/EVIDENCE.md
    - tests/unit/nativeEffectComponents.test.ts
    - tests/unit/emitterActorPlayback.test.ts
    - tests/unit/emitterNatives.test.ts
    - tests/unit/nativeCatalogIndex.test.ts
    - tests/unit/nativeEffectInitPreview.test.ts
    - tests/unit/nativeEffectComponentPreview.test.ts
    - tests/unit/nativeEquippedBodyPartItems.test.ts
    - tests/unit/nativeEquippedItemPresentation.test.ts
    - tests/unit/nativeEquippedItemSource.test.ts
    - tests/unit/nativeWindowRegistry.test.ts
    - tests/unit/sandboxCharacterVisual.test.ts
    - tests/unit/sandboxCommandSheet.test.ts
    - tests/unit/sandboxCoverageNotes.test.ts
    - tests/unit/sandboxMissingAsset.test.ts
    - tests/unit/sandboxNpcAppearances.test.ts
    - tests/unit/support/sandboxPickerHarness.ts
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "981: placements come only from SkillAction_LocateEffect stage rows (bSpawnOnTarget true is the target, otherwise the caster); reviewed dispatch stages are not mapped, so 3:1 reads skill-effect-placement-unresolved here and keeps its reviewed previews"
  - "982: AttachOn, offsets, bRelativeToCylinder, bSizeScale and stage timing are listed as unappliedFields; playbacks sit at the anchor pivot and start at the cast"
  - "983: no served manifest records an emitter native call; applyNative lands on the playback with its tests, the presentation applies none and carries no unapplied-natives field"
  - "984: unsimulated components emitter-class-unported:<class>, missing anchor skill-effect-anchor-unavailable:<side>, load failure with its message, superseded cast skill-cast-superseded"
  - "985: loadCastSkillEffectBundle split out of loadNativeSkillEffectComponents; parseEffectManifest validates the optional stages records"
  - "986: namedGaps is required on converted lookups through one convertedLookup helper; ten shared test doubles updated; the Phase 3 coverage test is untouched"
  - "987: skills-effects EVIDENCE kept under 30,720 bytes by condensing ribbon address detail the constants rows hold"

requirements-completed: []

estimate:
  tokens: 75000
  tasks: 3
actuals:
  tokens: 23450
  tasks: 3
  commits: 3
plan_head_before: 6a8bed8e1d89495fed799eef6172c149a9e901aa
plan_head_after: 41fc42d58457c29494ae4c63561eb9da3d800d05

coverage:
  - deliverable: "Skill cast presentation for any converted skill key"
    human_judgment: false
    verification:
      - { kind: unit, ref: "tests/unit/skillCastPresentation.test.ts", status: pass }
  - deliverable: "Emitter actor playback native hook"
    human_judgment: false
    verification:
      - { kind: unit, ref: "tests/unit/emitterActorPlayback.test.ts#emitter actor playback native hook", status: pass }
      - { kind: unit, ref: "tests/unit/emitterNatives.test.ts", status: pass }
  - deliverable: "Named gaps on converted catalog lookups and in the cast inspection"
    human_judgment: false
    verification:
      - { kind: unit, ref: "tests/unit/nativeCatalogIndex.test.ts#named gaps on converted catalog keys", status: pass }
      - { kind: unit, ref: "tests/unit/skillCastPresentation.test.ts#carries the named gaps", status: pass }
  - deliverable: "Visible cast in the sandbox"
    human_judgment: true
    rationale: "No runtime caller until 02-87 wires the presentation to the sandbox skill-cast event; no browser check was run in this plan"

duration: 12min
completed: 2026-11-11
---

# Phase 2 Plan 84: Skill cast presentation, emitter native hook and named gaps Summary

**Any converted `skill:<id>:<level>` now presents its emitter actors at the caster or target anchor that its `SkillAction_LocateEffect` stage rows record. Every component that is not drawn is named with its reason. The cast inspection carries the feature gaps and the catalog index named gaps (such as `emitter-class-unported:Engine.BeamEmitter`). The playback gets an `applyNative` hook, but no served manifest records a native call.**

## Performance

- Duration: about 12 minutes (16:04 to 16:16 UTC, 18:04 to 18:16 Riga)
- Tasks: 3 of 3
- Files: 3 created, 21 modified (including 10 shared test doubles)

## Accomplishments

- `createSkillCastPresentation` looks up `skill:<id>:<level>` in the catalog index. A key that is not converted returns its status and reason and starts nothing. For a converted key it loads the bundle through `loadCastSkillEffectBundle` and reads placements from the manifest stage rows. It then starts one `loadEmitterActorPlayback` per placement under the anchor that the caller's `anchors(entityId)` returns. The inspection holds the emitter actor count, placements (side, source stage, unapplied fields), not-drawn components with reasons, the feature gaps of the started playbacks and the index named gaps. A new cast by the same caster disposes the previous presentation. `advance` runs on the caller's frame clock.
- In the served manifests (36 manifests, 80 actors), 78 actors have one `SkillAction_LocateEffect` row each: 43 caster and 35 target. The 3:1 manifest records no stage row.
- `EmitterActorPlayback.applyNative(call)` delegates to `applyEmitterNative` on the started simulation and refuses a call before start. `emitterNatives.ts` is now imported only by that hook, which the boundary test checks.
- Converted catalog lookups carry `namedGaps`, taken from coverage rows with converted true and a non-pass status. `describeNativeCatalogLookup` returns `skill:1011:1 converted with named gaps: emitter-class-unported:Engine.BeamEmitter`. Gap and not-in-catalog answers are unchanged.
- The skills-effects EVIDENCE has a new section "Skill cast presentation (plan 02-84, 2026-11-11)" and an updated Open list (30,699 bytes).

## Task commits

1. Task 1 (tracer: presentation of a converted key other than 3:1): `3fa118e`
2. Task 2 (playback native hook): `74c3803`
3. Task 3 (named gaps, inspection, evidence): `41fc42d`

## Decisions made

OVERNIGHT-DECISIONS rows 981 to 987, listed in `key-decisions` above.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Bundle loading and stage records live in `nativeEffectComponents.ts` (not in the plan file list)**
- Found during: Task 1. The presentation gets a cast record, but the only loader read the catalog again. `EffectManifest` also had no typed `stages`.
- Fix: split out `loadCastSkillEffectBundle(record, signal)`. `parseEffectManifest` now validates the optional `stages` records (a new test case in `nativeEffectComponents.test.ts`). The placement rule lives in its own module, `skillEffectPlacements.ts`. Row 985.
- Commit: `3fa118e`

**2. [Rule 3 - Blocking] Fake playbacks and the emitter natives boundary test**
- Found during: Task 2. Adding `applyNative` to `EmitterActorPlayback` broke the typed fakes in `nativeEffectInitPreview.test.ts` and `nativeEffectComponentPreview.test.ts`. It also broke `emitterNatives.test.ts`, which required that no module import `emitterNatives.ts`.
- Fix: the fakes throw on `applyNative`. The boundary test now accepts only `src/effects/particles/render/emitterActorPlayback.ts` as an importer.
- Commit: `74c3803`

**3. [Rule 3 - Blocking] Converted lookup doubles in ten shared test files**
- Found during: Task 3. With `namedGaps` required, `pnpm typecheck` refused every converted `NativeCatalogLookup` double.
- Fix: added `namedGaps: []` in the doubles and in the `toEqual` expectations of `nativeCatalogIndex.test.ts`. `nativeCatalogIndexCoverage.test.ts` (Phase 3) uses `toMatchObject` and was not edited. Row 986.
- Commit: `41fc42d`

**4. [Plan fallback] No manifest records a native call**
- None of the 36 served manifests has a native-call field or entry (searched for the five names). The presentation therefore applies no native. Its inspection carries no unapplied-natives field, because that field would always be empty. Only the playback hook test exercises `applyNative` (row 983), so `emitterNatives.ts` still has no runtime caller. That half of gap SC3a stays open until a converter records native calls with their arguments.

**5. [Placement scope] 3:1 is placement-unresolved in the presentation**
- 3:1 records reviewed dispatch stages (init, shot) but no `SkillAction_LocateEffect` row. The presentation does not map the dispatch stages (row 981).

**Total deviations:** 3 auto-fixed blocking issues and 2 recorded scope outcomes. **Impact:** the plan's must-haves hold for recorded data. Native application and the 3:1 placement wait on data that the manifests do not hold.

## Verification

- `pnpm vitest run tests/unit/skillCastPresentation.test.ts tests/unit/emitterActorPlayback.test.ts tests/unit/nativeCatalogIndex.test.ts tests/unit/importBoundaries.particles.test.ts`: 97 passed.
- `pnpm vitest run tests/unit/emitterNatives.test.ts tests/unit/nativeEffectInitPreview.test.ts tests/unit/nativeEffectComponentPreview.test.ts tests/unit/nativeEffectComponents.test.ts`: passed.
- Full `pnpm test:unit`, BelowNormal, after Task 3 code and before the evidence edit: 226 files passed, 3 skipped; 2,768 tests passed, 59 skipped.
- `pnpm typecheck`: clean after each task.
- `node scripts/check-lane-ownership.mjs --base 6a8bed8 --part skills-effects`: lane actors, 0 foreign paths.
- Reference overlap: `node tools/reference-overlap/referenceOverlap.mjs --area particles --reference-root C:/laragon/www/l2-browser-client` gives 0 blocking runs and 11 unreviewed runs, all in `src/effects/particles/render/emitterActorPlayback.ts` (interface and hook lines), plus 4 stale reviewed runs. Report: `artifacts/reference-overlap/02-84-particles.json`. The orchestrator's independent review covers them. `skillCastPresentation.ts` and `skillEffectPlacements.ts` sit outside every overlap area.
- No browser check: this layer has no runtime caller until 02-87.

## Requirements

- ACT-06 and FX-01: advanced (the effects half of gaps SC3a and SC3c), still Pending. `requirements.ready-ids` blocks both, because sibling plans that also declare them (02-79, 02-87, 02-94) have no SUMMARY yet. Rule G9 also leaves REQUIREMENTS.md to 02-89.

## Known stubs

None. The presentation has no runtime caller yet by design (index rule 14; 02-87 wires it).

## Threat flags

None beyond the plan's register. T-02-84-01: no native call is read from served data. T-02-84-02: one presentation per caster.

## Open follow-ups

- Emitter natives need a converted source of native calls with arguments (for example the skill action argument behind `bSizeScale`). Until then `applyEmitterNative` has no runtime caller (FX-01).
- Placement inside the anchor is still unapplied: AttachOn bones (EAttachMethod names in the manifest `classEnums`), offsets, `bRelativeToCylinder`, and stage timing between CastingActions and ShotActions (ACT-06, FX-01).
- 3:1 placement in the presentation: the reviewed dispatch stages have no recorded anchor. 02-87 should keep the reviewed Power Strike previews as the 3:1 route, or accept placement-unresolved for it.

## Next phase readiness

- 02-87 can call `createSkillCastPresentation` with `anchors` from the entity registry and show `notDrawn`, `featureGaps`, `namedGaps` and `placements[].unappliedFields` in the `sandbox-skill-cast-note`. There is no unapplied-natives field (row 983). Something must call `advance(elapsedSeconds)` every frame.
- 02-79 writes the same EVIDENCE next; it is at 30,699 bytes.

## Process cleanup

No dev server, Vite preview, Playwright or e2e runner was started. Every Vitest run, including the one full suite, finished in the foreground. After Task 3, no process with this worktree path in its command line remained, and nothing listened on 5173 or 5175.

## Self-Check: PASSED

- FOUND: src/effects/skillCastPresentation.ts, src/effects/skillEffectPlacements.ts, tests/unit/skillCastPresentation.test.ts
- FOUND: 3fa118e, 74c3803, 41fc42d on HEAD
