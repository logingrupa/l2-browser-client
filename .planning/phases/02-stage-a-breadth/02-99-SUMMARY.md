---
phase: 02-stage-a-breadth
plan: 99
subsystem: actors-skills-effects
tags: [skillgrp, engine-dll, dispatch-candidates, byte-replay, effect-bundles, unit-ledger]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-79 skill roots and actors lane catalog, 02-88 tile batch done, 02-95 gap-reasons list version 11, 02-98 summary"
provides:
  - "recipes/actors/skill-dispatch-candidates.json, generated and byte-checked from the pinned R2 replay and the pinned animation notify bindings"
  - "binding statuses reviewed-native-dispatch-candidates (11,210 rows) and reviewed-animation-notify-candidates (4 rows), kept as gaps under skill-dispatch-candidate-runtime-unresolved"
  - "236 sealed skill-dispatch-class units (234 R2 classes plus 2 notify classes), 196 published as interlude:skill-dispatch-class:<effectObject> records"
  - "capstone-free byte replay test of 10 sample rows against the lock-equal engine.dll and soulshot.int"
affects: [02-89, 03-13, 03-19, ACT-06, FX-01]

actuals:
  tokens: 47500
  tasks: 3
  commits: 3
plan_head_before: afb4c769ec5975ba27e13f0e961c062675b52a21
plan_head_after: cfe2517

tech-stack:
  added: []
  patterns:
    - "Generated recipe from pinned research data: hash-pinned input, lock-checked sources, recount gates, canonical bytes, --check byte compare, eol=lf attribute"
    - "One migrate, stage and outcome body (convert_bundle_unit, migrated_bundle_outcome, published_bundle_outcome) shared by skill roots and dispatch class units"

key-files:
  created:
    - recipes/actors/skill-dispatch-candidates.json
    - scripts/actors/skill_dispatch_candidate_recipe.py
    - scripts/actors/skill_dispatch_candidates.py
    - scripts/actors/skill_dispatch_recipe_sources.py
    - scripts/actors/skill_animation_notify_recipe.py
    - scripts/actors/skill_dispatch_class_conversion.py
    - tests/pipeline/skill_dispatch_byte_replay.py
    - tests/pipeline/test_skill_dispatch_byte_replay.py
    - tests/pipeline/test_skill_dispatch_candidates.py
  modified:
    - scripts/actors/skill_binding_table.py
    - scripts/actors/skill_effect_conversion.py
    - scripts/actors/skill_unit_inventory.py
    - scripts/actors/actor_census.py
    - recipes/actors/gap-reasons.json
    - .gitattributes
    - docs/parts/skills-effects/skill-binding-census.json
    - docs/parts/skills-effects/EVIDENCE.md
    - docs/parts/npcs/actor-unit-census.json
    - docs/parts/npcs/EVIDENCE.md
    - tests/browser/sandbox-skill-cast.spec.ts
    - tests/unit/castSkillIndex.test.ts
    - tests/unit/nativeCatalogIndex.test.ts

key-decisions:
  - "02-99: one sealed skill-dispatch-class unit per candidate class, shared by every row that names it; catalog id interlude:skill-dispatch-class:<effectObject> matches no skill lookup, so no candidate plays (P1165, P1166)"
  - "02-99: skill 3 level 1 keeps reviewed-source-dispatch; a class unit converts from the lowest candidate row with one skillgrp and one skillsoundgrp row, else seals gap no-exact-skillsound-row (P1167, P1168)"
  - "02-99: the four animation notify rows get their own status reviewed-animation-notify-candidates and an animationNotify recipe section; the gates ran with 236 class units and 6,361 unresolved rows (P1170, P1172)"
  - "02-99: the byte replay test decodes only the sampled instruction forms without capstone and reuses the native_effect_bundle PE section reader (P1169)"

patterns-established:
  - "Candidate rows stay gaps with a named reason and recipe evidence until a runtime answer exists"

requirements-completed: []

coverage:
  - id: D1
    description: "Generated, pinned skill dispatch candidate recipe with --check"
    requirement: ACT-06
    verification:
      - kind: unit
        ref: "tests/pipeline/test_skill_dispatch_candidates.py"
        status: pass
      - kind: other
        ref: "python -B scripts/actors/skill_dispatch_candidate_recipe.py --replay <rea-in>/20261113-roadmap/skill-dispatch-r2-replay.json --client E:/Lineage2-client --check"
        status: pass
    human_judgment: false
  - id: D2
    description: "Candidate binding statuses in the binding table and census; candidate rows stay gaps"
    requirement: ACT-06
    verification:
      - kind: unit
        ref: "tests/pipeline/test_skill_binding_table.py"
        status: pass
      - kind: other
        ref: "python -B scripts/actors/skill_binding_table.py --client E:/Lineage2-client --check"
        status: pass
    human_judgment: false
  - id: D3
    description: "Byte replay of 10 sample rows against the lock-equal engine.dll"
    requirement: FX-01
    verification:
      - kind: integration
        ref: "tests/pipeline/test_skill_dispatch_byte_replay.py (client-gated cases ran on DATABASE-PC, not skipped)"
        status: pass
    human_judgment: false
  - id: D4
    description: "236 shared class units sealed, catalog records under an id no skill lookup reads"
    requirement: FX-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_skill_effect_batch_bookkeeping.py#SkillDispatchClassUnitTests"
        status: pass
      - kind: unit
        ref: "tests/unit/castSkillIndex.test.ts, tests/unit/nativeCatalogIndex.test.ts, tests/pipeline/test_catalog_index_keys.py"
        status: pass
    human_judgment: false
  - id: D5
    description: "Actor unit census with the candidate reason and the class units"
    requirement: ACT-06
    verification:
      - kind: unit
        ref: "tests/pipeline/test_actor_unit_inventory.py, tests/pipeline/test_actor_census.py"
        status: pass
      - kind: other
        ref: "python -B scripts/actors/actor_census.py --client E:/Lineage2-client --check"
        status: pass
    human_judgment: false
  - id: D6
    description: "Sandbox shows the candidate note for skill 3 level 2 and the unresolved note for skill 42 level 1, no component loaded"
    requirement: ACT-06
    verification:
      - kind: e2e
        ref: "NATIVE_STORE_ROOT=actors DEV_PORT=5175 pnpm test:e2e tests/browser/sandbox-skill-cast.spec.ts; playwright:artifacts/skill-evidence/skill-3-2-gap-1440x900.png"
        status: pass
    human_judgment: false

duration: 2h 30m
completed: 2026-11-14
---

# Phase 2 Plan 99: Skill dispatch candidates Summary

**11,210 empty-description skill rows bound to the byte-replayed R2 dispatch candidates and 4 rows to the replayed animation notify candidates, all kept as `skill-dispatch-candidate-runtime-unresolved` gaps, with 236 shared class units sealed (216 converted, 196 published) and no sealed receipt resealed**

## Performance

- **Duration:** about 2 h 30 min
- **Started:** 2026-11-13T23:24:14Z
- **Completed:** 2026-11-14T01:55Z
- **Tasks:** 3 of 3
- **Files modified:** 30

## Accomplishments

- `scripts/actors/skill_dispatch_candidate_recipe.py` writes `recipes/actors/skill-dispatch-candidates.json` (2,167,760 bytes, SHA-256 `316bba1fe9ce5ba72ef36127bccb6082c670db4939f7aa45b79dff13f3d792fa`) from the replay `bd9fd151...c8fe` and the notify bindings `bd1bbaad...70ba`. It refuses another replay hash, a source pin that differs from the lock, coverage its recount does not reproduce, a cast style outside null, 0 and 12, a class with two package pins and unresolved replay record ids. It checks that every candidate row is one empty-description skillgrp row on E: and that empty rows total 17,576. `--check` compares bytes.
- Recipe content: engine pin `4dd2f63c...` at 0x10300000, verification (2026-11-13, wf_f4663a6a-7bd, 14,505/14,505, 823/823, 1,483/1,483, facts SHA-256 `8b952fde...5517`), 7 stages, 34 tables, 416 dispatches, 39 helper routes, 3 gates, 234 classes, 1,483 bindings, and the `animationNotify` route (4 bindings, 2 classes, wf_943f023e-86b, 845/845, 427/427). No disassembly text.
- Binding census: visualRoot 12,236, reviewedSourceDispatch 1, reviewedNativeDispatchCandidates 11,210, reviewedAnimationNotifyCandidates 4, gap `native-skill-dispatch-required` 6,361; gates by binding none 1,328, transient 139, union-target 16.
- Skills gap rows: 11,214 `skill-dispatch-candidate-runtime-unresolved` (recipe as evidence), 6,361 `native-skill-dispatch-required`. Actor unit census: 11,215 and 6,361 (the inventory does not know the Power Strike recipe), 236 `skill-dispatch-class` units, 7,768 units in total.
- Byte replay: all 30 bindings of skills 1, 3, 56, 1419, 2023, 2025, 2039, 4049, 5007 and 5115 recompute their case VA and class from E: bytes; index shift by one fails 28 of 30. An ad hoc run of the same decoder reproduced all 1,483 bindings.
- Class batch: tracer skill 10 level 1 (`LineageEffect.e_u011_a`), then one process `--batch skills --limit 235`, exit 0, 2026-11-14 00:08:10 to 01:38:31 UTC.

## Task Commits

1. **Task 1: recipe, candidate binding kind, byte replay sample, class unit and tracer** - `149c3ae`
2. **Task 2: actor unit census, catalog index cases and sandbox candidate note** - `d3c3da1`
3. **Task 3: class batch, receipt gate, lane catalog and skills-effects evidence** - `cfe2517`

**Plan metadata:** this SUMMARY commit.

## Class units (Task 3)

| Outcome | Classes |
| --- | --- |
| converted, published pass | 77 |
| converted, published with a class or feature gap (Beam 7, VertMesh 2, BlendBetweenSubdivisions 23, UseDirectionAs 79, UseMeshBlendMode 7, UseActorForces 1) | 119 |
| converted, unpublished: unbound simulated component (`converter-refused`) | 20 |
| `converter-refused` at conversion: default-property syntax 14 (e_u064_a, e_u064_cloud, e_u519_firecracker_0 to 3, e_u519_fireseed_0 to 3, e_u524_meteor, m_u033_a, s_u505_c, s_u807_mage_ca), missing retained Emitters order 3 (NSpear_sp, e_u300_heart_arrow, s_u003_d) | 17 |
| `no-exact-skillsound-row` (e_u001_a, e_u049_a, mb_frintessa_organ_heal) | 3 |
| Total | 236 |

Representative split: 233 classes have a candidate row with one skillgrp and one skillsoundgrp row, 3 do not (measured on E:, not the planning-time 231 and 3: the 2 notify classes both have one).

Disk: tracer drop 30,224,384 bytes (receipt-level 40,103,936); projection 235 x 40,103,936 = 9,424,424,960 bytes against 142,041,722,880 free and the 4,294,967,296 floor; free after 134,412,476,416. Published class store bytes 124,612,037 in 196 manifest folders. The batch's sharing pass shared 189,200,523 bytes.

Receipt gate: fingerprint inputs equal before and after (`print_fingerprint_inputs.py`); 12,001 receipts before, every one present with an equal fingerprint after; 236 new receipts, all of step `skill-dispatch-class` (the tracer gap seals would also have been this step; there are none, the 3 no-exact classes sealed as gaps under the same step). Frozen converter files equal to the plan start commit `afb4c76`. Lane catalog `8458dff23d62a056525ab6b6b55ed1ccd00092c4207f1c46b494f0e915cc1894` (10,845 effect components); `write_lane_catalog.py --lane actors` exit 0, `--plan` exit 0.

## Files Created/Modified

- `scripts/actors/skill_dispatch_candidate_recipe.py` - generator and `--check`
- `scripts/actors/skill_dispatch_recipe_sources.py` - pinned input hashes, lock-checked sources, facts identity
- `scripts/actors/skill_animation_notify_recipe.py` - the notify route section
- `scripts/actors/skill_dispatch_candidates.py` - strict reader, row expansion, reason constant, census block
- `scripts/actors/skill_dispatch_class_conversion.py` - class unit kind
- `scripts/actors/skill_binding_table.py`, `skill_effect_conversion.py`, `skill_unit_inventory.py`, `actor_census.py` - candidate statuses, shared conversion body, class units, census
- `tests/pipeline/skill_dispatch_byte_replay.py` and the tests listed under key-files

## Decisions Made

Rows P1165 to P1173 in `pending-decision-rows.md` (G2): one unit per class; class records under an id no skill lookup reads; skill 3 level 1 keeps reviewed-source-dispatch; the representative rule; the capstone-free decoder; the notify rows' own status; the union-target label not pinned; the gate counts with the added rows; the eol=lf attribute. Another session also numbered a row P1165 (speed lane merge); the orchestrator should renumber one of the two.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added rows changed the gate counts**
- **Found during:** Task 1
- **Issue:** the executor prompt added four animation notify rows and two classes, so the plan gates (234 class units and receipts, 11,211 and 6,365 census rows, 6,365 gap) could not hold.
- **Fix:** gates ran with 236 class units and new receipts, census rows 11,215 and 6,361, skills gap rows 11,214 and 6,361, census key reviewedAnimationNotifyCandidates 4. `classes` stays the 234 R2 classes and `reviewedNativeDispatchCandidates` 11,210.
- **Commit:** `149c3ae`, `d3c3da1`

**2. [Rule 3 - Blocking] `.gitattributes` line for the generated recipe**
- **Found during:** Task 1
- **Issue:** `--check` compares bytes and `core.autocrlf` would rewrite the recipe on checkout.
- **Fix:** `recipes/actors/skill-dispatch-candidates.json text eol=lf`, like the other generated recipes. `check-lane-ownership.mjs --part skills-effects` lists `.gitattributes` as the one foreign path.
- **Commit:** `149c3ae`

**3. [Rule 3 - Blocking] Files outside the plan list**
- `tests/pipeline/test_skill_effect_root_outcomes.py` (Phase 3 shared, clean before the edit), `tests/pipeline/test_actor_census.py` and `tests/pipeline/actor_census_fixture.py` carry the new signatures (candidate document argument, class units on the synthetic run). Four new helper modules keep every file under 400 lines.

**4. [Plan detail] Recompute signature**
- `recompute_candidate_binding(client_bytes, recipe, binding, skill_id, level, index_shift=0)` takes the engine reader and soulshot bytes in one tuple and the row level (needed for the 5007 level table).

---

**Total deviations:** 4 (all blocking or detail). **Impact:** counts follow the added rows; no sealed unit resealed; no frozen file changed.

## Issues Encountered

- The first full sandbox spec run timed out once at 932 x 430 waiting for the world to become ready (240 s) in the cast picker case; its single rerun passed (30.1 s). The 1440 x 900 and portrait cases passed in the first run. Not caused by this plan (the picker casts converted skills); recorded in the evidence.
- `pending-decision-rows.md` refused a heredoc append from this isolated session; the rows were added with the edit tool.

## Reference overlap

No overlap area covers `scripts/actors/**` or `tests/pipeline/**` (`tools/reference-overlap/overlapAreas.json`: materials, bsp-visibility, movement, particles, network), so no run applies.

## Requirement IDs

- ACT-06: open (partial). Candidate bindings exist and stay gaps; rule G9 leaves REQUIREMENTS.md to 02-89.
- FX-01: open (partial). 196 class bundles are published but no candidate plays.

## Open for 02-89

- Which candidate branch plays per stage and gate: 1,075 branches with both sides recorded, 3,208 case calls not traversed, all 292 cases intraprocedural only. One runtime question on IMPORTA-PC (Debug session under DEC-OWN-13 or the REA thread) unblocks it.
- The playback join from a candidate row to its class bundle, after that answer.
- 6,361 rows keep `native-skill-dispatch-required` (skill 7035 level 1 stays unresolved; InitSkillProcess rejects a null target unless cast style is 11, cast style 14 skips the projectile copy, per the gate follow-up `1dc09f2b...5472`).
- 40 unpublished class units: 17 converter refusals, 20 unbound simulated components, 3 no-exact sound rows.
- Fingerprints that changed: none of the existing ones; only 236 new `skill-dispatch-class` receipts. Recipe byte size 2,167,760.
- The animation notify rows hold NPC conditions (selector bit, sequence, notify position in serialized animation position, not seconds) that a playback plan must honour.

## Process cleanup

Every process this plan started has exited: the Playwright runs (PID 87224 waited out, rerun exited), the tracer and the batch (PID 45464, exit 0). No listener on 5173 or 5175; no node, python or browser process with this worktree path in its command line (checked 2026-11-14T01:46:53Z).

## Next Phase Readiness

02-89 reads the open branch question and the class outcomes above. The actors lane catalog `8458dff2...` is ready for the main-checkout restage (merge command printed by `--plan`).

---
*Phase: 02-stage-a-breadth*
*Completed: 2026-11-14*

## Self-Check: PASSED
