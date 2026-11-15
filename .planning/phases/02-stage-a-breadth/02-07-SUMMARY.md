---
phase: 02-stage-a-breadth
plan: 7
subsystem: integration
tags: [coverage, int-01, world-03, denominators, load-checks, gap-rows, catalog-keys]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-02 gap rows (read_gap_rows, CATALOG_KEY_PATTERNS, reason lists) and the unit ledger schedule helpers; 02-04 the contract key rules, validate_catalog_record and tests/fixtures/catalog-index-keys.json; 02-06 the load-check record file format"
provides:
  - "scripts/native_store/build_coverage_report.py: CoverageReportError, build_coverage_report, validate_coverage_report, coverage_report_bytes, coverage_markdown, coverage_output_path, coverage_markdown_path, main (--store-root, --lane, --output, --markdown)"
  - "scripts/native_store/coverage_denominators.py: COVERAGE_PART_ORDER, CoverageReportError, coverage_denominators(inventory_path, lock_path)"
  - "scripts/native_store/catalog_index_keys.py: catalog_index_keys(store_root, catalog, shared_store_root=None)"
  - "scripts/native_store/load_check_records.py: LoadCheckRecordError, read_load_check_records, is_catalog_key, is_riga_timestamp"
  - "package.json report:coverage"
  - "docs/coverage.md: the committed coverage table of the shared store"
  - "tests/pipeline/catalog_store_fixture.py: write_store_catalog, model_record, write_profile_manifest"
affects: [02-12, 02-21, 02-25, 02-26, 02-55]

actuals:
  tokens: 15300
  tasks: 3
  commits: 4
plan_head_before: ca66e32c89655489a98201dc0502960ebad2d451
plan_head_after: 9a45b1bcc14fdba24a961e03f6e3dad9c2d8f27c

tech-stack:
  added: []
  patterns:
    - "Denominators come only from committed files: the dat table inventory and the reference client lock; anything else is unknown with a stated source"
    - "Row status is the most severe step status (failed, gap, pending, pass); a key with no gap row is pass when converted, else gap census-pending"
    - "Loads come only from load-check records whose path and content carry the measured catalog SHA-256; a failed record in any lane wins"
    - "Profile manifests are read from the store root first, then the shared store, after the pinned SHA-256 and byte length match"

key-files:
  created:
    - scripts/native_store/build_coverage_report.py
    - scripts/native_store/coverage_denominators.py
    - scripts/native_store/catalog_index_keys.py
    - scripts/native_store/load_check_records.py
    - tests/pipeline/test_coverage_report.py
    - tests/pipeline/test_catalog_index_keys.py
    - tests/pipeline/catalog_store_fixture.py
    - docs/coverage.md
  modified:
    - package.json
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md
    - .planning/STATE.md
    - .planning/ROADMAP.md

key-decisions:
  - "docs/coverage.md is the committed coverage table, not an EVIDENCE table (row 213)"
  - "coverage_denominators.py, catalog_index_keys.py and the test helper catalog_store_fixture.py are extra modules (row 214)"
  - "Failed rows count under gap at part level (row 215); unlisted keys of a counted denominator count as pending (row 216)"
  - "chargrp denominator stays the inventory's 15 until the 02-21 census (row 217)"
  - "The browser default player profile is code and is not counted (row 218); the report refuses inside machine windows (row 219)"
  - "Items 9238 is used with the inventory countSource shown verbatim (row 220); keys outside an enumerated denominator are refused (row 221)"
  - "INT-01 and WORLD-03 stay Pending (row 222)"

requirements-completed: []

duration: 15min
completed: 2026-11-08
---

# Phase 2 Plan 7: Coverage skeleton summary

**One read-only report over any catalog root: per-part coverage.json from the committed inventory and reference lock, gap rows per step and browser load-check records pinned to the measured catalog SHA-256, plus the committed shared-store table `docs/coverage.md`.**

## Performance

- Duration: about 15 min (2026-11-08 22:24 to 22:40 Riga)
- Tasks: 3 of 3
- Files: 8 created, 5 modified

## Accomplishments

- `python -B scripts/native_store/build_coverage_report.py --store-root <dir> [--lane <lane>] [--output <file>] [--markdown <file>]`, also `pnpm report:coverage`, writes coverage.json v1 `{schemaVersion, catalogSha256, storeRoot, generatedAtRiga, denominators, parts, rows}`. The output defaults to `<store-root>/coverage.json` and must pass `require_converter_output`, so `public/l2` is measured only with an output under `artifacts/`. The markdown path is project-relative and is refused under `public/l2`.
- Denominators: data 40 table keys from `docs/parts/data/dat-table-inventory.json`; world 163 keys from `recipes/reference-client-tree.lock.json` (153 `tile:XX_YY`, plus `map:Auto0` to `map:Auto5`, `map:Lobby`, `map:entry`, `map:ship_position`, `map:skylevel`); npcs 6519, items 9238, skills-effects 29812 and player-characters 15 from the inventory recordCount with its countSource; ui `unknown` ("no committed window census yet (UI-01, plan 02-19)"); sandbox, audio, minimap and movement-geodata `unknown` ("no committed denominator yet").
- WORLD-03 shape: all 163 world keys have a row; gap rows become `steps [{step, status, reason}]` sorted by step; a key with no gap row and no catalog record is `gap census-pending`.
- `catalog_index_keys` follows the 02-04 contract key table: tiles plus legacy `map-XX-YY-section`, tables, windows, NPCs by `modelCatalogId` else exactly one model with the profile mesh (two raise), items from player-profile `upperItems`, characters from `chargrpIndex` with a staged model, skills from `interlude:skill:<id>:level:<level>:` ids. Tiles, tables and windows records first pass `validate_catalog_record`. It equals `tests/fixtures/catalog-index-keys.json` on the golden catalog.
- INT-01 idempotency: the same inputs and clock give byte-identical coverage.json and markdown. `validate_coverage_report` recomputes the part counts from the rows.

## Shared store figures (public/l2, catalog SHA-256 55c12147db306264deb2be33f6b9cd661d1376d12dc2aa6473be3700322972fe, 2026-11-08 22:33 Riga)

Command: `pnpm report:coverage --store-root public/l2 --output artifacts/coverage/public-l2-coverage.json --markdown docs/coverage.md`. `git status --short public` stayed empty and `public/l2/coverage.json` does not exist.

| Part | Denominator | Converted | Gap | Pending | Loads |
| --- | --- | --- | --- | --- | --- |
| data | 40 | 0 | 40 | 0 | none converted |
| world | 163 | 1 (tile:20_20, legacy section) | 162 | 0 | 1 unverified |
| player-characters | 15 | 0 | 4 | 11 | none converted |
| npcs | 6519 | 1 (npc:21622) | 5371 | 1148 | 1 unverified |
| items | 9238 | 1 (item:22) | 996 | 8242 | 1 unverified |
| skills-effects | 29812 | 1 (skill:3:1) | 17576 | 12236 | 1 unverified |
| sandbox, ui, audio, minimap, movement-geodata | unknown | 0 | 0 | unknown | none |

The gap and pending rows for actors come from the actor census gap rows already in this worktree's `artifacts/lane-store/actors/gap-rows/`. No load-check record exists yet, so every loads figure is unverified. The report holds 38,876 rows.

How later plans refresh it: 02-12 commits the tile census, so world rows gain real steps instead of census-pending; 02-26 adds the gap census so every denominator row has exactly one status and the counted pending tail disappears; 02-55 re-runs the same command against the integration lane store union. Each re-runs `pnpm report:coverage ... --markdown docs/coverage.md` and rewrites the STATUS coverage figures.

## Task commits

1. Task 1, tracer (tables part end to end): `d1de15e` feat(02-07): write coverage.json for the tables part from the inventory, gap rows and load checks
2. Task 2, RED: `c65f0eb` test(02-07): add failing all-parts coverage and catalog key agreement cases
3. Task 2, GREEN: `630fd00` feat(02-07): cover every Stage A part with world, actor and contract catalog keys
4. Task 3: `9a45b1b` feat(02-07): add report:coverage and the committed shared-store coverage table

Docs commit: STATUS.md, OVERNIGHT-DECISIONS rows 213 to 223, this summary, STATE.md and ROADMAP.md.

## Verification

- Tracer gate: the Task 1 `<verify>` passed (15 tests) before Task 2 expanded it.
- `python -B -m unittest discover -s tests/pipeline -p "test_catalog_index_keys.py" -v`: 8 OK. `-p "test_coverage_report.py" -v`: 19 OK.
- Task 2 acceptance one-liner (world 163 keys, ui unknown) exits 0. `PORT_SCOPE` does not appear in either coverage module (also asserted by a test). The tokenize and ast comment check exits 0 for the four modules, both tests and the fixture helper; the largest file is 270 lines.
- Task 3 acceptance: the package script check exits 0; the coverage file check (schemaVersion 1, 163 world rows) exits 0; `grep -c "^| " docs/coverage.md` prints 13; no en or em dash; `grep -c "(docs/coverage.md)" STATUS.md` prints 11; `git status --short public` is empty.
- `pnpm vitest run tests/unit/laneOwnership.test.ts`: 36 of 36 passed (STATUS format kept).
- `pnpm test:pipeline`: 1199 tests OK, 107 skipped.
- `pnpm test:unit`, two runs: run 1 had 3 failed, 1607 passed, 82 skipped (the 2 baseline `nativeNpcProfiles.test.ts` cases and one 5000 ms timeout in `nativeTerrainPreview.test.ts`); run 2 had only the 2 baseline cases. This plan changed no TypeScript; both match the 02-01 red baseline class (deterministic NPC profile cases plus an occasional timeout).
- `node scripts/check-lane-ownership.mjs --base ca66e32 --part adapter-dispatch`: "lane integration: 0 foreign paths", exit 0.
- `pnpm test:e2e` was not run: this plan has no browser check.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] One error class across three modules**
- Found during: Task 1
- Issue: `catalog_index_keys` must raise `CoverageReportError`, but importing it from `build_coverage_report` would be circular.
- Fix: `CoverageReportError` is defined in `coverage_denominators.py`, the lowest module, and imported by the other two; tests import it from `build_coverage_report`.
- Commit: d1de15e

**2. [Rule 2 - Missing critical functionality] Keys outside an enumerated denominator are refused**
- Found during: Task 1
- Issue: a converted or gap-row key outside the inventory or lock (for example a synthetic tile) would have inflated a part past its denominator.
- Fix: `listed_part_keys` refuses such keys with the key named, and a counted denominator refuses more listed keys than its count; covered by `test_a_converted_key_outside_an_enumerated_denominator_is_refused` (row 221).
- Commit: d1de15e, 630fd00

**3. [Rule 3 - Blocking] The shared store is a junction**
- Found during: Task 1
- Issue: `catalog_writer.read_current_catalog_bytes` and `confined_child_path` refuse reparse points, so they cannot read `public/l2`.
- Fix: the report reads `catalog.json` with its own 32 MiB bound, and profile manifests resolve by realpath and must stay under the realpath of their root.
- Commit: d1de15e, 630fd00

**4. [Rule 3 - Blocking] Shared test helper**
- Found during: Task 2
- Fix: `tests/pipeline/catalog_store_fixture.py` holds the catalog, model and profile manifest writers both test modules use (row 214).
- Commit: c65f0eb

**5. [Run rule] BelowNormal priority not applied**
- The Bash tool refuses PowerShell in this worktree session, so the report and the suites ran at normal priority on the idle machine (row 223).

## Known stubs

None. Unknown denominators are explicit `unknown` with a stated source, not stubs.

## Threat flags

None beyond the plan's register. T-02-07-01 (records pinned to the measured SHA-256, failed wins), T-02-07-02 (output guard), T-02-07-03 (manifest SHA-256 and byte length), T-02-07-04 (committed denominators, PORT_SCOPE test) and T-02-07-05 (32 MiB catalog and load-check bounds, row-by-row validation) are each covered by a test.

## Needs human

Nothing new. Owner review is invited on row 220 (items denominator provenance).

## Process cleanup

This plan started no dev server, preview, browser or Playwright run. Vitest and the unittest runs exited on their own. After the last run, `ps -W` showed no node, python, vitest or browser process started by this plan (only processes from 2026-10-29 and 2026-11-07 and the per-command hook node), and `netstat -ano` showed no listener on 5173 or 5175.

## Self-check: PASSED

- Created files exist: the four `scripts/native_store/` modules, both tests, the fixture helper and `docs/coverage.md`.
- Commits d1de15e, c65f0eb, 630fd00 and 9a45b1b are ancestors of HEAD.
