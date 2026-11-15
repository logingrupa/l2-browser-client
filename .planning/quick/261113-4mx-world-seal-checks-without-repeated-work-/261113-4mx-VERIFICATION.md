---
phase: 261113-4mx-world-seal-checks-without-repeated-work-
verified: 2026-11-13T10:39:44Z
status: passed
score: 9/9 must-haves verified
covered_files:
  - .planning/quick/261113-4mx-world-seal-checks-without-repeated-work-/261113-4mx-PLAN.md
  - .planning/quick/261113-4mx-world-seal-checks-without-repeated-work-/261113-4mx-SUMMARY.md
  - scripts/native_store/file_identity.py
  - scripts/native_store/unit_ledger.py
  - scripts/world/convert_tile_batch.py
  - scripts/world/environment_program.py
  - scripts/world/minimap_sources.py
  - scripts/world/raw_map_step.py
  - scripts/world/terrain_seam_strip.py
  - scripts/world/tile_step_workers.py
  - tests/pipeline/support/tile_step_worker_runs.py
  - tests/pipeline/test_convert_tile_batch.py
  - tests/pipeline/test_sealed_receipt_reuse.py
  - tests/pipeline/test_world_seal_inspection_reuse.py
  - tests/pipeline/test_world_tile_batch_cost_order.py
  - tests/pipeline/test_world_tile_batch_phases.py
  - tests/pipeline/test_world_tile_batch_worker_processes.py
covered_digest: "v4:sha256:508a988dbd44d5e72c4232e7d439a58dafab51d6f84c4e8a08bd9c89c4622398"
behavior_unverified: 0
overrides_applied: 0
---

# Quick task 261113-4mx: world seal checks without repeated work, and heavy tiles first - verification report

**Task goal:** the world tile batch stops checking the same sealed unit and parsing the same reference client lock many times per process, and a pooled batch starts its costliest tiles first, with no output byte, fingerprint, receipt, row or refusal message changed.
**Verified:** 2026-11-13T10:39:44Z
**Status:** passed, with three warnings for the orchestrator (no code gap)
**Re-verification:** no, first verification
**Commits checked:** f5397d6, b9c683c, d93fc1c on `lane/speed`, base fd2cd24

## Goal achievement

### Must-have truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Many `sealed_receipt` and `is_sealed` calls on one sealed unit read the seal and check the outputs once, also through a second ledger object (D-01) | VERIFIED | `unit_ledger.py:259-272`. `test_many_calls_on_one_sealed_unit_read_the_seal_and_check_the_outputs_once` and `test_a_second_ledger_object_of_the_same_lane_and_step_shares_the_kept_answer` pass in my gate 1 run. The output check is counted with `autospec=True` and the real method as side effect, as ruled. |
| 2 | Another file identity of the seal or receipt record runs the full check: reseal gives the new receipt, also from another process; a replaced record raises the mismatch error; a missing seal gives None every time; nothing is kept after None or an error; `begin` and `seal` hold no line about kept answers (D-01) | VERIFIED | Both identities are taken before any read (`unit_ledger.py:261`), the entry is popped before the check (`:266`), kept only when neither identity is None (`:270`). The map name occurs on lines 127, 263, 266 and 271 only. Seven tests of `test_sealed_receipt_reuse.py` pass, the child-interpreter reseal among them. My probes: 26 fresh answers, see adversarial points 1 and 2. |
| 3 | A caller that changes a returned receipt does not change the next answer; two step directories, and two unit keys of one step directory, do not share an answer (D-01) | VERIFIED | Every return is a new `json.loads` of bytes (`:265`, `:272`); the key is `(str(step_directory), unit_key)` (`:262`). Three tests pass; probes S7 and S9. |
| 4 | The five world lock readers parse the lock once per process and again after the file is replaced, all through `process_reference_client_lock`; no world module names `read_reference_client_lock` (D-02) | VERIFIED | `raw_map_step.py:104`, `terrain_seam_strip.py:89`, `environment_program.py:123`, `minimap_sources.py:28` and `:34`. Grep over `scripts/world`: no match for `read_reference_client_lock`. Five tests of `LockParseReuseTests` pass. |
| 5 | One `tile_rows` pass over a synthetic lane with two sealed units reads each seal record once and parses the lock once; the summary holds the before counts (D-01, D-02) | VERIFIED | `TileRowsPassCountTests` passes with counts 2 and (1, 0, 1). I reproduced the before counts with a throwaway probe that puts the former behavior back by patching (no kept receipt; a fresh lock parse in the four world modules): 5 receipt verifications and 3 lock parses, as the summary states. |
| 6 | Every reader the decision 3 rule admits goes through one shared helper, every reader below the share is untouched, and the summary names each candidate with its measured share (D-03) | VERIFIED, with warning W3 | No helper was added (`file_identity.py` holds `file_identity` only), no reader below the share was changed (diff of `scripts/world` holds only the five lock reader lines, `locked_tile_map_bytes` and the cost order). The profile log exists (12:07:40, 2 tiles, 8.2781 s) and every number of the summary table equals the log. One row is missing from the table, see W3. |
| 7 | With a pool the tasks of a phase are submitted in descending expected cost, equal costs in task order, outcomes in task order; one worker unchanged; rows, attempted tiles, preflights and summary of a two-worker run equal the one-worker run (D-04) | VERIFIED | `tile_step_workers.py:141-153`; the one-worker branch (`:149-150`) is the code of fd2cd24. Eight in-process tests and `HeavyTilesFirstWorkerProcessTests` (three child-interpreter tests) pass in my gate 3 run. My fuzz of 3,000 task lists found no problem. |
| 8 | The expected cost of a tile is the `eBytes` of the lock record of its map, read in the coordinator; the stop of the first tile is the reported stop when a costlier later tile stopped first (D-04) | VERIFIED | `raw_map_step.py:115-119`, `convert_tile_batch.py:186` (coordinator, once, for the tiles of `seam_inputs`). `test_the_stop_of_the_first_tile_is_reported_when_a_costlier_later_tile_stopped_first` and the two `LockedTileMapBytesTests` pass. In the committed lock all 148 eligible tiles hold an int `eBytes`, 148 distinct values; the first 30 tiles by `eBytes` start 16_12, 18_10, 17_21, 17_20, 17_22, 17_25. |
| 9 | No seal inspection pool, no mesh pool, no change to what a first seal check verifies, no frozen or pinned file changed; the whole suite shows no FAIL or ERROR other than the two baseline errors (D-05) | VERIFIED, with warning W1 | `git diff --name-only fd2cd24 HEAD` over the ten frozen and pinned paths prints nothing. `verified_receipt_bytes` is the former body with `return receipt_bytes` as its only changed line. Suite log: 2,447 tests, `FAILED (errors=2, skipped=66)`, no `FAIL: ` line, the two `ERROR: ` lines are the two baseline errors by name; the plan's verdict command exits 0 on it. Baseline: 2,416 tests, the same two errors, 66 skipped. 2,447 - 2,416 = 31 = 13 + 7 + 8 + 3 new tests. |

**Score:** 9/9 truths verified (0 present but behavior-unverified)

### Required artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/native_store/file_identity.py` | `def file_identity` | VERIFIED | 9 lines, imported and called in `unit_ledger.py:16` and `:261` |
| `scripts/native_store/unit_ledger.py` | `verified_receipts_by_step_directory_and_unit_key` | VERIFIED | 363 lines, map and `VerifiedReceipt` used by `sealed_receipt` only |
| `scripts/world/tile_step_workers.py` | `expected_cost` | VERIFIED | last field of `TileStepsTask`, sort key at `:144`, `itertools` no longer imported |
| `tests/pipeline/test_sealed_receipt_reuse.py` | the decision 1 tests | VERIFIED | 13 tests, 280 lines, all pass |
| `tests/pipeline/test_world_seal_inspection_reuse.py` | lock parse tests and pass counts | VERIFIED | 7 tests, 172 lines, all pass |
| `tests/pipeline/test_world_tile_batch_cost_order.py` | in-process cost order tests | VERIFIED | 8 tests, 166 lines, all pass |

### Key links

| From | To | Via | Status |
|------|----|-----|--------|
| `unit_ledger.py` | `file_identity.py` | `file_identity(` on the seal and the receipt record before any read | WIRED |
| `raw_map_step.py`, `terrain_seam_strip.py`, `environment_program.py`, `minimap_sources.py` | `unit_ledger.py` | `process_reference_client_lock(` | WIRED (5 call sites) |
| `convert_tile_batch.py` | `tile_step_workers.py` | `expected_costs[tile_id]` on every `TileStepsTask` of both phases | WIRED |

### Gate commands, run by me through `run_below_normal.py` with a time limit

| Gate | Result | Exit |
|------|--------|------|
| Task 1 command (16 test files) | Ran 228 tests in 58.6 s, OK (skipped=1) | 0 |
| Task 2 command (11 test files) | Ran 150 tests in 24.9 s, OK (skipped=2) | 0 |
| Task 3 command 1 (6 test files) | Ran 99 tests in 69.5 s, OK (skipped=1) | 0 |
| Whole suite | not run, as instructed; judged from the log, see truth 9 and W1 | verdict command on the log: 0 |

Gate 1 has 228 tests against the executor's 222 because task 2 added six tests to one of its files afterwards.

## The seven adversarial points

All probes were throwaway scripts in a temporary folder outside the repository, on synthetic units, with `python -B`; the folder is deleted.

**1. One process: a kept answer although the disk says something else.** Found only in the two accepted cases.
- Fresh answer (26 probe cases): reseal with another fingerprint through the same and through a second ledger object; `begin` with another fingerprint before the seal (None, and `is_sealed` False); removed step directory, unit folder and work root (None); removed receipt record (mismatch error); seal record replaced by a rename over it (mismatch error); the step directories of two units swapped by rename (mismatch error for both, the right receipts after swapping back); receipt rewritten in place with another size (mismatch error); two lanes, two steps and two projects with equal folder names; the twin unit keys of one folder (test); 300 reseals with equal record sizes and the modification times set back with `os.utime`: 0 stale, 0 of 600 records kept their inode.
- Spellings of the work root: lower case, forward slashes, relative and the long-path prefix all gave the new receipt after a reseal through the canonical spelling. They produced 2 map keys for one unit (the long-path prefix survives `resolve`), each checked against the file identities on every call, so a second key costs one more verification and never a wrong answer. Upper case and a dotted path are refused by the unchanged constructor check.
- Stale, accepted: both records rewritten in place with the same sizes and their modification times set back (deliberate tamper, the accepted row of ruling advisory 1). Without the time set back: 0 of 200 in-place same-size rewrites went unnoticed.
- Kept, accepted by D-01: an output deleted or resized after the first check.

**2. Two processes.** A child interpreter that reseals with another fingerprint: the parent gets the child's receipt. A child that reseals with size-equal records and sets their times back: the parent still gets the new receipt (inode). A child that only begins the unit: the parent gets None. A child that deletes a sealed output: the parent keeps its answer, also through a second ledger object (D-01, stated by the test of the same name).

**3. An object through which a caller changes the next answer.** Receipt: no. Each call returns a new parse; the entry is a `NamedTuple` of a tuple and bytes; mutation of a first-call and of a kept-call receipt left the next answer unchanged. Lock: yes, by design. `read_map_lock_record` returns the kept lock's own record dict, and a change shows in the next call (probe: a changed `eSha256` and `eBytes` were served, and `locked_tile_map_bytes` then refused). Before this task every call had its own parse. No caller in `scripts` assigns into a lock record or the lock (grep), which is the check decision 2 asks for.

**4. Refusal messages and error types on the first call.** The source of `unit_ledger.py` at fd2cd24 was loaded as a second module and compared with HEAD over 21 disk states times 9 operations (`sealed_receipt`, `is_sealed` with the same and another fingerprint, `begin` with the same and another fingerprint, `sealed_receipts`, twin key, bad key), first call and two repeats: 189 pairs, same error type and same message in every one. Disk states: sealed, seal not JSON, seal a list, seal a folder, receipt missing, receipt a folder, receipt changed, receipt a list, receipt not JSON, receipt empty, seal naming another unit, step or fingerprint, output deleted, resized or a folder, output path not portable or outside the roots, receipt without outputs, outputs that are no records, step directory removed. Only difference, not on a first call and accepted by D-01: after a kept answer and a deleted or resized output, fd2cd24 raises `sealed output ... is missing or changed` from `is_sealed` and `begin`; HEAD returns True and `begin` raises `already sealed with this fingerprint; check is_sealed first`.

**5. The kept lock after the lock file changed; owners of the cache.** A lock of another size is parsed again. Same-size rewrites: 0 of 200 in place and 0 of 200 by truncate and write were served from the kept lock. A same-size rewrite with the modification time set back is served from the kept lock (T-4mx-04, accepted). A missing lock refuses every call with the missing-lock message, and so does a folder at the lock path. One owner: `reference_client_locks_by_path_and_identity` in `unit_ledger.py:98-106`, unchanged by this task. The only other call sites of `read_reference_client_lock` are the frozen guard's own access cache (from before), `coverage_denominators.py`, `side_by_side_check_records.py` and `generate_golden_fixtures.py`. Entries are never dropped: 405 lock rewrites left 405 entries in the probe process; no batch writes the lock.

**6. Cost order against task order.**
- Without a stop: no difference found. Tasks, results, `attemptedTiles`, preflights and manifests are all collected in task order (`convert_tile_batch.py:141`, `:160`, `:201`); the two-worker run equals the one-worker run in the child-interpreter test, and the manifests ran in the coordinator in tile order.
- Submitted twice or never: no. Fuzz of 3,000 task lists (0 to 9 tasks, tied costs, a pool that breaks at a random submit): every task submitted at most once, in stable descending cost; a task has no future only after the pool broke and then gets the worker-died outcome at its own position; equal costs give the task order of fd2cd24.
- With a stop: the reported stop follows the unchanged rule (first stopped tile in task order). Which later tiles were attempted, and how many steps they sealed before the stop, can differ from a pool in task order, because costlier later tiles start first. D-04 states this, and the stop test asserts all three tiles attempted with pass rows for raw and chunks.
- One worker: the `outcomes` branch is unchanged and runs lazily in task order. One difference before any step: the costs are read in the coordinator, so a lock record whose `eBytes` is no whole number now ends the batch with `Tile batch failed: reference client lock holds no whole byte size ...`; the guard does not validate that field. Named in the summary; all 148 eligible tiles hold an int.

**7. Actors and data batches.** Same code path, no caller-specific branch. Differences other than fewer repeated checks: (a) the D-01 trade of point 4; (b) a first call does two `os.stat` calls and a second `json.loads` more than before; (c) the process keeps the receipt bytes of every unit it verified (this checkout: data-ui 787 receipts, 1.46 MB; world 29 receipts, 0.38 MB, largest 109 KB). No caller depends on a repeated output check: outside `UnitLedger.begin` no `rmtree` or `unlink` in `scripts/actors`, `scripts/data`, `scripts/world` or `scripts/native_store` touches a unit folder, and the two refusal texts are matched only in tests. The item, npc, actor sound, tables and ui texture test files of gate 1 pass.

## Other checks

| Check | Result |
|-------|--------|
| Frozen or pinned file edited | none |
| Files changed by the three commits | 15, all in `files_modified`; none outside |
| Comments or docstrings in the 15 files (tokenizer, whole file) | none |
| Unused imports, top-level names, methods (AST over the 15 files, usage searched in `scripts` and `tests`) | none; `itertools` and `NO_REFUSAL` are gone, `wait_until_an_earlier_tile_has_stopped` is renamed everywhere |
| Debt markers, sleeps or retries added | none (the gate poll loop of the support module is from before) |
| Commit messages | prefix `feat(261113-4mx): `, no attribution line |
| `docs/BATCH_PIPELINE_SPEED.md`, `.planning/STATE.md` | not touched by the commits |
| File sizes | all under 400 lines except `tests/pipeline/test_convert_tile_batch.py`, see W2 |
| Leftover processes | no python or ffmpeg process with `l2b-speed` or the probe folder in its command line; nothing of other work was stopped |

## Warnings for the orchestrator (no code change needed to meet the must-haves)

- **W1, suite log time.** The log ended at 12:25:58, 24 seconds before the commit time of d93fc1c (12:26:22), so by the clock it is not newer than the last code commit. It does cover the committed code: the last write to any of the 15 files was 12:16:13, the 482.7 s run began about 12:17:55, `git status -- scripts tests` is clean, and the test count grew by exactly the 31 tests of HEAD. The plan orders the suite before the commit.
- **W2, file size.** `tests/pipeline/test_convert_tile_batch.py` went from 417 to 425 lines with no split. It holds no new test; the eight lines are `SYNTHETIC_EXPECTED_COST`, `synthetic_expected_cost`, the `run_batch` argument and two patches, all named by the plan. Reason given by the summary (deviation 6): "through the edits the plan names; no new test went into it".
- **W3, decision 3 table.** `native_assets.hash_file` (2,860 calls, 0.883 s, 10.67 percent, 0.31 ms per call) is at the share, only reads and depends on one file, and the summary neither names it nor is its sentence "none reads the bytes of one file only" true for it. The outcome stands: the function and its only caller here, `implementation_hash` (52 calls times 55 files = 2,860), live in the frozen `native_assets.py`, so it cannot be routed through a helper, and its time is inside the `implementation_hash` row the summary does give.

## Notes

- The two costs the summary hands to the orchestrator are confirmed by the log: `implementation_hash` 20.47 percent (callers `bsp_step.py:60`, `minimap_step.py:57`, `mover_step.py:69`, `static_mesh_step.py:95`) and `pinned_music_encoder` 11.0 percent (10.58 in the frozen `encoder_identity`).
- The summary's projection departs from ruling 4 for a stated reason, which I confirmed: the 30-tile file holds 14 hot rows and none of the candidates.
- T-4mx-04 says the lock identity risk is "as before this plan". That holds for `locked_input_records`; for the five world readers it is new, since they parsed the file on every call before.
- The accepted row of ruling advisory 1 (a ledger record rewritten in place within one clock tick) is not in the threat register of PLAN.md. The plan file is the orchestrator's.
- Not verified here, by design of the plan: wall time, CPU time, peak memory and the byte comparison of real tiles on drive E:.

## Gaps summary

No gap. The three task commits deliver the goal in code, every must-have has a passing test that I ran, and the adversarial probes found no stale answer outside the two cases the decisions accept.

---

_Verified: 2026-11-13T10:39:44Z_
_Verifier: Claude (gsd-verifier)_
