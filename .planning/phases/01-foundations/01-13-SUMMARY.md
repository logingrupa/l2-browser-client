---
phase: 01-foundations
plan: 13
subsystem: asset-pipeline
status: complete
tags: [reference-client, hash-lock, dat-inventory, FOUND-03, FOUND-04]
requires:
  - phase: 01-foundations
    provides: "01-02 walker, lock builder and guard; 01-08 guarded client entry points and the entry point scan test; 01-01 docs/parts/data/EVIDENCE.md"
provides:
  - recipes/reference-client-tree.lock.json (full-tree lock, E: versus IMPORTA-PC, 9,743 paths classified)
  - tests/pipeline/test_reference_client_lock.py (committed lock checks plus real-tree guard cases)
  - scripts/build_dat_table_inventory.py (guarded 40-row inventory generator)
  - docs/parts/data/dat-table-inventory.json (40 rows, route, layout, record count, source, status)
  - tests/pipeline/test_dat_table_inventory.py
  - Reference client lock and dat table inventory sections in docs/parts/data/EVIDENCE.md
affects: [every E: conversion read, clientBuild lock hash, DATA-01, DATA-02, DATA-03, plan 01-12 UModel gap]
tech-stack:
  added: []
  patterns:
    - "Lock keys keep the on-disk spelling; lookups compare casefolded paths"
    - "Inventory record counts are a sourced positive integer or the string unknown, enforced by validate_dat_table_inventory before writing and in the test"
key-files:
  created:
    - recipes/reference-client-tree.lock.json
    - tests/pipeline/test_reference_client_lock.py
    - scripts/build_dat_table_inventory.py
    - docs/parts/data/dat-table-inventory.json
    - tests/pipeline/test_dat_table_inventory.py
  modified:
    - docs/parts/data/EVIDENCE.md
    - .planning/phases/01-foundations/deferred-items.md
    - .planning/OVERNIGHT-DECISIONS.md
key-decisions:
  - "The lock key for the engine library is system/engine.dll (both disks spell it so); the lock test looks records up by casefolded path, like the guard (OVERNIGHT-DECISIONS row 24)"
  - "A decoded table's record count is the length of its single top-level record list; Elbera parser presence is parse_hairgrp and keyed_hair_pairs in Elbera's tools (OVERNIGHT-DECISIONS row 25)"
  - "With the lock committed, the 01-08 UModel pre-read gap is open with E: enabled; no UModel conversion against E: until plan 01-12 closes it"
requirements-completed: [FOUND-03, FOUND-04]
coverage:
  - id: D1
    description: "Full-tree hash lock of E:/Lineage2-client against IMPORTA-PC C:/Lineage2-client, committed with LF"
    requirement: FOUND-03
    verification:
      - kind: unit
        ref: "python -B -m unittest discover -s tests/pipeline -p test_reference_client_lock.py"
        status: pass
    human_judgment: false
  - id: D2
    description: "Guard accepts system/Engine.dll and refuses system/l2.ini on the real E: tree"
    requirement: FOUND-03
    verification:
      - kind: integration
        ref: "tests/pipeline/test_reference_client_lock.py#RealConversionTreeGuardTests"
        status: pass
    human_judgment: false
  - id: D3
    description: "40-row dat inventory with route, layout, record count, count source and status"
    requirement: FOUND-04
    verification:
      - kind: unit
        ref: "python -B -m unittest discover -s tests/pipeline -p test_dat_table_inventory.py"
        status: pass
      - kind: unit
        ref: "python -B -m unittest discover -s tests/pipeline -p test_client_entry_points.py"
        status: pass
      - kind: integration
        ref: "pnpm test:pipeline (838 run, 103 skipped, OK)"
        status: pass
    human_judgment: false
metrics:
  duration: 9 min
  completed: 2026-11-08
  tasks: 2
  files: 8
actuals:
  tokens: 631000
  tasks: 2
  commits: 2
plan_head_before: 569a2d3ee68d0a28078b18a8843a7f4e75b0f232
plan_head_after: c1df1dd61565118c67884d9d0d4e4484b723a460
---

# Phase 1 Plan 13: Reference client hash lock and dat inventory Summary

Hashed both full client trees (IMPORTA-PC 5,629 files and E: 9,737 files, about 7.8 GB each), committed the lock that shows 5,602 equal paths and lists every difference, and wrote the 40-table `.dat` inventory from the locked tree: 8 tables decoded locally, 29 with a pinned layout only, 3 on the Elbera route, and every count sourced or `unknown` (FOUND-03, FOUND-04).

## Performance

- Started 07:25 Riga, finished 07:34 Riga on Sunday 2026-11-08, well before the 10:00 relay window. No pause was needed.
- IMPORTA-PC hashing over ssh took under a minute. E: hashing at BelowNormal took about a minute. The inventory run took 3 seconds. `pnpm test:pipeline` took 64 seconds.

## What was built

- `recipes/reference-client-tree.lock.json` (2.48 MB, LF, `text eol=lf`): schemaVersion 1, hashing script SHA-256 `4acdccbd...92cf` (LF-normalised, equal to both sidecars), both host summaries, class counts and per-file records.
- `tests/pipeline/test_reference_client_lock.py`: 6 checks on the committed lock (schema, 4 MB cap, class counts sum, six fields and known class, Engine.dll equal and equal to `recipes/native-inputs.lock.json`, `system/l2.ini` volatile-config, walker hash current) and 2 real-tree guard cases that skip only when `E:/Lineage2-client` is absent.
- `scripts/build_dat_table_inventory.py` (201 lines): `descriptor_layout_links`, `classify_dat_table`, `elbera_parser_presence`, `decoded_record_count`, `validate_dat_table_inventory`, `build_dat_table_inventory`. It calls `require_reference_client` on `--client` first. It verifies the descriptor through `checked_bytes` against `SCHEMA_HASHES['06_interlude.xml']`, takes table names from the lock's IMPORTA-side `system/*.dat` entries (fails unless 40), and counts local tables only through `decode_table`, which reads through the guarded `table_source_path`. It never uses UModel.
- `docs/parts/data/dat-table-inventory.json`: `schemaVersion` 1, `descriptorSha256`, `referenceTreeLockSha256` `1957c968...2b52` (canonical JSON), 40 rows sorted by table.
- `tests/pipeline/test_dat_table_inventory.py`: 16 tests. Synthetic descriptor cases (commented links vanish, case-insensitive match, two layouts raise, Elbera route only with a parser), parser presence on a temp tree, and the committed JSON (validates, sorted, tally 8/29/3, decode-sourced integers, Elbera evidence or unknown). Boundary cases: 39 rows, 41 rows, unsorted, a count of 0, unsourced or fractional counts, and an unknown count that names a source. Elbera constants are compared with the table parsed from `docs/PORT_SCOPE.md`.
- `docs/parts/data/EVIDENCE.md` (6.7 KB): "Reference client lock" and "Dat table inventory" sections with the 40-row table.

## Lock result

| Class | Paths |
|---|---|
| equal | 5,602 |
| differing | 4 |
| importa-only | 4 |
| e-only | 4,111 |
| volatile-config | 22 |
| unreadable | 0 |

- Differing: `Start-LAN.cmd`, `Start-Tailscale.cmd`, `iwo/135206150202151192151196144_1.dat`, `system/nwindow.dll`.
- IMPORTA-PC only: `READ-ME.txt`, `Start-Client.ps1`, `Start-Debug.cmd`, `system/l2.zip`.
- E: only, by top-level entry: `L2FileEdit-master/` (4,108 files, the nested copy), `L2FileEdit-master.zip`, `Start-Kingdom.cmd`, `Start-Local.cmd`.
- Volatile config: 22 `*.ini` and `.bak-*` paths, including `system/l2.ini`, `system/Running.ini`, `system/l2.ini.bak-20261104-111916` and the four `connection-profiles/*.ini`.
- No case differences. All 40 `system/*.dat` files and `system/engine.dll` are equal.
- Content folders (animations, maps, music, sounds, staticmeshes, systextures, textures, voice, l2text) have no differing or one-side-only paths.

## Inventory result

8 local-decoded with decode counts: armorgrp 1,014, chargrp 15, mobskillanimgrp 5,463, npcgrp 6,519, npcname-e 6,519, skillgrp 29,812, skillsoundgrp 1,398, weapongrp 1,313. The five that Elbera also counted match its numbers. 29 local-layout-only rows, six of them with Elbera evidence counts (actionname-e, etcitemgrp, itemname-e, skillname-e, sysstring-e, systemmsg-e). hairgrp, helmetgrp and hairaccessarygrp are on the elbera route with "Elbera parser present, unverified" and an unknown count. No row is on the none route.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 1 - Bug] Engine.dll lock key case**
- **Found during:** Task 1
- **Issue:** Both disks spell the file `system/engine.dll`, so the acceptance check `l.files['system/Engine.dll']` returns undefined, even though the record is equal with the expected hash.
- **Fix:** Kept the on-disk spelling (the 01-02 builder's rule). The lock test looks records up by casefolded path, like the guard does. The acceptance check passes with a casefolded key lookup: `equal 4dd2f63c...5b08`. OVERNIGHT-DECISIONS row 24.
- **Files:** tests/pipeline/test_reference_client_lock.py
- **Commit:** f2481ae

**2. [Rule 1 - Bug] Record count from a decode**
- **Found during:** Task 2
- **Issue:** The plan's `len(decode_table(...))` would count the result dict's keys, not records.
- **Fix:** `decoded_record_count` takes the length of the single top-level record list and raises unless there is exactly one. OVERNIGHT-DECISIONS row 25.
- **Commit:** c1df1dd

**3. [Rule 2 - Missing critical] Inventory validation shared by generator and test**
- **Issue:** The 39- and 41-row and unsourced-count edge cases need one owner.
- **Fix:** `validate_dat_table_inventory` runs before the JSON is written and in the boundary tests. `classify_dat_table` takes the Elbera parser statuses as a third argument, so the route is decided in one place.
- **Commit:** c1df1dd

The plan's step 1 was checked as written: L2.exe was not running on either host. Nothing was written on IMPORTA-PC or under E:.

## Deferred issues

- The plan 01-08 UModel pre-read gap is now open with E: enabled, because the lock exists. It is recorded in `deferred-items.md` (section "From plan 01-13") and owned by plan 01-12. Until then, run no UModel conversion against `E:/Lineage2-client`.
- `.planning/OVERNIGHT-DECISIONS.md` row 23 (Phase 2 discuss, written by the orchestrator) was uncommitted in the worktree. This plan committed only its own rows 24 and 25 and left row 23 for its author.

## Processes

Started: the IMPORTA-PC walker over ssh, the local E: walker, the inventory run, and the unittest and `pnpm test:pipeline` runs. All exited 0 on their own. Afterwards, no local python.exe had a command line containing `autonomous-roadmap` or `hash_reference_client_tree`. The only local python was another worktree's `editor\world\server.py`, which this plan did not start. `tasklist | grep -i python` on IMPORTA-PC printed nothing. No `.partial` file remains in the scratch directory.

## Self-Check: PASSED

- FOUND: recipes/reference-client-tree.lock.json, tests/pipeline/test_reference_client_lock.py, scripts/build_dat_table_inventory.py, docs/parts/data/dat-table-inventory.json, tests/pipeline/test_dat_table_inventory.py
- FOUND commits: f2481ae, c1df1dd
- Acceptance: inventory tally prints `40 8 29`; `require_reference_client(` appears once in the generator; EVIDENCE.md has "Reference client lock" and is 6,753 bytes; the lock is `i/lf`.
