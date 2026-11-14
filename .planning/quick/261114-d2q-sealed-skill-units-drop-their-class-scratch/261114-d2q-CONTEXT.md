# Quick task 261114-d2q: sealed skill units drop their class decode scratch - context

Locked decisions of the orchestrator (thread "Speed Up Asset Conversion Tools", 2026-11-14). Builds on quick task 261113-h7k (read its SUMMARY for the scratch removal and the lane lock).

## Measured facts (real store, read only, `C:/laragon/l2b-orchestration/pipeline-speed/results/actors-unit-folder-contents.json`)

- Sealed `skill-effect-root` units hold 7.12 GiB (15,205 files) under `<step>/bundle/.work/classes`; sealed `skill-dispatch-class` units hold 3.98 GiB (8,560 files) there. No receipt lists these files. `engine.u` (2.7 MB) sits there 3,852 times.
- The folder is the work root of `DefaultReader` (`scripts/native_effect_bundle.py:340`, `output / '.work'`), filled while `migrate_effect_bundle` runs.
- For a sealed unit the skills batch reads only the outcome record, `receipt.json` and `effects/<manifest sha>/**` (`scripts/actors/skill_effect_conversion.py`: `sealed_bundle_outcome`, `published_bundle_outcome`, `read_staged_manifest`, the store publishing near line 270). `SOURCE_BUNDLE_FOLDER` is used only in `migrated_bundle_outcome`, during a conversion.
- `npc-profile-pack` units also hold `bundle/.work` (0.32 GiB), but their bundle is verified again on later runs (`npc_batch.py:354-359`). They are out of scope.

## Locked decisions

1. The scratch removal of `scripts/native_store/converter_scratch_removal.py` also removes `<lane>/work/<unit>/<step>/bundle/.work` for sealed steps named `skill-effect-root` and `skill-dispatch-class`. Sealed means: `complete.json` exists and no `.running.json`. It runs where the converter scratch is removed today: only in a lane held free of conversions under the whole lane lock, in the command and in the pass at the end of a batch, and `--plan` only reports.
2. The whole `.work` folder of the unit is removed the way a job folder is: rename to `.work.removing`, then `shutil.rmtree`; a leftover `.work.removing` is removed by the next run; a folder that cannot be renamed or removed counts as not removed and is left whole.
3. Nothing else of `bundle` is removed (`assets`, `source`, manifest and receipt of the bundle stay as evidence). No other step is touched.
4. The report keeps its keys. The removed folders and bytes count in `scratchJobFoldersRemoved`, `scratchJobFoldersNotRemoved`, `scratchBytesRemoved` and `scratchBytesLeftByLane`. If a separate count is needed for clarity, add one key and say so in the summary.
5. The step names come from their owners (`SKILL_EFFECT_ROOT_STEP`, `SKILL_DISPATCH_CLASS_STEP`, `SOURCE_BUNDLE_FOLDER`), unless importing them into `scripts/native_store` would create an import cycle or pull heavy modules into the store command; then one small module owns the three names and the actors modules import them from it. Decide by checking the imports and say which.
6. The cost of finding the folders must stay small: one listing of the unit folders of the lane, no walk into unit steps that are not of the two kinds.

## Hard constraints

- No file that a fingerprint hashes changes: none of `implementation_source_paths()` (`scripts/native_assets.py:153-157`), `scripts/native_actor_profiles.py`, `scripts/world/mover_class_defaults.py`, `scripts/actors/combat_audio_bundle.py`, `scripts/stage-native-effect.mjs`, `scripts/native_effect_bundle.py`, `scripts/native_assets_lib/effect_readiness.py`. `scripts/actors/skill_effect_conversion.py` and `skill_dispatch_class_conversion.py` are in no fingerprint; check before editing.
- No sealed unit is unsealed, no receipt output is removed, no path outside `bundle/.work` of the two step kinds is removed.
- AGENTS.md code rules; short `.md` files; one heavy command at a time through `python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py`.
- Tests write only into temporary folders. Never write under `C:/Users/rolan/.t3/worktrees`.

## Tests the plan must require

- A sealed unit of each of the two step kinds loses `bundle/.work` and keeps every other file; `UnitLedger.sealed_receipt` returns the same receipt afterwards.
- Not removed: the same folder in an unsealed step, in a step with `.running.json`, in a sealed `npc-profile-pack` step, in a lane not held free, and under `--plan` (which reports the folders and bytes).
- A leftover `.work.removing` goes in the next run; a folder with a file held open is left whole and counted as not removed.
- With the synthetic skill run of the existing tests (`tests/pipeline/test_skill_effect_conversion*.py` or their support modules): seal a root, remove its scratch through the pass, run the skills batch again: the root is a cache hit, no conversion starts, and the catalog bytes are equal.
- The whole suite once at the end against `C:/laragon/l2b-orchestration/autonomous-roadmap/pipeline-lane-after-roadmap-merge.log`.

## Proof the orchestrator runs afterwards

Plan mode against the real store (read only): folders and bytes it would remove, compared with the measured 11.1 GiB.
