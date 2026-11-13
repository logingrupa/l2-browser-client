---
phase: 261112-vj5-world-tile-batch-in-worker-processes-wit
plan: 01
status: complete
subsystem: pipeline (world lane batch)
tags: [world, tile-batch, worker-processes, interprocess-lock, pipeline-speed]
requirements: [D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08, D-09, D-10]
plan_head_before: b17eed7b5e48950886e6d63d1359c58db0f6ddde
plan_head_after: 478834f5178a7fc6a03d7de7baff9e3a3ebeae47
units_committed:
  - task 1: 505bf6c
  - task 2: 415ad0d
  - task 3 stage 1: 0546d25
  - task 3 stage 2: 39f0b20
  - task 3 stage 3: d8cca49
  - gap closure G1: 698ed88
  - gap closure G1 correction: edcba96
  - gap closure G2 and G3: 478834f
executor_contexts:
  - context 1: task 1, task 2
  - context 2: task 3 stage 1, task 3 stage 2
  - context 3: task 3 stage 3
  - context 4: gap closure G1 to G4
key-files:
  created:
    - scripts/native_store/interprocess_lock.py
    - scripts/native_store/worker_count_argument.py
    - scripts/world/class_default_reads.py
    - scripts/world/tile_step_workers.py
    - tests/pipeline/support/interprocess_lock_programs.py
    - tests/pipeline/support/tile_step_worker_runs.py
    - tests/pipeline/test_interprocess_lock.py
    - tests/pipeline/test_immutable_write_publish.py
    - tests/pipeline/test_world_converter_request_locks.py
    - tests/pipeline/test_world_class_default_reads.py
    - tests/pipeline/test_world_tile_batch_phases.py
    - tests/pipeline/test_world_tile_batch_worker_processes.py
    - scripts/native_store/store_file_publish.py
    - scripts/native_store/lane_roots.py
    - tests/pipeline/support/store_file_publish_programs.py
    - tests/pipeline/test_store_file_publish.py
    - tests/pipeline/test_world_store_path_refusals.py
  modified:
    - scripts/world/convert_tile_batch.py
    - scripts/native_store/catalog_writer.py
    - scripts/world/mover_step.py
    - scripts/world/static_mesh_step.py
    - scripts/world/exact_sound_sources.py
    - scripts/world/minimap_step.py
    - scripts/world/static_placement.py
    - scripts/world/light_actors.py
    - scripts/world/tile_chunk_plan.py
    - scripts/world/bsp_surface_materials.py
    - scripts/world/sky_materials.py
    - scripts/actors/item_unit_workers.py
    - scripts/actors/convert_actors.py
    - tests/pipeline/test_convert_tile_batch.py
    - scripts/world/bsp_step.py
    - scripts/world/material_texture_images.py
    - scripts/world/tile_json_resource.py
    - scripts/world/sky_step.py
    - scripts/actors/item_census.py
    - tests/pipeline/test_item_unit_workers.py
    - tests/pipeline/test_item_unit_worker_processes.py
    - tests/pipeline/test_lane_catalog_writer.py
    - tests/pipeline/test_world_tile_batch_phases.py
actuals:
  tokens: 50000
  tasks: 3
  commits: 8
---

# Quick task 261112-vj5 plan 01: world tile batch in worker processes - summary

`convert_tile_batch.py --eligible --limit N --workers W` runs the raw step of every selected tile and eligible seam neighbour first, then the other steps of each selected tile in W worker processes, and every manifest in the coordinator in tile order. On synthetic steps 2 workers write the gap-row bytes, the attempted tiles and the summary of 1 worker.

All five units are committed on `lane/speed`. The whole pipeline suite ran once and passes the plan's verdict rule. `actuals.tokens` is the character count of `git diff b17eed7..HEAD` (151,764, context lines included) divided by 4.

## Unit 1 - task 1: inter-process lock, publish-if-absent immutable_write, locks at the converter calls and the mover class unit

- Commit: `505bf6c`
- Gate (the task 1 verify command, BelowNormal): 274 tests, 4 skipped, exit 0. Log: `C:/laragon/l2b-orchestration/autonomous-roadmap/vj5-task1-gate.log`.
- New tests: `test_interprocess_lock.py` 6, `test_immutable_write_publish.py` 7, `test_world_converter_request_locks.py` 7. They failed before the implementation (missing module, no link) and pass after it.
- `scripts/native_store/interprocess_lock.py`: `interprocess_lock`, `lane_lock_folder`, `lock_file_path`, `convert_under_request_lock`, `InterprocessLockError` (a `RuntimeError`).
- `immutable_write` publishes through `os.link`; `replace_file` is unchanged.
- `scripts/native_store/catalog_writer.py` is now 429 lines (413 before), over the 400 line guide as the context file accepts.
- `mover_step.py` takes `mover_class_unit_lock` around `mover_class_evidence` and around `sealed_mover_class_receipt_sha256`.
- Test fakes: `SyntheticTextureConverter` and `FailingTextureConverter` hold `output`; the `SimpleNamespace` converter of `converted_archive` holds `output`.

## Unit 2 - task 2: one owner for the class-default reads of the world steps

- Commit: `415ad0d`
- Gate (the task 2 verify command, BelowNormal): 218 tests, 4 skipped, exit 0. Log: `C:/laragon/l2b-orchestration/autonomous-roadmap/vj5-task2-gate.log`.
- New tests: `test_world_class_default_reads.py` 10; `test_world_class_default_lookups.py` keeps 7 (the last one replaced by `test_two_class_default_readers_of_one_cache_folder_share_one_frozen_read`). They failed before the implementation (missing module).
- `scripts/world/class_default_reads.py` (44 lines): `kept_class_default_values`, `kept_class_chain`, `kept_material_class_defaults` on one `kept_read`.
- `ClassDefaults` holds no cache of its own; `light_actors.py`, `tile_chunk_plan.py`, `bsp_surface_materials.py` and `sky_materials.py` read through the owner.

## Unit 3 - task 3 stage 1: one home for the worker count argument

- Commit: `0546d25`
- Gate (the first verify command of task 3, BelowNormal): 24 tests, exit 0. Log: `C:/laragon/l2b-orchestration/autonomous-roadmap/vj5-task3-stage1-gate.log`.
- `scripts/native_store/worker_count_argument.py` holds `MAXIMUM_WORKER_COUNT`, `WORKER_COUNT_PATTERN` and `worker_count_argument`, moved unchanged from `scripts/actors/item_unit_workers.py`, which lost its `argparse` and `re` imports. `convert_actors.py` and `test_item_worker_command_line.py` import from the new home.

## Unit 4 - task 3 stage 2: the three phases, the pool, --workers and the preflight floor

- Commit: `39f0b20`
- Gate (the second verify command of task 3, BelowNormal): 77 tests, exit 0. Log: `C:/laragon/l2b-orchestration/autonomous-roadmap/vj5-task3-stage2-gate.log`.
- New tests: `tests/pipeline/test_world_tile_batch_phases.py` holds the 20 tests of the behavior block. It failed before the implementation (no module `world.tile_step_workers`).
- `scripts/world/tile_step_workers.py` (157 lines): the four `BATCH_EXIT` constants, `TileBatchStop`, `TileStepsTask`, `TileStepsOutcome`, `TileStepRun`, `ordered_tile_steps_outcome`, `NO_STOPPED_POSITION`, `WORKER_DIED_MESSAGE`, the worker side and `TileStepWorkers`.
- `scripts/world/convert_tile_batch.py`: `selected_tile_ids`, `seam_input_tile_ids`, `seam_input_raw_results` (phase A), `selected_tile_step_results` (phases B and C), `batch_free_disk_floor`, `world_tile_step_run`, `--workers` with default 1.
- `tests/pipeline/test_convert_tile_batch.py` changed only as action D lists. No expectation of that file changed, and all 21 of its tests pass.

## Unit 5 - task 3 stage 3: the proof with real worker processes and the whole suite

- Commit: `d8cca49`
- Gate, third verify command (BelowNormal): 92 tests, exit 0. Log: `C:/laragon/l2b-orchestration/autonomous-roadmap/vj5-task3-stage3-gate-run2.log`. This is the second run of that command; the first run is under "Findings" below.
- Gate, fourth verify command (the whole suite, run once, BelowNormal, no other `scripts/test_pipeline.py` on the machine): 2394 tests in 457 s, 66 skipped, 2 errors, no `FAIL:` line. The two `ERROR:` lines are the two baseline errors (`test_the_20_20_ambient_counts_equal_the_staged_ambience`, `test_the_generic_20_20_step_holds_the_brush397_and_brush610_nodes_at_their_native_positions`). The verdict command exits 0. Log: `C:/laragon/l2b-orchestration/autonomous-roadmap/pipeline-261112-vj5.log`. The baseline log holds 2334 tests; the 60 more are the tests of this plan.
- New tests: `tests/pipeline/test_world_tile_batch_worker_processes.py` (194 lines) holds the 9 tests of the behavior block. It failed before its support module existed (`No module named 'support.tile_step_worker_runs'`).
- `tests/pipeline/support/tile_step_worker_runs.py` (138 lines): the run factory `scenario_tile_step_run`, seven scenarios in `TILE_BATCH_SCENARIOS_BY_NAME`, the step-call records, the one gate function `wait_at_the_gate_until`, and the report the child program prints.
- One production change in this unit, found by the two-worker scenarios: `run_tile_batch` creates the lane work root before it builds `TileStepWorkers` (`scripts/world/convert_tile_batch.py`, now 268 lines). New test: `test_the_lane_work_root_exists_before_the_workers_are_built` in `test_world_tile_batch_phases.py` (now 21 tests, 369 lines); it failed before the change.
- `tests/pipeline/test_convert_tile_batch.py` gained `write_synthetic_tile_census`, taken out of `TileBatchTestCase.setUp` so that the support module writes the same census (417 lines, 413 before).

## Findings

### A worker resolved the lane work root while another worker created it (fixed for the world batch)

- Seen in the first run of the two-worker scenarios: a worker failed with `ConverterOutputRefusedError: converter output must be a dedicated folder under <project>\artifacts: \\?\<project>\artifacts\lane-store\world\work`.
- Cause: the frozen `refuse_reparse_points` (`scripts/native_store/store_paths.py:45-50`) ends in `Path.resolve()`. For a path that does not exist, `ntpath.realpath` keeps the `\\?\` prefix when the Windows error of its first look differs from the error of its second look (Python 3.12 `ntpath.py:727-751`). That happens when another process creates the missing parent folders between the two looks (path not found, then file not found). The prefixed path is then not under the artifacts folder.
- It shows only on a store whose `artifacts/lane-store/world/work` does not exist yet and with more than one worker.
- Fix inside `files_modified`: the coordinator creates the lane work root before the pool exists. No frozen file is touched.

### Not fixed, for the orchestrator

- **The items pool has the same race, and its existing test failed once on it.** The first run of the third verify command ended with exit 1: 85 tests ran and `setUpClass` of `tests.pipeline.test_item_unit_worker_processes.PooledItemBatchByteIdentityTests` errored with the same `ConverterOutputRefusedError`, for `...\lane-store\actors\work`, raised in a worker initializer (`UnitLedger.__init__` to `lane_work_root`). Log: `C:/laragon/l2b-orchestration/autonomous-roadmap/vj5-task3-stage3-gate.log`. That code path holds no line of this plan, and its cause sits in `scripts/actors/item_census.py` or the test's project tree, both outside `files_modified`, so it is not changed here. The command was run again after the work root change (which the gate needed anyway) and passed with 92 tests; the whole suite also passed that test. It is a test that can fail again on a loaded machine.
- **The same mechanism can reach deeper folders, not verified.** Any path that goes through `refuse_reparse_points` and has two or more missing trailing folders can get the prefix when another process creates one of those folders at that moment. Unit folders are safe (one worker per tile, raw only in phase A). Whether a store path shared by two tiles (a folder that two workers create on a fresh store) can hit it was not checked. It would show as a failed step row with `Path escapes its root` or `converter output must be a dedicated folder`. Worth a look in the `--workers 6` proof on a fresh store.

## Items the plan asks the summary to record

- **The mover class corner of selection (fact 1).** `selected_tile_ids` decides the selection before any step runs and nothing seals `class:Engine.Mover` before it. When that class unit is unsealed while a later tile already holds a mover receipt, the up-front selection sees that tile's mover seal as pending where the old lazy loop saw it after the first mover step. No code handles the corner.
- **`scripts/native_store/catalog_writer.py` line count:** 429 lines (413 before).
- **A dead worker's tile is reported as not attempted.** `worker_died_outcome` has `started` false, so the tile of a broken future is not in `attemptedTiles` and gets no step results of this run, also when some of its steps sealed before the worker died. Its rows come from its seals and its recorded rows. The dying-worker test shows it: the stop names the second tile, `attemptedTiles` holds the first tile only, and the second tile has its raw pass row and batch-pending rows.
- **A failed phase A raw row is dropped when phase A stops.** `run_tile_batch` keeps the phase A raw results only for phase B, so after a stop in phase A no tile is attempted and a selected tile whose raw failed before the stop keeps its recorded raw row (or `batch-pending`). The next run calls its raw step again.
- **Order of work with a pool.** `TileStepWorkers.outcomes` submits every task when it is called and yields the results afterwards; without a pool it runs each task when the consumer asks for it.
- **Store state of the one-run convergence claim.** It holds on a fresh store. On a store that the present code sealed, a tile that the run does not select and whose terrain seal was made with a pending seam goes stale when phase A seals that neighbour's raw unit, and the next run converts it. With a `--limit`, phase A also seals the raw unit of eligible seam neighbours that are not selected, so the new code equals the converged present code only over a closed set of eligible tiles. No executor test shows convergence; the orchestrator's proof does.
- **Comparing a stopped batch.** A batch that a preflight stops with more than one worker can hold, in `attemptedTiles` and in the rewritten rows, later tiles that were already running and that one worker never starts. Compare such a batch with `--workers 1` only after the resume run has converged.
- **After `WORKER_DIED_MESSAGE`.** The batch does not restart or repair. Before the next run the orchestrator checks the shared converter folders (`work/static-mesh-converter`, `work/sound-converter`, `work/minimap-texture-converter`) for a half-published request, which the next run would read as a `decode-failed` gap row, and checks for UModel child processes of the ended workers.

## Deviations from the plan

- Task 1, one test more than the behavior block: `test_a_published_file_whose_read_back_differs_is_refused_as_a_runtime_copy`. Reason: the plan's action B adds that refusal to `immutable_write` and no listed test reached it.
- Task 1, lock key of a conversion: the converter folder and the canonical request JSON are joined with a newline (`converter:<posix folder>\n<canonical JSON>`). Reason: the plan names the parts and no separator; a newline cannot occur in a path, so two folders cannot produce one key.
- Task 1, the "lock is released when the converter raises" check is inside `test_a_conversion_runs_under_the_lock_of_its_converter_folder_and_request`, not a test of its own.
- Task 2, one test more than the behavior block: `test_a_read_that_is_not_kept_leaves_its_lock_file_under_the_work_root`.
- Task 3 stage 2, test fixtures: the two tests about recorded rows of a seam neighbour write those rows with `write_gap_rows`. Reason: no batch can leave a settled raw row on a neighbour while its owner still has work.
- Task 3 stage 3, production code changed in the proof stage: the lane work root is created before the pool (see "Findings"), with one test more than the behavior block. Reason: the plan says a failing stage 3 test shows a defect of the stage 2 code and the code is what gets fixed.
- Task 3 stage 3, `tests/pipeline/test_convert_tile_batch.py` is 417 lines where the plan asks for its present size (412 at plan time). Reason: `write_synthetic_tile_census` is shared with the worker support module instead of written twice.
- Task 3 stage 3, the third verify command ran twice (see "Findings"); the whole suite ran once.
- Task 3 stage 3, scenario details the plan leaves open: the plain, failed-step and later-tile scenarios select all three of the eligible tiles 10_11, 12_13 and 14_15; the dying scenario selects two of them; the seam-neighbour scenario uses the five-tile census of the phase tests with limit 2. The step-call records are sorted by process id and call number, so tests read them per tile or per step, not as one global order.
- All units: tests were written first and seen failing, then one commit per unit. There is no separate failing-test commit.
- The commit ledger file in the git folder was not written: the harness refused the compound command. `plan_head_before` is in the frontmatter above and `commits: 5` is `git rev-list --count b17eed7..HEAD`.

## Verification

- `git diff --name-only 277129e` over the frozen and pinned files and `docs/BATCH_PIPELINE_SPEED.md` prints nothing.
- The 32 files of `git diff --name-only b17eed7..HEAD` are the 32 files of the plan's `files_modified`.
- No real tile was converted and `convert_tile_batch.py` was never run against the real census.
- Not verified here, by design: the byte comparison of real tiles and the one-run convergence (the orchestrator's proof on drive E:).

## Process cleanup

After the whole suite and before the commit of stage 3: no python process with `l2b-speed` (and not `l2b-speed-proof`), `--multiprocessing-fork`, `test_pipeline.py` or `unittest` in its command line was running. The processes of the other threads (`l2b-speed-proof`, `autonomous-roadmap`, `watch_disk_c.py`, `measure_command.py`) were left alone.

## Self-check: passed

- The five commits `505bf6c`, `415ad0d`, `0546d25`, `39f0b20`, `d8cca49` are ancestors of `HEAD` on `lane/speed`.
- The five marker files exist and `git status --porcelain -- scripts tests` prints nothing.

## Gap closure

Executor context 4 (2026-11-13, 01:15 to 02:05 Riga) closed gap 1 of `261112-vj5-VERIFICATION.md` by decisions G1 to G4 of the context file. G1 to G4 are done. `actuals.tokens` and `actuals.commits` in the frontmatter now cover `b17eed7..HEAD` (200,155 characters of diff, 8 commits); the gap closure alone is 20 files, 524 lines added and 51 removed.

### Commits

| Commit | Decision | What it does |
|--------|----------|--------------|
| `698ed88` | G1, G4 | `publish_store_files` (new `scripts/native_store/store_file_publish.py`, 10 lines) verifies and writes the files of a step under one inter-process lock of the store root; `write_store` takes the same lock; the six worker-side writes go through the owner |
| `edcba96` | G1 correction | the lock is taken for lane stores only (see deviation 1) |
| `478834f` | G2, G3, G4 | both pools get their lane work root and lane store root first; a store path refusal while a material is published leaves the step as an exception |

### G1 - one owner for publishing store files

- `publish_store_files(store_root, files)` runs `verify_store_destinations` and then `immutable_write(confined_child_path(root, relative), payload)` for every file, inside `lane_store_publish_lock(root)`.
- `lane_store_publish_lock` is in `scripts/native_store/interprocess_lock.py` (87 lines): key `store:<store root as POSIX>`, lock folder `<lane>/work/interprocess-locks`, the folder of decision 3.
- `write_store` holds the same lock from its verify to its catalog replace. Its write loop is `write_store_files`, the one loop both functions share.
- Callers moved to the owner: `write_static_mesh_store_files` (`static_mesh_step.py`, also the mover step), `write_chunk_glbs` (`bsp_step.py`), `write_material_texture_images` (`material_texture_images.py`), `store_converted_radar_texture` (`minimap_step.py`), `write_tile_json_resource` and `write_tile_resource_bundle` (`tile_json_resource.py`).
- After the change no module of `scripts/world` names `verify_store_destinations`, and only `typed_payload.py` names `immutable_write` (see "Not routed through the owner"). An ast test holds this.
- The store lock is a leaf. Under it run `verify_store_destinations`, `immutable_write`, `require_catalog_unchanged` and `replace_file`, none of which takes a lock. Every caller asks for it after its converter request lock, class-default lock or mover class lock is left. No call site had to hold another lock, so nothing was stopped and reported. `interprocess_lock` would refuse a nested lock with `InterprocessLockError`; the whole suite ran without one.
- `scripts/native_store/catalog_writer.py` is 435 lines (429 before).

### G2 - shared roots before the pool

- `create_lane_work_and_store_roots(project_root, lane_name)` (new `scripts/native_store/lane_roots.py`, 6 lines) is the one owner. `run_tile_batch` calls it for the world lane before `TileStepWorkers` is built, for every worker count. `run_pooled_item_batch` calls it for the actors lane before `outcomes_converted_by_workers`.

### G3 - handlers checked

Every `except ValueError`, `except (OSError, ValueError)`, `MODEL_CONVERSION_ERRORS`, `MATERIAL_CONVERSION_ERRORS`, `(FormatError, ValueError)` and `except Exception` handler of `scripts/world` was read against the store publishes.

| Handler | Surrounds a store publish | Done |
|---------|---------------------------|------|
| `bsp_surface_materials.py` `convert_surface_material`, first `try` (`MATERIAL_CONVERSION_ERRORS`) | yes: `write_material_program_record` and `write_material_texture_images` | `except StorePathError: raise` in front of it. The step fails; nothing is sealed |
| `sky_step.py` `SkyRootConversion.convert` (`(FormatError, ValueError)`) | yes: the same two writes. Not named in G3, same shape | `except StorePathError: raise` in front of it |
| `bsp_surface_materials.py` `converted_texture_pngs` and the third `try` of `convert_surface_material` | no: `converter.texture` and `converter.material_texture` work in a private temporary folder | unchanged |
| `static_mesh_step.py` `static_mesh_outcomes` (`MODEL_CONVERSION_ERRORS`) | no: conversion under the request lock and the read of the archive. The `Converter` is built outside the `try`; `write_static_mesh_store_files` is outside every handler in the mesh step and the mover step | unchanged |
| `minimap_step.py` `tile_minimap` (`MODEL_CONVERSION_ERRORS`) | no: only the conversion. `store_converted_radar_texture` runs after the handler | unchanged |
| `world_audio_step.py` `TileSounds.convert` (two `except ValueError`) | no: sound resolution and conversion. The converter is built between the two `try` blocks; `write_tile_resource_bundle` is outside every handler | unchanged |
| `bsp_step.py` `run_bsp_step`, `sky_step.py` `run_sky_step`, `collision_step.py` `run_collision_step` (`except ValueError`) | no: level model, zones, lightmaps and chunk rectangles are read there. They return a failed row and seal nothing | unchanged |
| `lighting_step.py`, `bsp_visibility_step.py`, `mover_step.py`, `terrain_chunk_step.py`, `tile_chunk_plan.py`, `raw_map_step.py` | no: their handlers name `FormatError`, `LevelModelLayoutError`, `LevelModelRangeError`, `MoverUnsupportedError` or `ClassDefaultError`, which a `StorePathError` is not; their publishes are outside the `try` | unchanged |
| `tile_manifest_step.py` `is_earlier_tile_record_of_this_store` (`(ValueError, KeyError, TypeError)`) | no: only `validate_tile_manifest`; `confined_child_path` is in front of the `try`. Coordinator only | unchanged |
| `tile_music.py`, `raw_map_extraction.py`, `level_model.py`, `blocking_volume_geometry.py`, `ambient_sound_inventory.py` | no: decode handlers | unchanged |
| `tile_step_workers.py` `TileStepRun.step_result` (`except Exception`) | every step | unchanged: it turns the exception into a `failed` row without a seal, which is the wanted outcome |
| `convert_tile_batch.py` `SEAL_INSPECTION_ERRORS` (two places) and `main`; `convert_tile.py` (two places) | no: seal inspection in the coordinator and the command-line exit | unchanged |
| `tile_census.py`, `minimap_join_census.py`, `reader_cross_check_rows.py`, `terrain_seam_facts.py`, `freeze_world_oracle.py`, `copy_world07_fixtures.py` | no: command-line `main` of scripts that no worker runs | unchanged |

Not routed through the owner, on purpose:

- `typed_payload.py` (`write_typed_payload_asset`, used by collision, lighting and BSP visibility). G1 does not name it. Its guard resolves `l2/maps/<asset sha>/<folder>`, and the asset holds `sourceSha256`, the map hash of the tile, so only the worker of that tile creates `<asset sha>`. Read, not run under two processes.
- `write_native_material_resources` (frozen `scripts/native_assets_lib/material_resources.py`). It guards the store root, which exists, and joins the rest without a guard, so only `immutable_write` meets the other process.

### G4 - tests

New tests: 22. One test renamed. Every new test was seen failing before its code.

| File | Tests | Covers |
|------|-------|--------|
| `tests/pipeline/test_store_file_publish.py` (237 lines) | 14 | owner under the store lock; refusal before any write; path refusal leaves the lock; `write_store` under the same lock; a second lock is refused; a store outside a lane; the six world call sites; the ast rule; the two-process publish |
| `tests/pipeline/test_world_store_path_refusals.py` (139 lines) | 6 | a `StorePathError` while a surface material is published fails `run_bsp_step` and gives a `failed` row through `TileStepRun.step_result`, no seal and no unit folder; the same fixture seals with no gap row when nothing is refused; the same for sky materials; another `ValueError` stays a gap reason |
| `tests/pipeline/test_item_unit_workers.py` | 1 | the pooled item batch creates both lane roots before its pool |
| `tests/pipeline/test_item_unit_worker_processes.py` | 1 | each run leaves the lock file of its own store root and no other |
| `tests/pipeline/test_world_tile_batch_phases.py` | renamed | `test_the_lane_work_root_and_the_lane_store_root_exist_before_the_workers_are_built` replaces `test_the_lane_work_root_exists_before_the_workers_are_built` |

Two-process test, `TwoProcessStorePublishTests`: two child interpreters build the same 600 files, report ready, wait for one start signal and publish into one fresh lane store.

| Code | Runs | Result |
|------|------|--------|
| Lock taken out of `publish_store_files` (temporary local edit, restored, never committed) | 5 | 5 failed, each with `StorePathError: Path escapes its root` in one or both children |
| Committed code | 10 | 10 passed, no refusal, 600 files present with the right bytes, no other file in the store |

The same 5 of 5 without the lock was seen twice: before the lock was first written, and again on the final code.

### Gates and suite

- G1 gate: 146 tests, 1 skipped, exit 0 (`vj5-gap-g1-gate-run2.log`). Its first run ended with one error, see deviation 4.
- G1 correction gate: 68 tests, exit 0 (`vj5-gap-g1-lane-only.log`).
- G2 and G3 gate: 164 tests, exit 0 (`vj5-gap-g2-g3-gate-run2.log`). Its first run had one failure, see deviation 3.
- Whole suite, once, BelowNormal, started 01:50 after the last code edit, no other `scripts/test_pipeline.py` on the machine: 2416 tests in 406.6 s, 66 skipped, 2 errors, no `FAIL:` line. The two `ERROR:` lines are the two baseline errors. Log: `C:/laragon/l2b-orchestration/autonomous-roadmap/pipeline-261112-vj5-gap-closure.log`.
- Against `pipeline-261112-vj5.log` (2394 tests), per test name: the one name that was ok and is gone is the renamed test; 23 new names, all ok.
- `git diff --name-only d8cca49 HEAD` over the frozen and pinned files prints nothing. No changed file is in `implementation_source_paths()`.

All logs are in `C:/laragon/l2b-orchestration/autonomous-roadmap/`.

### Deviations

1. **`698ed88` created a lock folder beside the served store, corrected in `edcba96`.** The first G1 commit took the lock for every store root, with the lock folder at `<store root>/../work/interprocess-locks`. `write_store` is also what `stage_native_runtime.py` uses for `public/l2`, so staging in the main checkout would have left `public/work/interprocess-locks/<sha>.lock`: not ignored by git and copied into a build. A test showed it, then `edcba96` limited the lock to `<project>/artifacts/lane-store/<lane>/l2`, the shape `UnitLedger` already requires of a work root. A store root of any other shape is written without a lock, as before this task. This reads G1 as "lane stores": decision 3 puts lock files under the lane work root, and the served store has none. **For the orchestrator to confirm.**
2. **Three commits, not two.** Reason: deviation 1. No commit was amended.
3. **`test_a_preflight_refusal_in_a_worker_for_the_third_unit_stops_the_slice_and_keeps_two_sealed_units` changed.** It asserted that the actors lane store root does not exist after a refused slice. G2 creates that root before the pool, so the test now asserts that the root holds nothing.
4. **Two more existing tests changed for the lock file.** `snapshot_tree` of `test_lane_catalog_writer.py` and `sha256_by_relative_path` of `test_item_unit_worker_processes.py` leave `.lock` files out: `write_store` on a lane store now leaves its lock file in the lane work root, and its name holds the store path, which differs between two temporary projects.
5. **Sky materials.** `sky_step.py` is outside the files G1 lists and was changed under G3, which asks for every such handler.
6. **`tests/pipeline/test_world_bsp_step.py`** was changed in `698ed88` and set back in `edcba96`; it is byte-equal to `d8cca49`.

### For the orchestrator

- **The items pool race is not ruled out.** The first run of the G1 gate, before G2 existed, ended with `setUpClass` of `PooledItemBatchByteIdentityTests` in error: `StorePathError: Path escapes its root: weapon-mesh__.../items`, raised in a worker initializer. After G2 the file passed 12 of 12 repeated runs. The refused call is in test support code, not in the batch: `LaterUnitsSealFirstItemRun.__init__` resolves the unit folder of another unit in every worker while another worker begins that unit. G2 removes the missing lane root from that path; the window between the two folder creations of `ledger.begin` is still there for that test. The production item pool resolves only the unit folder of its own unit.
- **A lock file in this checkout's real world lane.** `artifacts/lane-store/world/work/interprocess-locks/559814ff...d45d.lock` (0 bytes, the store key of this checkout's world lane store) was created at 01:31 by the existing real-client test `tests/pipeline/test_world_sky_step.py` line 184, which calls `convert_tile_sky(REPOSITORY_ROOT, ...)` and so publishes sky materials into the real lane store. That test wrote there before this task as well. Nothing else under `artifacts/lane-store` changed during this context.
- **Readers outside the lock.** The lock covers publishes. A reader that resolves a store path whose folder is missing, at the moment another process creates that folder, would still be refused. None was found in a worker: the world steps resolve store paths only to publish, and the manifest step, `write_lane_catalog` and the coverage report run in the coordinator, the last two after the pool is shut down.

### Process cleanup

No python process with `l2b-speed` (and not `l2b-speed-proof`) or `test_pipeline` in its command line was running after the suite. No process of another thread was stopped. The five helper scripts written under `autonomous-roadmap` are deleted; the logs stay. `artifacts/test-scratch` is empty.

### Self-check: passed

- `698ed88`, `edcba96` and `478834f` are ancestors of `HEAD` on `lane/speed`; `git status --porcelain -- scripts tests` prints nothing.
- No commit carries an attribution line. No real tile was converted and neither batch script was run.
