---
phase: 02-stage-a-breadth
plan: 27
subsystem: data
tags: [data-01, dat-tables, lane-store, unit-ledger, gap-rows, inventory, name-index, pickers]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-17 convert_tables.py, table_layout_pins, decode-failed gap rows, --decoded-tables-catalog inventory counts; 02-03 and 02-04 catalog_writer merge and validate_catalog_record('tables'); 02-02 UnitLedger"
provides:
  - "Sealed decodes of all 37 descriptor-linked tables in the data-ui lane store: 33 tables records, 4 decode-failed gap rows"
  - "scripts/data/table_name_indexes.py: NAME_INDEX_ALGORITHM_VERSION, NAME_INDEX_SOURCES, native_table_name_index, write_table_name_index, main (--output, --table repeatable)"
  - "native-table-name-index v1 manifests and tables records npcname_e_names, itemname_e_names, skillname_e_names (ledger step name-index)"
  - "scripts/native_store/catalog_writer.py: TABLE_NAME_INDEX_ID_SUFFIX, is_table_name_index_id"
  - "Regenerated docs/parts/data/dat-table-inventory.json (33 local-decoded, 4 decode-failed layout-only, 3 elbera) with data-driven tallies"
affects: [02-26, 02-28, 02-35, 02-50]

actuals:
  tokens: 14400
  tasks: 3
  commits: 3
plan_head_before: 798e712ad6064bbdbecf552ae5646c8929b5f701
plan_head_after: b37520e38473a26e6809875c809ac636089408aa

tech-stack:
  added: []
  patterns:
    - "Derived tables records (name indexes) carry ids ending in _names; coverage drops them before the data denominator check through catalog_writer.is_table_name_index_id"
    - "A name index reads only a sealed source manifest whose bytes equal the catalog manifestSha256 and byte length; it never reads a client file"
    - "Inventory tallies derive from TABLES and the rows; no typed count"

key-files:
  created:
    - scripts/data/table_name_indexes.py
    - tests/pipeline/test_table_name_indexes.py
  modified:
    - scripts/native_store/catalog_writer.py
    - scripts/native_store/build_coverage_report.py
    - docs/OUTPUT_CONTRACT.md
    - docs/parts/data/dat-table-inventory.json
    - docs/parts/data/EVIDENCE.md
    - tests/pipeline/test_convert_tables.py
    - tests/pipeline/test_dat_table_inventory.py
    - tests/pipeline/test_coverage_report.py
    - STATUS.md
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md
    - .planning/phases/02-stage-a-breadth/deferred-items.md

key-decisions:
  - "Name index record ids are npcname_e_names, itemname_e_names, skillname_e_names because the 02-04 tables id rule refuses npcname-e-names (row 292)"
  - "catalog_writer.is_table_name_index_id owns the derived-id rule; coverage keeps those keys outside the data denominator (row 293)"
  - "eula-e, servername-e and questname-e stay decode-failed gaps; no tolerance, no NaN encoding (row 294)"
  - "Name index merges use capacity TABLES_CATALOG_CAPACITY + 3; convert_tables keeps 40 (row 295, deferred item)"
  - "hairaccessorylocgrp sealed in the Task 1 probe run and kept (row 296)"
  - "DATA-01 stays Pending (row 297)"

metrics:
  duration: 19min
  completed: 2026-11-09
---

# Phase 2 Plan 27: DATA-01 breadth and picker name indexes summary

**All 37 descriptor-linked tables are now sealed in the data-ui lane store: 33 decode to `native-table` manifests with `tables` records, and eula-e, questname-e, servername-e and sysstring-e are `decode-failed:FormatError` gap rows. The inventory has no "layout pinned, not decoded" row and its tallies come from the data. Three hash-pinned name indexes (`npcname_e_names` 6,519, `itemname_e_names` 9,238, `skillname_e_names` 29,812 entries) give the 02-35 pickers ids and names through the catalog.**

## Performance

- Duration: about 19 min (02:33 to 02:52 Riga)
- Tasks: 3 of 3
- Files: 2 created, 12 modified

## Accomplishments

- Task 1 (tracer): zonename-e decodes to 369 records (`/l2/tables/31bb5776.../zonename-e.json`); its inventory row is local-decoded with the `convert_tables.py` count source. New tests: a `--table` without a descriptor layout, or a linked table missing from the lock, exits 1 naming the file; a sealed table and a decode-failed table both survive a rerun with every lane file byte-identical.
- Task 2: `--batch tables --limit 40` decoded the remaining tables. New decodes and record counts: actionname-e 102, castlename-e 53, clientdata 15, commandname-e 114, creditgrp-e 62, entereventgrp 1,152, gametip-e 182, hairaccessorylocgrp 112, hennagrp-e 180, huntingzone-e 220, logongrp 26, musicinfo 358, obscene-e 13, optiondata_client-e 16,380, raiddata-e 220, recipe-c 871, staticobject-e 577, symbolname-e 11, variationeffectgrp-e 288, zonename-e 369. New decode-failed gaps:
  - eula-e: `Unexpected safe-package trailer: eula: ` (the pinned layout reads past the payload).
  - servername-e: `Unexpected safe-package trailer` with 730 unread bytes before the 13-byte trailer.
  - questname-e: `native table questname-e holds a value JSON cannot carry: ... nan` (a FLOAT field is NaN).
  A second batch run skipped all 37 units and left `catalog.json` byte-identical (`a953a490...` before and after). The inventory test now derives the tally from `TABLES` and the rows, refuses any `layout pinned, not decoded` row and requires a `decode-failed:` status on every layout-only row. The ten decodes Elbera also counted match its counts.
- Task 3: `scripts/data/table_name_indexes.py` builds a `native-table-name-index` v1 manifest per table from the sealed source manifest after checking its bytes and length against the catalog pin. Entries keep the identifier and name fields as decoded (`id`/`name` for npcname-e and itemname-e, `skill_id`/`skill_level`/`name` for skillname-e, from the pinned layouts), sorted by identifier with ties in source order; `duplicateIdentifierCount` counts exact repeats. A decode-failed source gives no index and prints its gap. A rerun skips all three sealed units and leaves `catalog.json` byte-identical (`022a3af3...`).

| Record | Entries | Duplicates | Manifest bytes |
|---|---|---|---|
| itemname_e_names | 9,238 | 0 | 407,150 |
| npcname_e_names | 6,519 | 0 | 239,341 |
| skillname_e_names | 29,812 | 0 | 1,755,442 |

## Task commits

1. Task 1 (tracer): `5b3ebc6` feat(02-27): decode zonename-e into a sealed lane manifest and its inventory row
2. Task 2: `5ccd54b` feat(02-27): decode every descriptor-linked table and derive the inventory tallies from the rows
3. Task 3: `b37520e` feat(02-27): npcname-e, itemname-e and skillname-e name indexes for the sandbox pickers

The tracer gate passed: Task 1's `<verify>` ran end to end on the real client before the batch.

## Requirements

- DATA-01: Pending. 33 of 37 linked tables decode; four are decode-failed gaps for the owner; the three hair tables are 02-28 (row 297).

## Deviations from plan

### Auto-fixed issues

**1. [Rule 1 - Bug] Name index records broke the coverage report**
- Found during: Task 3
- Issue: `build_coverage_report` on the real data-ui lane raised `part data has keys outside its denominator: table:itemname_e_names, ...`, because every `tables` record becomes a `table:` key.
- Fix: `catalog_writer.is_table_name_index_id` (suffix `_names`, inside the tables id rule) owns the derived-id rule; `build_coverage_report.denominator_catalog_keys` drops those keys before the denominator check. `docs/OUTPUT_CONTRACT.md` states the rule. Tests: a coverage case with an `itemname_e_names` record, and an inventory case that no inventory table takes a name index id. The real lane now reports data 33 converted, 7 gap.
- Files: `scripts/native_store/catalog_writer.py`, `scripts/native_store/build_coverage_report.py`, `docs/OUTPUT_CONTRACT.md`, `tests/pipeline/test_coverage_report.py`, `tests/pipeline/test_dat_table_inventory.py`
- Commit: `b37520e`
- Effect: `check-lane-ownership --base 798e712 --part data` exits 1 with these three foreign paths (Needs Human, row 293).

### Other adjustments

- Record ids: the plan's `npcname-e-names` style is refused by the 02-04 rule `^[a-z][a-z0-9_]*(?:-[a-z])?$` (the flagged assumption). The rule accepts `npcname_e_names`, so the ids are `<table with - as _>_names` and the files `/l2/tables/<sha>/<id>.json` (row 292). 02-35 reads these ids.
- `NAME_INDEX_SOURCES` also names the rows list of each layout (`npc`, `item_name`, `skill`), which the index needs to find the rows.
- hairaccessorylocgrp was sealed by a Task 1 probe run and its row landed in the Task 1 commit (row 296).
- `convert_tables.py` needed no change: no failure was a runner defect.

## Deferred issues

- `convert_tables.py` capacity 40 counts the derived records; the plan that fixes a decode failure must raise it (deferred-items.md, row 295).

## Verification

- `test_convert_tables.py` 10 OK, `test_dat_table_inventory.py` 26 OK, `test_table_name_indexes.py` 16 OK, `test_coverage_report.py` 20 OK.
- `pnpm test:pipeline` at BelowNormal: 1366 tests OK, 104 skipped (`artifacts/scratch/02-27/pipeline-final.log`).
- Edge cases: adjacency (same name, different ids; one skill at two levels; exact duplicate tuples kept and counted), empty (empty name kept as `""`, zero rows give entryCount 0), ordering (identifier sort, ties in source order, two fresh builds byte-identical), tamper (changed source bytes refused).
- Every `check-machine-schedule` call printed `activeWindow: null`.
- `write_lane_catalog.py --lane data-ui --plan` prints the restage line now in `.planning/STATE.md`.

## Needs Human

- Restage the data-ui lane store with the exact line in `.planning/STATE.md` (plan 02-27).
- Confirm the `_names` derived-id rule in the three integration-owned paths, or widen the tables id contract (rows 292 and 293).
- Decide the eula-e and servername-e layout fixes and how a native-table manifest carries a NaN float for questname-e (row 294).

## Known stubs

None.

## Threat flags

None. The index builder reads only the lane store, verifies source bytes against the catalog pin (T-02-27-01) and writes only through `require_converter_output` (T-02-27-03).

## Process cleanup

This plan started only foreground Python, node and pnpm processes, and each one exited. A final `Get-CimInstance Win32_Process` listing for command lines with `autonomous-roadmap` found none, and nothing listens on port 5173 or 5175.

## Self-Check: PASSED

- Created files exist: `scripts/data/table_name_indexes.py`, `tests/pipeline/test_table_name_indexes.py`.
- Commits `5b3ebc6`, `5ccd54b` and `b37520e` are ancestors of HEAD.
