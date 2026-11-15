---
phase: 261112-i80-batch-bookkeeping-without-repeated-work-
verified: 2026-11-12T14:08:00Z
status: passed
score: 13/13 must-haves verified
covered_files:
  - .planning/quick/261112-i80-batch-bookkeeping-without-repeated-work-/261112-i80-PLAN.md
  - .planning/quick/261112-i80-batch-bookkeeping-without-repeated-work-/261112-i80-SUMMARY.md
  - scripts/actors/actor_sound_batch.py
  - scripts/actors/actor_sound_conversion.py
  - scripts/actors/character_conversion.py
  - scripts/actors/convert_actors.py
  - scripts/actors/item_census.py
  - scripts/actors/item_conversion.py
  - scripts/actors/item_requests.py
  - scripts/actors/npc_batch.py
  - scripts/actors/npc_store_records.py
  - scripts/actors/skill_effect_conversion.py
  - scripts/data/lane_unit_outcomes.py
  - scripts/native_store/unit_ledger.py
  - tests/pipeline/test_actor_sound_bindings.py
  - tests/pipeline/test_actor_sound_bundle_reseal.py
  - tests/pipeline/test_actor_sound_slice_bookkeeping.py
  - tests/pipeline/test_catalog_record_replacement.py
  - tests/pipeline/test_item_batch_bookkeeping.py
  - tests/pipeline/test_item_conversion_run.py
  - tests/pipeline/test_locked_input_lock_reuse.py
  - tests/pipeline/test_npc_batch_bookkeeping.py
  - tests/pipeline/test_npc_requests.py
  - tests/pipeline/test_skill_effect_batch_bookkeeping.py
  - tests/pipeline/test_step_gap_row_replacement.py
covered_digest: "v4:sha256:5aceb97122e35dff6e13b5932f4fea6f40d59c7b09d3ca4f395bdba6efb9ac1c"
behavior_unverified: 0
overrides_applied: 0
---

# Quick task 261112-i80: batch bookkeeping without repeated work - verification report

**Task goal:** Batch bookkeeping without repeated work: batched catalog record replacement, one sealed check per unit per process, per-process lock reuse, per-slice catalog and gap-row writes.
**Verified:** 2026-11-12T14:08:00Z, on `lane/speed` at `ddc0b51`
**Status:** passed
**Re-verification:** No - initial verification

Method: every must-have was checked in the code of `0a59a9f..ddc0b51`, the three targeted test commands of the plan were run again by the verifier, the whole-suite claim was judged from the log file, and the four byte-identity tests were also run against the pre-task code (`0a59a9f`) to see that their expected bytes are the bytes the old code writes. The SUMMARY was treated as a list of claims.

## Goal achievement

### Observable truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Items, skills, actor sounds and npc: one synthetic batch each writes catalog.json, the step gap-row file and the census (where one is written) with the expected bytes | VERIFIED | `ItemBatchByteIdentityTests`, `SkillEffectBatchBookkeepingTests.test_one_finish_...`, `ActorSoundSliceByteIdentityTests`, `NpcBatchByteIdentityTests` pass on `ddc0b51`. The same four tests pass against the pre-task code `0a59a9f` (verifier replay, 7 run, 0 failures, 0 errors), so the expected bytes are the old bytes. Expected values are literals, see "Expected bytes in the tests" |
| 2 | An items slice calls `UnitLedger.sealed_receipt` once per unit sealed at process start; a unit sealed in the process enters the map by one receipt read | VERIFIED | `item_conversion.py:119-127` builds the map in one pass, `:164` adds a unit after its seal by one `sealed_receipt` read. `ItemBatchReceiptReadTests` pins A `[True]`, B `[True]`, C `[False, False, True]`, D `[False]` and passes |
| 3 | Items verify and read each archive once per unit, write store files per unit, write the catalog once at the end | VERIFIED | `item_conversion.py:181-192`: one `converted_model_store_files_and_record` call per unit, `write_store(store_root, unit_files, before, unchanged_catalog_bytes)` per unit, one final `write_store(store_root, {}, before, json_bytes(catalog))`. `test_the_archive_of_a_unit_with_two_record_ids_is_read_once` and the three `ItemBatchStoreWriteTests` pass |
| 4 | `locked_input_records` parses the lock once per process per resolved path and identity, and again after the file changes | VERIFIED | `unit_ledger.py:96-108`, key `(str(resolved path), lock_file_identity(...))`, reader gets the path as given. `test_locked_input_lock_reuse.py` (4 tests) passes; the unchanged `test_unit_ledger.py` passes. The missing-lock message is a constant without a path, so it is unchanged |
| 5 | Actor sounds hash the converter sources and the builder once per run object | VERIFIED | `actor_sound_conversion.py:104-105` sets both attributes in `__init__`; `sound_unit_work` and `bundle_work` read them; `builder_sha256` is gone. `ActorSoundHashReuseTests` counts 1 and 1 over three sound units and a two-bundle slice |
| 6 | Item gap rows are validated by `write_gap_rows` and `UnitLedger.seal` only | VERIFIED | `item_requests.py:157-160` returns the dict; the `validate_gap_row` import is removed. `ItemGapRowValidationTests` (no pattern load, refusal at the seal with the same message) pass |
| 7 | Skill store records reach the catalog through one `merge_catalog_slice_records` call | VERIFIED | `skill_effect_conversion.py:246-255`. `test_the_records_of_every_converted_root_reach_the_catalog_through_one_merge` and `test_a_run_without_a_converted_root_makes_no_merge` pass |
| 8 | Actor sounds and npc write the catalog and the step gap rows once per slice; the next run re-adds a missing record of a sealed bundle and of a sealed npc unit | VERIFIED | `actor_sound_batch.py:86-121` and `:184-199` (one `synchronize_store` in `finally`); `npc_batch.py:385-398` (recording block) and `:341-374`. `test_a_slice_that_converts_two_bundles_writes_the_catalog_and_the_gap_row_file_once`, `test_a_three_unit_slice_reads_the_lane_gap_rows_once_per_step` (2 reads), `test_the_missing_record_of_a_sealed_bundle_is_added_again`, `test_a_model_record_missing_from_the_catalog_is_added_again_from_its_own_archive`, `test_the_pack_profile_record_missing_from_the_catalog_is_added_again_from_its_own_bundle` pass |
| 9 | After an actor-sound slice without its synchronization the next slice repairs every sealed bundle it walks (missing added, differing replaced, no-manifest removed); a slice over an agreeing catalog writes no file | VERIFIED | `write_bundle_catalog_records` compares the whole record dict and removes by id; `write_bundle_gap_rows` compares rows. The five `ActorSoundSealedBundleRepairTests` and `test_a_slice_over_an_unchanged_store_writes_no_file` pass; each repair test also checks the following slice writes nothing (no `write_store`, no `replace_file`, bytes and `st_mtime_ns` unchanged) |
| 10 | An npc slice whose records are all current still refuses both capacities with today's messages; for a current record no verification runs and no store file is offered; pinned by tests and recorded in the SUMMARY | VERIFIED | Every record, rebuilt or current, goes through `catalog_with_records_replaced` (`npc_batch.py:366-369`). `test_a_slice_that_builds_no_record_still_refuses_a_models_slice_over_capacity`, `..._a_profile_slice_over_capacity`, `test_a_slice_over_current_records_verifies_no_archive_or_bundle_and_offers_no_store_file`, and the two store-file tests pass. SUMMARY Task 3 lists the three consequences with their tests |
| 11 | Outside a batch slice every npc gap row is on disk before its unit is sealed; after a stopped slice the next slice restores the model rows from the receipts | VERIFIED | `convert_actors.py:91-94`, `:100`, `:244` call `self.step_gap_rows.replace` before `ledger.seal`; `convert_npc` opens no recording (`recorded_until_exit` has one caller, `run_npc_batch_slice`). `ConvertNpcGapTests.test_the_profile_row_and_the_sound_identity_row_are_on_disk_when_the_profile_unit_is_sealed`, `StepGapRowReplacementsTests.test_outside_a_recording_...`, `NpcBatchGapRowWriteTests.test_the_deleted_model_gap_row_file_...` pass. The model-step row goes through the same `seal` method the profile test exercises |
| 12 | `replace_step_gap_rows` with `rewrite_when_unchanged` false writes nothing for equal rows in any order | VERIFIED | `lane_unit_outcomes.py:26-31` sorts both sides. `test_equal_rows_in_another_order_write_nothing` passes (no `write_gap_rows` call, bytes and `st_mtime_ns` unchanged) |
| 13 | The whole pipeline suite has no failing or erroring id outside the baseline | VERIFIED | `C:/laragon/l2b-orchestration/autonomous-roadmap/pipeline-261112-i80.log`, written 15:54:25, after the last task commit (15:48:15): `Ran 2242 tests in 355.723s`, `FAILED (errors=2, skipped=67)`, no `FAIL:` line. The two `ERROR:` ids are the two of `261112-i80-suite-baseline.txt` (`test_world_audio_step ... ambient_counts`, `test_world_bsp_step ... brush397_and_brush610`). The baseline run log shows the same two ids at 2181 tests; 2242 - 2181 = 61 new tests, which is the count of the new tests |

**Score:** 13/13 truths verified (0 present, behavior-unverified)

### Required artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `scripts/actors/npc_store_records.py` | `def catalog_with_records_replaced` | VERIFIED | Lines 53-73; used by items, npc batch, single-npc path, characters, actor sounds |
| `scripts/native_store/unit_ledger.py` | `def process_reference_client_lock` | VERIFIED | Lines 96-108; called by `locked_input_records` |
| `scripts/actors/item_conversion.py` | `def receipt_outcome` | VERIFIED | Lines 115-127; used by the map pass and by `convert` |
| `scripts/actors/actor_sound_batch.py` | `def write_bundle_catalog_records` | VERIFIED | Lines 86-121; called by `ActorSoundBundles.synchronize_store` |
| `scripts/data/lane_unit_outcomes.py` | `def replace_step_gap_rows` | VERIFIED | Lines 26-61 with `StepGapRowReplacements`; used by `npc_batch.py` and `convert_actors.py` |
| `tests/pipeline/test_item_batch_bookkeeping.py` | byte identity and call count | VERIFIED | 8 tests pass |
| `tests/pipeline/test_actor_sound_slice_bookkeeping.py` | byte identity, counts, three repairs, steady state | VERIFIED | 10 tests pass |
| `tests/pipeline/test_npc_batch_bookkeeping.py` | byte identity, read count, re-added record | VERIFIED | 13 tests pass |

### Key link verification

| From | To | Via | Status |
|---|---|---|---|
| `item_census.py` | `item_conversion.py` | `sealed_outcomes_by_unit_key` (3 call sites, one shared map) | WIRED |
| `unit_ledger.py` | `reference_client_guard.py` | `lock_file_identity` in the cache key | WIRED |
| `skill_effect_conversion.py` | `catalog_writer.py` | one `merge_catalog_slice_records` call | WIRED |
| `actor_sound_batch.py` | `npc_store_records.py` | `catalog_with_records_replaced` for `combatAudio` | WIRED |
| `npc_batch.py` | `lane_unit_outcomes.py` | `replace_step_gap_rows` for both steps | WIRED |

### Requirements coverage

| Requirement | Status | Evidence |
|---|---|---|
| D-09 batched replace helper, one merge for skills | SATISFIED | Truths 1, 7, 8; no caller of the per-record helpers is left |
| D-10 one sealed-outcome map per process | SATISFIED | Truth 2 |
| D-11 one archive read per unit, per-unit store files, catalog at the end | SATISFIED | Truth 3 |
| D-12 lock parsed once per process, hashes once per run object | SATISFIED | Truths 4, 5 |
| D-13 item gap rows validated once | SATISFIED | Truth 6 |
| D-14 per-slice catalog and gap rows, re-added record | SATISFIED | Truths 8 to 11 |

### Behavioral spot-checks (run by the verifier, each through `run_below_normal.py`)

| Command of the plan | Result | Status |
|---|---|---|
| Task 1: `test_catalog_record_replacement` `test_locked_input_lock_reuse` `test_item_batch_bookkeeping` `test_item_conversion_run` `test_item_requests` `test_unit_ledger` | Ran 61 tests in 4.979 s, OK (skipped=1) | PASS |
| Task 2: `test_skill_effect_batch_bookkeeping` `test_skill_effect_root_outcomes` `test_skill_effect_store_pins` `test_actor_sound_slice_bookkeeping` `test_actor_sound_bundle_reseal` `test_actor_sound_bindings` `test_actor_sound_refusal_reasons` | Ran 57 tests in 8.161 s, OK | PASS |
| Task 3: `test_step_gap_row_replacement` `test_npc_batch_bookkeeping` `test_npc_batch` `test_npc_requests` `test_character_conversion_run` `test_catalog_record_replacement` | Ran 82 tests in 16.576 s, OK | PASS |
| Pre-task replay: the four byte-identity tests plus the npc refusal-state and stopped-slice tests, against an export of `0a59a9f` in a scratch folder (removed afterwards); `write_store` and `merge_catalog_slice_records` injected into the two old modules whose fixtures wrap those names | 7 run, 0 failures, 0 errors | PASS |

The one skip of the Task 1 run is `test_item_requests.ConvertedItemPackageTests`, which skips when this checkout's actors lane store holds no catalog. A measurement run cleared that store at 15:56 (see notes). The test file is not changed by this task.

## Hard-limit checks

| Check | Result |
|---|---|
| Frozen or pinned file edited | None. `git diff --stat f1f643e HEAD` lists, outside this task's 23 files, only `.planning/STATE.md` and the four 261112-i67 planning files, all added by `0a59a9f` before the task. No file of rule G6, no `catalog_writer.py`, `write_lane_catalog.py`, `merge_lane_store.py`, `native_actor_profiles.py`, `gap_rows.py`, no file of `TOOL_IDENTITY_FILES`, no `combat_audio_bundle.py`, no file of `implementation_source_paths()` or of `npc_profile_tool_pins()` is in the diff. The context file was not edited by a task commit |
| Files outside `files_modified` | None. `git diff --name-only 0a59a9f HEAD` is exactly the 23 paths of `files_modified` (12 scripts, 11 tests). Per commit: `03a1764` 9 files, `7d4c771` 7 files, `ddc0b51` 8 files |
| Comments in code | None. A tokenizer scan of all 23 changed files finds no comment and no docstring; the added lines hold no `#`, TODO, FIXME, XXX, TBD or HACK |
| Unused functions | None. No reference is left in `scripts`, `tests`, `docs` or `recipes` to `is_unit_sealed`, `ItemConversionRun.sealed_outcome`, `builder_sha256` (method), `write_catalog_record`, `replace_bundle_gap_rows`, `is_bundle_sealed`, `is_no_sound_bundle_sealed`, `sealed_bundle_outcome`, `ActorSoundBundles.is_sealed`, `catalog_with_record_replaced`, `catalog_without_record`, `replace_step_gap_rows_when_changed`. Every function and class defined in the 12 changed modules is referenced elsewhere in `scripts`. An AST scan finds no unused import in the 23 files |
| File size | `npc_batch.py` 400 lines, `convert_actors.py` 397 (396 before, one line added as planned), `actor_sound_conversion.py` 381 (388 before), `actor_sound_batch.py` 295, `lane_unit_outcomes.py` 100, `npc_store_records.py` 102 |
| Commit messages | No attribution line, plain hyphens, on `lane/speed` only |
| Processes | Nothing the verifier started still runs |

### Expected bytes in the tests

| Test | How the expected bytes are built | Verdict |
|---|---|---|
| Items | Records from the test's own `archive_record` over literal archive bytes; gap rows and census written out as literals; `json_bytes`, `canonical_json_bytes`, `gap_reason_list_versions`, `lane_gap_rows_path` only serialize and locate. Unit keys come from `conversion_unit_key(weapon_selection(row))`, which this task does not change | Not built by the code under test |
| Skills | Literal `effectComponents` records and literal gap rows | Not built by the code under test |
| Actor sounds | Literal `combatAudio` record over literal manifest bytes, literal gap rows, literal census; the profile record comes from the fixture `write_profile_manifest`, the route proof path from a constant | Not built by the code under test |
| Npc | Model records from the SHA-256 of the archives the test reads, the profile record from the bundle manifest it reads, literal gap rows. The pack folder is located with `npc_profile_pack_id` and `pack_unit_key`, which this task does not change | Not built by the code under test |

No test calls `catalog_with_records_replaced`, `write_bundle_catalog_records`, `write_store_records` or a kept copy of old code to produce an expected value. `test_step_gap_row_replacement.py` seeds its rows on disk through `replace_step_gap_rows`, but every expected byte string is built from literal rows.

## Anti-patterns found

None in the changed files: no debt marker, no placeholder, no empty implementation, no stub.

## Notes for the owner (not gaps)

1. Two disclosed consequences touch the letter of the context line "every existing refusal keeps its condition". Both follow from what the plan prescribes (Task 1 E and Task 2 D apply all removals before all additions; D-11 writes store files per unit) and both are recorded in the SUMMARY:
   - A capacity refusal that fired only because a record was added before a later unit of the same slice removed one no longer fires for items and actor sounds. The message is unchanged and the count judged is the count after the whole replacement. Npc keeps its per-pack order.
   - An items slice over the `models` capacity is now refused after its per-unit store files are written; in a store that held no catalog the first per-unit call has already published the empty catalog. Pinned by `test_a_slice_over_the_model_capacity_is_refused_after_its_unit_files_and_keeps_the_catalog`.
2. Npc rebuild rule: a catalog record that pins the sealed SHA-256 is kept as it is, so a later change to how a record is derived from an unchanged archive or bundle does not reach such a record through the batch. The item path already behaved so. The SUMMARY states that no test pins this.
3. `take_recorded` raises `AttributeError` outside a recording. Its only caller runs inside the block of `run_npc_batch_slice`.
4. SUMMARY accuracy: Task 3 reports "1 skip" for its verify command; its own log `261112-i80-task3-verify.log` and the verifier's run show 82 tests, OK, no skip. Task 1 reports "no skip"; the verifier's run has one skip for the environment reason above. Neither changes a result.
5. Environment during verification: a measurement run not started by this task or by the verifier (`C:/laragon/l2b-orchestration/pipeline-speed/run_batch_sequence.py --clear after-sequence items:300 skills:20 actor-sounds:100 actor-sounds:250 items:1`, started 15:56:43) cleared this checkout's actors lane store and is converting real units in it. At 16:03:37 its items step rewrote the tracked file `docs/parts/items/item-census.json` (`sliceLimit` 300, 49,618 lines removed), which now shows as modified in `git status`. The task commits did not touch that file. Do not stage it with the artifacts of this task.

## Human verification required

None.

## Gaps summary

No gap. All 13 must-have truths hold in the code, the 8 artifacts are substantive and wired, the 5 key links are wired, the three targeted commands pass in the verifier's own runs, the four byte-identity tests also pass against the pre-task code, and the whole-suite log shows only the two baseline ids.

---

_Verified: 2026-11-12T14:08:00Z_
_Verifier: Claude (gsd-verifier)_
