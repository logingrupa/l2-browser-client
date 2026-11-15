---
phase: 261113-h7k-lane-store-shares-identical-files-by-har
plan: 01
status: complete
plan_head_before: b61d2467448ed21b764bfd0cd6f173cf26f849dc
plan_head_after: 96731039d2460ea2d299ca11d7cecaf88b682cbb
commits: 4
tasks_committed: [1, 3, 2, 4]
tasks_open: []
---

# Quick task 261113-h7k: the lane store shares identical files by hard links - summary

Status: complete. All four tasks are committed in the order 1, 3, 2, 4 (`671f459`, `01790ac`, `e54b19e`, `9673103`) and the closing steps passed. Ruling 7 was not applied.

## Baseline (task 1 step A)

- Whole suite at `b61d246`: `Ran 2453 tests in 352.918s`, `FAILED (errors=2, skipped=66)`. Log: `C:/laragon/l2b-orchestration/autonomous-roadmap/pipeline-261113-h7k-baseline.log`.
- The two errors are the known ones: `test_world_audio_step ... test_the_20_20_ambient_counts_equal_the_staged_ambience` and `test_world_bsp_step ... test_the_generic_20_20_step_holds_the_brush397_and_brush610_nodes_at_their_native_positions`.
- Guard helper `h7k-guard.py` and its listing `h7k-guard.txt` (1,634 lines, stored after the baseline) are in the same folder.
- `implementation_hash()` before and after the commit: `0bb618007f0306489bbd2683a741e2c38f9eb73c02b6472bdb94cf59e29a38c0`.

## Task 1: the sharing command, its allowlist, link replacement and record

- Commit `671f459`, nine new files (four modules in `scripts/native_store`, the fixture, four test files).
- Gate: 79 tests pass (58 new, 21 of `test_unit_ledger.py`); the guard listing is unchanged. Gate log: `261113-h7k-task1-gate.log` in the orchestration folder.
- Three of the four new test files were seen failing on import before their modules existed. `test_lane_sharing_candidates.py` was written before its module but was first run after it.

Deviations from the plan:

1. The ruling 9 test patches the cap to 6 names instead of filling a file to about 1,000 names in two lanes. Reason: same code path with far fewer writes on the SSD; the 1,001 file test runs the real cap.
2. One more survey rule, `changed-during-the-run`, for a file that is gone between the folder listing and its stat, and a folder that is gone lists as empty. Reason: `data-ui` and `integration` convert without a lane lock, so a walk beside them must not fail. Two tests cover it.
3. A file that is itself a reparse point is neither entered nor counted, like a junction.
4. A lane whose record would be empty and has no record file gets none.

Choices the plan left open:

- `sharedBytes` and its two breakdowns count a file only when every name it has on disk was replaced (its bytes are really freed). `filesSkippedByRule` counts names. `leftoverLinksKept` is a list of paths.
- `sha256_of_file_with_identity` returns `FileHashOutcome(sha256, skip_rule)` and opens the file by an extended-length path.
- The record key is `device:file number:size:modification time in ns`.

Notes for the later tasks and the proof:

- The record file and the temporary links folder of a lane count under `outside-the-shared-places` from the second run on.
- A one-lane pass skips a file whose record lies in another lane (`has-a-name-outside-this-run`). A file named in `integration` and `world` is recorded in `integration` (its name sorts first), so the batch-end pass of `world` links no new twin to it; the all-lane command does.
- Ruling 12: once names share one file, a process that holds any name open without delete sharing blocks the unlink or replace of every other name; the unit then fails visibly and no bytes are at risk.
- `main` names no lane free in this task, so unit step files are shared only when a caller names `actors` or `world` free; task 2 changes that under the lane lock.

## Task 3: the copy sites link instead of copy

- Commit `01790ac`, fourteen files: new `scripts/native_store/linked_file_copy.py`, `store_file_copy.py`, the three actors sites, the new `support/second_volume_simulation.py` and `test_linked_file_copy.py`, seven changed test files.
- Gate: 145 tests pass; the guard listing is unchanged. Gate log: `261113-h7k-task3-gate.log` in the orchestration folder.
- Beside the gate: 22 more test files that import the changed modules (`261113-h7k-task3-neighbours.log`): 21 files pass (2 tests skipped) and `test_converter_independence.py` did not import, because that hand-made run lacked `tests/pipeline` on the path. Run again with it, its 20 tests pass.
- `implementation_hash()` after the commit: `0bb618007f0306489bbd2683a741e2c38f9eb73c02b6472bdb94cf59e29a38c0`.
- Seen failing first: the three site tests (the archive was a copy) and the four files that import the new module. The merge test passed before the change, as it must: it guards that a merge keeps copying.

Pre-existing tests that changed (change 1 of the plan, nothing else): in `test_lane_union_store_copy.py` the free-space refusal test and the differing-target-file test call `simulate_a_second_volume(self)` first, and the first one now also requires a missing byte count above zero.

Deviations from the plan:

1. `require_source_bytes_hold_expected_sha256` is a new function of `store_file_copy.py`, used by the copy and the link path. Reason: the refusal text keeps one owner.
2. `test_store_file_copy.py` gains the base class `StoreFileSourcesTestCase` (set-up and two helpers moved out of `StoreFileCopyTests`), so the link tests reuse them with a lane store root target.
3. Three tests more than the plan lists: a lane store root target links and needs only the floor free; a lane store root on a second volume copies and needs the missing bytes free; a linking union with less than the floor free is refused with `0 bytes`.
4. `convert_actors.py` drops `import shutil`, which the change left unused. The file stays at 401 lines.

Notes:

- File sizes: `test_store_file_copy.py` is now 412 lines; `test_lane_catalog_writer.py` went from 442 to 462. Neither was split; the plan names both as the place of these tests.
- Ruling 12 now holds from the conversion on in `actors`: the unit archive is a second name of the converter's `asset.l2asset`, so a holder of either name without delete sharing blocks the next `begin` of that unit.
- The free-space check decides link or copy per file before the first link. Two store paths that name one file one name below the cap would give one link and one copy that the check did not count; the floor covers it.
- The test doubles `SyntheticItemRun` and `SyntheticCharacterRun` rewrite one `converted.l2asset` in place at each start; with links this is also the file of the unit archives sealed before, with the same bytes. Only the doubles do this; the converter writes each archive into a new content folder.
- `actor_sound_conversion.py:236` still copies, as the plan says.

## Task 2: the two-part lane lock and the scratch removal

- Commit `e54b19e`, 23 files: `interprocess_lock.py`, the new `scripts/native_store/converter_scratch_removal.py`, `lane_sharing_candidates.py`, `share_identical_lane_files.py`, the four mains, the two worker modules, the new `test_lane_batch_lock.py` and `test_converter_scratch_removal.py`, three support files and eight changed test files.
- Gate: 148 tests pass (1 skipped); the guard listing is unchanged. Gate log: `261113-h7k-task2-gate.log` in the orchestration folder.
- Beside the gate: 27 more test files that import the changed modules (`261113-h7k-task2-neighbours.log`): 399 tests pass (3 skipped); the guard listing is unchanged. No whole suite ran in this context.
- `implementation_hash()` after the commit: `0bb618007f0306489bbd2683a741e2c38f9eb73c02b6472bdb94cf59e29a38c0`.
- Seen failing first: the two new test files, on import. The changed test files were first run after the implementation.
- Ruling 7 was not needed.

Pre-existing tests that changed (changes 2 to 5 of the plan, nothing else): `CONVERT_ACTORS_NAMES_REPLACED_BY_DEFAULT_MOCKS` gains `lane_batch_lock`; `DeferredPoolFixture.setUp` and the in-process pool test of `test_world_tile_batch_cost_order.py` mock `hold_lane_in_use_part_until_process_end`; the lock file test of `test_item_unit_worker_processes.py` is renamed and also expects the lane lock file of the pooled run; `test_world_raw_step.py` expects `world/work` to hold only `interprocess-locks` after the refused command.

Deviations from the plan:

1. Scratch removal has its own module, `scripts/native_store/converter_scratch_removal.py` (ruling 11). The plan's `files_modified` does not list it yet; I did not edit the plan file.
2. Two tests of task 1 changed because `main` now names lanes free: the main test expects the sealed unit output of `actors` to be shared and the two lane lock files under `outside-the-shared-places`; the converter scratch twin of the never-shared test moved to the `integration` lane, because a free `actors` lane now loses its job folders.
3. `run_sharing_command` and `synthetic_audio_converter_and_request` moved into `support/shared_lane_fixture.py`, so three test files share them; `test_shared_lane_files_stay_valid.py` changed only for that.
4. `main` of the sharing command refuses a lane folder that is a reparse point before it makes the lock folder in it (T-h7k-05).
5. The character class search also decodes `chargrp` inside the lock.
6. Tests beyond the plan's list: a batch that holds the in-use part exclusively refuses a worker; the lock of one lane leaves the others free; the tile batch `main` refuses a held lane; the class search builds and writes under the lock.

Choices the plan left open:

- Refusal text: `lane <name> is in use by <holder> and this run does not wait for it: <lock file>`. Holders: `another batch, conversion or sharing run`, and for the exclusive in-use part `a conversion process, which may be a worker left by a stopped batch`.
- After a refused `hold_the_lane_in_use_part_exclusively` the batch holds only the one-batch part; the shared in-use part is not taken again.
- Plan mode states the job folders and bytes a run would remove and the bytes it would leave. `scratchBytesRemoved` is the bytes before minus the bytes left, so a half-removed folder counts its removed part. A rename or removal that fails with any `OSError` counts in `scratchJobFoldersNotRemoved`.
- A job folder named `<name>.removing` beside a still existing `<name>` makes the rename of `<name>` fail; `<name>` goes in the next run.

Notes for task 4 and the proof:

- `lane_batch_lock` yields the `HeldLaneLock`. `convert_tile_batch.main` enters it without `as`; `convert_actors.main` enters it in one `with` together with `lane_coverage_refreshed_at_exit`.
- A real run of the command leaves the lane lock file (`<lane>/work/interprocess-locks/<sha256 of "lane">.lock`) in every lane, also `integration` and `data-ui`; from then on it counts under `outside-the-shared-places`.
- A pool worker that is refused the in-use part fails its initializer and breaks the pool. That needs a sharing run beside a pool, which the batch parts of the coordinator rule out.
- `convert_actors.py` is 402 lines (ruling 11). `test_lane_batch_lock.py` is 328 lines.
- The walk for scratch lists each converter folder once more per lane to find `.work`, and reads the size of every scratch file; in lanes that keep their scratch this is read-only.

## Task 4: the batches share their lane at their end

- Commit `9673103`, five files: `share_identical_lane_files.py`, `convert_tile_batch.py`, `convert_actors.py`, the new `test_batch_end_file_sharing.py` and `test_item_worker_command_line.py`.
- Gate: 83 tests pass (11 new); the guard listing is unchanged. Gate log: `261113-h7k-task4-gate.log` in the orchestration folder.
- `implementation_hash()` after the commit: `0bb618007f0306489bbd2683a741e2c38f9eb73c02b6472bdb94cf59e29a38c0`.
- Seen failing first: the new test file, on import.

Pre-existing test that changed (change 2 of the plan, second name, nothing else): `CONVERT_ACTORS_NAMES_REPLACED_BY_DEFAULT_MOCKS` gains `share_identical_files_of_batch_lane`. Without it that test would run the pass on this checkout's real `actors` lane.

Deviations from the plan: none in the code. In the tests, the three ways the tile pass raises are three test methods, and the tile tests also check that a done batch removes a scratch job folder and a stopped one keeps it.

Notes:

- `convert_actors.py` is 410 lines (402 before): the new `selected_conversion_failed` and the pass lines (ruling 11). It was not split, as the plan says.
- Every done batch prints one more line on standard error: `identical lane files shared: ` and the report as compact sorted JSON. Standard output is byte for byte as before (a test compares a run with and without the pass).
- A done batch whose pass fails prints `identical lane files not shared: <error>` and exits with `BATCH_EXIT_ERROR` (tile) or 1 (actors) while its summary says `exitCode` 0. A record of another shape or a worker left by a stopped batch causes this on every batch until someone acts (delete the record, end the worker).
- After a refused exclusive hold of the in-use part the batch holds only the one-batch part until it leaves the lock.
- A done tile batch with nothing to do still walks its lane and removes scratch.
- The pass removes the `failure.txt` and the UModel log of a job folder that `native_assets.py:253` tells the reader to inspect.
- A first pass takes an estimated 5 to 20 minutes under the lane lock with no machine-window preflight, a later one 1 to 2. Run the command by hand before the first batch.
- The actors pass runs after every `--batch` name, also when units of the batch failed; a single conversion and a batch that raises share nothing.
- The tile summary is now printed inside the `try` of `main`, so an `OSError` of that print reads `Tile batch failed`.
- Ruling 12 (see task 1) now applies after every done batch of `actors` and `world`, because each one leaves its lane's twins as names of one file.

## Closing steps

- Whole suite at `9673103`: `Ran 2571 tests in 376.162s`, `FAILED (errors=2, skipped=66)`. Log: `C:/laragon/l2b-orchestration/autonomous-roadmap/pipeline-261113-h7k.log`. Baseline: 2453 tests, the same 2 errors, 66 skipped.
- The two errors are the baseline ones (`test_world_audio_step ... test_the_20_20_ambient_counts_equal_the_staged_ambience`, `test_world_bsp_step ... test_the_generic_20_20_step_holds_the_brush397_and_brush610_nodes_at_their_native_positions`). The plan's check for a `FAIL: ` or `ERROR: ` line the baseline lacks exits 0.
- The guard comparison after the suite exits 0: no test wrote a lock file, record, temporary link, job folder or linked file into this checkout's `artifacts/lane-store`.
- No other `scripts/test_pipeline.py` ran beside the suite. Two `pythonw.exe` processes started at the boot of 15:24 (PIDs 10652 and 11676, command line not readable) are not from this task and were left alone.
- `git diff --name-only b61d246` names 41 files. All are in the plan's `files_modified` except `scripts/native_store/converter_scratch_removal.py`, which ruling 11 allows; the plan file was not edited.
- `implementation_hash()`: `0bb618007f0306489bbd2683a741e2c38f9eb73c02b6472bdb94cf59e29a38c0` (D-09).
- No stub, skipped test or unrun check was left by this plan.

## Self-check: passed

The four commits are ancestors of HEAD, the five files of task 4 exist, and the working tree holds no modified tracked file.
