---
phase: 261112-l5d-lane-store-union-and-merge-copy-files-on
verified: 2026-11-12T14:43:04Z
status: passed
score: 12/12 must-haves verified
covered_files:
  - .planning/quick/261112-l5d-lane-store-union-and-merge-copy-files-on/261112-l5d-PLAN.md
  - .planning/quick/261112-l5d-lane-store-union-and-merge-copy-files-on/261112-l5d-SUMMARY.md
  - scripts/native_store/catalog_writer.py
  - scripts/native_store/merge_lane_store.py
  - scripts/native_store/pinned_store_verification.py
  - scripts/native_store/store_file_copy.py
  - scripts/native_store/write_lane_catalog.py
  - tests/pipeline/test_bundle_member_pins.py
  - tests/pipeline/test_lane_union_store_copy.py
  - tests/pipeline/test_merge_lane_store.py
  - tests/pipeline/test_native_combat_audio.py
  - tests/pipeline/test_npc_batch_bookkeeping.py
  - tests/pipeline/test_pinned_store_verification.py
  - tests/pipeline/test_skill_effect_store_pins.py
  - tests/pipeline/test_store_file_copy.py
covered_digest: "v4:sha256:12daa0f41faf6aa13124bc66703e65ba6acc587165541cd2d9871f8b87bc3908"
behavior_unverified: 0
overrides_applied: 0
---

# Quick task 261112-l5d: lane store union and merge copy files one at a time - verification report

**Task goal:** Lane store union and merge copy files one at a time with a free-space guard
**Verified:** 2026-11-12T14:43:04Z
**Status:** passed
**Re-verification:** No - initial verification

Method: the code of the 13 changed files was read at HEAD `ccf784e`, the diff `94f9598..HEAD` was read in full, and the targeted test command of the plan was run by the verifier. The summary was treated as a list of claims; each claim used below was checked against the code, git or a test run.

## Goal achievement

### Observable truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The union collects one `StoreFileSource` per union lane file and publishes through `copy_store_files`; no payload, no import of `add_store_file` or `verify_store_destinations` (D-01, D-07) | VERIFIED | `scripts/native_store/write_lane_catalog.py:66-67` calls `add_store_file_source` per path of `union_lane_store_relative_paths`; `:115` publishes with `copy_store_files`. The `catalog_writer` import at `:13-14` holds neither removed name; no `read_bytes()` of a union file remains. Test `test_the_lane_catalog_verifies_the_target_lane_and_each_union_lane_without_collecting_payloads` asserts the module has no `add_store_file`. |
| 2 | `copy_store_files` raises every `write_store` refusal with the same condition, message and order, writes `catalog.json` last and only when changed, returns the same dict (D-02) | VERIFIED | `scripts/native_store/store_file_copy.py:99-112` has the order of `write_store` (`catalog_writer.py:402-413`): reparse check, destination check, catalog unchanged, byte cap, guard, write loop, catalog unchanged, `replace_file` when `after != before`. Tests in `tests/pipeline/test_store_file_copy.py`: parity with `write_store` on a twin target (return dict and tree), the three refusals before the first write compared text for text with `write_store`, catalog changed during the copy, read back differs, and the order test (destination, catalog changed, cap, free space, then write). All pass. |
| 3 | The write loop applies the write-time rule of `immutable_write` to every source; an existing destination is hashed, kept or refused, never replaced (D-02) | VERIFIED | `store_file_copy.py:106-107` runs `copy_immutable_store_file` for every source; `:91-96` hashes an existing destination and returns; `:81-84` looks again after the chunks and renames with `Path.rename`, not `replace`. The only `replace_file` call is the catalog at `:111`. Four tests pass: destination created after the check, destination changed after the check found it identical (both compared with `catalog_writer.immutable_write` text), destination created with other bytes while its source is copied, and with identical bytes kept with its fixed past modification time. |
| 4 | A missing file is copied in chunks while hashed; a changed source is refused, the temporary file removed, no later file written, catalog not replaced; peak memory below the file size for 8 chunks (D-03) | VERIFIED | `write_hashed_source_chunks` (`:58-64`) reads `STORE_FILE_COPY_CHUNK_BYTES` (1 MiB) per step; `:70-72` refuses a digest mismatch; the `finally` at `:85-86` removes the temporary file. Tests: `test_a_source_changed_after_its_sha256_was_taken_stops_the_copy_and_leaves_the_target_as_it_was` (exact message, whole target snapshot unchanged with the first of two sources changed) and `test_copying_a_file_of_eight_chunks_keeps_the_traced_peak_below_the_file_size` (tracemalloc). Both pass. |
| 5 | `verify_pinned_store_files` returns key to (relative as pinned, verified SHA-256); that SHA-256 is the expected SHA-256 of the copy; an unpinned union file is hashed once before the first write (D-04) | VERIFIED | `scripts/native_store/pinned_store_verification.py:15-17, :63, :83`. `add_store_file_source` (`store_file_copy.py:23-29`) takes the mapped SHA-256 or hashes the source. Tests: hash call count 0 with a mapping and 1 without; the union test finds exactly one hashed path under the actors store, the unpinned receipt; the walk tests assert key, relative and SHA-256 per entry and inline against pooled parity. |
| 6 | Two union lanes with one relative path and different bytes are refused with `Conflicting store file paths: <relative>` before the first write, also pinned against unpinned (D-05) | VERIFIED | `store_file_copy.py:27-29`, raised inside `merge_union_lane` before any copy. Tests: kept once and conflict (other bytes, other spelling) at the copy; `test_a_path_one_union_lane_pins_and_another_holds_unpinned_with_other_bytes_is_refused_before_the_first_write` (integration store does not exist afterwards); the unedited two-lane conflict test of `test_lane_catalog_writer.py`. |
| 7 | The free-space guard refuses before the first write, names the three numbers and says nothing was written; one more free byte lets the call write (D-06) | VERIFIED | `store_file_copy.py:43-50`, called at `:105` before the write loop. Boundary test with the exact message and `free + 1` writing 2 files; nearest existing ancestor test; wiring tests at the union and the merge. Owner refinement of decision 6 is in the code (`:44-45`, return when nothing is missing) and has its test next to the guard tests, `test_a_copy_with_no_missing_file_is_not_refused_for_low_free_space_and_does_not_read_the_free_bytes`, plus the union rerun test. |
| 8 | A lane without union lanes still publishes through `write_store` with no files; the plan check uses `missing_store_file_sources` (D-07) | VERIFIED | `write_lane_catalog.py:110, :114-117`. `scripts/world/convert_tile_batch.py:214` is unedited and still calls `write_lane_catalog(project_root, WORLD_LANE_NAME, [], plan_only=False)`. Tests: lane without union calls `write_store` once with `{}` and never the copy; differing target file refused by the plan check and by the union. |
| 9 | The merge verifies with `verify_pinned_store_files` and the one worker count constant (12), checks archives from disk and publishes through `copy_store_files`; result dict and refusal messages unchanged on the fixtures (D-08) | VERIFIED | `scripts/native_store/merge_lane_store.py:169-177`, `:130-141` (`verify_archive(archive_path)` then `zipfile.ZipFile(archive_path)`). The constant is defined once, `pinned_store_verification.py:12`, and imported by both commands. `tests/pipeline/test_merge_lane_store.py` has 42 added lines and 0 deleted, so the 19 older tests are unedited; all 23 pass, among them the call site test, archive changed after the walk, source changed after the archive check, and the floor-only free space test. |
| 10 | The collecting walk and its `deque` import are deleted; no import or call under scripts or tests in the deleting commit; tests moved in the stated commits; parity helpers compare inline and pooled (D-09) | VERIFIED | Whole-word search for `pinned_store_files` over the `.py` files of the worktree: no match. `git grep -w` on `118662b` over `scripts tests`: no line. On `bd6f44a` the name is left only in `catalog_writer.py`, `merge_lane_store.py`, `test_native_combat_audio.py`, `test_npc_batch_bookkeeping.py` and `test_skill_effect_store_pins.py`, so the two walk test files moved one commit earlier, as the truth states. `catalog_writer.py` diff: 0 added, 16 deleted (the function and `from collections import deque`). `IN_PROCESS_WALKS` and the old dict name are gone. |
| 11 | The unedited union, plan and merge tests pass with their byte and tree assertions as they are | VERIFIED | `tests/pipeline/test_lane_catalog_writer.py` and `tests/pipeline/test_lane_union_catalog.py` are not in `git diff --stat 94f9598 HEAD`; `test_merge_lane_store.py` has additions only. All three ran in the verifier's targeted run: 168 tests, OK. |
| 12 | The whole pipeline suite shows no FAIL line and no ERROR line other than the two baseline errors | VERIFIED | Judged from `C:/laragon/l2b-orchestration/autonomous-roadmap/pipeline-261112-l5d.log`, modified 2026-11-12 16:36:40 +0200, after the last task commit `ccf784e` (16:30:28 +0200). `Ran 2273 tests in 343.844s`, `FAILED (errors=2, skipped=67)`, no line starting with `FAIL: `, and exactly two `ERROR: ` lines: `test_world_audio_step` 20_20 ambient counts and `test_world_bsp_step` 20_20 brush nodes. The skipped count equals the baseline (67); the 20 tests of `test_store_file_copy` and the 7 of `test_lane_union_store_copy` are in the log with `ok`. The verifier did not run the whole suite. |

**Score:** 12/12 truths verified (0 present, behavior-unverified)

### Required artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/native_store/store_file_copy.py` | Copy module with `StoreFileSource`, `add_store_file_source`, `missing_store_file_sources`, `copy_store_files`, `STORE_FILE_COPY_CHUNK_BYTES` | VERIFIED | 112 lines, all five names defined, imported and called by both commands |
| `scripts/native_store/pinned_store_verification.py` | Walk reports relative and SHA-256; owner of the worker count | VERIFIED | Holds `PINNED_STORE_VERIFICATION_WORKER_COUNT = 12`; no other definition in `scripts` |
| `scripts/native_store/write_lane_catalog.py` | Union collects paths and publishes through the copy | VERIFIED | Holds `copy_store_files(` at line 115 |
| `scripts/native_store/merge_lane_store.py` | Merge without payloads, archives from disk, publishes through the copy | VERIFIED | Holds `copy_store_files(` at line 177; no `import io`, no `write_store`, no `verify_store_destinations` |
| `tests/pipeline/test_store_file_copy.py` | Contract tests of the copy, at least 180 lines | VERIFIED | 335 lines, 20 tests, all pass |
| `tests/pipeline/test_lane_union_store_copy.py` | Union tests of the copy, at least 80 lines | VERIFIED | 105 lines, 7 tests, all pass |

### Key link verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `write_lane_catalog.py` | `store_file_copy.py` | import and three calls | WIRED | line 18; calls at 67, 110, 115 |
| `merge_lane_store.py` | `store_file_copy.py` | import and three calls | WIRED | line 22; calls at 147, 173, 177 |
| both commands | `pinned_store_verification.py` | `from native_store.pinned_store_verification import PINNED_STORE_VERIFICATION_WORKER_COUNT, verify_pinned_store_files` | WIRED | `write_lane_catalog.py:17`, `merge_lane_store.py:21` |
| `store_file_copy.py` | `catalog_writer.py` | `store_file_key`, `sha256_of_file`, `require_catalog_unchanged`, `require_catalog_within_byte_limit`, `replace_file` | WIRED | lines 9-10, every name used |
| `store_file_copy.py` | `unit_ledger.py` | `BATCH_MINIMUM_FREE_BYTES`, `nearest_existing_ancestor`, import only | WIRED | line 12; `unit_ledger.py` is not in the diff |
| `require_version_two_lane_archives` | lane archive on disk | `verify_archive` then `zipfile.ZipFile(archive_path)` | WIRED | `merge_lane_store.py:134-138` |

### Behavioral spot-checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Targeted tests of the plan (Task 3 command, a superset of the Task 1 and Task 2 commands, 12 files) | `python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py python -B -m unittest tests/pipeline/test_store_file_copy.py tests/pipeline/test_lane_union_store_copy.py tests/pipeline/test_lane_catalog_writer.py tests/pipeline/test_merge_lane_store.py tests/pipeline/test_lane_union_catalog.py tests/pipeline/test_pinned_store_verification.py tests/pipeline/test_bundle_member_pins.py tests/pipeline/test_skill_effect_store_pins.py tests/pipeline/test_native_combat_audio.py tests/pipeline/test_lane_npc_profile_mesh_join.py tests/pipeline/test_lane_coverage_refresh.py tests/pipeline/test_npc_batch_bookkeeping.py` | `Ran 168 tests in 39.927s`, `OK`, exit 0 | PASS |
| Whole suite | not run by the verifier; judged from the log | 2273 tests, 2 baseline errors, no FAIL line | PASS |

### Scope and rule checks

| Check | Result |
|-------|--------|
| Frozen files of rule G6 and pinned files | Not edited. `git diff --stat 94f9598 HEAD` lists 13 files; none is `scripts/native_assets.py`, under `scripts/native_assets_lib/`, `scripts/native_catalog/`, `scripts/native_effect_bundle.py`, `scripts/native_audio.py`, `scripts/native_animation_families.py`, `scripts/reference_client_guard.py`, `scripts/native_store/store_paths.py`, `scripts/native_actor_profiles.py`, or a file of `TOOL_IDENTITY_FILES`. None of the 13 is in `implementation_source_paths()` of `scripts/native_assets.py`. |
| Files outside `files_modified` | None. The 13 changed files are exactly the 13 of `files_modified`. `tests/pipeline/test_npc_batch_bookkeeping.py` changed by 4 added and 3 deleted lines: the import of the collecting walk became the import of the verification walk and the two call lines moved, as the accepted exception states. |
| Out of scope files | `scripts/native_store/unit_ledger.py`, `scripts/world/convert_tile_batch.py`, `scripts/native_store/print_lane_union_catalog.py`, `tests/pipeline/test_lane_catalog_writer.py`, `tests/pipeline/test_lane_union_catalog.py` and everything under `scripts/actors/` are not in the diff. |
| Comments | None. A search of the 13 files for `#` and docstring quotes finds only the `#` inside the `WINDOW_ID_PATTERN` regular expression of `catalog_writer.py`. |
| Unused imports | None in the 13 files (checked with an `ast` pass over each file). |
| Unused functions and helpers | None found. Every function of `store_file_copy.py`, `verified_lane_store_file_sources` of the merge and every helper method of the two new test files has a caller. `add_store_file` and `verify_store_destinations` stay in `catalog_writer.py` with production callers (28 call lines in 11 files under `scripts`). |
| Names the plan says to delete | `pinned_store_files`, `from collections import deque` in `catalog_writer.py`, `import io` and the `write_store`, `verify_store_destinations` imports of the merge, the `add_store_file`, `verify_store_destinations` imports and the local worker count constant of `write_lane_catalog.py`, `IN_PROCESS_WALKS`: none remains under `scripts` or `tests`. |
| Commits | Three commits on `lane/speed` (`bd6f44a` six files, `118662b` six files, `ccf784e` two files), no attribution line, plain hyphens. Working tree clean under `scripts` and `tests`. |
| Notes from the plan check | All five are recorded in the summary (sections "Recorded from the plan check" and "Plan output record"). |
| Process cleanup | After the verifier's run, the only python process whose command line names this worktree is the orchestrator's journal watcher (PID 8132), which the verifier did not start. |

### Anti-patterns found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `tests/pipeline/test_store_file_copy.py`, `tests/pipeline/test_lane_union_store_copy.py` | 38, 23 | The two-line helper `bytes_by_relative_path` is defined identically in both files | Info | Small duplication against the DRY rule of AGENTS.md; does not affect the goal |
| `scripts/native_store/store_file_copy.py` | 81-84 | Between the second look at the destination and `Path.rename`, a destination created by another writer is refused only because `Path.rename` raises `FileExistsError` on Windows; no test drives that window | Info | Declared in the plan (threat T-261112-l5d-10) and Windows is the only platform of this pipeline; the two driven states of the truth have tests |
| `tests/pipeline/test_bundle_member_pins.py` | - | 426 lines, above the 400 line guide | Info | Same length as before the task (21 added, 21 deleted) |

No TODO, FIXME, placeholder or stub was found in the 13 files.

### Human verification required

None. Every truth has a passing test that drives its behaviour, and the whole-suite claim is shown by the log.

### Gaps summary

No gaps. The union and the owner merge build `StoreFileSource` entries and publish through `copy_store_files`, which copies one file at a time in 1 MiB chunks, keeps the order and the messages of the `write_store` refusals, applies the write-time rule to every source, and refuses before the first write when the missing bytes plus the 4 GiB floor exceed the free bytes. The collecting walk is deleted with no caller left. The targeted tests pass in the verifier's own run and the whole-suite log shows only the two baseline errors.

---

_Verified: 2026-11-12T14:43:04Z_
_Verifier: Claude (gsd-verifier)_
