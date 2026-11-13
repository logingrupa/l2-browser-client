---
phase: 261112-vj5-world-tile-batch-in-worker-processes-wit
verified: 2026-11-13T00:40:00Z
status: passed
score: 20/20 must-haves verified
covered_files:
  - .planning/quick/261112-vj5-world-tile-batch-in-worker-processes-wit/261112-vj5-PLAN.md
  - .planning/quick/261112-vj5-world-tile-batch-in-worker-processes-wit/261112-vj5-SUMMARY.md
  - scripts/actors/convert_actors.py
  - scripts/actors/item_census.py
  - scripts/actors/item_unit_workers.py
  - scripts/native_store/catalog_writer.py
  - scripts/native_store/interprocess_lock.py
  - scripts/native_store/lane_roots.py
  - scripts/native_store/store_file_publish.py
  - scripts/native_store/worker_count_argument.py
  - scripts/world/bsp_step.py
  - scripts/world/bsp_surface_materials.py
  - scripts/world/class_default_reads.py
  - scripts/world/convert_tile_batch.py
  - scripts/world/exact_sound_sources.py
  - scripts/world/light_actors.py
  - scripts/world/material_texture_images.py
  - scripts/world/minimap_step.py
  - scripts/world/mover_step.py
  - scripts/world/sky_materials.py
  - scripts/world/sky_step.py
  - scripts/world/static_mesh_step.py
  - scripts/world/static_placement.py
  - scripts/world/tile_chunk_plan.py
  - scripts/world/tile_json_resource.py
  - scripts/world/tile_step_workers.py
  - tests/pipeline/support/interprocess_lock_programs.py
  - tests/pipeline/support/store_file_publish_programs.py
  - tests/pipeline/support/tile_step_worker_runs.py
  - tests/pipeline/test_convert_tile_batch.py
  - tests/pipeline/test_immutable_write_publish.py
  - tests/pipeline/test_interprocess_lock.py
  - tests/pipeline/test_item_unit_worker_processes.py
  - tests/pipeline/test_item_unit_workers.py
  - tests/pipeline/test_item_worker_command_line.py
  - tests/pipeline/test_lane_catalog_writer.py
  - tests/pipeline/test_minimap_step.py
  - tests/pipeline/test_store_file_publish.py
  - tests/pipeline/test_world_audio_step.py
  - tests/pipeline/test_world_bsp_step.py
  - tests/pipeline/test_world_class_default_lookups.py
  - tests/pipeline/test_world_class_default_reads.py
  - tests/pipeline/test_world_converter_request_locks.py
  - tests/pipeline/test_world_sky_materials.py
  - tests/pipeline/test_world_store_path_refusals.py
  - tests/pipeline/test_world_tile_batch_phases.py
  - tests/pipeline/test_world_tile_batch_worker_processes.py
covered_digest: "v4:sha256:1fc9f2200f9ad4db50298ed896c2e6a102a2e36561756cafd3a994874c279cf6"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 15/16
  previous_verified: 2026-11-12T23:10:00Z
  gaps_closed:
    - "With more than one worker the store publish path of the world steps is safe between processes, so the lane outputs equal those of --workers 1 (gap 1 of the initial verification, closed by decisions G1 to G4)"
  gaps_remaining: []
  regressions: []
advisory:
  - finding: "The store lock is taken for lane stores only (<project>/artifacts/lane-store/<lane>/l2). G1 says one lock per store root. Every store the world batch and the pooled item batch write is a lane store, so the goal is not affected"
    category: architectural
    reason: "The executor reads G1 through decision 3 (lock files live under the lane work root; the served store has none). The orchestrator confirms or widens it"
    evidence_status: "none provided"
  - finding: "typed_payload.py (collision, lighting, BSP visibility) and the frozen material_resources.py write store files without the store lock"
    category: architectural
    reason: "Safe by path layout: the guard keeps its prefix only when another process creates the whole missing parent chain of the resolved path, and maps/<asset sha> is created by the worker of one tile only (the asset holds the map hash). Measured, see the re-verification section. No test with processes holds this rule; a new shared folder directly above such a path would need the owner"
    evidence_status: "none provided"
  - finding: "A present, differing texture image under native-materials/textures is now refused with 'Existing immutable store file differs; preserved' before any file is written, where it was refused with 'Existing immutable runtime asset is corrupt; preserved' at that file"
    category: other
    reason: "Follows from G1 (verify_store_destinations runs first for every routed write). It needs a corrupt file in the store. The gap reason text of the sealed BSP or sky unit differs in that case only"
    evidence_status: "none provided"
  - finding: "tests/pipeline/support/item_unit_worker_runs.py: LaterUnitsSealFirstItemRun resolves the unit folder of another unit in every worker initializer while another worker may begin that unit"
    category: other
    reason: "Test support only, older than this task. It can make PooledItemBatchByteIdentityTests fail on a loaded machine. The production item pool resolves only the folder of its own unit"
    evidence_status: "none provided"
  - finding: "Publishing is one process at a time per lane store, and verify_store_destinations hashes every file that is already present while the lock is held"
    category: other
    reason: "Not a correctness matter. With several workers the publish of shared static meshes is serial; the wall time of the --workers 6 proof shows whether it matters"
    evidence_status: "none provided"
  - finding: "publish_store_files and write_store resolve the store root before they take the lock"
    category: architectural
    reason: "Safe because G2 creates the root before a pool exists. An entry that starts several processes on a lane whose store root is missing would have to create the root first as well"
    evidence_status: "none provided"
---

# Quick task 261112-vj5: world tile batch in worker processes - verification report

> Current status: passed. See "Re-verification after gap closure - 2026-11-13 02:40 Riga" at the end. The report below is the initial verification of 2026-11-12, kept as written; its gap 1 is closed.

**Task goal:** `scripts/world/convert_tile_batch.py --eligible --limit N --workers W` converts tiles in W worker processes and gives the same lane outputs as `--workers 1`; the raw step of every selected tile and of every eligible seam neighbour is sealed before any terrain step runs.
**Verified:** 2026-11-12T23:10:00Z (2026-11-13 01:10 Riga)
**Status:** gaps_found
**Re-verification:** No - initial verification
**Code under test:** `lane/speed` at `d8cca49`, tracked tree clean.

## Verdict in short

- The 15 must-have truths of the plan hold. I read the code and ran the five targeted gates myself; all exit 0.
- The seam half of the goal holds: the raw step runs in phase A only, for every selected tile and every eligible seam neighbour, before any other step.
- The "same lane outputs as `--workers 1`" half is not safe yet with more than one worker. The path guard in front of every store write fails when two processes publish the same new store file at the same moment. A probe reproduces it in every run. This is the mechanism the SUMMARY lists as "not verified".
- Nothing else blocks. Seven smaller observations are listed as warnings.

## Goal achievement

### Observable truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | 2 workers give the gap-row bytes, attempted tiles and summary of 1 worker on a synthetic step runner (plain, failed step, refusal on the second tile, neighbours not selected, raw fails once) | VERIFIED | `tests/pipeline/test_world_tile_batch_worker_processes.py`: five comparison tests with real child interpreters (`filecmp` of the gap-row files, `attemptedTiles`, summary without `rigaTime` and `freeBytes`). Third gate of task 3 run by me: 92 tests, exit 0 |
| 2 | Phase A runs raw once per selected tile and per eligible seam neighbour with work, before any other step; a neighbour that is not selected is not attempted and its returned row is not recorded | VERIFIED | `seam_input_tile_ids` and `seam_input_raw_results` in `scripts/world/convert_tile_batch.py` lines 89-145 (results kept only `if task.tile_id in selected`); `SeamInputPhaseTests` (9 tests) pass |
| 3 | Raw runs in phase A only; a selected tile whose raw failed is not run again and gets upstream-failed rows | VERIFIED | `worker_step_names` drops `RAW_STEP_NAME` and the manifest (line 154); `failed_raw_step` feeds `failed_earlier_step`; `test_no_raw_step_runs_after_phase_a`, `test_a_selected_tile_whose_raw_failed_in_phase_a_...` and the raw-fails-once comparison pass |
| 4 | Other steps of a tile run in registered order in one process; manifests run in the coordinator in tile order; no worker step module names `read_store_catalog` or `write_store` | VERIFIED | `selected_tile_step_results` consumes outcomes in task order and calls `workers.coordinator_outcome` for the manifest; `test_the_other_steps_run_in_worker_processes_and_every_manifest_in_the_coordinator_in_tile_order` checks process ids; grep over `scripts/world`: only `tile_manifest_step.py` holds the two names. The ast test covers `world.*` modules only; the one non-world function a worker calls from a module that holds them (`converted_model_store_files_and_record` in `scripts/actors/npc_store_records.py`) does not open the catalog (read) |
| 5 | With `--workers 1` and without `--workers` no `ProcessPoolExecutor` is built; phases A and B run through the functions the workers call | VERIFIED | `TileStepWorkers.__init__` line 134 (`None if worker_count == 1`); both sides end in `ordered_tile_steps_outcome`; `run_main` of the phase tests patches `ProcessPoolExecutor` with an `AssertionError` |
| 6 | Second process enters the same key only after the first leaves; a dead holder frees the lock; different keys do not wait; a second lock in one process is refused | VERIFIED | `scripts/native_store/interprocess_lock.py` lines 44-63; `tests/pipeline/test_interprocess_lock.py` (6 tests, child interpreters) pass in the task 1 gate |
| 7 | The three `Converter.convert` calls of the world steps run under the request lock | VERIFIED | `static_mesh_step.py:140`, `exact_sound_sources.py:98`, `minimap_step.py:181`; grep finds no other `convert(` of a `Converter` in `scripts/world`. `bsp_surface_materials.py` calls `converter.texture` and `converter.material_texture` in a private `TemporaryDirectory`, which publishes nothing shared |
| 8 | Every read of the `class:Engine.Mover` unit folder and its begin and seal run under the unit lock | VERIFIED | `mover_step.py` lines 107-108 and 229-230, the lock is left before `sealed_chunk_plan` and before `mover_unit`; grep: `mover_class_evidence(` and `sealed_mover_class_receipt_sha256(` are called nowhere else in `scripts`; `MoverClassUnitLockTests` and the ast test pass |
| 9 | One frozen class-default read per cache folder, client, class and field list per process; refusal kept; callers isolated; a read that is not kept takes the cache-folder lock | VERIFIED | `scripts/world/class_default_reads.py` lines 17-29; grep over `scripts`: the three frozen readers are called only there (and in the actors lane with its own work root); 10 + 7 tests pass in the task 2 gate |
| 10 | `immutable_write` accepts the same bytes, refuses different bytes and keeps the file, never shows the final name half-written, leaves no temporary file in those cases | VERIFIED | `catalog_writer.py` lines 96-112 (`os.link`, `FileExistsError` then SHA-256 check, `finally` unlink); 7 tests pass. See warning 2 for a case outside the listed ones |
| 11 | Floor is `BATCH_MINIMUM_FREE_BYTES` with one worker and one GiB more with two; `--workers 0` and `--workers x` are usage errors with the exit code of a bad `--limit` | VERIFIED | `batch_free_disk_floor` line 201; `TileBatchWorkerCountTests` pass |
| 12 | After a refusal no later tile starts, a running later tile ends before its next preflight, the first stopped tile in tile order is reported; the 3-tile scenario with 2 workers | VERIFIED | `ordered_tile_steps_outcome` and `run_tile` (`earlier_tile_stopped` asked before each preflight); `test_a_running_tile_ends_before_its_next_preflight_...`, `test_no_tile_after_the_first_stopped_tile_starts` and `TwoWorkerStopTests` pass |
| 13 | A dead worker ends the batch with exit code 1 after the rows of the finished tiles are written, at submit or at result; the message names converter folders and UModel children; workers print nothing | VERIFIED | `future_outcome`, `futures_submitted_until_the_pool_breaks`, `WORKER_DIED_MESSAGE`; the dying-worker test, the broken-submit test and the stdout test pass |
| 14 | No frozen or pinned file changed, no private converter root, no seal check, fingerprint, config or algorithm version changed | VERIFIED | `git diff --name-only` against `b17eed7` and `277129e` over the frozen and pinned list and `docs/BATCH_PIPELINE_SPEED.md` prints nothing; no changed file is in `implementation_source_paths()`; `tile_step_current_seals.py` is untouched; the step diffs only swap the call |
| 15 | Whole suite: no FAIL line and no ERROR line other than the two of the baseline | VERIFIED | `pipeline-261112-vj5.log`: 2394 tests, `FAILED (errors=2, skipped=66)`, the two ERROR lines are the two of the baseline (2334 tests, same skip count). Per test: the only test that was ok on the baseline and is not ok now is `test_two_class_default_readers_do_not_share_answers`, replaced by the context amendment; 61 new test names, all ok. See warning 1 for the file time |
| 16 | With more than one worker the store publish path is safe between processes, so lane outputs equal those of one worker (task goal, plan success criterion) | FAILED | See "Gap 1" |

**Score:** 15/16 truths verified (0 present but behavior-unverified)

### Gap 1 (blocker): the path guard in front of every store write fails under two publishing processes

- Mechanism: `refuse_reparse_points` in the frozen `scripts/native_store/store_paths.py` (lines 45-50) returns `path.resolve()`. For a path whose parent folder is missing, `ntpath.realpath` (Python 3.12.6) keeps the `\\?\` prefix when the Windows error of its second look differs from the first: path not found, then file not found, which is what happens when another process creates the parent folder in between. `confined_child_path` then raises `StorePathError('Path escapes its root: ...')`. The executor met this mechanism twice for the lane work roots and fixed the world work root only.
- It reaches store files. Probe (throwaway folder under the system temp folder, removed afterwards, BelowNormal): two `python -B -c` processes, each running `immutable_write(confined_child_path(root, f'models/{i:05d}/asset.bin'), payload)` over the same 1500 new paths under one fresh root.

| Run | Refusals process 1 | Refusals process 2 | Files published | Temporary files left |
|-----|--------------------|--------------------|-----------------|----------------------|
| 1 | 116 | 106 | 1500 | 0 |
| 2 | 85 | 153 | 1500 | 0 |
| 3 | 114 | 112 | 1500 | 0 |

- With the step's own pattern (`verify_store_destinations` over all files, then the write loop) and the second process started later, the second process catches up, because checking a present file is faster than writing a new one:

| Late start | Refusals leader | Refusals follower | First refused index (leader, follower) |
|------------|-----------------|-------------------|----------------------------------------|
| 0.1 s | 45 of 1000 | 106 of 1000 | 12, 14 |
| 0.3 s | 63 of 1000 | 74 of 1000 | 63, 44 |

- What it does to a batch with W > 1:
  - Meshes and movers (`write_static_mesh_store_files`): the step ends with the exception, the row is `failed` with `decode-failed:StorePathError:Path escapes its root`, the later steps of the tile are upstream-failed, and the next run converts the tile again. That is the second pass this task removes.
  - BSP surface materials (`write_material_texture_images` inside the `try` of `convert_surface_material`): the refusal is caught as a material conversion error and the BSP unit **seals** with an unbound material and a gap row. The seal is current, so the wrong result stays.
- Not measured: how often a real batch hits it. It needs two tiles that publish the same new store file within about 0.1 ms of each other; adjacent tiles share meshes and iterate them in the same sorted order, and the catch-up effect above brings two overlapping write phases level. The orchestrator's proof (30 tiles, `--workers 6`, fresh store) is the setting where it is most likely.
- A fix does not need a frozen file: the guard can be made safe from the calling side (see `missing` in the frontmatter).

### Required artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/native_store/interprocess_lock.py` | Blocking lock, lane lock folder, conversion under request lock | VERIFIED | 70 lines, `def interprocess_lock`; imported by `mover_step.py`, `class_default_reads.py`, three step modules |
| `scripts/native_store/catalog_writer.py` | `immutable_write` through `os.link` | VERIFIED | lines 96-112; `replace_file` unchanged |
| `scripts/world/class_default_reads.py` | One owner of class-default reads | VERIFIED | 44 lines; used by five world modules |
| `scripts/world/tile_step_workers.py` | `TileStepRun`, stop rule, pool | VERIFIED | 157 lines, `class TileStepWorkers`; built in `run_tile_batch` |
| `scripts/world/convert_tile_batch.py` | Coordinator, `--workers`, floor | VERIFIED | 268 lines, `def seam_input_tile_ids` |
| `scripts/native_store/worker_count_argument.py` | One `--workers` argument type | VERIFIED | used by `convert_actors.py` and `convert_tile_batch.py`; removed from `item_unit_workers.py` |
| `tests/pipeline/test_world_tile_batch_worker_processes.py` | Child-interpreter tests of the real pool | VERIFIED | 9 tests, all pass |

### Key link verification

| From | To | Via | Status |
|------|----|-----|--------|
| `convert_tile_batch.py` | `tile_step_workers.py` | `TileStepWorkers(` at line 185, outcomes consumed with `zip(tasks, ..., strict=True)` | WIRED |
| `tile_step_workers.py` | `ProcessPoolExecutor` | `initializer=initialize_tile_step_worker` with run factory and `first_stopped_position` | WIRED |
| three step modules | `interprocess_lock.py` | `convert_under_request_lock(` | WIRED |
| `mover_step.py` | `interprocess_lock.py` | `with mover_class_unit_lock(` at two places | WIRED |
| five world modules | `class_default_reads.py` | `from world.class_default_reads import` | WIRED |

### Gate commands run in this verification

Each through `python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py`, with a time limit.

| Gate | Result |
|------|--------|
| Task 1 verify command | 274 tests, 4 skipped, OK, exit 0 |
| Task 2 verify command | 218 tests, 4 skipped, OK, exit 0 |
| Task 3, first command | 24 tests, OK, exit 0 |
| Task 3, second command | 78 tests, OK, exit 0 |
| Task 3, third command | 92 tests, OK, exit 0 |
| Task 3, fourth command (whole suite) | not run, as instructed; judged from the log (truth 15) |

### Requirements coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| D-01 shape, shared worker count | SATISFIED | truths 4, 5; `worker_count_argument.py` |
| D-02 three phases | SATISFIED | truths 1 to 5 |
| D-03 inter-process lock | SATISFIED | truth 6; adversarial points 2 and 6 |
| D-04 where the lock is taken | SATISFIED as decided; the store path guard is outside its three places (gap 1) | truths 7, 8, 9 |
| D-05 one owner of class-default reads | SATISFIED | truth 9; adversarial point 7 |
| D-06 store publish | SATISFIED for the listed cases; see warning 2 | truth 10; adversarial point 5 |
| D-07 preflight and stop | SATISFIED | truths 11, 12 |
| D-08 coordinator owns shared writes | SATISFIED | truth 4; gap rows and catalog refresh run after `workers.close()` |
| D-09 dead worker | SATISFIED | truth 13 |
| D-10 out of scope items untouched | SATISFIED | truth 14 |

### Scope and code rule checks

| Check | Result |
|-------|--------|
| Frozen or pinned file edited (`git diff --stat b17eed7 HEAD`) | none |
| Files changed by the five commits against the plan's `files_modified` | 32 against 32, identical sets |
| Comments or docstrings in the 32 files (tokenizer scan) | none |
| Unused imports in the 32 files (ast scan) | none |
| Names defined in the 32 files and mentioned nowhere else in `scripts` or `tests` | none besides test classes |
| `print(`, `sleep`, retry or `while` loop in the new script modules | none |
| Debt markers (TBD, FIXME, XXX, TODO) in the changed files | none |
| Commit attribution trailers | none |
| Files over about 400 lines | `catalog_writer.py` 429 (accepted in the context), `test_convert_tile_batch.py` 417 (was 413), `convert_actors.py` 402 (line count unchanged by the task) |
| Processes left by this verification | none with the worktree path; probe folders removed |

## Adversarial points

### 1. Files and folders that two workers, or a worker and the coordinator, can write at the same time

| Path | Writers | Cover |
|------|---------|-------|
| `work/static-mesh-converter`, `work/sound-converter`, `work/minimap-texture-converter`: `index/<request sha>.json`, `<content sha>/` | workers | `convert_under_request_lock`. The content folder is a function of the request, because `provenance.json` in the archive holds the request (`scripts/native_assets.py` line 695), so two different requests never share a folder. `.work/<mkdtemp>` is private |
| The same converter folder, `TemporaryDirectory` of the BSP texture calls | workers | private folder per call, nothing published |
| `work/class-defaults/<Class>.json` and `decompiled/<Class>/` | workers | cache-folder lock in `class_default_reads.py`, the only world entry (grep) |
| `work/class__Engine.Mover/...` (begin removes the folder, seal writes it) | workers, coordinator (manifest step, selection) | `mover_class_unit_lock` at both entries |
| `l2/**` content-addressed store files | workers, coordinator (manifest step) | file bytes: `immutable_write` (link, never replace). **Path guard in front of it: not covered (gap 1)** |
| `work/tile__<id>/<step>/` unit folders | one worker per tile in phase B, coordinator for the manifest of a finished tile, raw only in phase A | rule: one process per tile; raw folders are read-only after phase A |
| `l2/catalog.json` | coordinator only | manifest step and refresh run in the coordinator |
| `gap-rows/*.json`, coverage, summary on stdout | coordinator only, after `workers.close()` | D-08 |
| `work/interprocess-locks/*.lock` | every process | `mkdir(exist_ok=True)` and append-open; never deleted |
| `work/` (lane work root) | coordinator before the pool | fix of `d8cca49` |
| `first_stopped_position` (shared memory) | every process | lock of the `multiprocessing.Value` |

### 2. Two inter-process locks at once, or waiting for one while holding another

- No. `interprocess_lock` refuses a second lock in the same process before it opens the file (line 48).
- No code path asks for one: under the request lock only the frozen converter runs; under the cache-folder lock only the three frozen readers run; under the mover lock only the pinned `mover_class_defaults.py` runs, and its imports (`native_catalog.effects`, `native_effect_bundle`, `unit_ledger`, `map_sources.file_hash` and `safe_path`) take no lock. Both mover call sites leave the lock before the next call.
- The lock of `first_stopped_position` is a different mechanism. It is held for one read or one write, never together with a file lock. Windows does not free it when its holder dies (warning 4).

### 3. Can a row, the attempted tile list, the reported stop or a manifest order depend on which worker finishes first

- Manifest order: no. Outcomes are consumed in task order and each manifest runs in the coordinator right after its tile.
- Batch without a stop: rows and attempted tiles do not depend on finishing order in the batch rules. They do through gap 1: a refused store write gives a failed row or a sealed gap row that depends only on timing.
- Batch with a stop and more than one worker: yes, by decision 7. Which later tiles had already started decides `attemptedTiles` and whether their unsealed steps show `batch-pending` in place of their recorded rows. The reported stop is the first stop in tile order among the tiles that stopped; a later tile can be refused by a live disk read that an earlier tile then passes. The SUMMARY states this.
- Phase A raw results come from the ledger, so their finishing order does not matter.

### 4. Does `--workers 1` differ from the pre-change batch (`b17eed7`) in anything other than raw running first

No output byte, fingerprint, config or seal check differs. Behaviour differences found:

- The raw step of eligible seam neighbours that are not selected is run and sealed, with a preflight record each (decision 2).
- A preflight refusal during phase A ends the batch with no attempted tile and no phase B. Before the change the tiles ahead of the refused one were fully converted and the refused tile was attempted. Failed raw rows of that phase A are dropped.
- Selection is decided before any step runs (the mover class corner of fact 1).
- New files on disk: `work/interprocess-locks/` with one lock file per distinct converter request, also for cache hits, never deleted.
- The lane work root is created even when there is nothing to do.
- Class-default answers and refusals are kept for the life of the process, across steps and tiles, where each step object had its own.
- New store files are published by hard link in place of replace.
- An `InterprocessLockError` raised outside a step (selection reaches the mover lock through the seal check) is a `RuntimeError`, so `main` does not print its `Tile batch failed` line for it. It needs `LockFileEx` or `UnlockFileEx` to fail.
- For a selected tile the calls, preflights and rows equal the old ones (the two unchanged calls-list expectations of `test_convert_tile_batch.py` pass).

### 5. Does `immutable_write` ever overwrite an existing file or leave a temporary file

- Overwrite: no. A present file is only hashed; `os.link` cannot replace a file, and `FileExistsError` leads to the same hash check.
- Temporary file: none in the tested cases and none in the two-process probe (0 of 3000 and 0 of 2000 writes). One is left when the write of the temporary file itself raises, because the `try/finally` starts after the `with` block: a probe that raises `OSError(28)` in the write left `asset.bin.<random>.tmp` and no final name. A process that dies between creating and unlinking leaves one too. `replace_file` has the same shape (warning 2).

### 6. Is the lock blocking without a polling loop, and released when the process dies

- Yes. `LockFileEx` is called with `LOCKFILE_EXCLUSIVE_LOCK` only (no fail-immediately flag) on a synchronous handle from `msvcrt.get_osfhandle`, so the call waits inside Windows. The module holds no loop, sleep, retry or timeout.
- Yes. The lock belongs to the file handle; Windows frees it when the process ends. `test_a_process_that_exits_while_holding_the_lock_frees_it` (`os._exit(0)` inside the lock) passes.

### 7. Could the kept class-default answers hand two callers the same mutable object

- No. `kept_read` returns `copy.deepcopy` of the kept answer on every call, the first one included, and never returns the kept object. A kept refusal is raised as a new `ClassDefaultError` built from the kept arguments. `test_a_caller_that_changes_its_answer_does_not_change_the_answer_of_the_next_caller` covers values, a chain and material class defaults.

## Warnings (not blocking)

1. **Suite log time.** `pipeline-261112-vj5.log` was last written at 00:51:05 and the last code commit `d8cca49` is stamped 00:51:29, so by file time the log is 24 seconds older than the commit, not newer. It does cover the committed code: the newest of the 32 task files was last modified at 00:41:52, before the 457 second run started (about 00:43:28), and the tracked tree equals `HEAD`. The commit came after the gate, as the plan orders.
2. **Temporary file after a failed write.** See point 5. Decision 6 says "always remove the temporary file".
3. **For the orchestrator's proof.** The receipt of `class:Engine.Mover` holds clock, host and free-byte fields, and its SHA-256 is `classDefaultsReceiptSha256` in every tile's mover config (`mover_step.py` line 68). Mover fingerprints, and what is derived from them, therefore differ between any two fresh stores at any worker count. This is older than this task; the byte comparison has to allow for it.
4. **Lock of `first_stopped_position`.** If a pool breaks and a worker is ended inside the few instructions that hold this lock, the coordinator's next read of the value waits for ever. The window is one read per step.
5. **Exception outside a step.** An exception that leaves a worker task (for example from `unit_step_evidence`, before the `try` of `step_result`) comes out of `future.result()`. `workers.close()` then waits until the running tiles have run all their steps, and the batch ends through `main` with no rows written. With one worker it ends at once, as before the change.
6. **Items pool.** The work-root race that the SUMMARY reports for `tests/pipeline/test_item_unit_worker_processes.py` is still there (outside this plan's files). It passed in both of my runs.
7. **Drive of the proof.** `os.link` needs a file system with hard links. Drives C: and E: are NTFS, so the proof is not affected.

## Human verification required

None. The byte comparison of real tiles and the one-run convergence are the orchestrator's proof by design; gap 1 should be closed before that proof is read as a result.

## Gaps summary

One gap. Every store write of a world step first runs the frozen path guard, and that guard refuses a valid path when another process creates the parent folder at that moment. `immutable_write` was made safe for this task, the guard in front of it was not, and no lock or rule covers it. With one worker it cannot happen. With several workers it gives a failed step that needs a second run, or, in the BSP surface material path, a sealed unit with a gap row that no later run repairs. Closing it needs a rule on the calling side of the guard and a two-process test; no frozen file has to change.

---

_Verified: 2026-11-12T23:10:00Z_
_Verifier: Claude (gsd-verifier)_

---

## Re-verification after gap closure - 2026-11-13 02:40 Riga

**Verified:** 2026-11-13T00:40:00Z
**Status:** passed
**Re-verification:** Yes - after gap closure (decisions G1 to G5 of the context file)
**Code under test:** `lane/speed` at `478834f`, tracked tree clean. Gap closure commits: `698ed88`, `edcba96`, `478834f`.

### Verdict in short

- Gap 1 is closed. My own probe gets no refusal through the new owner in 12 runs, and refusals in every process of all 12 runs through the old call pattern.
- Reading the code found no worker-side store write, and no frozen code that a world step calls, that is still exposed.
- The 16 truths of the initial report hold (15 by regression, truth 16 now verified) and the 4 truths of the gap closure hold. Score 20/20.
- Six observations are listed as advisory. None blocks.
- The byte comparison of real tiles and the one-run convergence stay the orchestrator's proof, as before.

### Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 to 15 | As in the initial report | VERIFIED (regression) | The five targeted gates pass again (table below); `git diff d8cca49 HEAD` touches none of their owners except the routed write calls |
| 16 | With more than one worker the store publish path is safe between processes | VERIFIED | Probe below; `TwoProcessStorePublishTests` passes (in the gate and in 3 more runs of that test alone) |
| 17 | G1: the six worker-side store writes go through `publish_store_files` under one inter-process lock per lane store root; `write_store` takes the same lock; the store lock is a leaf | VERIFIED | `scripts/native_store/store_file_publish.py`; `write_store` in `catalog_writer.py` lines 424-435; call sites `static_mesh_step.py:256`, `bsp_step.py:147`, `material_texture_images.py:48`, `minimap_step.py:152`, `tile_json_resource.py:13` and `:24`; 14 tests of `test_store_file_publish.py` pass |
| 18 | G2: the lane work root and the lane store root exist before a pool is built, in the world batch and in the pooled item batch | VERIFIED | `create_lane_work_and_store_roots` called at `convert_tile_batch.py:185` before `TileStepWorkers(` and at `item_census.py:107` before `outcomes_converted_by_workers(`; the two tests pass |
| 19 | G3: a `StorePathError` raised while publishing is never sealed as a gap | VERIFIED | `except StorePathError: raise` in `convert_surface_material` and `SkyRootConversion.convert`; every other handler read (below); `test_world_store_path_refusals.py` (6 tests) passes, among them the BSP step that fails with no seal and no unit folder |
| 20 | G4: the four kinds of test exist and pass | VERIFIED | New test files run by me: 29 tests OK. The "fails without the lock" half is shown by my probe through the old call pattern, not by editing the code |

**Score:** 20/20 truths verified (0 present but behavior-unverified)

### Probe 1: the old failure, with and without the lock

Throwaway folder under the system temp folder, programs and store folders apart, BelowNormal, removed afterwards. Each process builds the same 1500 new files, reports ready, and starts on one signal. Files: 500 hash folders with `<hash>/asset.bin` and `<hash>/model.bin` (shared parent folder), and 500 files `category-NN/<name>.bin` over 50 category folders that do not exist yet. The store is a fresh `<probe>/.../artifacts/lane-store/world/l2`, created before the processes start, as G2 does.

Through `publish_store_files` (new owner):

| Processes | Calls per process | Runs | Refusals | Other errors | Missing files | Wrong bytes | Temporary files left | Lock files |
|-----------|-------------------|------|----------|--------------|---------------|-------------|----------------------|------------|
| 2 | 500 calls of 3 files | 3 | 0 in each process | 0 | 0 | 0 | 0 | 1 |
| 2 | 1 call of 1500 files | 3 | 0 in each process | 0 | 0 | 0 | 0 | 1 |
| 4 | 500 calls of 3 files | 3 | 0 in each process | 0 | 0 | 0 | 0 | 1 |
| 4 | 1 call of 1500 files | 3 | 0 in each process | 0 | 0 | 0 | 0 | 1 |

Through the old call pattern (`verify_store_destinations`, then `immutable_write(confined_child_path(...))`, no lock), same files, same start:

| Processes | Pattern | Refusals per process, run 1 | Run 2 | Run 3 |
|-----------|---------|------------------------------|-------|-------|
| 2 | verify and write per group of 3 files | 36, 41 | 31, 45 | 28, 51 |
| 2 | verify all 1500, then the write loop | 30, 83 | 24, 72 | 89, 23 |
| 4 | verify and write per group of 3 files | 39, 68, 47, 64 | 43, 64, 45, 74 | 69, 30, 55, 39 |
| 4 | verify all 1500, then the write loop | 80, 40, 66, 50 | 36, 48, 90, 44 | 43, 79, 41, 78 |

- Every refusal is `StorePathError: Path escapes its root`, on model-style and on category-style paths.
- In the old pattern no file was missing, wrong or left as a temporary file: `immutable_write` holds, as the initial report found. The refusal is the whole defect.
- Totals: with the lock 0 refusals in 36 process runs; without it 23 to 90 refusals in each of 36 process runs.

### Probe 2: what the guard needs to fail, and the writers outside the lock

- Mechanism (Python 3.12.6, `ntpath.py` lines 710-752): the prefix is kept only when the first look ends with "path not found" and the last look with "file not found", so another process has to create the whole missing parent chain of the resolved path in between. Measured with one process resolving `category-N/unique-N/leaf-K` through `refuse_reparse_points` while a second process creates folders at that moment, 18,000 resolves per variant, two runs:

| What the other process creates | Prefix kept, run 1 | Run 2 |
|--------------------------------|--------------------|-------|
| Only the shared folder above (`category-N`) | 0 | 0 |
| The whole parent chain (`category-N/unique-N`) | 569 | 282 |

- Mixed run, 3 runs: two processes publish through the owner (`maps/<hash>/native-tile-chunk-bsp/chunk.glb`, `native-materials/textures/<hash>/texture.png`, `<hash>/asset.bin`) while two processes write the way `typed_payload.py` and the frozen `material_resources.py` do, without the lock (`require_converter_output` on `maps/<own hash>/native-tile-collision`, then `immutable_write`; `immutable_write` of `native-materials/<shared hash>/graph.json` and `program.json`). 4500 files per run: 0 refusals, 0 missing, 0 wrong, 0 temporary files.
- Store root not created first, 6 runs with 2 and 4 processes through the owner: 0 refusals. The window there is one resolve per process, so this shows little; G2 is what closes it.
- A paced "create the parent folder of a locked path without the lock" control gave 0 refusals in 3 runs. It did not land in the window and shows nothing; the mechanism table above is the working control.

### Attack on the fix by reading the code

**Every call of `confined_child_path`, `refuse_reparse_points`, `lane_store_root`, `lane_work_root` and `require_converter_output` in `scripts/world`, `scripts/native_store`, `scripts/actors` and the frozen code a world step calls**

| Call | Path resolved | Safe because |
|------|---------------|--------------|
| `lane_work_root`, `lane_store_root` (every step, `UnitLedger.__init__`, `require_batch_preflight`, `material_texture_images.py:42`, frozen `material_resources.py:19`, `lane_roots.py`) | the lane work root or store root | both exist before a pool is built (G2) |
| `Converter.__init__` (frozen `native_assets.py:167`), `cached_class_chain` (frozen `class_defaults.py:302`) | `work/<converter folder>`, `work/class-defaults` | one missing component under an existing folder; the frozen `Converter.convert` and the readers join the rest without the guard |
| `UnitLedger.unit_step_directory` (`unit_ledger.py:238`) and `begin` (`:287`) | `work/<unit>/<step>` | one process per tile in phase B, raw only in phase A, the manifest in the coordinator after the tile; `class:Engine.Mover` under its unit lock; a neighbour's raw folder is read only after phase A |
| `UnitLedger.lane_output_path` (`:247`) | outputs of a sealed or sealing receipt | the files exist, so the first look succeeds |
| `verify_store_destinations` (`catalog_writer.py:401`), `write_store_files` (`:421`) | new store files | under the store lock in both callers (`publish_store_files`, `write_store`) |
| `publish_store_files` and `write_store`, `refuse_reparse_points(store_root)` | the store root, before the lock | exists (G2); see advisory 6 |
| `write_typed_payload_asset` (`typed_payload.py:91`) | `l2/maps/<asset sha>/<folder>`, no lock | `<asset sha>` holds the map hash of the tile, so only that tile's worker creates it; another process creating `maps` alone does not trigger (probe 2) |
| frozen `write_native_material_resources` | joins `native-materials/<program sha>/<file>` without the guard | only `immutable_write` meets the other process; no locked writer resolves a path whose direct parent is `native-materials/<program sha>` |
| `read_current_catalog_bytes` (`:134`), `write_store` catalog path (`:429`, `:434`) | `l2/catalog.json` | parent exists; only the coordinator writes it |
| `read_pinned_file` (`:372`), `is_earlier_tile_record_of_this_store` (`tile_manifest_step.py:293`), `require_world_lane_store` (`:343`) | files of a finished tile, the store root | coordinator only; the files exist |
| `native-materials/surface-materials-<sha>.json` (manifest step, through `write_store`) | direct parent `native-materials`, which the unlocked frozen writer creates | written only when the tile has material files, so the folder already exists |
| `npc_store_records.py:86`, `convert_actors.py`, `character_*`, `actor_census.py`, `item_census.py:123` | actors lane paths | item workers resolve their lane roots (G2) and their own unit folder; the rest runs in one process |
| `write_lane_catalog.py`, `lane_coverage_refresh.py`, `build_coverage_report.py`, `gap_rows.py`, `merge_lane_store.py`, `store_file_copy.py`, `print_lane_union_catalog.py`, `load_check_records.py`, `data_ui_table_manifest.py`, `texture_layout_cross_checks.py`, `committed_world_data.py`, `convert_tile.py:57`, `convert_tile_batch.py:222` and `:254` | lane outputs | coordinator after the pool is closed, or scripts that no worker runs |

**Lock order.** The store lock is never asked for while another inter-process lock is held: `publish_store_files` is called after `convert_under_request_lock` returned (meshes, movers, minimap), after `kept_read` left the class-default lock, and after both `with mover_class_unit_lock` blocks of `mover_step.py` ended (lines 107-108, 229-230). Under those three locks only frozen or pinned code runs, and none of it names `write_store`, `publish_store_files` or `lane_store_publish_lock`. Under the store lock run `verify_store_destinations`, `immutable_write`, `require_catalog_unchanged`, `require_catalog_within_byte_limit` and `replace_file`, none of which takes a lock. `interprocess_lock` refuses a nested lock, and a test holds that for the store lock.

**`write_store` in the coordinator.** Same function, same key (`store:` plus the resolved store root), same lock file; `test_write_store_verifies_writes_and_replaces_the_catalog_under_the_same_lock` compares the lock file path.

**Handlers that could seal a path refusal.** Read again, all of `scripts/world`:

- `convert_surface_material` first `try` and `SkyRootConversion.convert`: `StorePathError` is raised again in front of the conversion handler. The step ends through `TileStepRun.step_result` as a `failed` row with no seal.
- `static_mesh_outcomes`, `tile_minimap`, `TileSounds.convert`: the handler surrounds the conversion and the read of the archive only; the `Converter` is built outside the `try`; the publish runs after it.
- `run_bsp_step`, `run_sky_step`, `run_collision_step` (`except ValueError`): surround the level model, zone, lightmap and rectangle reads only, and return a failed row.
- `lighting_step.py`, `bsp_visibility_step.py`, `mover_step.py`, `terrain_chunk_step.py`, `tile_chunk_plan.py`, `raw_map_step.py`: handlers name `FormatError`, layout, range, mover or class-default errors, which a `StorePathError` is not. `map_emitter_step.py` has no handler.
- `convert_surface_material` third `try` and `converted_texture_pngs`: private temporary folder, no publish.

No step turns a `StorePathError` raised while publishing into a gap row or a seal.

**Output bytes, fingerprints, configs, refusal messages (`git diff d8cca49 HEAD`).**

- No output path, payload or `outputs` list changed; no algorithm version or config field changed; no changed file is in `implementation_source_paths()` (checked by calling it: 55 paths, none changed since `b17eed7`); no frozen or pinned file changed since `b17eed7`.
- One refusal text differs in one case, see advisory 3 (a corrupt texture image already in the store).
- The re-raise in the two material functions covers the whole first `try`, so a `ConverterOutputRefusedError` of the class-default cache folder (a wrong work root) now fails the step where it was a gap reason.
- New on disk: one store lock file per lane store in `<lane>/work/interprocess-locks/`, also for `write_store` of the other lanes; an empty actors store root after a refused pooled item slice.

**Item pool.** Real for the batch: the worker initializer resolves the lane work root (`UnitLedger.__init__`) and the converter folder the coordinator already created; both lane roots now exist before `ProcessPoolExecutor` is built, and a worker resolves only the folder of its own unit. What remains is in test support, see advisory 4.

### Regression

Each through `python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py`, with a time limit, one at a time.

| Command | Result |
|---------|--------|
| `test_store_file_publish.py`, `test_world_store_path_refusals.py`, `test_material_program_images.py` | 29 tests, OK, exit 0 |
| Task 1 verify command | 274 tests, 4 skipped, OK, exit 0 |
| Task 2 verify command | 218 tests, 4 skipped, OK, exit 0 |
| Task 3, first command | 26 tests, OK, exit 0 |
| Task 3, second command | 78 tests, OK, exit 0 |
| Task 3, third command | 94 tests, OK, exit 0 |
| `TwoProcessStorePublishTests` alone, 3 runs | OK, OK, OK |
| Whole suite | not run, as instructed; judged from the log |

Whole suite from `pipeline-261112-vj5-gap-closure.log` against `pipeline-261112-vj5-baseline.log`:

- 2416 tests, `FAILED (errors=2, skipped=66)`; baseline 2334 tests, same two `ERROR:` lines, no `FAIL:` line in either.
- Per test name: the only name that was ok on the baseline and is not ok now is `test_two_class_default_readers_do_not_share_answers`, replaced by the context amendment. 83 new names against the baseline (23 against the first task log), all ok, among them every new test of the gap closure.
- Log time: created 01:50:07, last written 01:56:56. The newest of the 20 files changed since `d8cca49` was last modified at 01:46:53, so the run started after the last edit. Commit `478834f` is stamped 01:57:19, after the gate, and the tracked tree equals `HEAD`.

### Scope and code rule checks

| Check | Result |
|-------|--------|
| Frozen or pinned file changed (`git diff --name-only` against `d8cca49` and `b17eed7`) | none |
| Comments or docstrings in the 20 changed files (tokenizer and ast scan); `#` in the 524 added lines | none |
| Unused imports; top-level names of the 20 files mentioned nowhere else in `scripts` or `tests` | none |
| `sleep`, retry, `while` or polling loop in the changed script files or in the added lines | none (`process.poll()` in a test is the subprocess call) |
| Debt markers | none |
| Files over about 400 lines | `catalog_writer.py` 435 (429 before, accepted over 400 in the context), `test_lane_catalog_writer.py` 442 (441 before) |
| Processes and folders left by this re-verification | none: no python process with the probe folder or this worktree in its command line; both throwaway folders removed; `artifacts/test-scratch` empty |

### Advisory (new scope, not blocking)

| # | Finding | Category | Why advisory |
|---|---------|----------|--------------|
| 1 | The store lock is taken for lane stores only; G1 says per store root | architectural | Every store the two pools write is a lane store; the orchestrator confirms the reading |
| 2 | `typed_payload.py` and the frozen `material_resources.py` write outside the lock | architectural | Safe by path layout and measured; no process test holds the rule |
| 3 | A corrupt texture image in the store is refused with another text, before any write | other | Follows from G1; needs a corrupt store file |
| 4 | `LaterUnitsSealFirstItemRun` in test support resolves another unit's folder in each worker | other | Test only, older than this task; can fail on a loaded machine |
| 5 | Publishing is serial per lane store and hashes present files under the lock | other | Speed only; the `--workers 6` proof shows it |
| 6 | The store root is resolved before the lock is taken | architectural | Covered by G2 for both pools |

Warnings 2, 3, 4, 5 and 7 of the initial report are unchanged; G5 puts them out of scope. Warning 6 (items pool) is answered above.

### Human verification required

None.

### Gaps summary

No gap remains. The path guard in front of a store write no longer meets another process: the six worker-side writes and the coordinator's `write_store` share one lock per lane store, the lane roots exist before a pool, and a path refusal fails the step. The measured difference is 0 refusals with the lock against 23 to 90 per process without it, over the same 1500 files.

---

_Re-verified: 2026-11-13T00:40:00Z_
_Verifier: Claude (gsd-verifier)_
