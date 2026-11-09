---
phase: 02-stage-a-breadth
plan: 26
subsystem: integration
tags: [coverage, int-01, gap-census, denominators, items, etcitemgrp, census-lanes]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-02 gap rows and reason lists; 02-07 coverage report, catalog_index_keys and load-check records; 02-13 committed tile census; 02-17 decoded itemname-e and etcitemgrp manifests; 02-19 committed window census; 02-21 actor unit census and actors census rows"
provides:
  - "scripts/native_store/gap_census.py: build_gap_census(denominators, gap_rows, catalog_index_keys, load_checks), item_census_rows, GapCensusIncompleteError, GAP_CENSUS_STATUS_PRECEDENCE, GAP_CENSUS_STEP_ORDER"
  - "scripts/native_store/gap_census_denominators.py: load_census_denominators(lane_names), census_item_join_rows, measured_part_names"
  - "build_coverage_report.py: rows and part counts from the census, --census-lanes, stable bytes on an unchanged rerun"
  - "seed reason item-group-row-absent (listVersion 3); integration lane census rows for etcitems and ungrouped items"
  - "docs/coverage.md: the shared-store census over the actors, data-ui and world lane stores"
affects: [02-25, 02-55, 02-70]

actuals:
  tokens: 24000
  tasks: 3
  commits: 3
plan_head_before: 44b7767b4a923b36e75365d7482841e86994369d
plan_head_after: eeac57599a316fb808e7f1e044c543d7a3ce7c57

tech-stack:
  added: []
  patterns:
    - "One census status per denominator key: converted only from catalog index keys, else failed, gap or pending from the latest step; a key with no source fails the census"
    - "Denominators only from committed files, checked key by key or count by count; a difference passes only when skill-row-ambiguous rows declare it"
    - "A report measures only the parts of the lanes it reads"

key-files:
  created:
    - scripts/native_store/gap_census.py
    - scripts/native_store/gap_census_denominators.py
    - tests/pipeline/test_gap_census.py
  modified:
    - scripts/native_store/build_coverage_report.py
    - scripts/native_store/coverage_denominators.py
    - scripts/native_store/catalog_index_keys.py
    - scripts/native_store/gap_rows.py
    - scripts/native_store/gap_reasons.json
    - tests/pipeline/test_coverage_report.py
    - tests/pipeline/test_gap_rows.py
    - tests/pipeline/test_material_graph.py
    - docs/coverage.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "Status precedence converted, failed, gap, pending; the reason comes from the latest step in GAP_CENSUS_STEP_ORDER (row 346)"
  - "Seed reason item-group-row-absent, listVersion 3; no current item uses it (row 347)"
  - "Etcitem and ungrouped item rows are integration lane census rows written by the report (row 348)"
  - "--census-lanes reads gap rows, converted keys and load checks pinned to each lane catalog; a report measures only its lanes' parts (row 349)"
  - "Shared-store census output goes to artifacts/lane-store/integration/coverage-census.json (row 350)"
  - "Denominators from committed files; chargrp 15 with no padding row subtracted, since 02-21 records none (row 351)"
  - "An unchanged rerun keeps generatedAtRiga, so reruns are byte-identical (row 352)"
  - "INT-01 stays Pending (row 353)"

patterns-established:
  - "Coverage rows come from build_gap_census; a lane that needs a part counted writes census rows for every key"

requirements-completed: []

coverage:
  - id: D1
    description: "build_gap_census gives every world key one status with its latest-step reason, refuses a missing map:Lobby row and never converts a key from a pass row"
    requirement: INT-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_gap_census.py#GapCensusWorldTests"
        status: pass
    human_judgment: false
  - id: D2
    description: "Tables, NPCs, items with etcitems, skills with declared ambiguity, characters and windows are checked against committed denominators, and every refusal names its part"
    requirement: INT-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_gap_census.py#GapCensusPartTests, GapCensusItemJoinTests, GapCensusRefusalTests"
        status: pass
    human_judgment: false
  - id: D3
    description: "coverage.json rows and parts come from the census; --census-lanes; loads only from load checks pinned to the serving catalog; reruns byte-identical"
    requirement: INT-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_coverage_report.py"
        status: pass
    human_judgment: false
  - id: D4
    description: "Real-data census over public/l2 and the actors, data-ui and world lane stores passes with no missing key, unlisted reason or unknown step; docs/coverage.md regenerated twice with identical bytes"
    requirement: INT-01
    verification:
      - kind: integration
        ref: "tests/pipeline/test_gap_census.py#GapCensusCompletenessTests"
        status: pass
      - kind: integration
        ref: "python -B scripts/native_store/build_coverage_report.py --store-root public/l2 --census-lanes world actors data-ui --output artifacts/lane-store/integration/coverage-census.json --markdown docs/coverage.md (run twice, cmp identical)"
        status: pass
    human_judgment: false

duration: 27min
completed: 2026-11-09
---

# Phase 2 Plan 26: Gap census Summary

**`build_gap_census` gives each of the 46,035 counted denominator keys exactly one status with a listed reason across tables, world, characters, windows, NPCs, items and skills. Keys come from the shared store and the actors, data-ui and world lane stores, and any key without a source fails the census. Items now join all 6,911 etcitemgrp ids as `etcitem-presentation-unplanned` gaps, and `docs/coverage.md` is regenerated from this census.**

## Performance

- Duration: about 27 min (2026-11-09 06:14 to 06:41 Riga)
- Tasks: 3 of 3
- Files: 3 created, 11 modified

## Accomplishments

- `gap_census.py`:
  - Status precedence is `converted, failed, gap, pending`. Converted comes only from catalog index keys.
  - The reason comes from the row of the chosen status whose step is latest in `GAP_CENSUS_STEP_ORDER`.
  - The census refuses each of these and names the part: a key with no row and no catalog entry, a count mismatch that `skill-row-ambiguous:<count>` rows do not declare, an unlisted reason, an unknown step, a stray key, rows under an `unknown` denominator, and a load status other than pass or failed.
- `gap_census_denominators.py` reads every denominator from a committed file:
  - inventory: tables (40), itemname-e (9,238), skillgrp (29,812)
  - reference lock plus tile census: world (153 + 10)
  - actor unit census: npcgrp (6,519), chargrp (15)
  - window census: 248 roots, keyed by windowId
- `item_census_rows` reads item ids from the decoded data-ui manifests `itemname-e.item_name[].id` and `etcitemgrp.item[].object_id`. It writes etcitem and ungrouped ids as integration lane census rows. An id outside itemname-e, or an id with both an etcitem row and a weapon or armor row, is refused.
- `build_coverage_report.py`:
  - Rows and part counts come from the census, and a report covers only the parts of the lanes it reads.
  - `--census-lanes` adds converted keys, gap rows and load checks from each lane store. Load checks are pinned to that lane's catalog.
  - The markdown names the census lane stores and the Lobby status.
  - An unchanged rerun keeps `generatedAtRiga`.

## Coverage census (public/l2 catalog 55c12147, census lanes actors, data-ui, world)

| Part | Denominator | Converted | Loads pass | Gap | Pending |
| --- | --- | --- | --- | --- | --- |
| data | 40 | 36 | 0 | 4 | 0 |
| world | 163 | 1 | 0 | 124 | 38 |
| player-characters | 15 | 0 | 0 | 4 | 11 |
| ui | 248 | 248 | 0 | 0 | 0 |
| npcs | 6519 | 2 | 1 | 5370 | 1147 |
| items | 9238 | 1 | 0 | 7906 | 1331 |
| skills-effects | 29812 | 1 | 0 | 17575 | 12236 |
| sandbox, audio, minimap, movement-geodata | unknown | 0 | 0 | 0 | unknown |

- Lobby (`map:Lobby`) has the census status gap `map-licensee-unsupported:123/30`.
- Items gap 7,906: 6,911 etcitems plus 995 weapon and armor gaps. `item-group-row-absent` applies to 0 items.
- The 248 converted windows and 36 tables come from the data-ui lane catalog. Their 02-20 StatusWnd load check is pinned to an older lane catalog, so all of them count as loads unverified.
- 46,035 rows in all. Running the command twice gave byte-identical `docs/coverage.md` (`cmp` identical), and `git status --short public` is empty.

## Task commits

1. Task 1, tracer (world census): `35c5707` feat(02-26): give every world key one census status in coverage.json
2. Task 2: `da5a704` feat(02-26): census tables, actors, items with etcitems and windows with every refusal
3. Task 3: `eeac575` test(02-26): run the real-data gap census and keep coverage bytes stable across reruns

The docs commit holds this summary, `docs/coverage.md`, the STATUS coverage figures, OVERNIGHT-DECISIONS rows 346 to 353, STATE.md and ROADMAP.md.

## Verification

- Tracer gate: Task 1's `<verify>` passed (gap census 6, coverage report 21) before expansion. A world-lane census over public/l2 also gave 163 rows.
- `test_gap_census.py`: 19 OK, including `GapCensusCompletenessTests` on real data (about 26 s). `test_coverage_report.py`: 25 OK. `test_gap_rows.py`: 12 OK. `test_material_graph.py`: 15 OK. `test_catalog_index_keys.py`: 8 OK.
- `pnpm test:pipeline` (run as `scripts/test_pipeline.py` at BelowNormal through `run_at_below_normal_priority`), after the last code commit: 1488 tests OK, 103 skipped.
- `pnpm vitest run tests/unit/laneOwnership.test.ts`: 36 passed (STATUS format kept).
- `node scripts/check-lane-ownership.mjs --base 44b7767 --part adapter-dispatch`: "lane integration: 0 foreign paths", exit 0.
- Checks on every touched file:
  - 0 comment tokens
  - no unused imports
  - every file under 400 lines (largest `test_coverage_report.py` at 357)
  - no en or em dash
  - the self-contained wording grep is empty
- `pnpm test:e2e` was not run: this plan has no browser check.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] A report covers only the parts of the lanes it reads**
- Found during: Task 1
- Issue: with every part counted, a `--lane world` report (as used by 02-12, 02-13 and 02-16) would refuse because the actors and data parts have no rows.
- Fix: `measured_part_names(lane_names)`. Denominators and rows cover only those parts (row 349).
- Commit: 35c5707

**2. [Rule 2 - Correctness] The integration lane may write rows of any Stage A part**
- Found during: Task 2
- Issue: `write_gap_rows` allowed only the lane's own parts, and the integration lane owns no Stage A part. That made the planned item rows impossible.
- Fix: the integration lane may write rows of any Stage A part and of nothing else; tested (row 348).
- Commit: da5a704

**3. [Rule 1 - Bug] Reruns were never byte-identical**
- Found during: Task 3
- Issue: `generatedAtRiga` changes on every run.
- Fix: an unchanged rerun keeps the previous timestamp; tested (row 352).
- Commit: eeac575

**4. [Rule 2 - Transparency] The table names its census lanes**
- Found during: Task 3
- Issue: the table said only "store root public/l2", but its converted counts include the lane stores.
- Fix: the markdown lists the census lane stores. The coverage.json fields are unchanged, since the browser reader requires exactly those fields.
- Commit: eeac575

### Other adjustments

- `load_census_denominators(lane_names)` takes no `project_root`, because every denominator is a repository file. Converted keys and gap rows still use `project_root`.
- `item_census_rows(itemname_ids, weapon_and_armor_rows, etcitem_ids, item_table_sources)`:
  - It takes the decoded table source identities, so the rows can cite `system/<table>.dat` and its SHA-256.
  - It returns only the rows it adds. Returning the weapon and armor rows too would repeat their census step (row 348).
  - Rows carry no `sourceIdentity.object`, since `item_id=<id>` fails `QUALIFIED_OBJECT_NAME_PATTERN` (the same finding as 02-21 row 181).
- `coverage_denominators()` was replaced by `load_census_denominators`, and its unknown-ui source and actor table map were deleted. `read_measured_catalog` moved into `catalog_index_keys.py`.
- `GAP_CENSUS_STEP_ORDER` also lists the steps the lanes actually write: `name-index`, `field-cp`, `field-mp`, `npc-model`, `npc-profile` and `npc-sound-identities`.
- `test_material_graph.py` pinned the seed `listVersion` to exactly 2. It now asserts at least 2, so later bumps do not break it.
- The characters denominator is the chargrp rowCount 15. The 02-21 census records no padding row, so nothing is subtracted (row 351).
- STATUS.md coverage figures were rewritten from the census, because the old figures contradicted the new `docs/coverage.md`.

**Total deviations:** 4 auto-fixed (1 blocking, 2 correctness or transparency, 1 bug). **Impact:** each one was needed for the plan's truths; no scope creep.

## Known stubs

None.

## Threat flags

None beyond the register:
- T-02-26-01: converted comes only from catalog keys, tested.
- T-02-26-02: every row passes `validate_gap_row`, and an unknown step or stray key raises.
- T-02-26-03: counts must equal the committed denominators, and the real-data test covers this.
- T-02-26-04: only the two decoded manifests are read, through their pinned SHA-256 and byte length.

## Needs Human

Nothing new. Owner review is invited on rows 346 (status and step precedence) and 351 (chargrp padding row not subtracted).

## Process cleanup

- This plan started only foreground python, node and pnpm processes, and each one exited.
- After the last run, `ps -W` showed no python, node, vitest or browser process from this run. Only processes from Oct 29, Nov 4, Nov 5 and Nov 7 remained.
- `netstat -ano` showed no listener on 5173 or 5175.
- The planned `Get-CimInstance` listing was refused by the session's worktree guard, so the check used `ps -W` and `netstat`.

## Self-Check: PASSED

- FOUND: scripts/native_store/gap_census.py, scripts/native_store/gap_census_denominators.py, tests/pipeline/test_gap_census.py, docs/coverage.md
- FOUND: 35c5707, da5a704, eeac575
