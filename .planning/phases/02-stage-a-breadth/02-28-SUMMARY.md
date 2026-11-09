---
phase: 02-stage-a-breadth
plan: 28
subsystem: data
tags: [data-02, dat-tables, elbera-adapter, hair-tables, lane-store, cross-check, inventory]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-17 convert_tables.py, decode413 crypto pin, the tables catalog slice and the inventory's sealed-record counts; 02-19 load_pinned_elbera_module and lane_unit_outcomes; 02-27 the 37 sealed descriptor-linked tables and the inventory this plan regenerates"
provides:
  - "scripts/data/hair_table_adapter.py: ELBERA_HAIR_SELECTION_SCRIPT_PATH, ELBERA_HAIR_SELECTION_SCRIPT_SHA256, ELBERA_HAIR_FIELD_PROOF, HAIR_TABLE_PARSERS, HAIR_TABLE_UNDECODED_REASONS, HairTableUndecodedError, decode_hair_table, hair_table_int32_versus_layout_cross_check, hair_table_ddf_cross_check, hairgrp_cross_checks, main (--client)"
  - "scripts/data/convert_tables.py: route elbera-adapter (ELBERA_ADAPTER_ROUTE) for tables without a descriptor layout; unit config fields elberaScriptSha256 and fieldProof"
  - "scripts/data/lane_unit_outcomes.py: seal_unit_decode_gap(reason), the one sealed failure writer under seal_unit_decode_failure"
  - "scripts/build_dat_table_inventory.py: ELBERA_ADAPTER_COUNT_SOURCE, ELBERA_ADAPTER_DECODED_STATUS, count_elbera_route_table"
  - "Sealed elbera-adapter manifests hairgrp (15 rows), helmetgrp (3), hairaccessarygrp (4) in the data-ui lane store"
affects: [02-35, 02-40, 02-44]

actuals:
  tokens: 20000
  tasks: 3
  commits: 3
plan_head_before: a0acd2114fb61e6a056d70943da22c1cb3dcec62
plan_head_after: 7d8a90ff8887f3256aa899607f1b3db68630b5f6

tech-stack:
  added: []
  patterns:
    - "An Elbera parser module is reached only through an explicit name-to-function map inside one function; an AST scan proves no other attribute or escape"
    - "A table-specific gap reason seals through the same failure receipt writer as decode-failed:<ErrorClass>"
    - "A second-source cross-check parses only what it can read with certainty and otherwise returns an unresolved status, never a layout"

key-files:
  created:
    - scripts/data/hair_table_adapter.py
    - tests/pipeline/test_hair_table_adapter.py
  modified:
    - scripts/data/convert_tables.py
    - scripts/data/lane_unit_outcomes.py
    - scripts/build_dat_table_inventory.py
    - docs/parts/data/dat-table-inventory.json
    - docs/parts/data/EVIDENCE.md
    - tests/pipeline/test_dat_table_inventory.py
    - STATUS.md
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "Flat lock-equal Interlude hairgrp.ddf only; the keyed tables have no Interlude ddf (row 315)"
  - "depends_on 02-19 and 02-27 kept (row 316)"
  - "descriptorSha256 holds the Elbera script SHA on the elbera-adapter route; the proof label lives in the receipt, inventory and evidence (row 317)"
  - "seal_unit_decode_gap owns the sealed failure receipt for both reason kinds (row 318)"
  - "dats/hairgrp.xml pinned in the adapter at 83662b49 (row 319)"
  - "UCHAR versus int32 compares the declared reader at each word's first byte (row 320)"
  - "ddf compared on stated counts only; CHAR width not stated (row 321)"
  - "hair_table_adapter.py --client prints the cross-checks; ELBERA_PARSER_SOURCES names the parser that runs (row 322)"
  - "DATA-02 marked Complete (row 323)"

patterns-established:
  - "Elbera adapter call scan: the module variable is used only as elbera_module.hair_pairs and elbera_module.keyed_hair_pairs, and is passed to no other call"

requirements-completed: [DATA-02]

coverage:
  - id: D1
    description: "hairgrp decodes through decode413 and the pinned Elbera hair_pairs into a sealed elbera-adapter native-table manifest and tables record; a short or trailer-less payload seals hair-layout-undecoded"
    requirement: DATA-02
    verification:
      - kind: unit
        ref: "tests/pipeline/test_hair_table_adapter.py#HairPairTableTests"
        status: pass
      - kind: integration
        ref: "python -B scripts/data/convert_tables.py --client E:/Lineage2-client --table hairgrp (decoded, 15 rows)"
        status: pass
    human_judgment: false
  - id: D2
    description: "helmetgrp and hairaccessarygrp decode through keyed_hair_pairs keeping file order and duplicate keys, recordCount from the count header, size mismatch gives helmet-layout-undecoded or hair-layout-undecoded"
    requirement: DATA-02
    verification:
      - kind: unit
        ref: "tests/pipeline/test_hair_table_adapter.py#KeyedHairTableTests"
        status: pass
      - kind: integration
        ref: "python -B scripts/data/convert_tables.py --client E:/Lineage2-client --table helmetgrp --table hairaccessarygrp (3 and 4 records)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Only hair_pairs and keyed_hair_pairs are reachable on the Elbera module; verify, verify_material_native, audit_assets, main and --check never appear"
    requirement: DATA-02
    verification:
      - kind: unit
        ref: "tests/pipeline/test_hair_table_adapter.py#ElberaCallScanTests"
        status: pass
    human_judgment: false
  - id: D4
    description: "Inventory rows hairgrp, helmetgrp, hairaccessarygrp stay elbera-route with sealed counts and the status 'decoded by Elbera adapter, Elbera 07b24 proof, unverified on 4dd2'"
    requirement: DATA-02
    verification:
      - kind: unit
        ref: "tests/pipeline/test_dat_table_inventory.py#CommittedDatTableInventoryTests, tests/pipeline/test_hair_table_adapter.py#InventoryElberaRouteCountTests"
        status: pass
    human_judgment: false
  - id: D5
    description: "UCHAR versus int32 and flat ddf cross-checks for hairgrp, with an unresolved status for an unreadable ddf and the nested e-only copy refused"
    requirement: DATA-02
    verification:
      - kind: unit
        ref: "tests/pipeline/test_hair_table_adapter.py#Int32VersusLayoutCrossCheckTests, DdfCrossCheckTests, RealHairgrpCrossCheckTests"
        status: pass
    human_judgment: false
  - id: D6
    description: "Hair field meanings on the 4dd2 client"
    verification: []
    human_judgment: true
    rationale: "The meanings are Elbera's proof against Engine.dll 07b24af4; only the Phase 3 check against 4dd2 can confirm them, and the two local sources disagree on the -1 words."

metrics:
  duration: 14min
  completed: 2026-11-09
---

# Phase 2 Plan 28: DATA-02 hair tables through the pinned Elbera adapter summary

**hairgrp, helmetgrp and hairaccessarygrp now decode through `decode413` and Elbera's `hair_pairs` and `keyed_hair_pairs`, loaded from `tools/ui/check_hair_selection_native.py` at SHA-256 `d21095f2...` (commit 12c9656). They are sealed `native-table` manifests on route `elbera-adapter` in the data-ui lane store, holding 15 rows of 15 pairs, 3 keyed records and 4 keyed records. Each output is labelled "Elbera 07b24 proof, unverified on 4dd2". On hairgrp, 192 of the 450 int32 words agree with the local UCHAR layout and 258 do not; every disagreement is a -1 word. The flat lock-equal ddf agrees on 15 records and declares 120 CHAR fields per record, against Elbera's 30 int32 words.**

## Performance

- Duration: about 14 min (04:23 to 04:37 Riga)
- Started: 2026-11-09T02:23:02Z
- Completed: 2026-11-09T02:37:00Z
- Tasks: 3 of 3
- Files: 2 created, 9 modified

## Accomplishments

- `hair_table_adapter.py` reads `system/<table>.dat` through `require_equal_file` and decrypts it with the crypto-pinned `decode413`. It loads the Elbera module only through `load_pinned_elbera_module` and calls the one mapped parser on the decoded bytes. A parser `ValueError` raises `HairTableUndecodedError` with the table's gap reason. No `__pycache__` was written into the Elbera checkout, and the script there equals its commit (`git diff --quiet HEAD`).
- `convert_tables.py` dispatches a table that has no descriptor layout but has an Elbera hair parser to the `elbera-adapter` route. A table with neither still exits 1 and names itself. The receipt config carries `elberaScriptSha256` and `fieldProof`.
- `build_dat_table_inventory.py` takes the elbera-route counts from sealed records whose `sourceSha256` equals the lock eSha256 of a checked lock-equal file. Each such row cites `scripts/data/hair_table_adapter.py (Elbera check_hair_selection_native.py at 12c9656) on lock-equal E:/Lineage2-client/system/<file>` as its source.
- Real decodes on lock-equal `E:/Lineage2-client`:

  | Table | Source bytes | Parser | Records | Manifest |
  |---|---|---|---|---|
  | hairgrp | 304 | hair_pairs | 15 rows of 15 pairs, values -1 to 9 | `f4c71595...` |
  | helmetgrp | 432 | keyed_hair_pairs | 3 (keys 1, 2, 3) | `83283aaa...` |
  | hairaccessarygrp | 432 | keyed_hair_pairs | 4 (keys 0, 1, 2, 3) | `f58d5c4a...` |

- Cross-checks (`python -B scripts/data/hair_table_adapter.py --client E:/Lineage2-client`):
  - UCHAR versus int32: the pinned `dats/hairgrp.xml` (`83662b49...`) declares only `UCHAR`. Of the 450 words, 192 agree and 258 disagree. The first disagreement offsets are 24, 40, 44 and 48, and every disagreeing word is -1.
  - ddf: the flat `Interlude/hairgrp.ddf` (`eac9426c...`) gives `RECCNT` 15, which agrees, and 120 `CHAR` fields per record, which does not match. helmetgrp and hairaccessarygrp report `no Interlude ddf`.
- The lane catalog is now `41439f5c...`, with 39 `tables` records.

## Task commits

1. Task 1 (tracer): `5372aab` feat(02-28): decode hairgrp through the pinned Elbera hair parser into the data-ui lane store
2. Task 2: `a806d57` feat(02-28): decode helmetgrp and hairaccessarygrp through Elbera keyed_hair_pairs
3. Task 3: `7d8a90f` feat(02-28): cross-check the Elbera hair readings against the UCHAR layout and the flat hairgrp ddf

The tracer gate passed. Task 1's `<verify>` ran end to end on the real client (hairgrp decoded, inventory regenerated, 28 inventory tests OK) before Task 2 started.

## Requirements

- DATA-02: Complete (row 323). The field meanings stay unverified on 4dd2 (Needs Human, D6).

## Deviations from plan

### Auto-fixed issues

**1. [Rule 2 - DRY, AGENTS.md] One sealed failure writer for both reason kinds**
- Found during: Task 1
- Issue: `seal_unit_decode_failure` hard-codes `decode-failed:<ErrorClass>`, but the plan needs `hair-layout-undecoded` and `helmet-layout-undecoded` gap rows.
- Fix: `seal_unit_decode_gap(..., reason)` holds the body, and `seal_unit_decode_failure` calls it.
- Files: `scripts/data/lane_unit_outcomes.py`
- Commit: `5372aab`

**2. [Rule 2 - Source fidelity] The hairgrp layout XML is pinned**
- Found during: Task 3
- Issue: `dats/hairgrp.xml` is not one of the 37 pinned descriptor-linked layouts.
- Fix: the adapter pins it at `83662b49...` and reads it through `checked_bytes` (row 319).
- Commit: `7d8a90f`

### Other adjustments

- `decode_hair_table` also returns `sourcePath` and `sourceSha256`, because the manifest needs them. `hair_table_ddf_cross_check(client_access, table, elbera_records)` takes the table and Elbera's records, so it can say `no Interlude ddf` for the keyed tables and derive the 15 by 30 shape from the decode instead of typing it.
- A `--client` entry point on the adapter prints the cross-checks for the evidence (row 322).
- `ELBERA_PARSER_SOURCES` now comes from `HAIR_TABLE_PARSERS`. hairgrp's presence check names `check_hair_selection_native.py hair_pairs`, the parser that runs, instead of `extract_charcreate.py parse_hairgrp`.
- Task 2 (tdd) found no RED step. The keyed route was already wired in Task 1 through `HAIR_TABLE_PARSERS`, so its behaviour tests passed on first run.

## Verification

- `test_hair_table_adapter.py`: 30 tests OK. `test_dat_table_inventory.py`: 28 OK. `test_convert_tables.py`: 10 OK. `test_client_entry_points.py`, `test_converter_output_guard.py`, `test_converter_independence.py`, `test_pinned_elbera_module.py`, `test_interface_layout_adapter.py`, `test_table_name_indexes.py`, `test_coverage_report.py` and `test_gap_rows.py` are all green.
- `pnpm test:pipeline` at BelowNormal: 1429 tests OK, 103 skipped (`artifacts/scratch/02-28/pipeline-final.log`). The 02-27 baseline was 1366 OK with 104 skipped.
- `grep -cE "\.(verify|verify_material_native|audit_assets|main)\(" scripts/data/hair_table_adapter.py` prints 0.
- `docs/parts/data/EVIDENCE.md` is 14,095 bytes.
- `node scripts/check-lane-ownership.mjs --base a0acd21 --part data`: `lane data-ui: 0 foreign paths`.
- The git grep for retired sibling workspace names returns nothing.
- Every `check-machine-schedule` call printed `activeWindow: null`.

## Needs Human

- Restage the data-ui lane store with the exact line in `.planning/STATE.md` (plan 02-28). The lane catalog is `41439f5c`.
- Hair field meanings on 4dd2. The -1 words and the 120-CHAR ddf disagree with the UCHAR layout, and the Phase 3 check against Engine.dll 4dd2 decides (rows 320 and 321).

## Known stubs

None.

## Threat flags

None beyond the plan's register. The adapter's `--client` entry point reads only lock-equal files through the guard and writes nothing (T-02-28-01 to T-02-28-04 are covered by the call scan, the guard reads and the labels).

## Process cleanup

This plan started only foreground Python, node and pnpm processes, and each one exited. A final `Get-CimInstance Win32_Process` listing for command lines containing `autonomous-roadmap` showed only the query's own shell, Python and PowerShell. Nothing listens on port 5173 or 5175.

## Self-Check: PASSED

- Created files exist: `scripts/data/hair_table_adapter.py`, `tests/pipeline/test_hair_table_adapter.py`.
- Commits `5372aab`, `a806d57` and `7d8a90f` are ancestors of HEAD.
