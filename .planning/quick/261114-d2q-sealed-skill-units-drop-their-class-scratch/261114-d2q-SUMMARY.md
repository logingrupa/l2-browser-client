---
quick: 261114-d2q
status: complete
branch: lane/speed
plan_head_before: f0ebed34f7bfb070b52e3c5db456f73a21f6e280
plan_head_after: 5b2a48d
commits: 2
completed: 2026-11-14
---

# Quick task 261114-d2q: sealed skill units drop their class decode scratch - summary

The lane scratch removal now also removes `<lane>/work/<unit>/<step>/bundle/.work` of sealed `skill-effect-root` and `skill-dispatch-class` steps, in the command and in the batch-end pass, only in a lane held free of conversions; `--plan` only reports.

## Commits

- `0c1055b` feat(261114-d2q): remove the bundle scratch of sealed skill effect units in the lane scratch removal (7 files)
- `5b2a48d` docs(261114-d2q): two lines in `docs/BATCH_PIPELINE_SPEED.md`

## Files

- `scripts/native_store/converter_scratch_removal.py` (99 lines): the removal.
- `scripts/actors/skill_bundle_step_names.py` (new): the three names.
- `scripts/actors/skill_effect_conversion.py`, `skill_dispatch_class_conversion.py`: import the names instead of defining them.
- `scripts/native_store/share_identical_lane_files.py`: field names of the removal, help text.
- `tests/pipeline/test_sealed_skill_bundle_scratch_removal.py` (new, 240 lines, 9 tests); `test_skill_effect_root_outcomes.py` imports the step name from its new owner.

## Decision 5: one small module owns the names

`scripts/actors/skill_bundle_step_names.py` holds `SKILL_EFFECT_ROOT_STEP`, `SKILL_DISPATCH_CLASS_STEP` and `SOURCE_BUNDLE_FOLDER`; the two actors modules and the store module import them from it. Measured: importing `actors.skill_dispatch_class_conversion` into the store command loads 67 more modules (`native_assets`, `native_catalog.*`, `native_effect_bundle`, `native_actor_profiles`), `skill_effect_conversion` 5 more. There is no import cycle; the reason is the heavy modules.

## Gate

- Seen failing first: on import, then 7 of 9 tests against the unchanged removal (the two that passed are tests of what must stay).
- Gate: 203 tests pass in 16 files (`261114-d2q-gate.log` in the orchestration folder): the new file, `test_converter_scratch_removal`, `test_share_identical_lane_files`, `test_batch_end_file_sharing`, `test_lane_batch_lock`, the four skill test files, `test_lane_sharing_candidates`, `test_shared_lane_files_stay_valid`, `test_pinned_store_verification`, `test_world_map_emitter_step`, `test_converter_output_guard`, `test_client_entry_points`, `test_converter_implementation_hash`.
- After the code commit `implementation_hash()` prints `c4bf8e6cf5f61bddf65a35e6fb65f6af34199e0589b978930aeb92d2f15a2bd8` and `test_converter_implementation_hash.py` passes (7 tests). No fingerprinted file changed.
- With the reparse check switched off the junction test fails, so it tests the check.

## Whole suite

`pipeline-261114-d2q.log`: 2,727 tests (2,718 + 9 new), failures=2, errors=3, skipped=70. The five are the five of the baseline; no `FAIL` or `ERROR` line the baseline lacks. The read-only listing of this checkout's `artifacts/lane-store` (`h7k-guard.py`) is the same before the gate and after the suite (`d2q-guard-before.txt`).

## How it works

- One listing of `<lane>/work`. Per unit folder two probes, `<unit>/<step>/complete.json` for the two step names; no unit folder and no step of another kind is listed. Only the `bundle` folder of a sealed skill step is listed.
- Sealed is the literal rule of decision 1: `complete.json` is a file and `.running.json` does not exist. The receipt hash is not checked here.
- A step, `bundle` or `.work` folder that is a junction or a link is skipped.
- `.work` is renamed to `.work.removing`, then removed; a leftover `.work.removing` goes in the next run.
- No new report key. The folders and bytes count in the four `scratch*` keys, also in `scratchBytesLeftByLane` of a lane that keeps its scratch.

## Deviations

1. The bytes left after a run are read from the folders that were not removed (the folder and its `.removing` name) instead of from a second listing of the lane. Reason: decision 6; a run listed `work` twice otherwise. This also applies to the converter job folders; their existing tests pass unchanged.
2. Renamed inside the module because the list now holds two kinds of folders: `LaneScratchRemoval.job_folders_removed` and `job_folders_not_removed` to `scratch_folders_*`, `scratch_job_folders` to `converter_scratch_job_folders`, `remove_scratch_job_folder` to `remove_scratch_folder`, `REMOVING_JOB_FOLDER_SUFFIX` to `REMOVING_SCRATCH_FOLDER_SUFFIX`. The report keys keep their names.
3. The help text of the command names the new removal.
4. Tests beyond the list: junctions are not followed (step, `bundle`, `.work`); a run lists `work` once and nothing of another step kind.
5. The GSD commit ledger file was not written: the session refuses compound git commands. `plan_head_before` above is the commit the work started from.

## Notes for the proof

- Plan mode reports job folders and bundle scratch folders in one number, `scratchJobFoldersRemoved`. Expect it near the measured 11.1 GiB plus whatever converter job folders exist.
- A step that holds both `.work` and `.work.removing` loses `.work.removing` first and `.work` in the next run (same as a job folder).
- Synthetic skill run of the batch test: 3 roots and 2 classes convert and leave scratch, the pass removes 5 folders, the next batch counts 3 and 3 already sealed (the third class is a sealed gap), starts no conversion, and the catalog bytes are equal.
- A skills batch of another thread (`convert_actors.py --batch skills --limit 235`) ran beside the suite; no other `scripts/test_pipeline.py` ran.

## Self-check: passed

Both commits are ancestors of HEAD; the seven code and test files and the doc exist; no python process of this run is left.
