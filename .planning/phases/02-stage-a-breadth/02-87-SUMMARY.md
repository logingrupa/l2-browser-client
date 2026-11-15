---
phase: 02-stage-a-breadth
plan: 87
subsystem: runtime
tags: [adapter-dispatch, integration, skill-cast, actor-sounds, sandbox-sheet, gap-closure, sc2e, sc3a, sc3c]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-80 loadSpawnedActorSounds and bindSpawnedActorSoundCues; 02-84 createSkillCastPresentation with its inspection and named gaps"
provides:
  - "createNativeSliceEffects builds skillCast (SkillCastPresentation over the catalog index, the cast skill index and registry pivots) or skillCastFailure"
  - "attachSandboxCommandSheet presents every adapter skill-cast and writes sandbox-skill-cast-note; renders sandbox-actor-sounds-note from SpawnedActorSounds"
  - "src/runtime/spawnedActorSoundWiring.ts wireSpawnedActorSounds and actorClipListingEvents"
  - "src/runtime/sandboxSkillCastNote.ts note text for an inspection, a failure and a missing presentation"
  - "bindSpawnedActorSoundCues takes parsed ActorClipEvent[]"
affects: [02-89, 02-94, 03-05, 03-19]

tech-stack:
  added: []
  patterns: ["only the newest cast writes the cast note", "actor-sounds binding waits for the clip hub listing, then updates on the frame loop", "a counting mixer per binding reports played and dropped cues"]

key-files:
  created:
    - src/runtime/sandboxSkillCastNote.ts
    - src/runtime/spawnedActorSoundWiring.ts
    - tests/unit/sandboxSkillCastWiring.test.ts
    - tests/unit/spawnedActorSoundWiring.test.ts
  modified:
    - src/runtime/attachSandboxCommandSheet.ts
    - src/runtime/createNativeSliceEffects.ts
    - src/runtime/createNativeSliceRuntime.ts
    - src/audio/spawnedActorSoundCues.ts
    - tests/unit/sandboxCommandSheet.test.ts
    - tests/unit/spawnedActorSoundCues.test.ts
    - tests/unit/support/sandboxCommandSheetFakes.ts
    - tests/browser/sandbox-skill-cast.spec.ts
    - tests/browser/sandbox-actor-audio.spec.ts
    - docs/parts/adapter-dispatch/EVIDENCE.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "1055: 3:1 goes through the presentation like every key (placement-unresolved); the reviewed Power Strike previews keep their own sheet group"
  - "1056: sandbox-skill-cast-note lists key, caster and target, emitter actors, feature gaps, named gaps, not drawn, placement gaps, or the catalog reason; no unapplied-natives part (row 983)"
  - "1057: the actor sounds wiring is a new src/runtime/spawnedActorSoundWiring.ts created after the registry, not inside loadNativeSliceAudio"
  - "1058: bindSpawnedActorSoundCues takes the parsed clip events of the clip hub listing; one actors-lane path changed"
  - "1059: only adapter spawn events with npcId or characterTemplateIndex bind; the initial player and Musveren keep the action cue preview"
  - "1060: both notes sit in new Sandbox groups (Skill cast presentation, Actor sounds); cast anchors are valid registry pivot roots"
  - "1061: the played-cue check uses npc:14663, the lowest npc whose bundle binds a notify; npc:12077, the lowest record, binds none"

requirements-completed: []

estimate:
  tokens: 75000
  tasks: 3
actuals:
  tokens: 26658
  tasks: 3
  commits: 3
plan_head_before: fbc52b869332f8b7518a8b7d54d75916993033d1
plan_head_after: b61bcaac1af4e63ac694daa2623abb7c6c686397

coverage:
  - deliverable: "Any converted skill presents on a sandbox skill-cast and the sheet shows its note"
    human_judgment: false
    verification:
      - { kind: unit, ref: "tests/unit/sandboxSkillCastWiring.test.ts", status: pass }
      - { kind: e2e, ref: "tests/browser/sandbox-skill-cast.spec.ts#sandbox cast picker on the actors lane store", status: pass }
  - deliverable: "Spawned npc and character entities load, bind and release their actor-sounds bundle"
    human_judgment: false
    verification:
      - { kind: unit, ref: "tests/unit/spawnedActorSoundWiring.test.ts", status: pass }
      - { kind: e2e, ref: "tests/browser/sandbox-actor-audio.spec.ts#spawned npc actor sounds on the native route", status: pass }
  - deliverable: "Listening judgement of the played actor cues"
    human_judgment: true
    rationale: "Owner listening round (ACT-05); the browser check proves a cue plays, not that it sounds right"

duration: 31min
completed: 2026-11-12
---

# Phase 2 Plan 87: Sandbox skill casts and spawned actor sounds wiring Summary

**Every sandbox `skill-cast` now runs the 02-84 skill cast presentation from the local player at the selected target, and the sheet shows its inspection in `sandbox-skill-cast-note`. Every spawned npc or character loads its own `actor-sounds:<key>` bundle and binds its clip notify cues on the world mixer. The binding is released on removal, respawn or dispose. `sandbox-actor-sounds-note` shows the state of each entity.**

## Performance

- Duration: about 31 minutes (19:40 to 20:11 Riga)
- Tasks: 3 of 3
- Files: 4 created, 11 modified

## Accomplishments

- `createNativeSliceEffects` builds `skillCast` before the Power Strike previews. It uses the catalog index, `buildCastSkillIndex(servedCatalog.effectComponents)`, and anchors taken from valid registry pivot roots. If the cast index refuses, `skillCastFailure` holds the reason. The runtime frame loop calls `advance` on the animation clock, and `addRelease` disposes the presentation.
- `attachSandboxCommandSheet` sends every adapter `skill-cast` event to `present(event)`. Only the newest cast writes the note. The 3:1 gate `startsStagedPowerStrike`, its imports and the `powerStrike` context field are deleted.
- `wireSpawnedActorSounds` handles adapter `spawn` and `despawn` events. It keys an entity as `npc:<id>` or `character:<index>`, and loads the bundle through `loadSpawnedActorSounds` under a per-entity abort controller. Once `clipPreview.actorClipListing(entityId)` exists, it binds `bindSpawnedActorSoundCues` and updates the binding every frame. Each binding gets a counting mixer that reports played and dropped cues and the last cue object and clip.
- Browser runs on `NATIVE_STORE_ROOT=actors`:
  - skill:4:1 is the lowest converted key after 3:1. It presents 1 emitter actor; its named gap is `emitter-feature-unported:UseDirectionAs`, and its target placement is not drawn without a selection.
  - skill:34:1 shows `named gaps: emitter-class-unported:Engine.BeamEmitter` and its BeamEmitter as not drawn.
  - npc:14663 binds 5 notify cues in Wait, Walk, atk01 and spatk01, and plays `monsound2.mechanic_golem.m_golem_metal_creak_1` in Wait.

## Task commits

1. Task 1 (tracer: skill-cast presentation through the sheet): `9dbc99c`. The tracer gate passed: `pnpm vitest run tests/unit/sandboxSkillCastWiring.test.ts tests/unit/sandboxCoverageNotes.test.ts` and `pnpm typecheck` were green before Task 2.
2. Task 2 (spawned actor sound wiring): `97ce12d`
3. Task 3 (browser checks, evidence, decision rows): `b61bcaa`

## Decisions made

OVERNIGHT-DECISIONS rows 1055 to 1061, listed in `key-decisions` above.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] The wiring cannot live in `loadNativeSliceAudio.ts`**
- Found during: Task 2.
- Issue: `loadNativeSliceAudio` runs before the adapter, the entity registry and the clip hub exist, and the binding needs all three.
- Fix: a new `src/runtime/spawnedActorSoundWiring.ts`, created in `createNativeSliceRuntime` right after the registry. `loadNativeSliceAudio.ts` is unchanged and still loads the default bundle (row 1057).
- Commit: `97ce12d`

**2. [Rule 3 - Blocking] `bindSpawnedActorSoundCues` took raw animation events**
- Found during: Task 2.
- Issue: the runtime holds only the parsed `ActorClipEvent` records that the clip hub listing carries. A second asset read would load the model twice.
- Fix: the parameter is now `readonly ActorClipEvent[]` and the module no longer parses. The 02-80 tests parse their raw fixtures first (11 still pass). This is the one foreign path that `node scripts/check-lane-ownership.mjs --base fbc52b8 --part adapter-dispatch` reports: `src/audio/spawnedActorSoundCues.ts` in the actors lane (row 1058).
- Commit: `97ce12d`

**3. [Rule 1 - Bug, test side] Node `Buffer.slice` shares memory**
- Found during: Task 3. `readAssetPackage(readFileSync(...))` failed its SHA-256 check in Node because `Buffer.slice().buffer` is the whole pooled buffer. The browser path is not affected.
- Fix: the spec passes `new Uint8Array(readFileSync(...))`.
- Commit: `b61bcaa`

### Plan adjustments

- **Played-cue npc (row 1061).** npc:12077 is the lowest actor-sounds record. It binds 0 of 12 notifies, because its bundle holds only npcgrp damage and defense sounds. The spec spawns it to check the wiring, then spawns the lowest npc whose served model notifies match exactly one bundle sound: npc:14663. A node-side count with the same rule over the lane store found 591 of 5,175 bundles that bind at least one notify.
- **Note placement (row 1060).** Both notes live in new Sandbox groups. The sandbox group list test now expects eight groups.
- **No unapplied natives in the cast note (row 1056).** The 02-84 inspection has no such field (row 983).
- **Browser runs use `--grep`.** The existing actor-audio report test auditions all 5,175 bundles, and the shared-store Power Strike describe skips under `NATIVE_STORE_ROOT`.
- **The actor-sounds browser check runs at 1440 x 900 only.** The plan asks for the two viewports and the portrait check only for the cast spec.

**Total deviations:** 3 auto-fixed (2 blocking, 1 test-side bug) and 5 recorded adjustments. **Impact:** every must-have holds. A played notify-bound cue is proven on the lowest npc that has one, not on the lowest record.

## Verification

- `pnpm vitest run tests/unit/sandboxSkillCastWiring.test.ts tests/unit/spawnedActorSoundWiring.test.ts`: 17 passed. With `sandboxCoverageNotes`, `sandboxCommandSheet` and `spawnedActorSoundCues`, 54 passed.
- Full `pnpm test:unit` (BelowNormal, no other suite running): 230 files passed and 3 skipped; 2,820 tests passed and 59 skipped.
- `pnpm typecheck`: clean after each task.
- `NATIVE_STORE_ROOT=actors pnpm test:e2e tests/browser/sandbox-skill-cast.spec.ts --grep "sandbox cast picker"`: 3 of 3 on port 5173, run twice (the second run added the note scroll and the note log). Screenshots: `artifacts/skill-evidence/sandbox-cast-skill-4-1-1440x900.png`, `-932x430.png`, `sandbox-cast-skill-34-1-1440x900.png` and `-932x430.png`. No horizontal scroll at 430 x 932.
- `NATIVE_STORE_ROOT=actors pnpm test:e2e tests/browser/sandbox-actor-audio.spec.ts --grep "spawned npc actor sounds"`: 1 of 1. The first two runs failed for the reasons in deviation 3 and row 1061. Screenshot: `artifacts/lane-store/actors/audio-reports/sandbox-actor-sounds-npc-14663-1440x900.png`.
- `node scripts/check-lane-ownership.mjs --base fbc52b8 --part adapter-dispatch`: lane integration, 1 foreign path (`src/audio/spawnedActorSoundCues.ts`, deviation 2).
- Reference overlap: no area in `tools/reference-overlap/overlapAreas.json` covers `src/runtime/**`, `src/audio/**` or `tests/**`, so there is no run to record.
- Headless SwiftShader: no frame rate claim.

## Requirements

ACT-05, ACT-06, FX-01 and SAND-02 advance and stay as they are in REQUIREMENTS.md:
- ACT-05: the runtime half of SC2e is closed, and the owner listening round is still open.
- ACT-06 and FX-01: the runtime half of SC3a and the sheet half of SC3c are closed. Emitter natives and placement fields remain open.
- SAND-02 is already checked.

Rule G9 leaves REQUIREMENTS.md to 02-89, so this plan marks nothing complete.

## Known stubs

None.

## Threat flags

None beyond the register:
- T-02-87-01: casts and spawns enter only through `GameWorldAdapter` events, and the runtime computes no outcome.
- T-02-87-02: there is one presentation per caster and one binding per entity, released on despawn, respawn, dispose and abort.

## Open follow-ups

- Target-side placements draw only when a target is selected. Placement fields (AttachOn, offsets, bRelativeToCylinder, bSizeScale) and emitter natives stay unapplied (02-84 Open; ACT-06, FX-01).
- 4,584 of 5,175 npc bundles bind no clip notify. Their role sounds stay `combat-role-route-unresolved` until a source route exists (ACT-05).
- The owner still has to make the listening judgement of the played cues (ACT-05).

## Process cleanup

- Every Playwright run started its own `pnpm dev` web server on 5173 (`reuseExistingServer: false`), and each run exited on its own. The first run's processes were set to BelowNormal by their command line, which holds this worktree path.
- After the last run, nothing listened on 5173 or 5175. A `Win32_Process` query for command lines that hold `autonomous-roadmap` returned nothing.
- The full Vitest suite ran in the foreground and exited.

## Self-Check: PASSED

- FOUND: src/runtime/sandboxSkillCastNote.ts, src/runtime/spawnedActorSoundWiring.ts, tests/unit/sandboxSkillCastWiring.test.ts, tests/unit/spawnedActorSoundWiring.test.ts
- FOUND: 9dbc99c, 97ce12d, b61bcaa (ancestors of HEAD)
