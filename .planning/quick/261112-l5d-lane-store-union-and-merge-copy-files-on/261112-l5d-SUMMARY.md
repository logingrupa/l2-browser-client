---
phase: 261112-l5d-lane-store-union-and-merge-copy-files-on
plan: 01
status: complete
tasks_completed: 3
tasks_total: 3
plan_head_before: 94f9598eaad7dd548dbfc63698216f2f9e2b0af2
plan_head_after: ccf784e2e2824248dff2867c71a8ca9a7e3fdb5f
actuals:
  tokens: 19000
  tasks: 3
  commits: 3
key-files:
  created:
    - scripts/native_store/store_file_copy.py
    - tests/pipeline/test_store_file_copy.py
    - tests/pipeline/test_lane_union_store_copy.py
  modified:
    - scripts/native_store/pinned_store_verification.py
    - scripts/native_store/write_lane_catalog.py
    - scripts/native_store/merge_lane_store.py
    - scripts/native_store/catalog_writer.py
    - tests/pipeline/test_bundle_member_pins.py
    - tests/pipeline/test_pinned_store_verification.py
    - tests/pipeline/test_merge_lane_store.py
    - tests/pipeline/test_skill_effect_store_pins.py
    - tests/pipeline/test_native_combat_audio.py
    - tests/pipeline/test_npc_batch_bookkeeping.py
---

# Quick task 261112-l5d: lane store union and merge copy files one at a time - summary

Status: complete. Tasks 1, 2 and 3 are committed on `lane/speed` (`bd6f44a`, `118662b`, `ccf784e`). The whole pipeline suite shows only the two baseline errors.

## Task 1: streamed copy module and the union on it, end to end

- Commit: `bd6f44a` on `lane/speed` (six files, 332 insertions, 63 deletions, no file deleted).
- Verify command of the plan: 125 tests, all pass, 30.9 s, exit 0 (`test_store_file_copy`, `test_lane_catalog_writer`, `test_pinned_store_verification`, `test_bundle_member_pins`, `test_lane_npc_profile_mesh_join`, `test_lane_coverage_refresh`, `test_native_combat_audio`, `test_merge_lane_store`).
- Extra targeted run: `test_store_file_copy`, `test_lane_union_catalog` and `test_skill_effect_store_pins`, 15 tests, all pass.
- Red step: `test_store_file_copy.py` failed first with `ImportError: cannot import name 'VerifiedStoreFile'`, before any implementation existed.
- `tests/pipeline/test_lane_catalog_writer.py` is unedited; its union test still reports 4 files written by the first union and 0 by the second with an unchanged tree snapshot.
- Free bytes of the temporary volume at run time: 9.86 GiB.

### What exists now

- `scripts/native_store/store_file_copy.py` (112 lines): `STORE_FILE_COPY_CHUNK_BYTES`, `StoreFileSource`, `add_store_file_source`, `missing_store_file_sources`, `require_free_bytes_for_missing_store_files`, `require_existing_destination_holds_expected_sha256`, `write_hashed_source_chunks`, `write_temporary_copy_of_expected_source`, `copy_source_to_absent_destination`, `copy_immutable_store_file`, `copy_store_files`. The only replace in the module is the `replace_file` of `catalog.json`.
- `scripts/native_store/pinned_store_verification.py` (83 lines): `VerifiedStoreFile(relative, sha256)`, `PINNED_STORE_VERIFICATION_WORKER_COUNT = 12`, and `verify_pinned_store_files` returns store file key to `VerifiedStoreFile`.
- `scripts/native_store/write_lane_catalog.py` (140 lines): no import of `add_store_file` or `verify_store_destinations`; the union collects `StoreFileSource` entries and publishes through `copy_store_files`; the plan check uses `missing_store_file_sources`; a lane without union lanes still calls `write_store` with an empty dict.
- `tests/pipeline/test_store_file_copy.py` (150 lines, 8 tests). `tests/pipeline/test_bundle_member_pins.py` stays at 426 lines. `scripts/native_store/catalog_writer.py` is untouched at 429 lines.

### New refusal messages

- `Store file source no longer has its expected SHA-256 <sha256>; copy stopped: <source path>`
- `Missing store files of <missing> bytes plus the floor of <floor> bytes exceed the <free> free bytes of the volume of <target root>; nothing was written`

### Deviations from the plan

1. Free-space guard runs only when at least one file has to be copied. The plan (Task 1 action B, D-06 as written) says "No special case when nothing is missing". The orchestrator notes carry an owner decision that refines decision 6: a call that copies no file is not refused for low free space, as today. `require_free_bytes_for_missing_store_files` returns before it reads the free bytes when no source is missing. Added test `test_a_copy_with_no_missing_file_is_not_refused_for_low_free_space_and_does_not_read_the_free_bytes` beside the guard tests. Consequences for the later tasks: the "named behaviour change" of the plan output section (a rerun with nothing to copy refused under 4 GiB) does not exist; a copy that only replaces `catalog.json` is not guarded either; the order test of Task 3 block A needs at least one missing file when it expects the free-space message.
2. `assert_every_walk_verifies` does not return the inline result. The plan asks for the return, but no caller reads it, and AGENTS.md forbids unused code. The four direct uses call `verify_pinned_store_files` themselves.
3. The step for one source is three functions, as the plan allows ("split further if needed"): `copy_immutable_store_file` (destination bound, existing destination rule), `copy_source_to_absent_destination` (temporary file, second look at the destination, `Path.rename`, read back) and `write_temporary_copy_of_expected_source` (chunks and the expected SHA-256 check). The names Task 3 patches are module globals and unchanged: `copy_immutable_store_file`, `write_hashed_source_chunks`, `require_free_bytes_for_missing_store_files`, `sha256_of_file`.
4. GSD bookkeeping: the plan start commit is recorded in the worktree git folder as `gsd-plan-head-before-quick-261112-l5d-01`. No drift sentinel file was written; the worktree root and the branch were checked by command before the commit instead.

### Recorded from the plan check

1. A pinned source that changes after the verification walk is now refused during the copy (`Store file source no longer has its expected SHA-256`), where the union read every source once.
2. An unreadable or vanished union source now raises during the copy or at the size read for the guard, not in a read loop before the first write.
3. A destination created by another writer during the copy is compared with the expected SHA-256 and kept or refused; it is never overwritten.
4. The two refusals that fire after files were renamed in (`Runtime copy hash differs`, `Catalog changed since it was read; preserved` before the replace) leave complete, hash-checked files that the catalog does not name. A refused copy can leave one empty destination folder, because the folder is created before the chunks are hashed; the file-only snapshot helper of the fixtures does not show it.
5. The unedited union and merge tests now need 4 GiB free on the temporary volume, because they run the copy with the real disk usage reader and copy at least one file.

### Not done in this task

- `scripts/native_store/merge_lane_store.py` still uses the collecting walk and `write_store`; `pinned_store_files` and its `deque` import are still in `scripts/native_store/catalog_writer.py` (Task 2).
- The refusal matrix, the write-time destination tests, the peak memory test, the union tests and the whole suite run are Task 3. The whole suite was not run.
- `scripts/world/convert_tile_batch.py` was not edited.

## Task 2: owner merge on the copy and deletion of the collecting walk

- Commit: `118662b` on `lane/speed` (six files, 80 insertions, 36 deletions, no file deleted).
- Verify command of the plan: 139 tests, all pass, 40.8 s, exit 0 (`test_merge_lane_store`, `test_lane_union_catalog`, `test_bundle_member_pins`, `test_pinned_store_verification`, `test_skill_effect_store_pins`, `test_native_combat_audio`, `test_lane_npc_profile_mesh_join`, `test_lane_catalog_writer`, `test_store_file_copy`, `test_npc_batch_bookkeeping`).
- Red step, `test_merge_lane_store.py` before the implementation: 23 tests, 1 failure and 3 errors. The changed source test failed with `LaneStoreMergeRefusedError not raised` (the merge still wrote from its payload dict). The call site, the archive changed and the free-space tests stopped at `patch.object` with `AttributeError`, because the merge module had no `verify_pinned_store_files` and no `copy_store_files` yet. The 19 existing tests passed.
- Every existing test of `tests/pipeline/test_merge_lane_store.py` and `tests/pipeline/test_lane_union_catalog.py` is unedited and passes, so `copiedFiles`, `unchangedFiles`, both catalog hashes and `addedRecordsBySlice` are unchanged on the fixtures.

### What exists now

- `scripts/native_store/merge_lane_store.py` (211 lines, was 198): no `import io`, no import of `pinned_store_files`, `verify_store_destinations` or `write_store`. `merge_verified_lane_store` runs `verify_pinned_store_files(lane_root, records_by_slice, PINNED_STORE_VERIFICATION_WORKER_COUNT)`, the unchanged join check, `require_version_two_lane_archives(lane_root, verified_store_file_by_key)`, builds the sources, takes `copiedFiles` from `missing_store_file_sources` and publishes with `copy_store_files`. The order of the refusals is catalog checks, pin walk, join check, archives, differing target file, then the copy.
- `require_version_two_lane_archives` checks each archive on its confined path: `verify_archive(archive_path)['sha256']` against the verified SHA-256, then `asset.json` through `zipfile.ZipFile(archive_path)`. No archive bytes are held past one check.
- `scripts/native_store/catalog_writer.py` is 413 lines (was 429): `pinned_store_files` and `from collections import deque` are deleted, nothing was added. `add_store_file`, `verify_store_destinations`, `read_pinned_file`, `require_one_sha256_per_store_file`, `pinned_file_child_references` and `catalog_pinned_file_references` stay.
- Whole-word search for `pinned_store_files` over the `.py` files of `scripts` and `tests`: no line (23 lines in 7 files before the plan). No file outside `.planning` names it. `scripts/native_store/merge_lane_store.py` holds no `io.`, no `write_store` and no `verify_store_destinations`.
- `tests/pipeline/test_merge_lane_store.py` (334 lines, 23 tests): four new tests, the call site test in `LaneStoreMergeTests` and the archive changed, changed source and free-space tests in `LaneStoreMergeRefusalTests`.
- `tests/pipeline/test_skill_effect_store_pins.py`, `tests/pipeline/test_native_combat_audio.py` and `tests/pipeline/test_npc_batch_bookkeeping.py` read relative paths and refusals from `verify_pinned_store_files` with `PINNED_STORE_VERIFICATION_WORKER_COUNT`. In `test_npc_batch_bookkeeping.py` only the import of the collecting walk (now two import lines) and the two call lines changed; both anchored patterns, both test names and the fixture are as they were, and its 13 tests pass.

### Deviations from the plan

1. The loop that builds the sources is its own function, `verified_lane_store_file_sources(lane_store_root, verified_store_file_by_key)`, called from `merge_verified_lane_store`. The plan describes the loop inside `merge_verified_lane_store`. Reason: one job per function (AGENTS.md); the calls, their order and their arguments are the ones the plan names.
2. Red step wording: the plan expects "the three refusal tests fail for the right reason". Two of them (archive changed, free-space guard) and the call site test stopped at `patch.object` with `AttributeError` rather than at an assertion, because the names they patch did not exist in the merge module before the implementation. That is the missing behaviour itself, so no test was changed to force an assertion failure.
3. Free-space test of the merge follows the owner refinement of decision 6: the fixture has two missing files, so the guard reads the driven reader and refuses. No test for a merge with nothing to copy was added here; that case is covered at the copy by the Task 1 test.
4. GSD bookkeeping: no drift sentinel file was written; the worktree root, the branch and the staged file list were checked by command before the commit. `STATE.md` and `ROADMAP.md` were not touched.

### Recorded from the plan check, as it applies to the merge

1. A pinned lane file that changes after the verification walk is now refused during the copy with `Store file source no longer has its expected SHA-256`, where the merge wrote the payload it had verified. Test: `test_a_lane_file_that_changes_after_the_archive_check_is_refused_by_the_copy_and_leaves_no_file`.
2. A lane file that becomes unreadable or vanishes after the walk now raises at the size read for the guard or during the copy, not in the walk's read before the first write. `main` reports an `OSError` as `Lane store merge refused`.
3. A destination that another writer creates during the copy is compared with the expected SHA-256 and kept or refused; it is never overwritten.
4. `Runtime copy hash differs` and `Catalog changed since it was read; preserved` before the replace fire after files were renamed in and leave complete, hash-checked files that the catalog does not name. A refused copy can leave one empty destination folder in the target; the file-only snapshot helper of the merge tests does not show it.
5. The unedited merge tests now need 4 GiB free on the temporary volume, because they run the copy with the real disk usage reader and copy at least one file.
6. `lane archive changed while it was read` now compares the archive on disk with the SHA-256 the walk verified, not with a payload held in memory. An archive that changes between the walk and the archive check is refused there; one that changes after the archive check is refused by the copy (point 1).

### Not done in this task

- The refusal matrix, the write-time destination tests, the peak memory test, the union tests of `tests/pipeline/test_lane_union_store_copy.py` and the whole suite run are Task 3. The whole suite was not run.
- No tracked file outside the six files of this task was modified. The untracked folders under `.planning/quick` were left as they are.

## Task 3: refusal matrix, peak memory and union tests of the copy, then the whole suite

- Commit: `ccf784e` on `lane/speed` (two test files, 292 insertions, 2 deletions, no file deleted). No production file changed: every new test passed against the code of Tasks 1 and 2, so no defect was found in `store_file_copy.py`, `write_lane_catalog.py` or `merge_lane_store.py`.
- Targeted verify command of the plan (12 files): 168 tests, all pass, 45.5 s, exit 0.
- The two new files alone: 27 tests, all pass, 2.4 s (`test_store_file_copy` 20 tests, `test_lane_union_store_copy` 7 tests). No test was skipped; the junction test ran.
- Whole suite, once, after the commit: `python -B scripts/test_pipeline.py` through `run_below_normal.py`, log `C:/laragon/l2b-orchestration/autonomous-roadmap/pipeline-261112-l5d.log`. `Ran 2273 tests in 343.844s`, `FAILED (errors=2, skipped=67)`, suite exit status 1. No `FAIL: ` line. The `ERROR: ` lines are exactly the two baseline errors:
  - `ERROR: test_the_20_20_ambient_counts_equal_the_staged_ambience (test_world_audio_step.RealClientAudioTests...)`
  - `ERROR: test_the_generic_20_20_step_holds_the_brush397_and_brush610_nodes_at_their_native_positions (test_world_bsp_step.OracleBrushSubsetTests...)`
  The judging part of the second verify command counts 0 other lines, so the pass rule holds. Before the run no other `scripts/test_pipeline.py` process was on the machine (checked by command line).
- Free bytes of the temporary volume at run time: 10.0 GiB.

### Tests added

`tests/pipeline/test_store_file_copy.py` (335 lines, 20 tests, 12 new), class `StoreFileCopyTests`:

- Same refusal as `write_store`, with equal message text apart from the store root and an unchanged target snapshot: existing destination with other bytes (`Existing immutable store file differs; preserved: <destination>`), catalog changed before the first write (`Catalog changed since it was read; preserved`), catalog over the patched byte cap (`Store catalog of N bytes exceeds N-1 bytes; preserved: <catalog path>`); with the cap at `len(after)` the copy writes 3 files.
- Catalog changed while files were copied: refused with `Catalog changed since it was read; preserved`, `catalog.json` keeps the other writer's bytes.
- Read back differs: `Runtime copy hash differs: <destination>`, no catalog, no `.tmp` file.
- Write-time rule of `immutable_write`, destination created after the destination check and destination changed after the check found it identical (two tests): full message `Existing immutable runtime asset is corrupt; preserved: <destination>`, the other writer's bytes are kept, the second destination does not exist, no catalog, no `.tmp` file, and `catalog_writer.immutable_write` refuses the same state with the same text.
- Destination created while its source is copied (two tests): with other bytes the same full message, the other writer's bytes kept, no catalog, no `.tmp` file; with identical bytes and a fixed past modification time the copy returns `filesWritten` 2 and the destination keeps that modification time. Both assert that the chunk step ran once, for the missing source.
- Order: destination message, catalog changed message, cap message, free-space message, then the write; the snapshot is unchanged after each refusal.
- Store root below a junction: `StorePathError`, the junction target keeps what it held.
- Peak memory: a source of 8 chunks (8 MiB) with `tracemalloc`; the traced peak is below the file size. Measured once outside the suite: 2,119,174 bytes peak for 8,388,608 bytes copied.

`tests/pipeline/test_lane_union_store_copy.py` (105 lines, 7 tests), class `LaneUnionStoreCopyTests(ProfileBundleProjectTestCase)`:

- The union hashes exactly one path under the actors store, the unpinned receipt, and every file of the actors store except `catalog.json` and `coverage.json` lies in the integration store with equal bytes.
- A bundle manifest rewritten after the join check of the actors lane is refused with `Store file source no longer has its expected SHA-256 <manifest sha256>` and no file lies under the integration store.
- A manifest path that the actors lane pins and the world lane holds unpinned with other bytes is refused with `Conflicting store file paths: <manifest relative>`; the integration store does not exist.
- Free-space guard through the union with a driven reader (`free` equal to the floor): `nothing was written`, the reader was read once, the integration store does not exist.
- A union rerun with no file to copy and a reader of 0 free bytes returns `filesWritten` 0, does not read the free bytes and leaves the project snapshot unchanged (owner refinement of decision 6).
- A differing receipt in the target lane is refused by the plan check and by the union with `Existing immutable store file differs; preserved`; the project snapshot is unchanged after each.
- A lane without union lanes never calls the copy and calls `write_store` once with an empty file dict.

### Deviations from the plan

1. Order test fixture. The plan lists the four conditions with `after` as the empty catalog. With the byte cap patched under `len(after)`, a catalog of another writer that is longer than the cap is refused by `read_current_catalog_bytes` (`Store catalog exceeds N bytes`) inside `require_catalog_unchanged`, before the changed-catalog comparison; `write_store` does the same, so it is not a defect of the copy. The order test therefore uses the pinned catalog as `after`, the shorter empty catalog as the other writer's bytes on disk, and the cap at `len(after) - 1`. The four refusals and their order are as the plan states.
2. Order test and the free-space message: one file is missing when the free-space refusal is expected (both, after the differing destination was removed), as Task 1 deviation 1 requires.
3. One union test more than the plan lists: the union rerun with no file to copy (orchestrator note on the owner refinement of decision 6). The same case at the copy is the Task 1 test `test_a_copy_with_no_missing_file_is_not_refused_for_low_free_space_and_does_not_read_the_free_bytes`.
4. The "destination created or changed after the destination check" block is two test methods over one shared assertion helper, not one test with two cases, because each case needs its own target tree.
5. Suite log path: `pipeline-261112-l5d.log`, as the orchestrator constraint names it, not `261112-l5d-suite-run.log` of the plan. The judging expression of the plan was applied to that log unchanged.
6. GSD bookkeeping: no drift sentinel file was written; the worktree root, the attached branch and the staged file list were checked by command before the commit. `STATE.md` and `ROADMAP.md` were not touched, and no docs artifact was committed.

## Plan output record

- Final line counts: `scripts/native_store/catalog_writer.py` 413 (was 429), `scripts/native_store/store_file_copy.py` 112, `tests/pipeline/test_store_file_copy.py` 335, `tests/pipeline/test_bundle_member_pins.py` 426, `tests/pipeline/test_lane_union_store_copy.py` 105.
- New refusal messages: `Store file source no longer has its expected SHA-256 <sha256>; copy stopped: <source path>` and `Missing store files of <missing> bytes plus the floor of <floor> bytes exceed the <free> free bytes of the volume of <target root>; nothing was written`.
- The copy keeps the write-time refusal `Existing immutable runtime asset is corrupt; preserved: <path>` of the write loop of `write_store` and replaces no existing destination: an existing destination is hashed and kept or refused, a missing one is renamed in with `Path.rename`, and the only replace in the module is the `replace_file` of `catalog.json`.
- Named behaviour change of the plan output block, not present: the plan expected a rerun of the union or the merge with nothing to copy to be refused with `nothing was written` under 4 GiB free. The owner decision in the orchestrator notes refines decision 6: the guard runs only when at least one file has to be copied. A rerun with nothing to copy returns `filesWritten` 0 as before and does not read the free bytes (tests at the copy and at the union). A copy that only replaces `catalog.json` is not guarded either.
- The union and merge tests that copy at least one file need the 4 GiB floor on the temporary volume, because they use the real disk usage reader (`shutil.disk_usage`). This includes the unedited tests of `test_lane_catalog_writer.py`, `test_lane_union_catalog.py`, `test_merge_lane_store.py` and `test_bundle_member_pins.py`.
- Atomicity compared with the union before this plan:
  1. A pinned source that changes after the verification walk is now refused during the copy; before, every source was read once and that read was written.
  2. Sources are read during the copy, so an unreadable or vanished union source raises during the copy or at the size read for the guard, after earlier files may have been copied; before, every source was read in a loop before the first write.
  3. A destination created by another writer during the copy is compared with the expected SHA-256 and kept or refused; it is never overwritten.
  4. The two refusals that fire after files were renamed in (`Runtime copy hash differs`, `Catalog changed since it was read; preserved` before the replace) and a changed or unreadable later source leave complete, hash-checked files that the catalog does not name; the next run counts them as unchanged. `write_store` behaves the same way for its two late refusals.
  5. A temporary file is removed on every path that does not rename it, also on a write error. A refused copy of a file whose destination folder did not exist yet leaves that folder in the target, empty, because the folder is created before the chunks are hashed; the file-only snapshot helper of the fixtures does not show it. A process kill in the middle of a file leaves one `.tmp` file, as `replace_file` does today.
- Whole suite log: 2273 tests, 67 skipped, 2 errors, both baseline (`test_world_audio_step` 20_20 ambient counts, `test_world_bsp_step` 20_20 brush nodes), no `FAIL: ` line.
- Not edited: `scripts/world/convert_tile_batch.py`, `scripts/native_store/unit_ledger.py`, `scripts/native_store/print_lane_union_catalog.py`, `tests/pipeline/test_lane_catalog_writer.py`, `tests/pipeline/test_lane_union_catalog.py`, every frozen file of rule G6 and everything under `scripts/actors/`. The diff of the three commits touches the 13 files of `files_modified` only (702 insertions, 99 deletions).
- Actuals: 3 commits measured with `git rev-list --count 94f9598..HEAD`; the diff of `scripts` and `tests` is 76,290 characters, about 19,000 tokens at 4 characters per token.
- Process cleanup: after the suite no python process started by these runs was left. The one python process whose command line holds `l2b-speed` is the orchestrator's workflow journal watcher, which these runs did not start.

## Self-check: passed

- Found: `tests/pipeline/test_store_file_copy.py`, `tests/pipeline/test_lane_union_store_copy.py`, `scripts/native_store/store_file_copy.py`.
- Found on `lane/speed`: `bd6f44a`, `118662b`, `ccf784e`.
- `git status --short -- scripts tests` prints nothing after the commit.
