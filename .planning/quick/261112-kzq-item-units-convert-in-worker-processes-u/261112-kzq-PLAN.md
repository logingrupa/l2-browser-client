---
phase: 261112-kzq-item-units-convert-in-worker-processes-u
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/actors/item_unit_workers.py
  - scripts/actors/item_conversion.py
  - scripts/actors/item_census.py
  - scripts/actors/convert_actors.py
  - tests/pipeline/support/item_unit_worker_runs.py
  - tests/pipeline/test_item_unit_worker_processes.py
  - tests/pipeline/test_item_unit_workers.py
  - tests/pipeline/test_item_worker_command_line.py
autonomous: true
requirements: [D-15, D-16, D-17]

estimate:
  tokens: 94000
  raw_tokens: 94000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A synthetic items batch converted by 4 worker processes that seal later units before earlier ones leaves catalog.json, the items gap-row file and the item census byte-identical to the same batch converted in one process, and equal to the expected bytes of the existing items byte-identity test (D-15)"
    - "The one-process tree and the pooled tree hold the same set of (path, SHA-256) for store files and for ledger outputs; receipts are equal after dropping finishedAtRiga, freeBytesBefore and freeBytesAfter, owner records after dropping pid and startedAtRiga, seals after dropping receiptSha256 (D-15)"
    - "The outcome list and the lines convert_actors prints from it are in run.units order in the one-process run and in the pooled run (D-15)"
    - "Only the coordinator writes shared files: no worker calls write_store, write_gap_rows, write_item_census_and_gap_rows, write_item_records or refresh_lane_coverage, no shared file exists before the first store write of the coordinator, and the coordinator converts no unit (D-15)"
    - "A unit sealed at process start is not submitted to a worker and UnitLedger.sealed_receipt is called once for it; a unit a worker seals enters the sealed-outcome map of the coordinator by one receipt read whose fingerprint equals the fingerprint of the coordinator; a worker never builds the sealed-outcome map (D-15)"
    - "A preflight refusal raised in a worker for the third unit is raised by the coordinator with the same type and message, the pool is shut down with cancel_futures=True, the first two units stay sealed and no catalog, gap-row file or census is written (D-15)"
    - "A transient failure in a worker comes back as a failed outcome at the position of its unit and the unit is not added to the sealed-outcome map (D-15)"
    - "Without --workers and with --workers 1 the units convert in the calling process and no ProcessPoolExecutor is constructed (D-16)"
    - "--workers is an argument error with every mode other than --batch items and for a value outside 1 to 61; skill roots and world tiles get no worker path (D-16, D-17)"
    - "Worker processes of a coordinator that runs at BelowNormal run at BelowNormal"
    - "The whole pipeline suite has no FAIL line and no ERROR line other than the two baseline ids (test_world_audio_step 20_20 ambient counts, test_world_bsp_step 20_20 brush nodes)"
  artifacts:
    - path: "scripts/actors/item_unit_workers.py"
      provides: "Worker initializer, worker task, pooled submission in unit order, the real worker run factory and the --workers argument type"
      contains: "def outcomes_converted_by_workers"
    - path: "scripts/actors/item_conversion.py"
      provides: "Conversion of one unsealed unit without the sealed-outcome map, and the one rule that adds a converted unit to the map"
      contains: "def convert_unsealed_unit"
    - path: "scripts/actors/item_census.py"
      provides: "One slice walk shared by the one-process batch and the pooled batch"
      contains: "def run_pooled_item_batch"
    - path: "scripts/actors/convert_actors.py"
      provides: "--workers argument, valid only with --batch items"
      contains: "--workers"
    - path: "tests/pipeline/support/item_unit_worker_runs.py"
      provides: "Synthetic worker run factories, preflights and the pooled batch report that worker processes and the child interpreter import"
      contains: "def print_pooled_batch_report"
    - path: "tests/pipeline/test_item_unit_worker_processes.py"
      provides: "Child-interpreter tests of the real pool: byte identity, unit order, worker write guards, worker preflight refusal"
      contains: "POOLED_BATCH_PROGRAM"
    - path: "tests/pipeline/test_item_unit_workers.py"
      provides: "In-process coordinator tests with a deferred fake executor"
      contains: "class DeferredExecutor"
    - path: "tests/pipeline/test_item_worker_command_line.py"
      provides: "Tests of the --workers argument, of the one-process and the pooled branch of run_item_conversion and of the real worker run factory"
      contains: "class WorkersArgumentTests"
  key_links:
    - from: "scripts/actors/item_census.py"
      to: "scripts/actors/item_unit_workers.py"
      via: "run_pooled_item_batch submits the unsealed unit keys of the slice"
      pattern: "outcomes_converted_by_workers"
    - from: "scripts/actors/item_unit_workers.py"
      to: "scripts/actors/item_conversion.py"
      via: "the worker task converts one unit: begin, convert, seal"
      pattern: "convert_unsealed_unit"
    - from: "scripts/actors/item_census.py"
      to: "scripts/actors/item_conversion.py"
      via: "the coordinator adds each unit a worker sealed by one receipt read"
      pattern: "add_sealed_outcome_of_converted_unit"
    - from: "scripts/actors/convert_actors.py"
      to: "scripts/actors/item_unit_workers.py"
      via: "argparse type of --workers"
      pattern: "worker_count_argument"
    - from: "tests/pipeline/test_item_unit_worker_processes.py"
      to: "tests/pipeline/support/item_unit_worker_runs.py"
      via: "python -B -c child program"
      pattern: "print_pooled_batch_report"
---

<objective>
Convert the unsealed item units of one slice in worker processes under one coordinator that alone writes shared files, with outputs byte-identical to the one-process batch.

Purpose: the audit of plans 02-78 and 02-79 measured conversion at 47 percent of items slice time, 1.43 s per pass unit, on one core of a machine with 16 threads.
Output: one new module `scripts/actors/item_unit_workers.py`, changed `item_conversion.py`, `item_census.py` and `convert_actors.py` (four added lines), one test support module and three new test files under `tests/pipeline`, a passing pipeline suite.

Decision ids: D-NN is locked decision NN of `.planning/quick/261112-i67-pinned-store-verification-walk-without-p/261112-i67-CONTEXT.md`. This plan covers D-15, D-16 and D-17 and nothing else. D-18 (measurement, the first run of the real worker run factory against the reference client) belongs to a later task.

Source coverage:

| Source item | Where |
|---|---|
| D-15 one coordinator, unit order, worker builds its own Converter and run, preflight then begin, convert, seal, only the coordinator writes shared files | Task 1 (pool, coordinator, byte identity), Task 2 (selection, refusals, guards), Task 3 (real factory) |
| D-16 `--workers`, 1 means no pool, never two slices side by side | Task 3 (argument, help text, one-process branch) |
| D-17 no workers for skill roots and world tiles | Task 3 (`--workers` refused for every mode other than `--batch items`; no skill or tile file is touched) |
| Hard constraint: outputs byte-identical, refusals keep type and message | Task 1 test (a), Task 2 test (c) |
| Hard constraint: every sealed unit checked once per process, fingerprint included | Task 2 (fingerprint guard, receipt read counts) |
| Hard constraint: BelowNormal | Task 1 (worker priority class test) |

Estimate and budget choice: `estimate.tokens` is 94000 against the 100000-token smart-zone budget (`estimate-calibration` on 2026-11-12: factor 1, 0 samples, confidence low). It is the sum, at four characters per token over measured file sizes, of what the executor touches:

| Part | Tokens |
|---|---|
| Reads: this plan 13,800; `execute-plan.md` and the summary template 13,100; the context file and AGENTS.md 4,700; the `read_first` ranges of the three tasks 20,800 | 52,400 |
| Files written: about 19,400 of content (four script files, the support module, three test files, the SUMMARY) plus about 30 percent rework after failing first runs | 25,200 |
| Output of the targeted test runs, git and the process check | 16,000 |
| Whole suite, read from its log by pattern | 500 |
| Sum, rounded | 94,000 |

Two rules of this plan hold the figure there: the whole-suite output goes to a log file and never into the conversation (Task 3 step F), and the 35 KB summary of 261112-i80 is not inlined (context section). Recorded choice: the margin is 6 percent on a low-confidence figure, so the run may still pass the budget, and the plan stays one plan of three tasks in that case too. A quick task holds one plan file; Task 3 changes two script files that Tasks 1 and 2 change, so it can only follow them; and each task ends in its own commit, so the work can be resumed at a task boundary from this plan and the git log.
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/quick/261112-i67-pinned-store-verification-walk-without-p/261112-i67-CONTEXT.md
@AGENTS.md

Not inlined, to keep the executor inside the context budget: `.planning/quick/261112-i80-batch-bookkeeping-without-repeated-work-/261112-i80-SUMMARY.md` (35 KB). The interface notes below and the source files hold what this plan needs from it; open it only for a question they do not answer.

Rules that bind every task:

- Files this plan may change: the eight files of `files_modified`. Never edit a frozen or pinned file of the context file (`scripts/native_assets.py`, `scripts/native_catalog/**`, `scripts/reference_client_guard.py`, `scripts/native_store/store_paths.py` and the others it lists); import from them only. Never edit `scripts/native_store/catalog_writer.py`, `write_lane_catalog.py`, `merge_lane_store.py` or `unit_ledger.py`. Do not edit `tests/pipeline/test_item_conversion_run.py` or `tests/pipeline/test_item_batch_bookkeeping.py`; import their fixtures.
- AGENTS.md code rules in full: no comments, no docstrings, full-word names, no dead code, no option beyond the ones named here, files under about 400 lines.
- No worker count is derived from the machine in code (no `os.cpu_count`). The caller chooses it.
- This plan runs unit tests in temporary folders only. It starts no real conversion, writes to no lane store and to no other checkout, and starts no debugger, dev server or interactive program.
- Every command runs from the checkout root through `python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py`.
- Each task ends with one commit on `lane/speed`: a plain sentence as message, no attribution line, files staged by name. No push, no merge. Quick task 261112-l5d works in this checkout at the same time; its files are never staged, edited or removed by this plan.

Interfaces as they stand at `ddc0b51` (read the files, these are the parts the tasks build on):

- `scripts/actors/item_conversion.py`: `ItemConversionRun(project_root, client_access, converter, ledger_root, store_root, sources)` with `units` (ordered), `units_by_key`, `ledger`, `unit_work(unit) -> (inputs, config, fingerprint)`, `receipt_outcome(unit, receipt)`, `sealed_outcomes_by_unit_key()` (one pass over all units, one `sealed_receipt` read each, kept in `self.sealed_outcomes`), `convert(unit)` (map lookup, then `ledger.begin`, `converted_model_reason`, `ledger.seal`, then one `sealed_receipt` read into the map; a `TRANSIENT_FAILURES` error returns a `FAILED_STATUS` outcome without a seal), `write_item_records(outcomes)`. `read_item_sources(project_root, client_root, decode_table)`.
- `scripts/actors/item_census.py`: `run_item_batch(run, limit, preflight)` (15 call sites in the two existing item test files; its signature stays), `write_item_census_and_gap_rows(run, slice_limit)`, `run_item_conversion(project_root, client_access, converter, output_root, decode_table, arguments, preflight)`.
- `scripts/actors/convert_actors.py` (397 lines): `main` calls `run_at_below_normal_priority()` before any conversion and passes the module-level function `lane_batch_preflight` as `preflight`; it prints one line per returned outcome through `printed_outcome`; it ends with the `if __name__ == '__main__':` guard that the spawn start method needs. `main` catches `OSError` and `ValueError` only.
- `scripts/native_store/unit_ledger.py`: `UnitLedger.sealed_receipt(unit_key)` returns the receipt or None and checks the seal, the receipt hash and each output; `begin` writes `owner.json` (with `pid`, `startedAtRiga`) and `.running.json`; `seal` writes `receipt.json` (with `freeBytesBefore`, `freeBytesAfter`, `finishedAtRiga`) and `complete.json` (with `receiptSha256`). `BatchPreflightRefusedError` is a `ValueError`. `BELOW_NORMAL_PRIORITY_CLASS`, `run_at_below_normal_priority()`.
- `scripts/native_assets.py` (frozen, read only): `Converter(client, output, umodel)` keeps `output` and `umodel` as resolved paths; `convert` works in a `tempfile.mkdtemp` folder under `output/.work` and publishes under a content key of the request, which carries the unit key.
- `tests/pipeline/test_item_batch_bookkeeping.py`: `ItemBatchFixture` (temporary project root, actor unit census, patches of `item_conversion.implementation_hash`, `converted_model_store_files_and_record` and a wrapping `write_store` mock), `BookkeepingItemRun` (five weapon rows, four units: shared sword, refused long sword, bow, axe), `SLICE_LIMIT` 3, `expected_item_records`, `expected_gap_row_document`, `expected_census`, `weapon_unit_key`, `archive_derived_store_files_and_record`, `BOOKKEEPING_WEAPON_ROWS`. `tests/pipeline/test_item_conversion_run.py`: `SyntheticItemRun`, `WEAPON_ROWS` (four units, all pass), `write_actor_unit_census`, `FIRST_CONVERTER_SHA256`, `CHANGED_CONVERTER_SHA256`.
- `tests/pipeline/test_bundle_member_pins.py` lines 33 to 53 and 125 to 166: the pattern for a pool test. `scripts/test_pipeline.py` runs the suite at module level with no main guard, so a pool started in the unittest process would replay the suite in every worker. A pooled run therefore starts from a child interpreter (`subprocess.run([sys.executable, '-B', '-c', PROGRAM, ...])`), and the unittest process patches `ProcessPoolExecutor` of the module under test so it can never start a pool itself. A `-c` program has no main file, so its workers do not run it again; everything a worker unpickles must live in an importable module, never in the `-c` program and never in a lambda.
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: One pooled items slice end to end - worker pool module, coordinator, and the byte-identity run in a child interpreter</name>
  <files>scripts/actors/item_conversion.py, scripts/actors/item_unit_workers.py, scripts/actors/item_census.py, tests/pipeline/support/item_unit_worker_runs.py, tests/pipeline/test_item_unit_worker_processes.py</files>
  <precondition>Quick tasks 261112-i67 and 261112-i80 are committed in this checkout: `ddc0b51` is an ancestor of `HEAD`, and `git status --short` prints no line for a file of `files_modified`, for `scripts/actors` or for the three existing item test files. Files of another quick task (for example `tests/pipeline/test_store_file_copy.py` of 261112-l5d) may show; leave them alone and never stage them.</precondition>
  <read_first>
    scripts/actors/item_conversion.py, scripts/actors/item_census.py, scripts/native_store/unit_ledger.py (lines 249 to 339), tests/pipeline/test_item_batch_bookkeeping.py, tests/pipeline/test_item_conversion_run.py, tests/pipeline/test_bundle_member_pins.py (lines 33 to 53 and 125 to 166)
  </read_first>
  <behavior>
    Class `PooledItemBatchByteIdentityTests` in `tests/pipeline/test_item_unit_worker_processes.py`. `setUpClass` builds two trees under one temporary folder and runs each batch once: the one-process tree by `run_item_batch(BookkeepingItemRun(...), SLICE_LIMIT, lambda: None)` and `write_item_census_and_gap_rows` in the unittest process, the pooled tree by one child interpreter with 4 workers (scenario `later-units-seal-first`). Tests:
    - test (a) `test_four_workers_that_seal_later_units_first_leave_the_shared_files_of_the_one_process_batch`: `catalog.json`, the items gap-row file (`lane_gap_rows_path(project_root, 'actors', 'items')`) and the item census of the two trees are byte-identical, and equal to `json_bytes({'schemaVersion': 1, 'models': expected_item_records()})`, `canonical_json_bytes(expected_gap_row_document())` and the dumped `expected_census()`.
    - test (a) `test_the_store_files_and_the_ledger_outputs_have_the_same_paths_and_sha256`: the set of (relative path, SHA-256) of every file under the store root is equal in both trees; so is the set for every file under the work root other than `owner.json`, `receipt.json` and `complete.json`; the relative path sets of the two work roots are equal and hold no `.running.json`.
    - test (a) `test_the_receipts_owner_records_and_seals_differ_in_clock_pid_free_byte_and_receipt_hash_fields_only`: per unit folder, `receipt.json` is equal after dropping `finishedAtRiga`, `freeBytesBefore`, `freeBytesAfter`; `owner.json` after dropping `pid`, `startedAtRiga`; `complete.json` after dropping `receiptSha256`; in each tree `receiptSha256` is the SHA-256 of the receipt bytes beside it.
    - test (b) `test_the_outcomes_and_the_printed_lines_follow_unit_order_in_both_runs`: the outcome list of the child equals the outcome list of the one-process run; its keys are `[weapon_unit_key(SHARED_SWORD_ROWS[0]), weapon_unit_key(REFUSED_LONG_SWORD_ROW), weapon_unit_key(BOW_ROW)]`, statuses `['pass', 'gap', 'pass']`, every `cacheHit` false; the lines `json.dumps(convert_actors.printed_outcome(outcome), sort_keys=True)` are equal in both runs and in that order. `main` prints exactly these lines from the returned list and its print loop is not edited by this plan.
    - `test_later_units_were_sealed_before_earlier_ones_in_the_pooled_run`: in the pooled tree `st_mtime_ns` of `complete.json` of unit 3 is not above that of unit 2, and that of unit 2 not above that of unit 1. The gate of the synthetic run makes any other order impossible; a gate that times out fails the child.
    - test (d) `test_no_worker_writes_a_shared_file_and_the_coordinator_converts_no_unit`: the child reports no shared file before its first store write (`sharedFilesBeforeTheFirstStoreWrite == []`), `coordinatorConvertedUnitKeys == []` and `poolWorkerCounts == [4]`; every worker ran with its shared-file writers replaced by a function that raises, so a worker write would have failed the child.
    - `test_every_unit_was_converted_by_its_own_below_normal_worker_process`: the three `owner.json` pids of the pooled tree are three different pids, none is `coordinatorPid`, they equal the pids of the worker record files, and every worker record holds priority class `BELOW_NORMAL_PRIORITY_CLASS`.
  </behavior>
  <action>
A. Tests first. Create `tests/pipeline/support/item_unit_worker_runs.py` (no `test_` prefix, no `__init__.py`; imported as `support.item_unit_worker_runs` with `tests/pipeline` and `scripts` on `sys.path`). It holds only module-level functions and classes, because worker processes import it:
- `wait_until_path_exists(path)`: a bounded poll (`GATE_POLL_SECONDS` 0.01, `GATE_TIMEOUT_SECONDS` 60) that raises `AssertionError` naming the path on timeout. It synchronizes worker processes through ledger files and hides no failure.
- `start_synthetic_item_conversion_patches()`: starts and returns two `mock.patch.object` patchers on `actors.item_conversion`: `implementation_hash` returning `FIRST_CONVERTER_SHA256`, `converted_model_store_files_and_record` with side effect `archive_derived_store_files_and_record`. The unittest process stops them in class cleanup; the child interpreter and the workers keep them for the life of the process.
- `refuse_shared_file_writers_in_this_process()`: patches `item_conversion.write_store`, `item_census.write_gap_rows`, `item_census.write_item_census_and_gap_rows`, `ItemConversionRun.write_item_records` and `native_store.lane_coverage_refresh.refresh_lane_coverage` with a side effect that raises `AssertionError('an item unit worker called a shared-file writer')`.
- `LaterUnitsSealFirstItemRun(BookkeepingItemRun)` with constructor `(project_root, client_root, gated_unit_count)`: `converted_model_reason(unit)` first waits, when the unit has a successor among the first `gated_unit_count` units of `self.units`, until `complete.json` of that successor exists, then returns the result of the parent method.
- Factory `later_units_seal_first_worker_run(project_root, client_root, gated_unit_count)`: starts the synthetic patches, calls `refuse_shared_file_writers_in_this_process()`, writes the worker record `Path(client_root).parent / 'item-unit-workers' / f'{os.getpid()}.json'` holding `{"priorityClass": N}` (N read with `ctypes` `GetPriorityClass(GetCurrentProcess())`), builds the run, keeps it in the module global `synthetic_worker_run` and returns it.
- `passing_preflight()`: a module-level function that does nothing (a lambda cannot cross the process boundary).
- `pooled_batch_report(scenario_name, project_root, client_root, worker_count)` and `print_pooled_batch_report(program_arguments)`: the coordinator side of the child interpreter. It calls `run_at_below_normal_priority()`, starts the synthetic patches, replaces `item_unit_workers.ProcessPoolExecutor` by a recording subclass (records `max_workers`, as `POOLED_WALK_PROGRAM` does), wraps `item_conversion.write_store` so its first call records which of these exist: any file under the store root, the items gap-row file, the item census. It builds `BookkeepingItemRun(project_root, client_root)` as the coordinator run, calls `run_pooled_item_batch(run, SLICE_LIMIT, passing_preflight, worker_count, later_units_seal_first_worker_run, (project_root, client_root, SLICE_LIMIT))`, then `write_item_census_and_gap_rows(run, SLICE_LIMIT)`, and prints one JSON line with `outcomes`, `printedLines`, `poolWorkerCounts`, `coordinatorPid`, `coordinatorConvertedUnitKeys`, `sharedFilesBeforeTheFirstStoreWrite`, `storeWriteCallCount`, `refusalType`, `refusalMessage` (the last two null unless the batch raised; a raised exception is caught and reported by type and message, as `POOLED_WALK_PROGRAM` does).
Create `tests/pipeline/test_item_unit_worker_processes.py` with `POOLED_BATCH_PROGRAM` (a four-line `-c` program: put `sys.argv[1]` and `sys.argv[2]` at the front of `sys.path`, import `print_pooled_batch_report`, call it with the remaining arguments), `POOLED_BATCH_TIMEOUT_SECONDS` 240 passed as `timeout` to `subprocess.run`, a helper that builds a project tree (project root with `artifacts`, client root, `write_actor_unit_census(project_root, BOOKKEEPING_WEAPON_ROWS)`), a helper `child_interpreter_report` that runs the program with `[sys.executable, '-B', '-c', ...]`, asserts exit status 0 with stderr as message and parses the line, and the tests of the behavior block. Run the file: it must fail, because `run_pooled_item_batch` and `actors.item_unit_workers` do not exist.

B. `scripts/actors/item_conversion.py` (D-15):
- Add `ItemConversionRun.convert_unsealed_unit(self, unit)`: the present body of `convert` from the `unit_work` call to the seal (begin, `converted_model_reason`, the `TRANSIENT_FAILURES` branch that returns the failed outcome, the archive copy, the gap rows, `ledger.seal`), returning the fresh outcome with `cacheHit` false. It never calls `sealed_outcomes_by_unit_key`, so a worker reads only the folder of the unit it converts.
- Add `ItemConversionRun.add_sealed_outcome_of_converted_unit(self, unit, outcome)`: returns without a read when the outcome status is `FAILED_STATUS`; otherwise makes one `self.ledger.sealed_receipt` read and stores `receipt_outcome(unit, receipt)` in the map of `sealed_outcomes_by_unit_key()`. This is the one owner of the rule for the one-process path and the coordinator.
- Change `convert`: map lookup as today; for an unsealed unit call `convert_unsealed_unit`, then `add_sealed_outcome_of_converted_unit`, and return the fresh outcome. The `sealed_receipt` calls of the one-process path keep their number and order (pass, begin, after the seal).

C. New `scripts/actors/item_unit_workers.py` (D-15):
- `from concurrent.futures import ProcessPoolExecutor` as a module attribute, so tests can replace it.
- `ItemUnitWorker = namedtuple('ItemUnitWorker', 'run preflight')` and the module-level name `item_unit_worker`, None in a process that is no worker.
- `initialize_item_unit_worker(run_factory, run_factory_arguments, preflight)`: the pool initializer. It sets `item_unit_worker` to `ItemUnitWorker(run_factory(*run_factory_arguments), preflight)`. The run factory is the one injection point; add no other.
- `converted_unit_outcome(unit_key)`: the worker task. In this order: `item_unit_worker.preflight()`, then `item_unit_worker.run.convert_unsealed_unit(...)` for the unit of that key in `units_by_key`. It returns the outcome dict and writes no shared file.
- `outcomes_converted_by_workers(unit_keys, worker_count, run_factory, run_factory_arguments, preflight)`: constructs `ProcessPoolExecutor(max_workers=worker_count, initializer=initialize_item_unit_worker, initargs=(run_factory, run_factory_arguments, preflight))`, submits `converted_unit_outcome` once per key in the given order, returns the results in submission order, and in a `finally` clause calls `shutdown(wait=True, cancel_futures=True)`. An exception of a worker is thereby raised at the position of its unit, after the outcomes before it were taken; `wait=True` lets units in flight finish and seal before the coordinator or the coverage refresh reads the ledger. No start method, no context and no task limit is passed.

D. `scripts/actors/item_census.py` (D-15):
- Add `selected_slice_units(run, limit)`: takes `run.sealed_outcomes_by_unit_key()` and walks `run.units` in order; it stops before a unit once `limit` unsealed units are collected, exactly where the loop of `run_item_batch` breaks today; it returns the units of the slice and the unsealed ones among them, both in unit order.
- Add `written_slice_outcomes(run, slice_units, unsealed_units, converted_outcomes)`: builds the outcome list in unit order (the fresh outcome of a unit converted in this slice, the map entry of a unit that was sealed at the walk), calls `run.write_item_records(outcomes)` and returns the list. Pair units and outcomes with `zip(..., strict=True)`.
- Change `run_item_batch(run, limit, preflight)` to use both helpers; signature and behavior stay: for each unsealed unit in order `preflight()` then `run.convert(unit)`.
- Add `run_pooled_item_batch(run, limit, preflight, worker_count, worker_run_factory, worker_run_arguments)`: the same walk, then `outcomes_converted_by_workers` with the unsealed unit keys, then `run.add_sealed_outcome_of_converted_unit(unit, outcome)` per unit in order, then `written_slice_outcomes`. `write_item_census_and_gap_rows` and `run_item_conversion` are not changed in this task.

E. Run the verify command; all tests pass. `ItemBatchReceiptReadTests` of the existing file must pass unchanged (the read counts `[True]`, `[True]`, `[False, False, True]`, `[False]`). Commit.

Not in this task: the command line, the real worker run factory and `run_item_conversion` (Task 3). The tracer proves the part that can fail by design (spawn, pickling by reference, a run per worker, ledger folders written by several processes, byte identity); the command-line layer is four lines that cannot run end to end without the reference client.
  </action>
  <verify>
    <automated>python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py python -B -m unittest tests/pipeline/test_item_unit_worker_processes.py tests/pipeline/test_item_batch_bookkeeping.py tests/pipeline/test_item_conversion_run.py tests/pipeline/test_item_requests.py tests/pipeline/test_unit_ledger.py</automated>
  </verify>
  <done>The new test file failed before B to D and passes after. The seven tests of `PooledItemBatchByteIdentityTests` pass with one child interpreter run of 4 workers. The three existing item test files and `test_unit_ledger.py` pass without an edit. `scripts/actors/item_unit_workers.py` exists and holds no comment. The change is committed on `lane/speed`.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Coordinator rules and refusals - sealed units stay out of the pool, a worker refusal stops the slice in unit order, a worker result without a valid seal is refused</name>
  <files>scripts/actors/item_conversion.py, scripts/actors/item_unit_workers.py, tests/pipeline/test_item_unit_workers.py, tests/pipeline/support/item_unit_worker_runs.py, tests/pipeline/test_item_unit_worker_processes.py</files>
  <read_first>
    scripts/actors/item_unit_workers.py, scripts/actors/item_census.py and scripts/actors/item_conversion.py as Task 1 left them, tests/pipeline/test_item_batch_bookkeeping.py (class `ItemBatchReceiptReadTests`), tests/pipeline/support/item_unit_worker_runs.py
  </read_first>
  <behavior>
    In-process tests in the new `tests/pipeline/test_item_unit_workers.py`, on `ItemBatchFixture` with `weapon_rows = WEAPON_ROWS` and `SyntheticItemRun` (four units, all pass). The fixture replaces `item_unit_workers.ProcessPoolExecutor` by `DeferredExecutor` and restores `item_unit_workers.item_unit_worker` after each test. The worker run factory of these tests is a closure that returns a second `SyntheticItemRun` on the same project root (nothing is pickled in process).
    - test (e) `test_units_sealed_at_process_start_are_not_submitted_and_their_receipt_is_read_once`: an earlier run seals units 1 and 2; a pooled slice with limit 1 submits `[unit 3 key]` only; with `UnitLedger.sealed_receipt` recorded as in `ItemBatchReceiptReadTests` the reads are `[True]`, `[True]`, `[False, False, True]`, `[False]`; outcomes have `cacheHit` `[True, True, False]`; the executor got `max_workers` 4, `initializer` `initialize_item_unit_worker` and `initargs` `(factory, factory arguments, preflight)`; `shutdown` was called once with `wait=True, cancel_futures=True`.
    - `test_sealed_and_converted_units_come_back_in_unit_order`: units 1 and 3 sealed at start, limit 2: submitted keys are units 2 and 4, outcome keys are units 1 to 4 in order, `cacheHit` `[True, False, True, False]`, the catalog holds the four records.
    - `test_a_slice_whose_units_are_all_sealed_runs_no_worker_run_factory`: all four sealed; no submission, the factory is never called, outcomes are the four map entries.
    - `test_a_worker_never_builds_the_sealed_outcome_map`: after a pooled slice the run the factory returned has `sealed_outcomes` None and holds the converted unit keys; the coordinator run converted none.
    - test (c) `test_a_preflight_refusal_for_the_third_unit_stops_the_slice_and_cancels_the_rest`: limit 4, a preflight that raises `BatchPreflightRefusedError` on its third call; `run_pooled_item_batch` raises that same exception; `shutdown` got `cancel_futures=True`; units 1 and 2 have `complete.json`, units 3 and 4 have no unit folder; the worker run converted units 1 and 2 only; `write_store` was not called and `catalog.json` does not exist.
    - `test_a_transient_failure_in_a_worker_comes_back_as_a_failed_outcome_in_place`: the worker run raises `OSError` for unit 2; statuses `['pass', 'failed', 'pass']` with limit 3; the map of the coordinator holds units 1 and 3; the coordinator made no receipt read for unit 2 after the walk; the catalog holds the records of units 1 and 3.
    - `test_a_worker_seal_under_another_fingerprint_is_refused_by_the_coordinator` (fails first): the factory builds its run while `implementation_hash` returns `CHANGED_CONVERTER_SHA256`; `run_pooled_item_batch` raises `ItemConversionError` naming the unit key; no catalog is written.
    - `test_a_converted_outcome_without_a_seal_is_refused` (fails first): `add_sealed_outcome_of_converted_unit` with a pass outcome for a unit that has no seal raises `ItemConversionError`.
    - `test_a_worker_refuses_a_unit_key_its_run_does_not_hold` (fails first): after `initialize_item_unit_worker`, `converted_unit_outcome` with a well-formed unknown key raises `ItemUnitWorkerError` naming the key, after the preflight was called once.
    Child-interpreter test in `tests/pipeline/test_item_unit_worker_processes.py`, class `PooledItemBatchRefusalTests`:
    - test (c) `test_a_preflight_refusal_in_a_worker_for_the_third_unit_stops_the_slice_and_keeps_two_sealed_units`: scenario `refused-third-unit` with 2 workers and limit 3; the child reports `refusalType` `native_store.unit_ledger.BatchPreflightRefusedError`, the synthetic refusal message, `poolWorkerCounts == [2]`, `storeWriteCallCount == 0`; on disk units 1 and 2 have `complete.json`, unit 3 has no unit folder, and the store root, the items gap-row file and the item census do not exist.
  </behavior>
  <action>
A. Tests first. In `tests/pipeline/test_item_unit_workers.py` write `DeferredExecutor`: constructor `(max_workers, initializer, initargs)` records its arguments; `submit(function, unit_key)` records the key and returns an object whose `result()` runs the initializer once before the first task and then the function, in the calling process; `shutdown(wait, cancel_futures)` records its keywords. Tasks therefore run in the order the coordinator consumes them, and a task after a raised one never runs, which is what `cancel_futures=True` gives a real pool. Write the nine in-process tests of the behavior block.
Extend `tests/pipeline/support/item_unit_worker_runs.py` for the second scenario:
- `FirstTwoUnitsBeginTogetherItemRun(BookkeepingItemRun)`: `converted_model_reason(unit)` first waits, for each of the first two units, until the unit folder of the other one exists (`ledger.unit_step_directory`), then returns the result of the parent method.
- Factory `first_two_units_begin_together_worker_run(project_root, client_root)`: as the first factory, with this run class.
- `preflight_refused_once_the_first_two_units_have_begun()`: raises `BatchPreflightRefusedError(SYNTHETIC_PREFLIGHT_REFUSAL_MESSAGE)` when the unit folders of the first two units of `synthetic_worker_run` both exist.
- `pooled_batch_report` selects factory, factory arguments and preflight by scenario name.
Why this is deterministic with exactly 2 workers and limit 3: the pool hands out tasks first in, first out; a preflight for unit 1 or 2 runs before the folder of its own unit exists, so it passes; neither of the two can finish before both have begun; unit 3 starts only when one of them finished, so its preflight sees both folders and refuses, before `begin`. The coordinator takes the outcomes of units 1 and 2 first, so both are sealed when it raises. Do not run this scenario with another worker count.
Add `PooledItemBatchRefusalTests` to `tests/pipeline/test_item_unit_worker_processes.py`. Run both test files: the three tests marked "fails first" must fail; the other new tests pin behavior Task 1 built and are expected to pass at once. If one of those fails, fix the cause in the Task 1 code, not the test.

B. `scripts/actors/item_conversion.py`: in `add_sealed_outcome_of_converted_unit`, after the one `sealed_receipt` read, raise `ItemConversionError` naming the unit key when the receipt is None or its `fingerprint` differs from `self.unit_work(unit)[2]`. This keeps the hard constraint of the context file for a unit another process sealed: fingerprint, receipt hash, output presence and size are checked once in the coordinator. On the one-process path the condition never holds.

C. `scripts/actors/item_unit_workers.py`: add `class ItemUnitWorkerError(ValueError)`; `converted_unit_outcome` calls the preflight, then raises `ItemUnitWorkerError` naming the key when `units_by_key` of the worker run does not hold it (the run of the worker differs from the run of the coordinator), then converts.

D. Run the verify command; all tests pass. Commit.

Behavior to record in the SUMMARY, not to change: after a worker raised, `shutdown(wait=True, cancel_futures=True)` lets units already in flight finish and seal, so units behind the refused one can be sealed too; the next run re-adds their records, as it does for the one-process path after a preflight refusal. A worker whose run factory raises, or a worker process that dies, makes `future.result()` raise `concurrent.futures.process.BrokenProcessPool` at the position of the first unit without an outcome; this plan adds no translation and no retry, and `main` does not catch it, like any other unexpected error today. A refusal the run factory raises in a worker (`require_reference_client`, `Converter`, `read_item_sources`) therefore does not keep its type or message; the coordinator makes the same three calls before the pool starts, so this takes a client or a lock that changes during the run.
  </action>
  <verify>
    <automated>python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py python -B -m unittest tests/pipeline/test_item_unit_workers.py tests/pipeline/test_item_unit_worker_processes.py tests/pipeline/test_item_batch_bookkeeping.py tests/pipeline/test_item_conversion_run.py</automated>
  </verify>
  <done>The three guard tests failed before B and C and pass after. Tests (c) pass in process with the deferred executor and in a child interpreter with a real pool of 2 workers; test (e) passes with the receipt read counts written in the test. The unittest process never constructs a real `ProcessPoolExecutor` for items. The change is committed on `lane/speed`.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: --workers on the command line, the real worker run factory, whole pipeline suite</name>
  <files>scripts/actors/item_unit_workers.py, scripts/actors/item_census.py, scripts/actors/convert_actors.py, tests/pipeline/test_item_worker_command_line.py</files>
  <read_first>
    scripts/actors/convert_actors.py (lines 1 to 46 and 345 to 397), scripts/actors/actor_arguments.py (the style of an argparse type), scripts/actors/item_census.py, scripts/native_assets.py (lines 165 to 181, read only), tests/pipeline/test_npc_batch.py (the test that expects `SystemExit` code 2 from `convert_actors.main`)
  </read_first>
  <behavior>
    Three classes in the new `tests/pipeline/test_item_worker_command_line.py`. They get a file of their own so that `tests/pipeline/test_item_unit_workers.py` stays under about 400 lines; the file imports `ItemBatchFixture` and the synthetic runs from the two existing item test files and nothing from `test_item_unit_workers.py`:
    - `ItemConversionWorkerWiringTests`, with `item_census.read_item_sources` and `item_census.ItemConversionRun` patched to give a synthetic run and `arguments` a `SimpleNamespace(batch='items', item=None, limit=3, workers=...)`:
      - `test_without_workers_and_with_one_worker_the_units_convert_in_the_calling_process`: for `workers` None and 1, with `item_unit_workers.ProcessPoolExecutor` replaced by a mock whose side effect is `AssertionError`, `run_item_conversion` returns three fresh outcomes, the coordinator run converted them and the census file exists.
      - `test_several_workers_hand_the_pool_the_real_factory_and_the_six_paths`: for `workers` 4, with `item_census.run_pooled_item_batch` replaced by a mock, its one call is `(run, 3, preflight, 4, item_unit_workers.item_worker_run, (project_root, client_access.root, converter.output, converter.umodel, lane_work_root(project_root, 'actors'), output_root))`.
    - `ItemWorkerRunFactoryTests`:
      - `test_the_worker_run_is_built_from_the_six_paths_like_the_run_of_the_coordinator`: with `require_reference_client`, `Converter`, `read_item_sources` and `ItemConversionRun` of `item_unit_workers` replaced by mocks, `item_worker_run(*six paths)` calls `require_reference_client(client_root)`, `Converter(client_access.root, converter_output_root, umodel_path)`, `read_item_sources(project_root, client_access.root, decode_table)` and `ItemConversionRun(project_root, client_access, converter, ledger_root, store_root, sources)` and returns that run.
      - `test_the_worker_task_the_initializer_the_real_factory_and_the_lane_preflight_pickle_by_reference`: `pickle.loads(pickle.dumps(f)) is f` for `converted_unit_outcome`, `initialize_item_unit_worker`, `item_worker_run` and `convert_actors.lane_batch_preflight`.
    - test (f) `WorkersArgumentTests`, each case `convert_actors.main([...])` with `sys.stderr` patched:
      - `test_workers_with_any_mode_other_than_the_items_batch_is_an_argument_error`: `SystemExit` code 2 for `--batch` npcs, skills, actor-sounds and characters with `--limit 1 --workers 2`, for `--batch npcs --limit 1 --workers 1`, for `--item 1 --workers 2`, `--npc 1 --workers 2` and `--print-batch-plan --workers 2`.
      - `test_a_worker_count_outside_one_to_sixty_one_is_an_argument_error`: code 2 for `--batch items --limit 1 --workers` with `0`, `62`, `04`, `-1` and `x`.
      - `test_the_items_batch_accepts_workers_and_hands_the_count_to_the_item_conversion`: with `require_actors_lane_store_output`, `require_reference_client`, `require_batch_preflight`, `run_at_below_normal_priority`, `Converter` and `lane_coverage_refreshed_at_exit` (returning `contextlib.nullcontext()`) of `convert_actors` replaced by mocks and `run_item_conversion` by a mock that returns two pass outcomes (dicts with the five keys `key`, `step`, `status`, `reason` and `cacheHit` that `printed_outcome` reads), `main` with `--batch items --limit 1 --workers 2` returns 0, the mock got `arguments.workers == 2` and `convert_actors.lane_batch_preflight` as preflight, and the captured `sys.stdout` holds exactly the two lines `json.dumps(convert_actors.printed_outcome(outcome), sort_keys=True)` in the order of the returned list; without `--workers` it got `arguments.workers is None`.
  </behavior>
  <action>
A. Tests first: create `tests/pipeline/test_item_worker_command_line.py` with the three classes; run the file; they fail (no `worker_count_argument`, no `item_worker_run`, no `--workers`).

B. `scripts/actors/item_unit_workers.py` (D-15, D-16):
- `worker_count_argument(text)`: an argparse type in the style of `slice_limit_argument`. It accepts an unpadded integer from 1 to `MAXIMUM_WORKER_COUNT` (61, the limit `ProcessPoolExecutor` has on Windows) and raises `argparse.ArgumentTypeError('--workers must be an integer from 1 to 61: ...')` for anything else. It lives here because `scripts/actors/actor_arguments.py` is outside the files of this plan.
- `item_worker_run(project_root, client_root, converter_output_root, umodel_path, ledger_root, store_root)`: the production run factory. `require_reference_client(client_root)`, `Converter(client_access.root, converter_output_root, umodel_path)`, `read_item_sources(project_root, client_access.root, decode_table)` with `decode_table` imported from `native_catalog.tables`, then `ItemConversionRun(project_root, client_access, converter, ledger_root, store_root, sources)`. All six arguments are paths and pickle.

C. `scripts/actors/item_census.py` (D-16): in `run_item_conversion` keep the ledger root in a local name and branch three ways: the single-item path as today; the items batch with `arguments.workers` None or 1 through `run_item_batch(run, arguments.limit, preflight)`, no pool; the items batch with more workers through `run_pooled_item_batch(run, arguments.limit, preflight, arguments.workers, item_worker_run, (project_root, client_access.root, converter.output, converter.umodel, ledger_root, output_root))`. `write_item_census_and_gap_rows` and the return stay.

D. `scripts/actors/convert_actors.py` (D-16, D-17), exactly four added lines and no other change, so the file ends at 401 lines:
- one import line: `worker_count_argument` from `actors.item_unit_workers`;
- one line `parser.add_argument('--workers', type=worker_count_argument, help=...)` with no default; the help text says in one plain sentence that it sets the worker processes of the items batch and that two slices of one batch must never run side by side (the rule of D-16);
- two lines after the `--level` check: when `arguments.workers` is not None and `arguments.batch` is not `ITEM_BATCH_NAME`, `parser.error('--workers is only valid with --batch items')`.
`arguments` already reaches `run_item_conversion`, `run_at_below_normal_priority()` already runs before any pool starts, and the `if __name__ == '__main__':` guard stays. Skill roots, world tiles and every other batch get no worker path (D-17).

E. Run the first verify command; all pass. Commit.

F. Whole suite, once, with no other `scripts/test_pipeline.py` process on the machine (check by command line first). Run the second verify command as written: it sends standard output and standard error to `C:/laragon/l2b-orchestration/autonomous-roadmap/pipeline-261112-kzq.log`. `scripts/test_pipeline.py` prints one line per test (verbosity 2, more than 2200 lines), so the output never goes into the conversation and the log is never read whole. Read from it only the lines that start with `FAIL:` or `ERROR:`, the `Ran ` line and the result line (Grep on the log with the pattern `^(FAIL|ERROR): |^Ran |^(OK|FAILED)`), and for a new failing id its traceback by line range. Pass rule: no `FAIL:` line, and no `ERROR:` line other than `test_world_audio_step.RealClientAudioTests.test_the_20_20_ambient_counts_equal_the_staged_ambience` and `test_world_bsp_step.OracleBrushSubsetTests.test_the_generic_20_20_step_holds_the_brush397_and_brush610_nodes_at_their_native_positions`. The exit status does not decide, because those two ids already end the run non-zero. The test count is 2242 plus the new tests of this plan, plus the tests of any other quick task committed or present in the checkout by then. A new failing id in a file of this plan, or caused by a change of this plan, is fixed at its cause and the suite is run again; a fix is a new commit. A failing id that comes from a file of another quick task and from no change of this plan is not touched and is reported in the SUMMARY with its id. Such a run does not meet the pass rule: the suite claim of this plan then stays open, and neither the done claim of this task nor the SUMMARY says that the suite passes.

G. Cleanup check before the done claim: no python process this plan started still runs. Pool workers do not carry the worktree path in their command line; look for python processes whose command line holds `multiprocessing-fork` and whose parent process is gone or was started by this plan, and stop only those, by PID.
  </action>
  <verify>
    <automated>python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py python -B -m unittest tests/pipeline/test_item_worker_command_line.py tests/pipeline/test_item_unit_workers.py tests/pipeline/test_item_unit_worker_processes.py tests/pipeline/test_item_batch_bookkeeping.py tests/pipeline/test_item_conversion_run.py tests/pipeline/test_npc_batch.py tests/pipeline/test_converter_independence.py</automated>
    <automated>python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py python -B scripts/test_pipeline.py > C:/laragon/l2b-orchestration/autonomous-roadmap/pipeline-261112-kzq.log 2>&1</automated>
  </verify>
  <done>The three new classes failed before B to D and pass after. `git diff --numstat` of `scripts/actors/convert_actors.py` against the commit before Task 1 shows 4 added and 0 removed lines. The whole suite passes by the rule of step F and its log is kept; when a failing id of another quick task leaves that rule unmet, the done claim names the id and says that the suite claim is open. The three commits of this plan change no file outside `files_modified` (`git diff --stat` from the commit before Task 1 to `HEAD`, limited to the commits of this plan). Nothing this plan started still runs. The change is committed on `lane/speed`.</done>
</task>

</tasks>

<threat_model>
## Trust boundaries

| Boundary | Description |
|----------|-------------|
| command line to pool | `--workers` sets how many processes start |
| coordinator to worker | unit keys, the run factory, its arguments and the preflight cross by pickle; outcomes and exceptions come back by pickle |
| worker to lane work folder | several processes write unit folders under one work root |
| coordinator to shared lane files | catalog, store files, gap rows, census, coverage |

## STRIDE threat register

| Threat ID | Category | Component | Severity | Disposition | Mitigation plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-261112-kzq-01 | Tampering | shared lane files written by more than one process | high | mitigate | The worker task calls the preflight and `convert_unsealed_unit` only; `write_item_records`, the gap rows, the census and the coverage refresh run in the coordinator after the pool is shut down. Task 1 test (d) runs every worker with those writers replaced by a function that raises and checks that no shared file exists before the first store write of the coordinator |
| T-261112-kzq-02 | Tampering | a unit sealed by a worker enters the map of the coordinator unchecked | medium | mitigate | `add_sealed_outcome_of_converted_unit` makes one `sealed_receipt` read (seal, receipt hash, output presence and size) and compares the fingerprint with the one the coordinator computes; a missing seal or another fingerprint is refused with `ItemConversionError` (Task 2 tests) |
| T-261112-kzq-03 | Tampering | two processes on one unit folder, where `UnitLedger.begin` removes the folder of the other | high | mitigate | The coordinator submits each unsealed unit key once; a worker never walks the ledger, because `convert_unsealed_unit` builds no sealed-outcome map (Task 2 test); the `--workers` help text carries the D-16 rule against two slices side by side |
| T-261112-kzq-04 | Denial of service | worker count taken from the command line | medium | mitigate | `worker_count_argument` accepts 1 to 61 only; no count is derived from the machine; workers inherit BelowNormal from `main` (Task 1 priority test) |
| T-261112-kzq-05 | Denial of service | a batch that runs inside the machine window or under the disk floor because the preflight moved | high | mitigate | Every worker task calls the same preflight before `begin`; a refusal crosses the process boundary with its type and message and is raised in unit order (Task 2 tests (c), in process and with a real pool) |
| T-261112-kzq-06 | Denial of service | a worker process that dies or a run factory that raises in a worker | low | accept | The standard library raises `BrokenProcessPool` at the position of the first unit without an outcome; sealed units stay sealed and the next run re-adds their records; nothing hangs. Recorded in the SUMMARY |
| T-261112-kzq-07 | Elevation of privilege | pickled callables executed in workers | low | accept | Workers are child processes of the coordinator on the same account and receive module-level functions of this checkout by reference only |
| T-261112-kzq-SC | Tampering | npm/pip/cargo installs | high | accept | This plan installs no package |
</threat_model>

<verification>
- The task verify commands above, each through `run_below_normal.py`, from the checkout root.
- Whole suite once at the end of Task 3 by the rule of its step F: no `FAIL:` line and no `ERROR:` line other than the two baseline ids. One suite run at a time on this machine. Its output goes to the log file of step F and is read by pattern, never whole.
- Required tests and where they are: (a) and (b) and (d) Task 1 `PooledItemBatchByteIdentityTests`; (c) Task 2, in process and in a child interpreter; (e) Task 2; (f) Task 3 `WorkersArgumentTests`.
- The commits of this plan change only the eight files of `files_modified`; no frozen or pinned file of the context file is among them. Another quick task (261112-l5d) works in this checkout at the same time: stage files by name, never with `git add -A`, and leave its files and its untracked folders alone.
- Nothing this plan started still runs when the done claim is made.
</verification>

<success_criteria>
- D-15: one coordinator walks `run.units` in order through `selected_slice_units`, submits the unsealed unit keys to a `ProcessPoolExecutor`, each worker builds its own run in `initialize_item_unit_worker` and does preflight, begin, convert, seal per task; outcomes are assembled in unit order before `write_item_records`; only the coordinator writes shared files; the pooled tree is byte-identical to the one-process tree in catalog, gap rows and census and equal in store files, ledger outputs and receipts apart from clock, pid, free-byte and receipt-hash fields.
- D-16: `convert_actors.py` takes `--workers`; absent or 1 converts in the calling process with no pool; the help text warns against two slices of one batch side by side.
- D-17: `--workers` is refused for every mode other than `--batch items`; no skill or world tile file is changed.
- A refusal a worker task raises (preflight or conversion) is raised by the coordinator at the position of its unit with its type and message; the pool is shut down with `cancel_futures=True`; sealed units stay sealed; no catalog is written. A failure of the pool initializer surfaces as `BrokenProcessPool` instead (accepted, T-261112-kzq-06).
- `convert_actors.py` gains four lines; every other new line is in `item_unit_workers.py`, `item_census.py`, `item_conversion.py` or the tests; no file of the plan passes about 400 lines.
- The whole pipeline suite passes by the baseline rule.
</success_criteria>

<output>
Create `.planning/quick/261112-kzq-item-units-convert-in-worker-processes-u/261112-kzq-SUMMARY.md` when done. Record in it: the suite test count and the `ERROR:` ids against the two baseline ids; the test that pins each of (a) to (f); the accepted consequences, each with its test where one exists: units in flight finish and seal after a worker refusal, so units behind the refused one can be sealed; a broken pool surfaces as `BrokenProcessPool` and is not caught by `main`; the new `ItemConversionError` refusal for a worker result without a seal under the fingerprint of the coordinator; each worker builds its own run and calls the preflight once per unit; the real worker run factory `item_worker_run` and the spawn of `convert_actors.py` as the main module were not run against the reference client in this task and are first run by the measurement task (D-18), where a spawn or pickling failure counts as a defect of this task. Record also: `--workers` has no argparse default, and the absent value stands for 1 (no pool), which is what lets `--workers 1` be refused outside the items batch (test (f)); the synthetic worker runs of the child-interpreter tests all write the same constant file `converted.l2asset` beside the client root at the same time, no run reads it, and it lies outside the store and work roots the tests compare; when the suite run does not meet the pass rule because of a failing id of another quick task, the suite claim is recorded as open with that id.
</output>
