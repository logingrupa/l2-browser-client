---
phase: 02-stage-a-breadth
plan: 72
subsystem: integration
tags: [int-01, world-03, world-06, act-05, fx-01, coverage, gap-census, derived-keys, gap-closure]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-26 gap census and coverage report; 02-55 integration union bba52c47 and union coverage; review fixes 6d189c8 (converted keys take their failed or gap step) and f5828ee (skills verdict step)"
provides:
  - "Key kinds minimap:XX_YY (minimap), tile-collision:XX_YY (movement-geodata), tile-audio:XX_YY, npc-sounds:<id> and skill-sound-row:<n> (audio) in CATALOG_KEY_PATTERNS"
  - "scripts/native_store/gap_census_derived_parts.py: DERIVED_PARTS, derived_tile_denominator, derived_converted_keys, derived_part_rows"
  - "gap_census_denominators: audio_denominator (153 tiles + 6,495 npcgrp rows naming a sound + 1,398 skill-sound-row units), npc_sound_denominator, skill_sound_row_denominator, skill_sound_census_rows; sandbox unknown with its reason"
  - "Named emitter gap rule: a skills row with emitter-class-unported:<class> or emitter-feature-unported:<property> leaves the published key converted, status gap with that reason; is_named_emitter_gap_reason and NAMED_EMITTER_GAP_REASONS in gap_census.py"
  - "Part converted counts pass rows only; converted plus gap plus pending equals every counted denominator"
  - "Coverage markdown line listing converted keys with a named emitter gap per part and reason"
affects: [02-74, 02-84, 02-89, 02-94, 03-05]

tech-stack:
  added: []
  patterns: ["derived census keys re-keyed in memory from lane step rows, never written to lane gap-row files"]

key-files:
  created:
    - scripts/native_store/gap_census_derived_parts.py
    - tests/pipeline/test_gap_census_derived_parts.py
  modified:
    - scripts/native_store/gap_rows.py
    - scripts/native_store/gap_census.py
    - scripts/native_store/gap_census_denominators.py
    - scripts/native_store/coverage_denominators.py
    - scripts/native_store/build_coverage_report.py
    - docs/OUTPUT_CONTRACT.md
    - tests/pipeline/test_gap_census.py
    - tests/pipeline/test_coverage_report.py

key-decisions:
  - "P818: derived key kinds with one owner module; the census re-keys lane step rows in memory and writes no lane gap-row file"
  - "P819: tile-audio converts when the union tile manifest pins world-audio or carries no audio step gap row (the step found nothing to convert)"
  - "P820: the pass-row converted count lands in Task 2 because the Task 2 check needs it"
  - "P821: review fix 6d189c8 stays; the validator keeps accepting converted true with any listed non-pass reason; the emitter rule lands in the skills verdict step"
  - "P822: the npc sound identity step name stays a literal in the census module; no actors-lane file is edited"

requirements-completed: []

estimate:
  tokens: 70000
  tasks: 3
actuals:
  tokens: 15700
  tasks: 3
  commits: 3
plan_head_before: 9731675ffe30c3286e0de8771a9fa42d55b3157f
plan_head_after: f04668a373240f8bea9f3185be5c92c858480c35

duration: 21min
completed: 2026-11-11
---

# Phase 2 Plan 72: Coverage denominators for audio, minimap and movement-geodata and named emitter gaps Summary

**Derived census keys give audio (8,046), minimap (153) and movement-geodata (153) committed denominators whose sums close in the union report, the sandbox states why it has no count, and the 522 Engine.BeamEmitter skill roots read gap with converted true.**

## Performance

- Duration: about 21 minutes (11:15 to 11:36 UTC)
- Tasks: 3 of 3
- Files: 2 created, 8 modified

## Accomplishments

- One owner module `scripts/native_store/gap_census_derived_parts.py` (`DERIVED_PARTS`) for five key kinds. Converted predicates read the union tile manifests and minimap manifests through the pinned manifest reader of `catalog_index_keys.py` and `validate_tile_manifest`; `npc-sounds` reads `combatAudio` records `actor-sounds:npc:<id>`.
- Every derived key has one status: converted, else the lane step row of its tile or npc re-keyed in memory, else pending `step-pending:<step>` with the identity of the source key's `census` row. `skill-sound-row` keys take their actor unit census status. No lane gap-row file changes (tested).
- Denominator sources are named in the report: the reference client lock (153 tiles), the data-ui lane decoded `system/npcgrp.dat` pinned to the locked SHA-256 (rows naming a sound through `npc_sound_references`), and `docs/parts/npcs/actor-unit-census.json` `skill-sound-row` units.
- Named emitter gap rule and markdown line; part `converted` counts pass rows, so every counted part closes.
- `docs/OUTPUT_CONTRACT.md` "Gap rows" and "Coverage report" list the kinds, sources, converted predicates, the sandbox reason and the named emitter rule.

## Union coverage (artifacts/lane-store/integration/l2/coverage.json)

Catalog `bba52c47...008c`, generated 2026-11-11T13:32:14+02:00, file SHA-256 `499a23ab1fb3450d9908c3862d576586fc0414614f3c4c285813c5d4b03403cf`, built with `--census-lanes world actors data-ui integration` (no `--markdown`; 02-89 writes the committed table).

| Part | Denominator | Converted | Gap | Pending |
| --- | --- | --- | --- | --- |
| data | 40 | 40 | 0 | 0 |
| sandbox | unknown (the sandbox is the checking tool and has no key space (Phase 3 P15)) | 0 | 0 | unknown |
| world | 163 | 0 | 84 | 79 |
| player-characters | 15 | 0 | 15 | 0 |
| ui | 248 | 40 | 208 | 0 |
| npcs | 6519 | 1000 | 1527 | 3992 |
| items | 9238 | 0 | 8170 | 1068 |
| skills-effects | 29812 | 2542 | 18732 | 8538 |
| audio | 8046 | 47 | 1509 | 6490 |
| minimap | 153 | 0 | 22 | 131 |
| movement-geodata | 153 | 13 | 50 | 90 |

World, ui and items now read fewer converted than before because catalog-listed keys with a failed or gap step count only as gap. Skills-effects lists 522 converted keys with `emitter-class-unported:Engine.BeamEmitter`.

## Task commits

1. Task 1 (tracer, minimap end to end) - `a8e3e89`
2. Task 2 (audio, movement-geodata, sandbox reason, contract lines, pass-row count) - `d3f429a`
3. Task 3 (named emitter gaps on converted roots, markdown line) - `f04668a`

## Decisions made

Rows P818 to P822 appended to `C:/laragon/l2b-orchestration/autonomous-roadmap/pending-decision-rows.md` (rule G2), listed in `key-decisions` above.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 1 - Bug] Tile-audio predicate refused three passed tiles**
- Found during: Task 2. Tiles 17_12, 18_11 and 18_12 pass the audio step with no sound to convert, so they pin no world-audio resource; the planned predicate left them with only a pass row and the census refused the report.
- Fix: tile-audio also converts when the tile manifest carries no audio step gap row (P819). Test `test_collision_and_world_audio_resources_convert_their_keys_and_a_step_without_a_gap_converts_tile_audio`.
- Commit: `d3f429a`

**2. [Rule 3 - Blocking] Pass-row converted count moved from Task 3 to Task 2**
- The Task 2 check (sums close for the three parts) cannot pass while converted counts converted rows with a gap status (P820). Commit `d3f429a`.

**3. [Rule 1 - Conflict with a later review fix] Validator and "other gap rows stay converted" not applied**
- Review fix 6d189c8 (after planning) gives every converted key the status of its failed or gap step; narrowing `validate_coverage_row` to emitter reasons would refuse the union report. The emitter rule lands in the skills verdict step instead (P821). The must-have result holds: 522 BeamEmitter keys read gap with converted true, and sums close for every counted part. Commit `f04668a`.

**4. [Rule 3 - Import cycle and lane boundary] Npc sound identity step name**
- `convert_actors.py` owns `NPC_SOUND_IDENTITY_STEP`, but importing it from the census is a cycle (the converter imports the coverage refresh). Task 2 moved it to `npc_requests.py`; `check-lane-ownership.mjs --part adapter-dispatch` flagged the two actors files, so Task 3 restored them and the census keeps the literal beside its step vocabulary (P822). Net plan diff edits no actors file; the check reports 0 foreign paths.

**5. [Plan file list] Files outside the listed set**
- `tests/pipeline/test_coverage_report.py` (denominator and count expectations, derived module added to the port-scope scan) and the wiring in `build_coverage_report.py` from Task 1 on (derived rows enter the row list there so the coverage `steps` list them too, rather than inside `build_gap_census`).
- `NO_COMMITTED_DENOMINATOR_SOURCE` and its fallback in `load_census_denominators` were deleted: every part now has a loader.

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_gap_census*.py"`: 36 tests OK.
- `python -B -m unittest discover -s tests/pipeline -p "test_coverage_report.py"`: 27 tests OK.
- Related suites OK: lane coverage refresh (10), lane driver refresh (7), npc batch (17), tile batch (19), gap rows (12), catalog index keys (15); a module-path run of 57 affected pipeline files passed 886 of 887, the one error being `test_actor_census` loaded as `tests.pipeline.*` (its fixture import needs discover mode, where its 13 tests pass).
- Task 1, 2 and 3 union checks: minimap 153 with sums closing; audio, minimap and movement-geodata closing and the sandbox reason shown; 522 converted BeamEmitter gap rows and no counted part open.
- `node scripts/check-lane-ownership.mjs --base 9731675 --part adapter-dispatch`: 0 foreign paths.
- Reference overlap: not run; this plan wrote census Python only and the overlap tool scans no Python converters yet (02-93).

## Known stubs

None.

## Next phase readiness

- 02-84 and 02-94 can rely on the named emitter gap rule; 02-94's `emitter-feature-unported:<property>` rows on converted roots will show the same way.
- 03-05 reads the three new denominators; its truth that they stay unknown is superseded for audio, minimap and movement-geodata (plan index contract note); the sandbox stays unknown with the P15 reason.
- 02-89 writes `docs/coverage.md` from this report (it still shows "no committed denominator yet").
- Lane coverage refreshes of the actors lane now also read the world lane gap rows (tile-audio) and the data-ui decoded npcgrp table.

## Process cleanup

No dev server, browser or e2e runner was started. Every Python run finished in the foreground; no process with this worktree path remains and nothing listens on 5173 or 5175.

## Self-Check: PASSED

- FOUND: scripts/native_store/gap_census_derived_parts.py, tests/pipeline/test_gap_census_derived_parts.py
- FOUND: a8e3e89, d3f429a, f04668a on HEAD
