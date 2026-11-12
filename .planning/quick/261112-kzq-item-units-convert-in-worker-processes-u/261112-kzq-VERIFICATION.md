---
phase: 261112-kzq-item-units-convert-in-worker-processes-u
verified: 2026-11-12T15:19:00Z
status: passed
score: 11/11 must-haves verified
covered_files:
  - .planning/quick/261112-kzq-item-units-convert-in-worker-processes-u/261112-kzq-PLAN.md
  - .planning/quick/261112-kzq-item-units-convert-in-worker-processes-u/261112-kzq-SUMMARY.md
  - scripts/actors/convert_actors.py
  - scripts/actors/item_census.py
  - scripts/actors/item_conversion.py
  - scripts/actors/item_unit_workers.py
  - tests/pipeline/support/item_unit_worker_runs.py
  - tests/pipeline/test_item_unit_worker_processes.py
  - tests/pipeline/test_item_unit_workers.py
  - tests/pipeline/test_item_worker_command_line.py
covered_digest: "v4:sha256:c1e9a5001f350814dc13c75d32bf5afdb7d7991da1a5db1bf5c34cefec212fa4"
behavior_unverified: 0
overrides_applied: 0
---

# Quick task 261112-kzq: item units convert in worker processes - verification report

**Task goal:** Item units convert in worker processes under one coordinator that alone writes shared files
**Verified:** 2026-11-12T15:19:00Z (17:19 Riga)
**Status:** passed
**Re-verification:** No - initial verification

Method: the code of the eight files was read at `HEAD` `1b55669`, the three targeted verify commands of the plan were run by the verifier through `run_below_normal.py`, and the whole-suite claim was judged from the log only. The summary was treated as a list of claims.

## Goal achievement

### Observable truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A synthetic items batch converted by 4 workers that seal later units first leaves catalog, items gap rows and item census byte-identical to the one-process batch and to the expected bytes of the existing byte-identity test (D-15) | VERIFIED | `PooledItemBatchByteIdentityTests.test_four_workers_that_seal_later_units_first_leave_the_shared_files_of_the_one_process_batch` compares the three files of both trees and against `expected_item_records`, `expected_gap_row_document`, `expected_census`. The reversed seal order is forced by the gate in `LaterUnitsSealFirstItemRun` and asserted by `test_later_units_were_sealed_before_earlier_ones_in_the_pooled_run`. Passed in the verifier run. |
| 2 | Same (path, SHA-256) set for store files and ledger outputs; receipts, owner records and seals equal after dropping the clock, pid, free-byte and receipt-hash fields (D-15) | VERIFIED | `test_the_store_files_and_the_ledger_outputs_have_the_same_paths_and_sha256` (the compared ledger set holds 2 files, so it is not empty; no `.running.json` is left) and `test_the_receipts_owner_records_and_seals_differ_in_clock_pid_free_byte_and_receipt_hash_fields_only` (also checks `receiptSha256` against the receipt bytes in both trees). Passed. |
| 3 | Outcome list and printed lines are in `run.units` order in both runs (D-15) | VERIFIED | `test_the_outcomes_and_the_printed_lines_follow_unit_order_in_both_runs`; `outcomes_converted_by_workers` returns `[future.result() for future in futures]` in submission order and `written_slice_outcomes` builds the list over `slice_units`. The print loop of `main` is unchanged in the diff, and `WorkersArgumentTests.test_the_items_batch_accepts_workers_and_hands_the_count_to_the_item_conversion` checks the printed lines against the returned list. Passed. |
| 4 | Only the coordinator writes shared files; no shared file before the first store write of the coordinator; the coordinator converts no unit (D-15) | VERIFIED | `converted_unit_outcome` calls the preflight and `convert_unsealed_unit` only. `run_pooled_item_batch` never calls `run.convert`. In the real pool every worker runs with `write_store`, `write_gap_rows`, `write_item_census_and_gap_rows`, `write_item_records` and `refresh_lane_coverage` replaced by a function that raises `AssertionError`, which the child does not catch (`except ValueError` only), so a worker write fails the test. `test_no_worker_writes_a_shared_file_and_the_coordinator_converts_no_unit` asserts `([], [], [4], None)`. Passed. |
| 5 | A unit sealed at start is not submitted and its receipt is read once; a worker-sealed unit enters the coordinator map by one receipt read under the coordinator fingerprint; a worker never builds the sealed-outcome map (D-15) | VERIFIED | `selected_slice_units` submits only keys outside `sealed_outcomes_by_unit_key()`. `add_sealed_outcome_of_converted_unit` (`item_conversion.py:153-159`) makes one `sealed_receipt` read and raises `ItemConversionError` on a missing seal or another fingerprint. Tests: `test_units_sealed_at_process_start_are_not_submitted_and_their_receipt_is_read_once` (reads `[True]`, `[True]`, `[False, False, True]`, `[False]`), `test_a_worker_never_builds_the_sealed_outcome_map`, `test_a_worker_seal_under_another_fingerprint_is_refused_by_the_coordinator`, `test_a_converted_outcome_without_a_seal_is_refused`. Passed. |
| 6 | A worker preflight refusal for the third unit is raised by the coordinator with type and message, the pool is shut down with `cancel_futures=True`, two units stay sealed, no catalog, gap rows or census (D-15) | VERIFIED | `outcomes_converted_by_workers` shuts down in `finally` with `wait=True, cancel_futures=True`. In process: `test_a_preflight_refusal_for_the_third_unit_stops_the_slice_and_cancels_the_rest` (same exception object, 3 preflight calls, `write_store` not called). Real pool of 2 workers: `PooledItemBatchRefusalTests` (type `native_store.unit_ledger.BatchPreflightRefusedError`, the message, 0 store writes, units 1 and 2 sealed, no folder for unit 3, no store root, gap-row file or census). Passed. |
| 7 | A transient failure in a worker comes back as a failed outcome in place and is not added to the map (D-15) | VERIFIED | `add_sealed_outcome_of_converted_unit` returns before any read for `FAILED_STATUS`. `test_a_transient_failure_in_a_worker_comes_back_as_a_failed_outcome_in_place` (statuses pass, failed, pass; map holds units 1 and 3; the coordinator read for unit 2 is the walk read only). Passed. |
| 8 | Without `--workers` and with `--workers 1` the units convert in the calling process and no pool is constructed (D-16) | VERIFIED | `run_item_conversion` branches on `arguments.workers in (None, 1)` to `run_item_batch` (`item_census.py:126-127`). `test_without_workers_and_with_one_worker_the_units_convert_in_the_calling_process` runs both values with `ProcessPoolExecutor` replaced by a mock that raises. Passed. |
| 9 | `--workers` is an argument error outside `--batch items` and outside 1 to 61; skills and world tiles get no worker path (D-16, D-17) | VERIFIED | `convert_actors.py:361` and `:367-368`; `worker_count_argument` in `item_unit_workers.py:21-24`. `WorkersArgumentTests` (8 command lines with exit code 2 and the message, the values 0, 62, 04, -1 and x, the bounds 1 and 61). `ProcessPoolExecutor`, `--workers` and `worker_count` appear in `scripts` only in `convert_actors.py`, `item_census.py`, `item_unit_workers.py` and the earlier `pinned_store_verification.py`. Passed. |
| 10 | Workers of a BelowNormal coordinator run at BelowNormal | VERIFIED | `test_every_unit_was_converted_by_its_own_below_normal_worker_process`: three worker pids, none the coordinator, each with priority class `BELOW_NORMAL_PRIORITY_CLASS` read in the worker by `GetPriorityClass`. `main` calls `run_at_below_normal_priority()` before the pool can start (`convert_actors.py:376`). Passed. |
| 11 | Whole suite: no `FAIL:` line and no `ERROR:` line other than the two baseline ids | VERIFIED | `pipeline-261112-kzq.log`: created 17:04:30, last written 17:11:23, after the last task commit (17:04:17); the tracked tree is clean since. `Ran 2297 tests in 410.492s`, `FAILED (errors=2, skipped=67)`, no `FAIL:` line, the two `ERROR:` lines are the two baseline ids. The 24 tests of this plan are in the log with `ok` (lines 562 to 585). 410 s is inside the normal suite time, so no pool started in the unittest process. |

**Score:** 11/11 truths verified (0 present, behavior-unverified)

### Required artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/actors/item_unit_workers.py` | initializer, worker task, pooled submission, real factory, argument type | VERIFIED | 53 lines; `def outcomes_converted_by_workers` present; imported by `item_census.py` and `convert_actors.py` |
| `scripts/actors/item_conversion.py` | `convert_unsealed_unit`, one rule that adds a converted unit to the map | VERIFIED | 204 lines; `convert` uses both methods |
| `scripts/actors/item_census.py` | one slice walk shared by both batches | VERIFIED | 132 lines; `selected_slice_units` and `written_slice_outcomes` used by `run_item_batch` and `run_pooled_item_batch` |
| `scripts/actors/convert_actors.py` | `--workers`, valid only with `--batch items` | VERIFIED | 401 lines (accepted note 3); numstat 4 added, 0 removed |
| `tests/pipeline/support/item_unit_worker_runs.py` | synthetic worker runs and the pooled batch report | VERIFIED | 180 lines; `def print_pooled_batch_report` present; module-level names only |
| `tests/pipeline/test_item_unit_worker_processes.py` | child-interpreter tests of the real pool | VERIFIED | 181 lines; `POOLED_BATCH_PROGRAM`; 8 tests |
| `tests/pipeline/test_item_unit_workers.py` | in-process coordinator tests | VERIFIED | 209 lines; `class DeferredExecutor`; 9 tests |
| `tests/pipeline/test_item_worker_command_line.py` | argument, wiring and factory tests | VERIFIED | 141 lines; `class WorkersArgumentTests`; 7 tests |

### Key link verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `item_census.py` | `item_unit_workers.py` | `outcomes_converted_by_workers` | WIRED | `item_census.py:106` |
| `item_unit_workers.py` | `item_conversion.py` | `convert_unsealed_unit` | WIRED | `item_unit_workers.py:43` |
| `item_census.py` | `item_conversion.py` | `add_sealed_outcome_of_converted_unit` | WIRED | `item_census.py:109` |
| `convert_actors.py` | `item_unit_workers.py` | `worker_count_argument` | WIRED | `convert_actors.py:18` and `:361` |
| `test_item_unit_worker_processes.py` | `support/item_unit_worker_runs.py` | `print_pooled_batch_report` | WIRED | `POOLED_BATCH_PROGRAM`, run with `python -B -c` |

### Behavioral spot-checks (run by the verifier, each through `run_below_normal.py`)

| Command | Result | Status |
|---------|--------|--------|
| Task 1 verify command (5 test files) | `Ran 57 tests in 20.558s`, `OK (skipped=1)` | PASS |
| Task 2 verify command (4 test files) | `Ran 30 tests in 13.991s`, `OK` | PASS |
| Task 3 first verify command (7 test files) | `Ran 74 tests in 35.780s`, `OK`; the 24 tests of this plan all `ok` | PASS |
| Whole suite | not run by the verifier; judged from the log (truth 11) | PASS by log |

### Scope and hygiene checks

| Check | Result |
|-------|--------|
| `git diff --stat 10aa0ad HEAD` | exactly the eight files of `files_modified` (822 added, 14 removed); each of the three commits names only files of the plan |
| Frozen and pinned files | none in the diff; `native_assets.py`, `native_catalog/**`, `reference_client_guard.py`, `store_paths.py`, `unit_ledger.py`, `catalog_writer.py` are imported only; the two older item test files are unchanged |
| Comments and docstrings | no `#`, no triple quote, no TODO or debt marker in the eight files |
| Unused names | no unused import in the eight files (`find_unused_python_names.py`); every new function and constant is called or asserted on; the plan names nothing to delete beyond the one line moved out of `convert` |
| No machine-derived worker count | no `cpu_count` in the eight files |
| Commit messages | plain sentences, no attribution line |
| Accepted notes 1 to 4 recorded in the summary | yes, "Accepted consequences" items 1 to 4 |
| Process cleanup | no python process of the verifier runs is left; no `multiprocessing-fork` process on the machine |

### Requirements coverage

| Decision | Status | Evidence |
|----------|--------|----------|
| D-15 | SATISFIED | truths 1 to 7 |
| D-16 | SATISFIED | truths 8 and 9, the help text of `--workers` |
| D-17 | SATISFIED | truth 9 |

### Anti-patterns found

None that blocks. Notes, not gaps:

| File | Note | Severity |
|------|------|----------|
| `scripts/actors/item_unit_workers.py:27-31` | `item_worker_run` and the spawn of `convert_actors.py` as the main module have only been tested with mocks and by a pickling check; the first real run is the measurement task (D-18), as the plan and the summary state. Static reading finds no defect: `lane_batch_preflight` reads module constants only, `Converter` keeps `output` and `umodel`, the six arguments are paths. | Info |
| `scripts/native_assets.py:717-727` (frozen, read only) | The converter publishes under the SHA-256 of the archive bytes, not under a key of the request as the plan text says. Two workers that produce a byte-identical archive at the same moment could make one of them see a half-written folder and raise the "corrupt" `ValueError`, which `converted_model_reason` turns into a sealed converter-refused gap. Distinct item units have distinct requests, so no case is known; the byte-identity comparison of D-18 is the check. | Info |

### Human verification required

None.

### Gaps summary

No gaps. Every must-have holds in the code and is exercised by a test the verifier ran; the whole-suite log meets the pass rule and is newer than the last task commit.

---

_Verified: 2026-11-12T15:19:00Z_
_Verifier: Claude (gsd-verifier)_
