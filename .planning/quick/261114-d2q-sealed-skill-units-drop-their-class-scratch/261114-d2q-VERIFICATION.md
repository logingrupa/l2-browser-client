---
quick: 261114-d2q
verified: 2026-11-14T01:52:55Z
status: passed
score: 10/10 must-haves verified
covered_files:
  - .planning/quick/261114-d2q-sealed-skill-units-drop-their-class-scratch/261114-d2q-SUMMARY.md
  - docs/BATCH_PIPELINE_SPEED.md
  - scripts/actors/skill_bundle_step_names.py
  - scripts/actors/skill_dispatch_class_conversion.py
  - scripts/actors/skill_effect_conversion.py
  - scripts/native_store/converter_scratch_removal.py
  - scripts/native_store/share_identical_lane_files.py
  - tests/pipeline/test_sealed_skill_bundle_scratch_removal.py
  - tests/pipeline/test_skill_effect_root_outcomes.py
covered_digest: "v4:sha256:be559365f814e6c6f4babaec3f19f824326e089bbb4a4f842c0cb02febd370da"
behavior_unverified: 0
overrides_applied: 0
---

# Quick task 261114-d2q: verification

Goal: the lane scratch removal also removes `<step>/bundle/.work` of sealed `skill-effect-root` and `skill-dispatch-class` units, only in a lane held free under the whole lane lock, and no sealed unit loses anything it needs. Result: achieved. No gaps. Commits `0c1055b`, `5b2a48d` on `lane/speed`.

Helpers and raw results: `C:/laragon/l2b-orchestration/autonomous-roadmap/261114-d2q-verify-*`.

## Locked decisions

| # | Decision | Status | Evidence |
| - | - | - | - |
| 1 | Removes `work/<unit>/<step>/bundle/.work` of sealed steps of the two kinds; sealed is `complete.json` and no `.running.json`; only a lane held free; command and batch-end pass; `--plan` reports | VERIFIED | `converter_scratch_removal.py:41-56`, one call site `share_identical_lane_files.py:110`. New tests pass (9 of 9). Synthetic lane: command refuses a lane held by a batch (exit 1, nothing removed); batch-end pass with a conversion process left removes nothing; a free lane loses the scratch |
| 2 | Rename to `.work.removing`, then `rmtree`; leftover goes next run; not removable counts as not removed and stays whole | VERIFIED | `:72-85`. Tests `the_rest_of_a_stopped...` and `file_open_elsewhere...` pass; mutation that ignores `.work.removing` fails the first |
| 3 | Nothing else of `bundle`, no other step | VERIFIED | Synthetic lane: the only files gone sit under `bundle/.work` of the two sealed step kinds; mutation that removes the whole `bundle` fails 7 tests |
| 4 | Report keeps its keys | VERIFIED | Key set of a run equals the 15 keys before; counts land in the four `scratch*` keys; no new key |
| 5 | Step names from one owner | VERIFIED | `scripts/actors/skill_bundle_step_names.py` owns the three names; both actors modules and the store module import them. No cycle. Measured: importing `actors.skill_dispatch_class_conversion` into the store command adds 66 modules (`native_assets`, `native_catalog.*`, `native_actor_profiles`); the names module adds none of them |
| 6 | One listing of the unit folders, no walk into other steps | VERIFIED | See point 4 |

Hard constraints: no fingerprinted file changed (point 5); no sealed unit unsealed and no receipt output removed (`sealed_receipt` equal before and after in the test; point 3). Required tests: all present and passing; mutations (no reparse check, every step sealed, running marker ignored, `npc-profile-pack` added, `model` added, no search) each fail at least one test.

Targeted runs (one at a time, BelowNormal): `test_sealed_skill_bundle_scratch_removal` 9, `test_converter_scratch_removal` 9, `test_share_identical_lane_files` 26, `test_batch_end_file_sharing` 11, `test_converter_implementation_hash` 7, `test_skill_effect_root_outcomes` 13, `test_skill_effect_batch_bookkeeping` 8; all OK.

Whole suite (from the logs): `pipeline-261114-d2q.log` 2,727 tests, failures=2, errors=3, skipped=70; baseline 2,718 with the same counts. The five `FAIL`/`ERROR` names are identical; the 9 new tests are `ok`; no baseline test is missing.

## The six points

1. Readers of `bundle/.work` of a sealed skill unit: none.
   - `DefaultReader.get` (`native_effect_bundle.py:283-297`) writes and reads `.work/classes/<hash>`. It runs only inside `migrate_effect_bundle`, reached only from `migrated_bundle_outcome` after `UnitLedger.begin` removed the step folder. Not on a sealed unit.
   - `migrate_effect_bundle` cache hit and `verify_effect_bundle` (`_verify`, also `native_migration.py:207`, which works on its own output tree): read `receipt['files']` only. Real lane: 0 bundle receipt files under `.work` in 481 sealed skill units.
   - `scripts/stage-native-effect.mjs` and `inspect-native-effect-bundle.py` through `effect_readiness.inspect`: declared manifest files only. Run on copies without `.work` of two real sealed bundles: passes.
   - Skills batch on a sealed unit: outcome record, `receipt.json`, `effects/<sha>/**` (`skill_effect_conversion.py:171-176, 234-245, 269-278`).
   - `survey_lane` walks the folder but skips it (`never-shared-folder`); only its skipped-file count drops.
   - `npc_batch.py:354-359`, `convert_actors.py:262`, `native_actor_profiles.py:197`, `mover_class_defaults.py:186`: other step kinds, not touched.
   - No reader in `vite/`, `src/`, `tests/unit`, the private preview scripts, the audit, report or census scripts.
2. Synthetic lane in a temporary folder (deleted): nothing removed that must stay. Kept whole: unsealed step, sealed step with `.running.json`, step with only `.running.json`, `npc-profile-pack`, `npc-model` and `npc-profile` steps with a `bundle`, a unit folder whose name contains the step name, a unit folder without `__`, a step nested one level deeper, `.work` that is a file, `.work` and `.work.removing` that are junctions, `bundle`, step and unit folders that are junctions, `.work` deeper in `bundle/source` or beside `bundle`, `.workx`, a `complete.json` that is a folder, a lane not held free, a `data-ui` lane named free, plan mode (function and command; the command wrote nothing). A junction inside a removed `.work` was unlinked, its target kept. A symlink named `.work` could not be created here (no privilege); `directory_entries` skips it by `entry.is_symlink()`.
3. Plan mode on the real store (exit 0, wrote nothing): `scratchJobFoldersRemoved` 459, `scratchJobFoldersNotRemoved` 0, `scratchBytesRemoved` 13,694,339,032 (12.75 GiB), `scratchBytesLeftByLane` actors 0, world 0, data-ui 5,621,816, integration 26,316,739. All 459 are bundle scratch: 226 roots, 7,640,331,198 bytes, 15,205 files (equal to the measured 7.12 GiB); 233 classes, 6,054,007,834 bytes, 12,106 files (measured 3.98 GiB and 8,560 files; class units converted after the measurement add 1.65 GiB). Converter job folders in actors and world: 0. Measured total 11.1 GiB, now 12.75 GiB. `npc-profile-pack` scratch (33 folders, 0.32 GiB) is not named. Five sealed units of each kind: every receipt output is the outcome record or under `effects/<sha>/`, none under `bundle`; all exist; seal matches receipt. All 481 sealed skill units: 0 receipt outputs under `bundle`. No convert process ran at the check; plan mode takes no lock.
4. Cost on the real actors lane (12,236 unit folders): 462 listings (1 of `work`, 461 of the `bundle` folder of sealed skill steps) and 26,857 stats (2 per unit folder, up to 5 more per sealed skill step), 1.3 s. No unit folder and no step of another kind is listed. The byte count then lists the 17,325 folders inside the 459 scratch trees, once, since they go with the run.
5. Fingerprints: the task commits name `docs/BATCH_PIPELINE_SPEED.md`, `scripts/actors/skill_bundle_step_names.py`, `skill_dispatch_class_conversion.py`, `skill_effect_conversion.py`, `scripts/native_store/converter_scratch_removal.py`, `share_identical_lane_files.py` and two test files. None is in `implementation_source_paths()` or in a byte-hashed list of `docs/BATCH_PIPELINE_SPEED.md:23-31`. `implementation_hash()` prints `c4bf8e6cf5f61bddf65a35e6fb65f6af34199e0589b978930aeb92d2f15a2bd8`; the guard test passes.
6. Code rules: no comment added or present in the touched files; no old name left (`job_folders_removed`, `scratch_job_folders`, `remove_scratch_job_folder`, `REMOVING_JOB_FOLDER_SUFFIX`); every new name is used; largest touched file 349 lines; report keys as decision 4 says.

## Notes, not gaps

- `<lane>/work` itself as a junction: the removal works behind it (the command checks the lane folder for reparse points, not `work`). Same as the converter scratch removal and the survey of 261113-h7k; the converters refuse such a lane (`lane_work_root`). Not introduced here.
- 34 sealed gap units with `unsupported default-property syntax` keep the decompiled script of the refused class only in `.work`. No code reads it and it can be decompiled again from the reference client; it goes with the scratch, as decision 2 says.
- The test `a_run_lists_the_unit_folders_once...` counts listings made through `converter_scratch_removal`; `lane_converter_folders` (earlier code) lists `work` once more per run.
- `docs/BATCH_PIPELINE_SPEED.md:25` cites `actors/skill_effect_conversion.py:45`; the list is at line 47 (48 before this task).
