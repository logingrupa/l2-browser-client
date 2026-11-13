---
phase: 261113-4mx-world-seal-checks-without-repeated-work-
plan: 01
subsystem: pipeline-speed
tags: [world, unit-ledger, reference-client-lock, tile-batch, worker-pool]
status: complete
requires:
  - quick task 261112-vj5 (world tile batch in worker processes, base fd2cd24)
provides:
  - a verified sealed receipt kept per process and file identity (D-01)
  - one parsed reference client lock per process for the five world lock readers (D-02)
  - the decision 3 profile with a share and a 30-tile projection per reader (D-03)
  - cost-ordered pool submission of tile step tasks (D-04)
affects:
  - scripts/native_store/unit_ledger.py
  - scripts/world/tile_step_workers.py
  - scripts/world/convert_tile_batch.py
tech-stack:
  added: []
  patterns:
    - process-wide map keyed by step directory and unit key, validated by file identity (device, inode, size, modification time)
key-files:
  created:
    - scripts/native_store/file_identity.py
    - tests/pipeline/test_sealed_receipt_reuse.py
    - tests/pipeline/test_world_seal_inspection_reuse.py
    - tests/pipeline/test_world_tile_batch_cost_order.py
  modified:
    - scripts/native_store/unit_ledger.py
    - scripts/world/raw_map_step.py
    - scripts/world/terrain_seam_strip.py
    - scripts/world/environment_program.py
    - scripts/world/minimap_sources.py
    - scripts/world/tile_step_workers.py
    - scripts/world/convert_tile_batch.py
    - tests/pipeline/support/tile_step_worker_runs.py
    - tests/pipeline/test_convert_tile_batch.py
    - tests/pipeline/test_world_tile_batch_phases.py
    - tests/pipeline/test_world_tile_batch_worker_processes.py
decisions:
  - The kept receipt is returned as a fresh json.loads of the kept bytes, not as a deep copy (the plan's measurement)
  - Decision 3 admitted no reader, so no shared helper was added and no reader was changed
metrics:
  completed: 2026-11-13
  tasks: 3
  files: 15
actuals:
  tokens: 19411
  tasks: 3
  commits: 3
plan_head_before: fd2cd24
plan_head_after: d93fc1caae4dcfd3ddb9b4ac89d3294644ac22a3
---

# Quick task 261113-4mx plan 01: world seal checks without repeated work, and heavy tiles first - summary

A sealed unit is verified once per process and file identity, the five world lock readers share one parsed lock per process, and a pooled tile batch submits the tasks of a phase in descending map byte size while it still yields the outcomes in task order. No real tile was converted and `convert_tile_batch.py` was never run against the real census.

## Before and after counts (synthetic lane, one `tile_rows` pass)

Fixture: tile 20_15 with a sealed raw unit and a sealed current world audio unit, all 14 registered steps inspected, nothing kept at the start of the pass.

| Count | Before | After |
|---|---|---|
| Receipt verifications (`unit_ledger.read_ledger_record` calls) | 5 | 2 (one per sealed unit) |
| Lock parses (`ReferenceClientLock` objects built) | 3 (1 through the unit ledger, 2 through the guard attribute) | 1 (through the unit ledger) |

The receipt count before was taken on the code at fd2cd24, the lock count before on the code of task 1 (f5397d6).

## Task 1: keep a verified receipt per process and file identity (D-01)

- Commit: `f5397d6` (f5397d67e54ae20956a5c5a0c341fc1abea1ce9b)
- Gate: 222 tests, OK, 1 skipped. Log: `C:/laragon/l2b-orchestration/autonomous-roadmap/gate-261113-4mx-task1.log`
- `file_identity(path)` gives `(st_dev, st_ino, st_size, st_mtime_ns)` or None for an `OSError`.
- `UnitLedger.sealed_receipt` takes both record identities before any read, returns `json.loads` of the kept bytes on equal identities, and otherwise drops the entry and runs `verified_receipt_bytes`, which is the former body with every condition and message unchanged. None or an error leaves no entry. `begin`, `seal`, `is_sealed` and `sealed_receipts` are unchanged.
- 13 tests in `test_sealed_receipt_reuse.py`, 1 in `test_world_seal_inspection_reuse.py`. Seen failing first: 12 of the 13 and the pass count test (the caller-mutation test also passes on the old code, because the old code reads the file on every call).
- `tests/pipeline/test_unit_ledger.py` is unchanged.

## Task 2: parse the reference client lock once per process, and the decision 3 rule (D-02, D-03)

- Commit: `b9c683c` (b9c683c5bd725d714c76ce3ecfadab40a97e88e8)
- Gate: 150 tests, OK, 2 skipped. Log: `C:/laragon/l2b-orchestration/autonomous-roadmap/gate-261113-4mx-task2.log`
- `read_map_lock_record`, `seam_neighbour_inputs`, `environment_lock_input_records`, `lock_equal_minimap_source_paths` and `locked_tile_ids` call `process_reference_client_lock`. `unit_ledger.py` holds the only lock cache and was not changed in this task. No module of `scripts/world` names `read_reference_client_lock` (four did).
- 6 new tests in `test_world_seal_inspection_reuse.py`, all seen failing against the committed readers.

### Decision 3 profile

One `cProfile` run around `inspected_tile_seals` for the two tiles whose manifest step is sealed in this checkout (15_20 and 18_20; each answered 8 current and 6 stale steps), read-only, at BelowNormal priority. Total 8.278 s for 2 tiles (4.14 s per tile under the profiler). Log: `C:/laragon/l2b-orchestration/autonomous-roadmap/seal-inspection-profile-261113-4mx.log`.

Projection method: the 30-tile file `tile-seal-inspection-profile.json` holds 14 hot rows and none of the candidates, so "seconds per call times the call count in the file" cannot be applied. The projection is seconds per call times (calls per tile here times 30). The calls per tile agree between the two profiles where both have a row: `unit_step_seal` 14 and 14, `sealed_receipt` 160 and 155.7, `raw_unit_fingerprint` 47 and 45.7.

| Reader | Calls | Seconds | Share | ms per call | 30-tile projection | Verdict |
|---|---|---|---|---|---|---|
| `read_tile_census` (from `seam_neighbour_inputs`) | 4 | 0.0033 | 0.04 % | 0.83 | 0.05 s | below the share, untouched |
| `select_eligible_tiles` (from `seam_neighbour_inputs`) | 4 | 0.0067 | 0.08 % | 1.67 | 0.10 s | below the share, untouched |
| `read_census_rows` | 2 | 0.0109 | 0.13 % | 5.47 | 0.16 s | below the share, untouched |
| `terrain_seam_rules_sha256` | 4 | 0.0062 | 0.08 % | 1.55 | 0.09 s | below the share, untouched |
| `environment_lock_input_records` | 4 | 0.0321 | 0.39 % | 8.03 | 0.48 s | below the share, untouched |
| `seam_neighbour_inputs` (whole) | 4 | 0.0996 | 1.20 % | 24.90 | 1.5 s | below the share, untouched |
| `native_assets.implementation_hash` | 52 | 1.6947 | 20.47 % | 32.59 | 25.4 s | not admitted: hashes 55 source files per call, not one file, and lives in a frozen file |
| `world_music.encoder_identity` through `pinned_music_encoder` | 4 | 0.8757 | 10.58 % | 218.92 | 13.1 s | not admitted: hashes the ffmpeg executable and runs `ffmpeg -version`, and lives in a frozen file |
| `store_paths.confined_child_path` | 1445 | 2.8211 | 34.08 % | 1.95 | 42.3 s | not admitted: a path check in a frozen file, not a reader of one file (plan point 6, accepted) |
| `UnitLedger.sealed_receipt` | 320 | 2.6445 | 31.95 % | 8.26 | 39.7 s | the subject of decision 1; 41 first verifications take 1.998 s, the other calls are the path check of the step directory |

Every other function at 5.0 percent or more is a composite of the rows above (`unit_step_seal`, the `*_seal_is_current` checks, `tile_manifest_unit`, `collision_unit`, `lighting_unit`, `sealed_chunk_plan`, `raw_unit_fingerprint`, `UnitLedger.__init__` through `lane_work_root`); none reads the bytes of one file only. No reader was admitted, so no `value_kept_by_file_identity` helper was added and no reader was changed.

Two findings for the orchestrator, outside the rule as written: `implementation_hash` is called 26 times per tile and re-hashes the frozen converter sources each time, and `pinned_music_encoder` re-hashes ffmpeg and starts it twice per tile. Both would need a per-process value kept in the calling world modules; neither is one-file keyed.

## Task 3: start the costliest tiles first in the pool, then the whole suite (D-04, D-05)

- Commit: `d93fc1c` (d93fc1caae4dcfd3ddb9b4ac89d3294644ac22a3)
- Gate 1: 99 tests, OK, 1 skipped. Log: `C:/laragon/l2b-orchestration/autonomous-roadmap/gate-261113-4mx-task3.log`
- Gate 2, whole suite, run once: 2,447 tests in 482.7 s, `FAILED (errors=2, skipped=66)`, no `FAIL: ` line, and the two `ERROR: ` lines are the baseline errors (test_world_audio_step 20_20 ambient counts, test_world_bsp_step 20_20 brush nodes). The verdict command of the plan exits 0. Baseline: 2,416 tests, the same two errors; the 31 added tests are 13 + 7 + 8 + 3. Log: `C:/laragon/l2b-orchestration/autonomous-roadmap/pipeline-261113-4mx.log`. No other `scripts/test_pipeline.py` ran on the machine at the start, so there was no wait.
- `locked_tile_map_bytes(tile_id)` returns the `eBytes` of the lock record and refuses a value that is not an `int` of 0 or more with `reference client lock holds no whole byte size for <map path>: <value>`.
- `TileStepsTask` has the last field `expected_cost`. `futures_submitted_until_the_pool_breaks` submits by descending cost with a stable sort and returns the futures by task position; `outcomes` yields in task order and gives the worker-died outcome to a task without a future. The one-worker branch, `ordered_tile_steps_outcome` and the stop texts are unchanged. `itertools` is no longer imported.
- `run_tile_batch` takes `tile_expected_cost=locked_tile_map_bytes`, builds the costs once for the tiles of `seam_inputs` and passes them to both phases. Arguments and summary shape of the command are unchanged.
- 8 in-process tests in `test_world_tile_batch_cost_order.py`, 3 child-interpreter tests in `HeavyTilesFirstWorkerProcessTests`. Seen failing first as an import error; a second check with the pool submitting in task order failed 6 of the 11 (both child-interpreter order tests among them), then the sort was restored.
- No existing expectation changed. Existing tests got only the new field and argument.

## Deviations from plan

1. **Task 1, pass count test.** The test clears the kept map with `patch.dict(..., clear=True)` for the pass. Reason: the fixture computes the world audio config before the count starts, and that verifies the raw unit, so without the clear the pass counted 1, not 2. The before count of 5 was taken without that line, because the map did not exist yet.
2. **Task 2, a third lock parse count.** The plan counts a parse as a call through `unit_ledger.read_reference_client_lock` or `reference_client_guard.read_reference_client_lock`. A module that imported the name from the guard is seen by neither wrap: against the committed readers the environment and minimap test counted (1, 0) while 16 locks were parsed, so it would have passed before the change. The counter also wraps `reference_client_guard.ReferenceClientLock`, which every parse builds once.
3. **Task 2, order of work.** The readers were changed after the pass count test and before the other five tests. To see those fail, the four reader modules were restored with `git checkout -- <four paths>`, the tests were run, and the saved patch was applied again. The final diff was checked.
4. **Task 2, projection.** See "Projection method" above: the 30-tile file has no row for any candidate.
5. **Task 3, support module.** `wait_until_an_earlier_tile_has_stopped` is renamed `wait_until_a_tile_has_stopped`, because the new stop scenario uses it for the stop of a later tile. `NO_REFUSAL` is removed, unused once a scenario holds a tuple of refusals. The calls recorded before a call are taken from the record file names, not from file contents, because another process may be writing a record at that moment. The stop scenario is named `first-tile-stops-after-the-costliest-last-tile`.
6. **Task 3, file size.** `tests/pipeline/test_convert_tile_batch.py` went from 417 to 425 lines through the edits the plan names; no new test went into it.
7. **Commit ledger.** The GSD ledger file in the git directory was not written, because that path is outside this worktree. The base is fd2cd24 from the orchestrator's note; `git rev-list --count fd2cd24..HEAD` gives 3.
8. **State.** STATE.md, ROADMAP.md and the docs were not touched and nothing under `.planning` was committed, as instructed.

## Notes for the proof run

- A first `sealed_receipt` call parses the receipt twice (once in the check, once for the returned object), as the plan chose.
- With one worker the expected costs are still read in the coordinator, so a lock record with a malformed `eBytes` now ends a one-worker batch with `Tile batch failed`. All 148 eligible tiles hold an `int`.
- Accepted risk T-4mx-04 is visible in tests: a lock rewritten in place with the same size inside one clock tick is not parsed again. `LockedTileMapBytesTests` therefore asserts that its rewritten locks differ in size.

## Process cleanup

No python process with `l2b-speed` (and not `l2b-speed-proof`) in its command line was left after the gates and the suite. The helper scripts and the patch file in `C:/laragon/l2b-orchestration/autonomous-roadmap` are deleted; the five logs are kept. Processes of other work were not touched.

## Verification

- `git diff --name-only fd2cd24 HEAD` over the frozen and pinned files prints nothing.
- The 15 files of `git diff --name-only fd2cd24 HEAD -- scripts tests` are all in `files_modified`.

## Self-check: PASSED

- Commits f5397d6, b9c683c and d93fc1c are on `lane/speed` after fd2cd24.
- `scripts/native_store/file_identity.py`, `tests/pipeline/test_sealed_receipt_reuse.py`, `tests/pipeline/test_world_seal_inspection_reuse.py` and `tests/pipeline/test_world_tile_batch_cost_order.py` exist.
