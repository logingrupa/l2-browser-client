---
phase: 261112-kzq-item-units-convert-in-worker-processes-u
plan: 01
status: complete
tasks_completed: 3
tasks_total: 3
plan_head_before: 10aa0ad0e2adb9d984fd9d4c5cf4b7c09b68175b
plan_head_after: 1b556698096dfcdf28d75c7c4fb9a5f6e8cb94d2
commits: 3
actuals:
  tokens: 13900
  tasks: 3
  commits: 3
key-files:
  created:
    - scripts/actors/item_unit_workers.py
    - tests/pipeline/support/item_unit_worker_runs.py
    - tests/pipeline/test_item_unit_worker_processes.py
    - tests/pipeline/test_item_unit_workers.py
    - tests/pipeline/test_item_worker_command_line.py
  modified:
    - scripts/actors/item_conversion.py
    - scripts/actors/item_census.py
    - scripts/actors/convert_actors.py
---

# Quick task 261112-kzq: item units convert in worker processes - summary

Status: complete. Tasks 1 to 3 are committed (`736e94c`, `f951425`, `1b55669`). The whole pipeline suite ran once after Task 3 and meets the pass rule: 2297 tests, no `FAIL:` line, and the two baseline `ERROR:` ids only. The real worker run factory and the spawn of `convert_actors.py` as the main module have not been run against the reference client; the measurement task (D-18) runs them first.

`actuals.tokens` is the size of the realized diff of the three commits (55,722 characters over the eight files, at four characters per token). It is not on the scale of the plan estimate of 94,000, which also counts reads and command output; those were not measured.

## Task 1: one pooled items slice end to end

- Commit: `736e94c` on `lane/speed` (5 files, 383 added, 10 removed lines).
- Red run: `tests/pipeline/test_item_unit_worker_processes.py` failed to import before steps B to D (`cannot import name 'item_unit_workers' from 'actors'`).
- Verify command (the one of the plan, through `run_below_normal.py`): 56 tests, OK, 23.7 s. The new file alone: 7 tests, OK, about 2 s, with one child interpreter run of 4 workers.
- Also run and passing, untouched: `test_converter_output_guard.py`, `test_client_entry_points.py`, `test_gap_census.py`, `test_converter_independence.py`, `test_npc_batch.py` (79 tests, 1 skip) and the new file through `unittest discover -s tests/pipeline`, the way `scripts/test_pipeline.py` loads it (7 tests, OK).
- The whole pipeline suite was not run (it belongs to Task 3).
- No python process of these runs is left. The only python process on the machine afterwards was the journal watcher of the orchestrator (PID 12516), which ran before the task started.

### What exists now

- `scripts/actors/item_unit_workers.py` (25 lines): `ProcessPoolExecutor` as a module attribute, `ItemUnitWorker`, `item_unit_worker`, `initialize_item_unit_worker(run_factory, run_factory_arguments, preflight)`, `converted_unit_outcome(unit_key)`, `outcomes_converted_by_workers(unit_keys, worker_count, run_factory, run_factory_arguments, preflight)`.
- `scripts/actors/item_conversion.py` (201 lines): `ItemConversionRun.convert_unsealed_unit(unit)`, `ItemConversionRun.add_sealed_outcome_of_converted_unit(unit, outcome)`; `convert` uses both.
- `scripts/actors/item_census.py` (128 lines): `selected_slice_units(run, limit)`, `written_slice_outcomes(run, slice_units, unsealed_units, converted_outcomes)`, `run_pooled_item_batch(run, limit, preflight, worker_count, worker_run_factory, worker_run_arguments)`; `run_item_batch` keeps its signature and uses the two helpers.
- `tests/pipeline/support/item_unit_worker_runs.py` (152 lines) and `tests/pipeline/test_item_unit_worker_processes.py` (163 lines, class `PooledItemBatchByteIdentityTests`, 7 tests).

### Tests that pin the required points

| Point | Test |
|---|---|
| (a) shared files byte-identical | `test_four_workers_that_seal_later_units_first_leave_the_shared_files_of_the_one_process_batch` |
| (a) store files and ledger outputs | `test_the_store_files_and_the_ledger_outputs_have_the_same_paths_and_sha256` |
| (a) receipts, owner records, seals | `test_the_receipts_owner_records_and_seals_differ_in_clock_pid_free_byte_and_receipt_hash_fields_only` |
| (b) unit order of outcomes and printed lines | `test_the_outcomes_and_the_printed_lines_follow_unit_order_in_both_runs` |
| later units seal first | `test_later_units_were_sealed_before_earlier_ones_in_the_pooled_run` |
| (d) only the coordinator writes shared files | `test_no_worker_writes_a_shared_file_and_the_coordinator_converts_no_unit` |
| BelowNormal workers, one process per unit | `test_every_unit_was_converted_by_its_own_below_normal_worker_process` |

### Deviations from the plan

1. `pooled_batch_report` catches `ValueError`, not every exception. Reason: every refusal of the batch is a `ValueError` (`BatchPreflightRefusedError`, `ItemConversionError`), and the plan states that a gate that times out and a worker that calls a shared-file writer fail the child. Both raise `AssertionError`; with `except ValueError` they end the child with a non-zero exit status and their traceback, which `child_interpreter_report` raises as the test failure. With `except Exception` they would have been reported as a refusal with exit status 0.
2. The scenario is selected through the table `POOLED_BATCH_SCENARIOS_BY_NAME` of `PooledBatchScenario(worker_run_factory, worker_run_arguments_after_the_roots, preflight)`; it holds one entry, `later-units-seal-first`. Task 2 adds `refused-third-unit` as a second entry. The plan named the selection for Task 2 only; the scenario name is already an argument in Task 1, so it is read from the start.
3. Two assertions beyond the behavior block: test (d) also asserts `refusalType` is null, and the ledger output test asserts that the compared set holds 2 files (the two archive copies), so the comparison cannot pass on empty sets.
4. `PooledItemBatchByteIdentityTests.setUpClass` replaces `item_unit_workers.ProcessPoolExecutor` by a mock that raises, for the life of the class. The context section of the plan asks for it; the behavior block of Task 1 does not list it.
5. `build_project_tree` creates the project root with `artifacts` and the actor unit census; the client root is a path only and is not created, as in `ItemBatchFixture`. Nothing reads it.
6. The module global `synthetic_worker_run` is assigned by the factory and read by nothing until Task 2 adds `preflight_refused_once_the_first_two_units_have_begun`. Written as the plan directs; if Task 2 does not read it, it is dead code and must be removed there.
7. The plan-head ledger file and the cwd sentinel of the executor protocol were not written into the git folder: the session refuses compound git commands that it cannot confine to this worktree, and the git folder of this worktree lies in the main checkout. The base commit is recorded in the frontmatter instead (`plan_head_before`).
8. The GSD init, state and config queries of the executor role were not run: the orchestrator limits this executor to Task 1 and forbids STATE.md and ROADMAP.md updates. The tracer gate was met by the verify command passing end to end after the implementation.

No file outside `files_modified` was changed. No frozen or pinned file was edited. `tests/pipeline/test_item_batch_bookkeeping.py` and `tests/pipeline/test_item_conversion_run.py` pass unchanged, with the receipt read counts `[True]`, `[True]`, `[False, False, True]`, `[False]`.

### Notes for the next tasks

- `outcomes_converted_by_workers` always constructs the executor, also for an empty key list. A real pool starts no process without a submission.
- `add_sealed_outcome_of_converted_unit` has no receipt or fingerprint guard yet (Task 2 step B). `converted_unit_outcome` has no unknown-key guard yet (Task 2 step C).
- `child_interpreter_report(scenario_name, project_root, client_root, worker_count)` and `build_project_tree(tree_root)` are module-level helpers of the test file and can be reused by `PooledItemBatchRefusalTests`.
- `test_source_preservation_contract.py` cannot be run with `python -B -m unittest tests/pipeline/test_source_preservation_contract.py` (`No module named 'reference_client_lock_fixture'`); it passes through `unittest discover -s tests/pipeline` (31 tests). The missing module is a fixture in `tests/pipeline` that this plan does not touch; the same command was not run at the commit before this task, so "unchanged by this plan" is inferred, not measured.

## Task 2: coordinator rules and refusals

- Commit: `f951425` on `lane/speed` (5 files, 270 added, 6 removed lines).
- Red run (the two new test files, before steps B and C): 17 tests, 1 failure, 2 errors. Exactly the three tests marked "fails first" failed: the fingerprint test (`ItemConversionError not raised`), the no-seal test (`TypeError: 'NoneType' object is not subscriptable`), the unknown-key test (`module 'actors.item_unit_workers' has no attribute 'ItemUnitWorkerError'`). The other 14 passed at once, so no Task 1 code needed a fix.
- Verify command (the one of the plan, through `run_below_normal.py`): 30 tests, OK, 8.6 s (9 in `test_item_unit_workers.py`, 8 in `test_item_unit_worker_processes.py`, 8 in `test_item_batch_bookkeeping.py`, 5 in `test_item_conversion_run.py`).
- Also run and passing: `PooledItemBatchRefusalTests` alone five times in a row (1 test each, OK, 1.3 to 1.7 s, the real pool of 2 workers refused at unit 3 every time); the two worker test files through `unittest discover -s tests/pipeline` (17 tests, OK); `test_item_requests.py` and `test_unit_ledger.py` (36 tests, OK); `test_converter_independence.py` through `unittest discover` (20 tests, OK).
- The whole pipeline suite was not run (it belongs to Task 3).
- The unittest process never constructs a real `ProcessPoolExecutor` for items: `DeferredPoolFixture` replaces `item_unit_workers.ProcessPoolExecutor` by `DeferredExecutor`, and the real pool of 2 workers starts only in the child interpreter.

### What changed

- `scripts/actors/item_conversion.py` (204 lines): `add_sealed_outcome_of_converted_unit` raises `ItemConversionError('converted item unit <key> has no seal under the fingerprint of this run')` when the one `sealed_receipt` read returns None or a receipt under another fingerprint than `self.unit_work(unit)[2]`.
- `scripts/actors/item_unit_workers.py` (31 lines): `class ItemUnitWorkerError(ValueError)`; `converted_unit_outcome` calls the preflight, then raises `ItemUnitWorkerError('the run of this item unit worker holds no unit <key>')` for a key its run does not hold, then converts.
- `tests/pipeline/test_item_unit_workers.py` (new, 209 lines): `DeferredFuture`, `DeferredExecutor`, `DeferredPoolFixture`, `PooledSliceSelectionTests` (4 tests), `PooledSliceRefusalTests` (5 tests).
- `tests/pipeline/support/item_unit_worker_runs.py` (180 lines): `FirstTwoUnitsBeginTogetherItemRun`, `first_two_units_begin_together_worker_run`, `preflight_refused_once_the_first_two_units_have_begun`, `SYNTHETIC_PREFLIGHT_REFUSAL_MESSAGE`, scenario `refused-third-unit`.
- `tests/pipeline/test_item_unit_worker_processes.py` (181 lines): `PooledItemBatchRefusalTests` (1 test, 2 workers).

### Tests that pin the required points

| Point | Test |
|---|---|
| (e) sealed units stay out of the pool, one receipt read each | `PooledSliceSelectionTests.test_units_sealed_at_process_start_are_not_submitted_and_their_receipt_is_read_once` (reads `[True]`, `[True]`, `[False, False, True]`, `[False]`) |
| unit order of sealed and converted units | `PooledSliceSelectionTests.test_sealed_and_converted_units_come_back_in_unit_order` |
| no worker run for a fully sealed slice | `PooledSliceSelectionTests.test_a_slice_whose_units_are_all_sealed_runs_no_worker_run_factory` |
| a worker never builds the sealed-outcome map | `PooledSliceSelectionTests.test_a_worker_never_builds_the_sealed_outcome_map` |
| (c) in process | `PooledSliceRefusalTests.test_a_preflight_refusal_for_the_third_unit_stops_the_slice_and_cancels_the_rest` (the raised exception is the same object) |
| (c) real pool | `PooledItemBatchRefusalTests.test_a_preflight_refusal_in_a_worker_for_the_third_unit_stops_the_slice_and_keeps_two_sealed_units` (type `native_store.unit_ledger.BatchPreflightRefusedError` and the message cross the process boundary) |
| transient failure in place | `PooledSliceRefusalTests.test_a_transient_failure_in_a_worker_comes_back_as_a_failed_outcome_in_place` |
| T-261112-kzq-02 fingerprint guard | `PooledSliceRefusalTests.test_a_worker_seal_under_another_fingerprint_is_refused_by_the_coordinator`, `test_a_converted_outcome_without_a_seal_is_refused` |
| worker run differs from the coordinator run | `PooledSliceRefusalTests.test_a_worker_refuses_a_unit_key_its_run_does_not_hold` |

### Deviations from the plan

1. The nine in-process tests sit in two classes on one fixture (`PooledSliceSelectionTests`, `PooledSliceRefusalTests` on `DeferredPoolFixture`). The plan names the file and the tests, not the classes.
2. The worker run factory of the in-process tests is the bound method `DeferredPoolFixture.worker_run`, not a closure. Reason: it keeps the runs it built in `self.worker_runs`, which the tests assert on, and a bound method compares equal in the `initargs` assertion. The fingerprint test uses a closure, because its factory changes `implementation_hash` before it builds the run. Nothing is pickled in either case.
3. The unknown-key test reads `item_unit_workers.ItemUnitWorkerError` as a module attribute and does not import the name. Reason: an import at the top would have failed the whole file in the red run instead of this one test.
4. `later_units_seal_first_worker_run` and the new factory share one helper, `synthetic_worker_run_of_class(run_class, project_root, client_root, *run_arguments_after_the_roots)`, so the patches, the writer guards, the worker record and the module global have one owner. The module global `synthetic_worker_run` is now read by `preflight_refused_once_the_first_two_units_have_begun`, which closes deviation 6 of Task 1.
5. `FirstTwoUnitsBeginTogetherItemRun.converted_model_reason` waits for the folders of both first units, its own included. Its own folder exists after `begin`, so this is the wait for the other one the plan describes, written without a branch per unit.
6. Assertions beyond the behavior block: test (c) in process also asserts 3 preflight calls; the fingerprint test also asserts that the map of the coordinator stays empty; the three guard tests assert the whole message, not only the unit key; the child-interpreter test asserts the unit folder of unit 3 itself (the parent of the step folder) is absent.
7. As in Task 1, the plan-head ledger file, the cwd sentinel and the GSD init, state and config queries of the executor role were not written or run; the orchestrator limits this executor to Task 2 and forbids STATE.md and ROADMAP.md updates.

No file outside `files_modified` was changed. No frozen or pinned file was edited. `tests/pipeline/test_item_batch_bookkeeping.py` and `tests/pipeline/test_item_conversion_run.py` pass unchanged.

### Behavior recorded, not changed

- After a worker raised, `shutdown(wait=True, cancel_futures=True)` lets units already in flight finish and seal, so units behind the refused one can be sealed too. The next run re-adds their records, as the one-process path does after a preflight refusal. The deferred executor of the in-process tests cannot show this (a task after a raised one never runs there); the real pool test uses 2 workers and 3 units, where nothing is in flight behind unit 3.
- The coordinator checks the seals of converted units after the pool is shut down. A worker run under another fingerprint therefore converts and seals every unsealed unit of the slice before the coordinator refuses the first one; no catalog, gap-row file or census is written, and the next run converts those units again under its own fingerprint (`UnitLedger.begin` removes the folder).
- A worker whose run factory raises, or a worker process that dies, makes `future.result()` raise `concurrent.futures.process.BrokenProcessPool` at the position of the first unit without an outcome. There is no translation and no retry, and `main` does not catch it. A refusal the run factory raises in a worker (`require_reference_client`, `Converter`, `read_item_sources`) therefore does not keep its type or message; the coordinator makes the same three calls before the pool starts, so this takes a client or a lock that changes during the run. No test pins this (accepted, T-261112-kzq-06).
- A transient failure leaves the unit folder with `owner.json` and `.running.json` and no seal; the coordinator makes no receipt read for it and writes the records of the other units.
- The fingerprint guard computes `unit_work(unit)[2]` once more per converted unit on the one-process path too. It adds no receipt read; the read counts of `ItemBatchReceiptReadTests` are unchanged.
- Each worker builds its own run in the initializer and calls the preflight once per unit, before the unknown-key check and before `begin`.

### Process check after Task 2

- No python process of these runs is left. The only python process with `l2b-speed`, `multiprocessing-fork` or `run_below_normal` in its command line is the journal watcher of the orchestrator, whose journal path holds the checkout name.
- Seen and left alone, not started by this task: PID 3484 (that journal watcher), PID 25768 (`python -B -m unittest discover -s tests/pipeline -p test_character_*.py`, parent 24852, from another session), PIDs 8336 and 10688 (python processes whose command line this account cannot read).

### Notes for Task 3

- `python -B -m unittest tests/pipeline/test_converter_independence.py` by file path fails to import (`No module named 'reference_client_lock_fixture'`), as noted for `test_source_preservation_contract.py` in Task 1; the first verify command of Task 3 names that file by path. Through `unittest discover -s tests/pipeline -p "test_converter_independence.py"` it passes (20 tests).
- `scripts/actors/item_unit_workers.py` is 31 lines; `worker_count_argument` and `item_worker_run` go there.

## Task 3: --workers on the command line, the real worker run factory, whole pipeline suite

- Commit: `1b55669` on `lane/speed` (4 files, 176 added, 5 removed lines).
- Red run (the new test file, before steps B to D): 7 tests, 13 failures and 6 errors counted per subtest. Six of the seven tests failed: the pooled wiring test and the two factory tests (`module 'actors.item_unit_workers' has no attribute 'item_worker_run'`), the two argument-error tests (argparse answered `unrecognized arguments: --workers 2` instead of the two new messages; the bounds line failed on the missing `worker_count_argument`), and the accepting test (`SystemExit` 2). `test_without_workers_and_with_one_worker_the_units_convert_in_the_calling_process` passed at once: the one-process branch existed before this task and did not read `arguments.workers`.
- First verify command (the one of the plan, through `run_below_normal.py`): 74 tests, OK, 30.5 s (7 in `test_item_worker_command_line.py`, 9 in `test_item_unit_workers.py`, 8 in `test_item_unit_worker_processes.py`, 8 in `test_item_batch_bookkeeping.py`, 5 in `test_item_conversion_run.py`, the rest in `test_npc_batch.py` and `test_converter_independence.py`). `test_converter_independence.py` imports by file path in this command, because the files named before it put `tests/pipeline` on `sys.path`. The new file also loads through `unittest discover -s tests/pipeline` (7 tests, OK).
- `git diff --numstat 10aa0ad -- scripts/actors/convert_actors.py`: 4 added, 0 removed. The file is 401 lines.
- `git diff --stat 10aa0ad HEAD`: the eight files of `files_modified` and no other (822 added, 14 removed lines).

### Whole pipeline suite

- Second verify command as written, once, 17:04:30 to 17:11:23 on 2026-11-12, log kept at `C:/laragon/l2b-orchestration/autonomous-roadmap/pipeline-261112-kzq.log`.
- `Ran 2297 tests in 410.492s`, `FAILED (errors=2, skipped=67)`. No `FAIL:` line.
- The two `ERROR:` lines are the two baseline ids and no other: `test_world_audio_step.RealClientAudioTests.test_the_20_20_ambient_counts_equal_the_staged_ambience` and `test_world_bsp_step.OracleBrushSubsetTests.test_the_generic_20_20_step_holds_the_brush397_and_brush610_nodes_at_their_native_positions`.
- The 24 tests of this plan are in the log (7 + 9 + 8). The run took 6 min 50 s, so no pool started in the unittest process.
- Before the start no other `scripts/test_pipeline.py` ran on the machine. Not started by this task and left alone: `convert_actors.py --client E:/Lineage2-client --batch characters --limit 14` (PIDs 25476 and 12992, started 17:02:42 by another session, checkout not visible in its command line) ran during part of the suite run and had ended when the suite ended.

### What changed

- `scripts/actors/item_unit_workers.py` (53 lines): `MAXIMUM_WORKER_COUNT` 61, `worker_count_argument(text)` (an unpadded integer from 1 to 61, else `argparse.ArgumentTypeError('--workers must be an integer from 1 to 61: <text>')`), `item_worker_run(project_root, client_root, converter_output_root, umodel_path, ledger_root, store_root)`. The module now imports `Converter` from `native_assets`, `decode_table` from `native_catalog.tables` and `require_reference_client` from `reference_client_guard`; those frozen files are imported only.
- `scripts/actors/item_census.py` (132 lines): `run_item_conversion` keeps the ledger root in a local name and branches three ways: single item as before; items batch with `arguments.workers` None or 1 through `run_item_batch`; more workers through `run_pooled_item_batch` with `item_worker_run` and the six paths. `arguments.workers` is read on the items batch only.
- `scripts/actors/convert_actors.py` (401 lines): the import of `worker_count_argument`, `--workers` with no default and a one-sentence help text that carries the D-16 rule, and the two-line check `--workers is only valid with --batch items` after the `--level` check.
- `tests/pipeline/test_item_worker_command_line.py` (new, 141 lines): `ItemConversionWorkerWiringTests` (2), `ItemWorkerRunFactoryTests` (2), `WorkersArgumentTests` (3).

### Tests that pin the required points

| Point | Test |
|---|---|
| D-16 no pool without `--workers` and with 1 | `ItemConversionWorkerWiringTests.test_without_workers_and_with_one_worker_the_units_convert_in_the_calling_process` |
| D-16 the pooled branch gets the real factory and the six paths | `ItemConversionWorkerWiringTests.test_several_workers_hand_the_pool_the_real_factory_and_the_six_paths` |
| D-15 a worker run is built like the run of the coordinator | `ItemWorkerRunFactoryTests.test_the_worker_run_is_built_from_the_six_paths_like_the_run_of_the_coordinator` |
| what crosses the process boundary pickles by reference | `ItemWorkerRunFactoryTests.test_the_worker_task_the_initializer_the_real_factory_and_the_lane_preflight_pickle_by_reference` |
| (f) D-17 `--workers` refused outside `--batch items` | `WorkersArgumentTests.test_workers_with_any_mode_other_than_the_items_batch_is_an_argument_error` (8 command lines, `--workers 1` with `--batch npcs` among them) |
| (f) T-261112-kzq-04 count from 1 to 61 | `WorkersArgumentTests.test_a_worker_count_outside_one_to_sixty_one_is_an_argument_error` |
| (f) the count reaches the item conversion, printed lines in order | `WorkersArgumentTests.test_the_items_batch_accepts_workers_and_hands_the_count_to_the_item_conversion` |

### Deviations from the plan

1. The one-process wiring test builds one project tree per worker value with `build_project_tree`, imported from `tests/pipeline/test_item_unit_worker_processes.py`. Reason: the second value needs unsealed units, and the tree of `ItemBatchFixture` holds the sealed units of the first value after one call. The plan names the two older item test files as import sources and forbids only `test_item_unit_workers.py`.
2. The wiring tests use `BookkeepingItemRun` on the default rows of `ItemBatchFixture`, so the three fresh outcomes are pass, gap and pass with `cacheHit` false. The plan says "a synthetic run" and names no class.
3. The argument-error tests capture `sys.stderr` with `contextlib.redirect_stderr` and assert the message beside exit code 2. Reason: before step D argparse already ended with code 2 for the unknown option, so the code alone could not fail first.
4. Assertions beyond the behavior block: both wiring tests assert the calls of `read_item_sources` and `ItemConversionRun` (ledger root and store root included), because no other test calls `run_item_conversion`; the pooled wiring test asserts that the coordinator run converted no unit, called no preflight and still wrote the census; the range test asserts that `worker_count_argument` returns 1 and 61 for the two bounds.
5. `item_unit_workers.ProcessPoolExecutor` is replaced by a mock that raises in `setUp` of the wiring class, so it also covers the pooled wiring test.
6. As in Tasks 1 and 2, the plan-head ledger file, the cwd sentinel, the GSD init, state and config queries and the windows ledger were not written or run; the orchestrator limits this executor to Task 3 and forbids STATE.md and ROADMAP.md updates. The base commit is in the frontmatter (`plan_head_before`), and `commits: 3` is `git rev-list --count 10aa0ad..HEAD`.

No file outside `files_modified` was changed and no tracked file outside it shows as modified. No frozen or pinned file was edited. No stub, TODO or placeholder is in the eight files.

### Process check after Task 3

- No python process of these runs is left: the runner (PID 9900) and the suite (PID 18588) ended by themselves, and no python process holds `l2b-speed`, `test_pipeline` or `multiprocessing-fork` in its command line apart from the journal watcher of the orchestrator (PID 2564, its journal path holds the checkout name).
- Seen and left alone, not started by this task: PIDs 8336 and 10688 (python processes since 11:32 whose command line this account cannot read), PID 24588 (`print_lane_union_catalog.py` of the roadmap worktree, another session).

## Required tests (a) to (f)

| Point | Where |
|---|---|
| (a) byte identity of shared files, store files, ledger outputs, receipts | Task 1, `PooledItemBatchByteIdentityTests` (three tests) |
| (b) unit order of outcomes and printed lines | Task 1, `test_the_outcomes_and_the_printed_lines_follow_unit_order_in_both_runs` |
| (c) worker preflight refusal for the third unit | Task 2, `PooledSliceRefusalTests` in process and `PooledItemBatchRefusalTests` with a real pool of 2 workers |
| (d) only the coordinator writes shared files | Task 1, `test_no_worker_writes_a_shared_file_and_the_coordinator_converts_no_unit` |
| (e) sealed units stay out of the pool, one receipt read each | Task 2, `PooledSliceSelectionTests.test_units_sealed_at_process_start_are_not_submitted_and_their_receipt_is_read_once` |
| (f) `--workers` argument | Task 3, `WorkersArgumentTests` (three tests) |

## Accepted consequences

1. `--workers` has no argparse default and an absent value stands for 1 (no pool). That is what lets `--workers 1` outside `--batch items` be refused as an argument error. Tests: the `--batch npcs --limit 1 --workers 1` case of test (f), and `arguments.workers is None` without the option in the accepting test.
2. An exception raised in the pool initializer (the run factory), or a worker process that dies, reaches the caller as `concurrent.futures.process.BrokenProcessPool` at the position of the first unit without an outcome, not with its own type and message; `main` does not catch it. The coordinator runs the same three constructors first, so this takes a client or a lock that changes during the run. No test (T-261112-kzq-06).
3. `scripts/actors/convert_actors.py` ends at 401 lines.
4. The synthetic worker runs of the child-interpreter tests all write the same constant file `converted.l2asset` beside the client root at the same time. No run reads it, and it lies outside the store and work roots the tests compare. The 4-worker run and the 2-worker run pass with this in place, in the targeted runs and in the whole suite.
5. After a worker raised, `shutdown(wait=True, cancel_futures=True)` lets units already in flight finish and seal, so units behind the refused one can be sealed; the next run re-adds their records. No test shows a unit sealed behind the refused one (see "Behavior recorded, not changed" of Task 2).
6. A worker result without a seal under the fingerprint of the coordinator is refused with `ItemConversionError`. Tests: `test_a_worker_seal_under_another_fingerprint_is_refused_by_the_coordinator`, `test_a_converted_outcome_without_a_seal_is_refused`.
7. Each worker builds its own run and calls the preflight once per unit. Tests: `test_a_worker_never_builds_the_sealed_outcome_map`, `test_a_preflight_refusal_for_the_third_unit_stops_the_slice_and_cancels_the_rest` (3 preflight calls), `test_a_worker_refuses_a_unit_key_its_run_does_not_hold`.
8. The real worker run factory `item_worker_run` and the spawn of `convert_actors.py` as the main module were not run against the reference client in this plan. The factory is tested with its four collaborators replaced by mocks, and the pickling test runs with `convert_actors` imported as a module, where `lane_batch_preflight` belongs to `actors.convert_actors`; run as a script it belongs to `__main__`. The measurement task (D-18) runs both first, and a spawn or pickling failure there counts as a defect of this plan.
9. In production every worker builds its own `Converter` on the one converter output folder of the coordinator. The plan rests this on the frozen converter working in a `tempfile.mkdtemp` folder and publishing under a content key that carries the unit key; no test of this plan runs two real converters side by side, so D-18 is the first check of it too.

## Self-check: passed

- The eight files of `files_modified` exist, and `git diff --stat 10aa0ad HEAD` lists exactly those eight.
- `736e94c`, `f951425` and `1b55669` are ancestors of `HEAD` on `lane/speed`.
- The suite log exists and holds the `Ran 2297 tests` line and the two baseline `ERROR:` lines only.
