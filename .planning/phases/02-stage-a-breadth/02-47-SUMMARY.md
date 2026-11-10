---
phase: 02-stage-a-breadth
plan: 47
subsystem: world
tags: [world-01, world-02, world-03, tile-batch, unit-ledger, coverage, load-sweep, dec-own-7]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-13 committed tile census; 02-02 unit ledger and batch preflight; 02-14 to 02-16, 02-29 to 02-31, 02-45, 02-61, 02-62 registered world steps; 02-70 tiles load sweep; 02-23 load-check records"
provides:
  - "scripts/world/convert_tile_batch.py: run_tile_batch, main, BATCH_EXIT_DONE, BATCH_EXIT_ERROR, BATCH_EXIT_MACHINE_WINDOW, BATCH_EXIT_DISK_FLOOR, TileBatchOutcome, TileBatchStop"
  - "scripts/world/eligible_tile_selection.py: select_eligible_tiles, step_level_rows, sealed_tile_step, seal_derived_step_row, failed_step_row, upstream_failed_row"
  - "scripts/world/tile_step_registry.py: source_tile_step_runners, TILE_STEP_NAMES, run_tile_step, DEFAULT_TILE_STORE_OUTPUT"
  - "scripts/native_store/unit_ledger.py: MachineWindowRefusedError, FreeDiskFloorRefusedError"
  - "recipes/world/gap-reasons.json listVersion 13: object-gaps:<count>, batch-pending, upstream-step-failed:<step>"
affects: [02-50, 02-54, 02-55, integration-restage]

estimate:
  tokens: 85000
  tasks: 4
actuals:
  tokens: 26000
  tasks: 4
  commits: 9
plan_head_before: e60411238c4e867cdb3c42ae590a78ebc18977ac
plan_head_after: bfab3b7cc696dca563ec6df952390a6ebaf70187

tech-stack:
  added: []
  patterns:
    - "Step-level rows come from seals only: a sealed step reads pass, its receipt's step-level reason or object-gaps:<count>; both world entry points share seal_derived_step_row"
    - "A batch tile is attempted only when its first unsealed step has no recorded failed row; every step of an attempted tile runs and skips its own sealed work through its fingerprint"
    - "Preflight refusals are typed (MachineWindowRefusedError, FreeDiskFloorRefusedError) so a batch maps them to exit 2 and 3 at a step boundary"

key-files:
  created:
    - scripts/world/convert_tile_batch.py
    - scripts/world/eligible_tile_selection.py
    - scripts/world/tile_step_registry.py
    - tests/pipeline/test_convert_tile_batch.py
  modified:
    - scripts/world/convert_tile.py
    - scripts/native_store/unit_ledger.py
    - recipes/world/gap-reasons.json
    - tests/pipeline/test_unit_ledger.py
    - tests/pipeline/test_world_lighting_step.py
    - docs/parts/world/EVIDENCE.md
    - STATUS.md
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md

decisions:
  - "Step-level rows live in the per-step gap-row files, one row per eligible tile in each of the 13 registered step files (507 rows), not one tile-steps.json (row 681)"
  - "A sealed step reads its receipt's step-level reason, else object-gaps:<count>, else pass; convert_tile.py records through the same rule (row 682)"
  - "A failed or raising step fails its row, later steps except manifest read upstream-step-failed:<step>, manifest still runs (row 683)"
  - "A tile whose first unsealed step holds a recorded failed row is settled until that step seals (row 684)"
  - "Typed preflight refusals give exit 2 and 3, flush rows and skip the catalog refresh; usage errors exit 1 (row 685)"
  - "The census is the only eligibility source (row 686); slicing bounded at four clean slices with the resume command recorded (row 687)"
  - "The step registry is tile_step_registry.py shared by both entry points (row 688); Task 3 found no legacy file left (row 689); foreign path unit_ledger.py only (row 690)"

metrics:
  duration: 100min
  started: 2026-11-10T11:46:00+02:00
  completed: 2026-11-10T13:26:00+02:00
---

# Phase 2 Plan 47: Eligible tile batch Summary

A resumable batch driver runs all 13 registered world steps over the eligible tiles of the committed census, with a preflight before each step and one seal-derived row per tile and step. Four clean slices sealed 9 new tiles through manifest (11 with 20_20 and 20_21). All 11 pass the tiles load sweep on world lane catalog `1b73e4e9`.

## What was built

- `scripts/world/convert_tile_batch.py`: `python -B scripts/world/convert_tile_batch.py --eligible --limit <n> [--client <root>] [--output <dir>]`.
  - It walks the census in order. It attempts the next `n` tiles that still have work and runs the registry steps in order.
  - Before each step it calls `require_batch_preflight(..., 'world', BATCH_MINIMUM_FREE_BYTES)` and `run_at_below_normal_priority()`.
  - Exit codes: 2 in a machine window and 3 below the disk floor, both at a step boundary with the rows flushed and the catalog refresh skipped. 1 for usage errors (`--limit 0`, missing `--eligible`). 0 when the slice ends or there is nothing to do.
  - On exit 0 it writes the world lane catalog (`write_lane_catalog`) and `coverage.json` (`write_coverage_report`).
- `scripts/world/eligible_tile_selection.py`: eligibility comes only from `docs/parts/world/tile-census.json` through `validate_tile_census`. The module also holds the step-level row rules and seal inspection.
- `scripts/world/tile_step_registry.py`: the single owner of step order. Both lane entry points use it and do not import each other.
- `scripts/native_store/unit_ledger.py`: adds the typed refusals `MachineWindowRefusedError` and `FreeDiskFloorRefusedError`.
- `recipes/world/gap-reasons.json` listVersion 13: `object-gaps:<count>`, `batch-pending`, `upstream-step-failed:<step>`.

## Run results (2026-11-10, DATABASE-PC)

| Slice | Riga | Exit | Tiles attempted |
| --- | --- | --- | --- |
| `--limit 1` | 11:59 | 0 | 16_25 (terrain failed: `Terrain layer 10 names only one of Texture and AlphaMap`) |
| `--limit 3` | 12:01 to 12:20 | 0 | 17_12, 18_10, 18_11 |
| `--limit 3` | 12:21 to 12:39 | 0 | 18_12, 18_17, 18_20 |
| `--limit 3` | 12:40 to 13:04 | 0 | 18_22, 19_10, 19_16 |

- Free disk at every preflight stayed between 151.0 and 154.2 GB. No machine window was hit.
- Rows: 507, one per eligible tile and registered step. Statuses: 106 pass, 39 gap, 2 failed, 360 pending. Pending counts 27 tiles at `batch-pending` and 16_25's cascade.
- Coverage (world lane, catalog `1b73e4e9...`): 11 of 163 converted, loads 11 pass, 0 failed, 0 unverified, 125 gap, 27 pending.
- Tiles sweep: `NATIVE_STORE_ROOT=world LOAD_CHECK_KIND=tiles LOAD_CHECK_LIMIT=11 pnpm test:e2e tests/browser/load-sweep-tiles.spec.ts`, run with port 5173 free. 1 passed (5.2 min), 11 `pass` records.
- Resume: `node scripts/check-machine-schedule.mjs && python -B scripts/world/convert_tile_batch.py --eligible --limit 3`.

## Tasks

| Task | Result | Commit |
| --- | --- | --- |
| 1 Batch driver tracer | driver, selection, registry, reasons, 18 tests; 16_25 slice; load-check in the Task 4 sweep | 2423605 |
| 2 Interruption, window, disk, first breadth slice | behaviour cases landed with Task 1; shared seal rule; three breadth slices | 6dd96cc |
| 3 Legacy backstop sweep | nothing left to delete; full pipeline suite 1818 tests OK after the scan fix | f3bbd7c |
| 4 Sweep, evidence, restage handoff, cleanup | 11 of 11 load-check pass, EVIDENCE, STATUS, STATE, rows 681 to 690 | bfab3b7 |

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_convert_tile_batch.py"`: 18 tests OK.
- `test_world_tile_general_steps.py`: OK.
- `python scripts/test_pipeline.py`: 1818 tests OK, 56 skipped. The first run had 2 failures from the registry move: `test_client_entry_points` and `test_converter_output_guard`. Fixed in f3bbd7c.
- The tile-identity count `grep -cE "[0-9]{2}_[0-9]{2}"` prints 0 for both new world modules.
- Decision I gate (paths outside this repository in `scripts` and `src`): empty before Task 1.
- `.planning/lanes.json` parses. No listener on 5173 or 5175 after the sweep.

## Deviations from Plan

**1. [Rule 3 - Blocking] Step rows go in the per-step files, not `tile-steps.json`.** `write_gap_rows` refuses a row whose step differs from the file's step and refuses a repeated key in one file. The rows therefore go in the existing per-step files that coverage reads. There is still exactly one row per (eligible tile, registered step). Row 681.

**2. [Rule 3 - Blocking] The step registry moved out of `convert_tile.py`.** Lane entry points may not import each other (`test_converter_independence`). The registry is now `scripts/world/tile_step_registry.py`. It is a function so the client entry point scan still reaches every step that reads client files. Both entry points guard `--output` themselves. Commits 2423605 and f3bbd7c.

**3. [Rule 2 - Missing functionality] The two refusals are told apart by type.** `require_batch_preflight` raised one error type for both a machine window and the disk floor. Two subclasses in `unit_ledger.py` let the batch map them to exit 2 and exit 3. `unit_ledger.py` is integration-owned, so this is the plan's foreign path, accepted in row 690.

**4. [Rule 1 - Bug] A deterministic failure blocked the resume command.** Without a fix, 16_25 would take a `--limit` slot on every run. A tile whose first unsealed step holds a recorded `failed` row now keeps its rows and is skipped until that step seals. Row 684, with a test.

**5. [Rule 2] One row rule for both entry points.** `convert_tile.py` records its step row through `seal_derived_step_row`, so the coverage rows do not depend on which entry point ran last. Commit 6dd96cc. EVIDENCE's Meshes line was corrected to match.

**6. The lane catalog and coverage are refreshed by function calls.** The plan said to run them as subprocesses. Calling `write_lane_catalog` and `write_coverage_report` directly gives the same outputs and keeps the refresh injectable in tests.

**7. Task 2's behaviour cases landed in the Task 1 commit.** These are interruption, machine window, disk floor, usage errors and byte-identical reruns. The driver contract was written in one piece. Task 2's commit carries the shared seal rule.

**8. One sweep served Task 1 and Task 4.** One `LOAD_CHECK_LIMIT=11` sweep after the last slice covered every sealed tile, including the Task 1 tile 17_12. Its records are pinned to the final catalog.

**9. The ownership check lists paths of other threads.** `check-lane-ownership.mjs --base e6041123 --part world` lists 8 foreign paths. 7 of them come from concurrent commits on this branch by other threads (skills-effects ribbon, movement review and reference-overlap sign-offs). This plan's commits touch one foreign path, `scripts/native_store/unit_ledger.py`, which is the content of `artifacts/plan-checks/02-47/foreign-paths.txt`. The Task 4 diff check therefore does not match on the whole range. Row 690.

## Requirements

- WORLD-01: Pending. 11 of 39 eligible tiles are sealed through manifest; 27 are `batch-pending` and 16_25 failed at terrain.
- WORLD-02: Pending. Sky and audio are sealed on the 11 tiles and the rest is pending.
- WORLD-03: Pending. Every eligible tile has one row per step and coverage reports them; the open tiles keep it partial.

None are marked complete. Breadth continues with the resume command.

## Needs Human

- Needs Human (plan 02-47): the world lane restage command in `.planning/STATE.md`. It merges lane catalog `1b73e4e9...` (11 tile records) into the main checkout's `public/l2` against base `55c12147...`.

## Open follow-ups

- 27 eligible tiles are `batch-pending`. Continue with the resume command, then rerun the tiles sweep with `LOAD_CHECK_LIMIT=<catalog tile count>`.
- 16_25 terrain: `Terrain layer 10 names only one of Texture and AlphaMap`. Fix the terrain layer reader (02-15 step), then `convert_tile.py --map 16_25 --step terrain`.
- Every converted tile carries `lighting-water-volume-unlinked:Gameplay.WaterVolume`. This was already open under 02-62.
- The census step row of each tile still reads `pending` `step-pending:raw`. It is written by `tile_census.py`, not this plan.

## Known Stubs

None.

## Process cleanup

- Started: four batch slices, two full pipeline runs, one Playwright sweep with its `pnpm dev` server on 5173, and helper listing scripts.
- After the sweep, nothing listens on 5173 or 5175. No python, node, ffmpeg or chrome-headless-shell process with `autonomous-roadmap`, `l2-music-derivative`, `:5173` or `:5175` in its command line remains; the only match was the listing process itself.

## Self-Check: PASSED

- Files exist: `scripts/world/convert_tile_batch.py`, `scripts/world/eligible_tile_selection.py`, `scripts/world/tile_step_registry.py`, `tests/pipeline/test_convert_tile_batch.py`.
- Commits present on HEAD: 2423605, 6dd96cc, f3bbd7c, bfab3b7.
