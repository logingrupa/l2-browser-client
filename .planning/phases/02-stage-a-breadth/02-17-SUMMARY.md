---
phase: 02-stage-a-breadth
plan: 17
subsystem: data
tags: [data-01, data-03, dat-tables, lane-store, unit-ledger, gap-rows, inventory]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-01 require_converter_output, lane_store_root and lane_work_root; 02-02 UnitLedger, locked_input_records, require_batch_preflight, run_at_below_normal_priority and the gap row writer and reader; 02-03 catalog_writer merge_catalog_slice and write_store; 02-04 validate_catalog_record('tables') and the native-table v1 manifest"
provides:
  - "scripts/native_catalog/table_layout_pins.py: SCHEMA_HASHES (descriptor plus 37 layouts), CRYPTO_HASH, MTX_DEFINITION_EVIDENCE, RGBA_DEFINITION_EVIDENCE, TABLES (37, derived from the pins), RECORD_IDENTIFIER_FIELDS"
  - "scripts/native_catalog/table_source_resolver.py: TableSourceResolutionError, DescriptorLink, descriptor_layout_links, descriptor_layout_for_file_name, resolve_table_source_file_name"
  - "scripts/native_catalog/tables.py: generic table_source_path(client, file_pattern, source_filename=None), interlude_descriptor_links, interlude_table_layout, decoded_table_record_count"
  - "scripts/data/convert_tables.py: DECODE_TABLE_ALGORITHM_VERSION, native_table_manifest, convert_table_unit, main (--client, --output, --table repeatable, --batch tables --limit n)"
  - "scripts/data/sysstring_systemmsg_counts.py: strict_table_count_report, validate_strict_count_report, main (--client)"
  - "scripts/build_dat_table_inventory.py: --decoded-tables-catalog, DECODED_TABLE_COUNT_SOURCE, lock_equal_source_sha256, count_descriptor_linked_table"
  - "docs/parts/data/sysstring-systemmsg-counts.json and the regenerated docs/parts/data/dat-table-inventory.json"
affects: [02-25, 02-26, 02-27, 02-28, 02-35, 02-40, 02-41, 02-44]

actuals:
  tokens: 29800
  tasks: 3
  commits: 3
plan_head_before: 87ca6905410784183438a9c4fb5a69aa00ab685b
plan_head_after: c6f7bdc1ffae1663ea90d60baa8c1f7acba4dc3a

tech-stack:
  added: []
  patterns:
    - "One case-insensitive resolver for descriptor layouts and system files; ambiguity raises naming every match, an explicit file name must be the exact directory entry"
    - "One sealed ledger unit table:<name> per table; decode errors become decode-failed:<ErrorClass> gap rows with the message in decode-error.json, never a batch stop"
    - "The inventory reads counts only from sealed tables records whose sourceSha256 equals the lock eSha256; it never decodes"
    - "Definition evidence attaches by the readers the selected Interlude layout uses (MTX, RGBA), not by table name"

key-files:
  created:
    - scripts/native_catalog/table_layout_pins.py
    - scripts/native_catalog/table_source_resolver.py
    - scripts/data/convert_tables.py
    - scripts/data/sysstring_systemmsg_counts.py
    - docs/parts/data/sysstring-systemmsg-counts.json
    - tests/pipeline/test_table_source_resolver.py
    - tests/pipeline/test_convert_tables.py
    - tests/pipeline/test_sysstring_systemmsg_counts.py
  modified:
    - scripts/native_catalog/tables.py
    - scripts/native_catalog/cli.py
    - scripts/build_dat_table_inventory.py
    - scripts/actors/actor_census.py
    - docs/parts/data/dat-table-inventory.json
    - docs/parts/data/EVIDENCE.md
    - tests/pipeline/test_dat_table_inventory.py
    - tests/pipeline/test_converter_output_guard.py
    - tests/pipeline/test_native_presentations.py
    - tests/pipeline/test_reference_client_guard.py
    - STATUS.md
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "Inventory counts come only from sealed decodes of the locked source (row 224)"
  - "MTX and RGBA pins attach by reader use in the selected layout (row 225)"
  - "native-table records is the decode data object unchanged (row 226)"
  - "sysstring-e stays a strict decode failure; DATA-03 verdict count-unresolved (row 227)"
  - "actor_census names its eight tables now that TABLES lists 37 (row 228)"
  - "Decode error messages sit in a sealed decode-error.json output (row 229)"
  - "table_source_path is generic and case-insensitive for pattern matches (row 230)"
  - "DATA-01 and DATA-03 stay Pending (row 231)"

metrics:
  duration: 35min
  completed: 2026-11-08
---

# Phase 2 Plan 17: Data tracer, generic decode and DATA-03 summary

**One generic `decode_table` path, pinned for all 37 descriptor-linked layouts, now writes sealed `native-table` manifests and `tables` catalog records into the data-ui lane store. 13 tables decode, including the gap-key tables itemname-e, etcitemgrp, classinfo-e, npcname-e and skillname-e. The inventory now takes its counts only from those sealed decodes. On DATA-03, systemmsg-e decodes strictly to 2083 records. The strict decode of sysstring-e fails, so the count verdict is `count-unresolved`.**

## Performance

- Duration: about 35 min (22:41 to 23:15 Riga)
- Tasks: 3 of 3
- Files: 8 created, 13 modified

## Accomplishments

- `table_layout_pins.py` pins the descriptor and all 37 linked layout XML files by SHA-256. It derives `TABLES` from those pins and keeps the record identifier rule as data.
- `table_source_resolver.py` gives `decode_table`, `convert_tables`, the inventory and the DATA-03 report one descriptor parser and one source resolver. If a name matches two links, or a pattern matches two files, it raises and names every match.
- `decode_table` now records the real relative source path for every table and applies the identifier uniqueness rule from data. It attaches definition evidence based on the readers the layout uses.
- `convert_tables.py`:
  - Each `table:<name>` unit is sealed in `artifacts/lane-store/data-ui/work/`.
  - Manifests are written as `/l2/tables/<manifestSha256>/<table>.json`, and the `tables` slice is merged sorted by id, with the catalog written last.
  - A rerun of a sealed table skips it and leaves `catalog.json` byte-identical (verified on the real client: SHA-256 `89ef36ad...` before and after).
- Sealed decodes on lock-equal `E:/Lineage2-client`:

  | Table | Records |
  |---|---|
  | npcname-e | 6519 |
  | itemname-e | 9238 |
  | etcitemgrp | 6911 |
  | classinfo-e | 10 |
  | skillname-e | 29812 |
  | armorgrp | 1014 |
  | chargrp | 15 |
  | mobskillanimgrp | 5463 |
  | npcgrp | 6519 |
  | skillgrp | 29812 |
  | skillsoundgrp | 1398 |
  | weapongrp | 1313 |
  | systemmsg-e | 2083 |

  sysstring-e is a sealed `decode-failed:FormatError` gap row in `gap-rows/decode.json`.
- `native_catalog/cli.py` refuses an output outside `artifacts/` or under `public/l2` right after argument parsing. The output guard scan now checks this for `cli.py` and `convert_tables.py`, and checks that the report script takes no `--output`.
- The regenerated inventory has 13 local-decoded, 24 local-layout-only and 3 Elbera rows. Every local-decoded count source starts with `scripts/data/convert_tables.py decode_table on lock-equal E:/Lineage2-client/`.
- The DATA-03 report `docs/parts/data/sysstring-systemmsg-counts.json` holds only decode facts. The verdict is `count-unresolved`.
  - systemmsg-e has a header count of 2083 and decodes strictly to 2083 records. It ends exactly: 233,702 consumed bytes plus the 13-byte trailer equal 233,715 decoded bytes. Its ids run from 0 to 2153, with 2083 distinct values, no duplicates and 71 missing in that range.
  - sysstring-e has a header count of 2083, and its strict decode raises `Unterminated Unreal string`.

## Task commits

1. Task 1 (tracer): `52e0540`. Decodes npcname-e through one generic source resolver into the data-ui lane store.
2. Task 2: `b0bf4de`. Pins all 37 descriptor layouts and takes inventory counts only from sealed table decodes.
3. Task 3: `c6f7bdc`. Adds the strict decode report for sysstring-e and systemmsg-e (DATA-03).

The tracer gate passed: Task 1's `<verify>` ran end to end on the real client, and the npcname-e record has recordCount 6519 and sourceSha256 `84c79b73...`, equal to the Phase 1 presentation test pin.

## Requirements

- DATA-01: Pending. 13 of the 37 linked tables are decoded. 23 linked tables are left for 02-27, the three hair tables for 02-28, and the sysstring-e failure for the owner (row 231).
- DATA-03: Pending. The verdict is `count-unresolved` (rows 227 and 231).

## Deviations from plan

### Auto-fixed issues

**1. [Rule 1 - Bug] The actor census would have decoded all 37 tables**
- Found during: Task 2
- Issue: `scripts/actors/actor_census.py` decoded every name in `TABLES`. Widening `TABLES` to 37 would have changed the committed census and run decodes that are not ready yet.
- Fix: the census now names its eight tables in `ACTOR_CENSUS_TABLES`. `test_actor_census.py` passes, and the committed census is unchanged.
- Files: `scripts/actors/actor_census.py`
- Commit: `b0bf4de`
- Effect: `check-lane-ownership --part data` exits 1 with this one foreign path (Needs Human, row 228).

**2. [Rule 3 - Blocking] The client entry point scan refused an inventory that reads no client file**
- Found during: Task 2 (full pipeline run)
- Issue: the inventory no longer decodes, so `test_client_entry_points` flagged that `--client` no longer reaches the per-file lock check.
- Fix: `lock_equal_source_sha256` calls `require_equal_file` for each lock-equal descriptor-linked file before trusting its lock eSha256. These are 37 small files; there is no whole-tree hash.
- Files: `scripts/build_dat_table_inventory.py`, `tests/pipeline/test_dat_table_inventory.py`
- Commit: `b0bf4de`

**3. [Rule 1 - Bug] The DATA-03 report could not represent a failed strict decode**
- Found during: Task 3
- Issue: the strict decode of sysstring-e fails, and the plan's report schema and its two verdicts assumed both decodes succeed.
- Fix:
  - Each table report gains `decodeStatus` and `decodeError`.
  - A failed table keeps its header count, read through the same `decode413` and `read_value`, and has null decoded facts.
  - The comparison is null without both decodes.
  - A third verdict, `count-unresolved`, is used. No fact is guessed.
- Files: `scripts/data/sysstring_systemmsg_counts.py`, `tests/pipeline/test_sysstring_systemmsg_counts.py`
- Commit: `c6f7bdc`
- Recorded in row 227.

### Other adjustments

- `convert_table_unit(project_root, client_access, table, output_root, ledger, links)` has no separate `lock` argument. Lock records come from `locked_input_records` (row 229).
- The receipt fields are fixed by 02-02, so the decode error message is sealed in `decode-error.json`, which is listed as a receipt output (row 229).
- `descriptor_layout_links` moved from the inventory into the resolver. `interlude_descriptor_links` in `tables.py` is now the one checked descriptor reader (Task 3 commit).
- After the last code commit, `write_lane_catalog.py --lane data-ui` wrote the lane catalog with `sourceCatalogSha256`, so that `--plan` could print the restage line. `public/l2` was only read.

## Verification

- `test_table_source_resolver.py`: 13 tests OK. `test_convert_tables.py`: 7 tests OK. `test_sysstring_systemmsg_counts.py`: 11 tests OK. `test_dat_table_inventory.py`: 23 tests OK. `test_converter_output_guard.py`: 7 tests OK. `test_native_presentations.py` and `test_reference_client_guard.py` are green (the client-gated classes skip as before).
- `pnpm test:pipeline` at BelowNormal: 1236 tests OK, 106 skipped (log in `artifacts/scratch/02-17/pipeline-task3.log`). The 02-07 baseline was 1223 tests with 106 skipped; this plan adds 13 tests.
- Edge cases covered:
  - Adjacency: two links for one file, or two files for one pattern, raise naming every match.
  - Empty: a zero-record payload gives recordCount 0, and the validator accepts 0 only on a sourced local-decoded row.
  - Ordering: records keep source order, JSON uses sorted keys, and the `tables` slice is sorted by id.
  - Boundary: a payload one byte short or long raises `FormatError`.
  - Precision: an id of 4294967295 is reported as an exact int.
- `check-lane-ownership --base 87ca690 --part data`: exit 1, with one foreign path, `scripts/actors/actor_census.py` (deviation 1).
- No machine window was hit; every `check-machine-schedule` call printed `activeWindow: null`.

## Needs Human

- Restage the data-ui lane store with the exact `write_lane_catalog.py --lane data-ui --plan` line now in `.planning/STATE.md`.
- Decide the ASCF terminator rule for sysstring-e (row 227). An untracked probe found that row 1551 is a one-byte ASCF whose only byte is 0x20.
- Confirm or move `ACTOR_CENSUS_TABLES` (row 228).

## Known stubs

None.

## Threat flags

None. The new entry points read only lock-equal files through the guard and write only to the ignored lane store or the committed report path.

## Process cleanup

This plan started only foreground Python, node and pnpm processes, and each one exited. The final `Get-CimInstance Win32_Process` query for `autonomous-roadmap` listed only the query's own shell and PowerShell. Nothing listens on port 5173 or 5175.

## Self-Check: PASSED

- The created files exist: table_layout_pins.py, table_source_resolver.py, convert_tables.py, sysstring_systemmsg_counts.py, sysstring-systemmsg-counts.json and the three new test files.
- Commits 52e0540, b0bf4de and c6f7bdc are ancestors of HEAD.
