# Quick task 261113-4mx: world seal checks without repeated work, and heavy tiles first - context

Locked decisions of the orchestrator (thread "Speed Up Asset Conversion Tools", 2026-11-13). The shared constraints of the pipeline speed work in `.planning/quick/261112-i67-pinned-store-verification-walk-without-p/261112-i67-CONTEXT.md` also apply. Read `docs/BATCH_PIPELINE_SPEED.md` first, section "Rules for parallel work". This task builds on quick task 261112-vj5 (the world tile batch in worker processes, HEAD `478834f`); read its SUMMARY for the code it added.

## Goal

The world tile batch stops re-checking the same sealed units and re-parsing the same lock file many times per process, and a pooled batch starts its heaviest tiles first. No output byte, fingerprint, receipt or row changes.

## Measured facts (DATABASE-PC, drive E: proof workspaces, first 30 eligible tiles, code at `478834f`)

- `--workers 6`: 1,208 s wall, 3,286 s CPU, 2.4 GiB peak for the whole job. Its outputs equal the settled one-process reference: 420 units with the same fingerprints and receipts, 6,063 store files with the same bytes, 30 catalog records.
- Of those 1,208 s, 233 s come after the last step of the last tile: the coordinator alone inspects the seals of every tile (`tile_rows` in `scripts/world/convert_tile_batch.py`), writes rows, the catalog and coverage.
- A profile of that inspection over the 30 sealed tiles (`C:/laragon/l2b-orchestration/pipeline-speed/results/tile-seal-inspection-profile.json`, 317.6 s under the profiler, 420 `unit_step_seal` calls):
  - `UnitLedger.sealed_receipt` (`scripts/native_store/unit_ledger.py`): 4,672 calls for 420 units, 170.5 s. Each call resolves every output path of the receipt through the frozen `confined_child_path` (83,058 calls, 165.6 s; 407,968 `nt._getfinalpathname`).
  - `reference_client_guard.read_reference_client_lock`: 613 calls, 54.2 s. Callers that parse the lock file on every call: `read_map_lock_record` in `scripts/world/raw_map_step.py` and `seam_neighbour_inputs` in `scripts/world/terrain_seam_strip.py`. `process_reference_client_lock` in `unit_ledger.py` already keeps the parsed lock per process by file identity.
  - `raw_unit_fingerprint` (`scripts/world/tile_chunk_plan.py`): 1,372 calls, 68.7 s (mostly the two items above).
- The same checks run inside every step (each step checks its upstream units) and when a batch selects its tiles: a lane with 148 sealed tiles spends about 7.5 s per tile before it can say there is nothing to do.
- Worker steps of the 30 tiles: 3,582 s in total, meshes 1,664 s. For 355 s of the 964 s between the first and the last step only one or two tiles were running: the heaviest tiles sit late in census order (17_22 needs 640 s, 17_25 445 s, 17_21 296 s) and were started last.

## Hard constraints

- Frozen, never edit: `scripts/native_assets.py`, `scripts/native_assets_lib/**`, `scripts/native_catalog/**`, `scripts/native_effect_bundle.py`, `scripts/native_audio.py`, `scripts/native_animation_families.py`, `scripts/reference_client_guard.py`, `scripts/native_store/store_paths.py`. Pinned, never edit: `scripts/native_actor_profiles.py`, `scripts/world/mover_class_defaults.py`.
- No fingerprint, config, algorithm version, seal check result, refusal message, row or output byte changes. No unit is resealed by this change.
- AGENTS.md code rules: no comments, full-word names, no dead code, no retries, no sleeps, no polling loops, no speculative options.
- `convert_tile_batch.py --eligible --limit N [--workers W]` keeps its arguments and its summary shape.

## Locked decisions

1. **A sealed receipt is verified once per process and file identity.** `UnitLedger.sealed_receipt` keeps its verified answer in one process-wide map keyed by the resolved step directory and by the file identity (device, inode, size, modification time in nanoseconds; the helper `lock_file_identity` or one like it) of the seal record AND of the receipt record. A call whose identities match the kept entry returns the kept receipt without reading the files or checking the outputs again. Any other state runs the present check in full: a missing seal returns None as today and keeps nothing; a mismatch raises the present error and keeps nothing. Callers must not be able to change the kept answer through the returned object (return a copy, or parse kept bytes again; choose by measurement and say which). `UnitLedger.begin` and `seal` need no special case when the key holds the file identities, but the tests below must prove it.
   - What this gives up, and why it is accepted: a sealed output that is deleted or resized by something else while the process runs is noticed by the next process, not by the same one. Store outputs are immutable, unit folders have one writer per unit, and quick task 261112-i80 took the same rule for item units ("each sealed unit is checked once per process").
2. **The reference client lock is parsed once per process.** The world callers that call `reference_client_guard.read_reference_client_lock` on every call (`read_map_lock_record`, `seam_neighbour_inputs`, and any other in `scripts/world` that the batch or a step reaches more than once per process; grep and list them) use the per-process parsed lock by file identity. One owner for that helper: keep `process_reference_client_lock` where it is or move it, but do not add a second cache. Callers that mutate the returned lock object must not exist; check.
3. **Other repeated readers found on the way.** `seam_neighbour_inputs` also reads and validates the tile census (`select_eligible_tiles(read_tile_census(project_root))`) on every call. If a profile of the inspection after decisions 1 and 2 shows a reader above about 5 percent of the remaining time that is read-only and keyed by a file, give it the same per-process file-identity treatment through one shared helper (not a copy per module). Name each one in the summary with its measured share. Do not touch anything below that share.
4. **Heavy tiles first in the pool.** With more than one worker, `TileStepWorkers.outcomes` submits the tasks of a phase to the pool in descending order of an expected cost and still yields the outcomes in the order of the task list, so manifests, rows, preflights and the reported stop keep their tile order. The expected cost of a tile is the byte size of its map file in the reference client lock (the lock record of `tile_map_path(tile_id)`); ties keep tile order. The coordinator passes the cost with each task or as a mapping; workers do not compute it. With one worker nothing changes: tasks run in task order in the coordinator.
   - The stop rule keeps its text: a tile at a position after the first stopped position does not start or ends before its next step; the batch reports the stop of the first stopped tile in tile order. With cost order a tile at an earlier position can still be waiting when a later one stops; it then runs, as an earlier tile does today.
5. **Not in scope:** pooling the seal inspection itself (measure it again after decisions 1 to 3; the orchestrator decides), a mesh-level pool, any change to what a seal check verifies on its first call, the actors batches' own bookkeeping.

## Rulings of the orchestrator on the plan (2026-11-13, these win over the text above)

The planner listed six points under "Decisions the orchestrator must revisit". All six are accepted as the plan states them:

1. Decision 1 uses a new `file_identity` with device, inode, size and modification time. `lock_file_identity` of the frozen guard stays as it is and keeps serving the lock of decision 2.
2. The key of a kept receipt is the step directory together with the unit key.
3. The same-fingerprint reseal test removes the step directory first, as the present refusal tells a person to do.
4. The share rule of decision 3 is applied to the profile of the two sealed tiles of this checkout. Next to each measured share the summary gives a projection for the 30-tile inspection: seconds per call times the call count in `C:/laragon/l2b-orchestration/pipeline-speed/results/tile-seal-inspection-profile.json`. The real 30-tile profile is the orchestrator's proof.
5. The cost is the map file byte size (`eBytes`), also for phase A. It is a ranking that puts the three measured heavy tiles into the first six starts, not a prediction of their order.
6. The step directory is still resolved through the frozen path guard on every call. Accepted.

The four advisories of the plan checker are adopted:

- The threat register gets one accepted row: a ledger record rewritten in place with the same size within the clock tick of the kept identity. No production writer does that (`write_new_record` opens with `xb`).
- The counting wrap of the output check must run the real method with its instance (`autospec=True` with a side effect that calls the original, or a wrap of the path check filtered by the lane folder).
- `tests/pipeline/test_convert_tile_batch.py` already has 417 lines. New tests of task 3 go into a new test file; shared helpers move to `tests/pipeline/support` instead of being copied.
- `docs/BATCH_PIPELINE_SPEED.md` and `.planning/STATE.md` are committed at `fd2cd24` and stay the orchestrator's files.

## Tests the plan must require

- `sealed_receipt`: many calls on one sealed unit read the receipt file and check the outputs once (count through a patched reader or a counting path check); a second ledger object for the same lane and step shares the kept answer; after the unit is begun and sealed again (same fingerprint and a different one) the next call verifies again and returns the new receipt; after the seal file or the receipt file is replaced by a file with other content the next call verifies again (and raises the present mismatch error where today's code raises it); a missing seal returns None every time; a caller that changes the returned receipt does not change what the next caller gets; two different step directories do not share an answer.
- A child-interpreter test: process A keeps a receipt, process B reseals the unit, process A's next call returns the new receipt (file identity crosses processes).
- Lock parse: `read_map_lock_record` and `seam_neighbour_inputs` called many times parse the lock file once per process, and again after the file is replaced.
- Heavy first: with a synthetic step runner that records its start order (child interpreter, 2 workers, tasks that wait on a signal file as the existing worker tests do), the pool starts the costliest tasks first while outcomes, manifests, rows, preflights and the summary are identical to a run in task order; equal costs keep tile order; one worker runs in task order; a stop on the tile at the first position is the reported stop even when a costlier later tile stopped first.
- The existing pipeline tests keep passing. Baseline log of the lane at `478834f`: `C:/laragon/l2b-orchestration/autonomous-roadmap/pipeline-261112-vj5-gap-closure.log` (2,416 tests, two known errors: test_world_audio_step 20_20 ambient counts, test_world_bsp_step 20_20 brush nodes). Done means no test fails or errors that passed there.
- A before and after number from the executor, on a synthetic lane only: the count of receipt verifications and lock parses for one `tile_rows` pass over sealed synthetic tiles. The real-tile timing is the orchestrator's proof.

## Proof the orchestrator runs afterwards (not the executor)

On drive E:, first 30 eligible tiles into fresh world lane stores with `--workers 1` and `--workers 6`: byte comparison of every unit, store file and catalog record against the settled reference and between the two runs, the seal inspection profile again, and wall time, CPU time and peak memory. The executor converts no real tile.
