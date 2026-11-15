---
phase: 02-stage-a-breadth
plan: 1
subsystem: native-store
status: complete
tags: [store-paths, output-guard, lanes, junction, pipeline]
requires:
  - phase: 01-foundations
    provides: Converter and asset.json v2 (01-12), the reference client guard (01-07), lanes.json (01-01)
provides:
  - scripts/native_store/store_paths.py, the single owner of reparse refusal, confined child paths, portable relative names, lane store paths and the converter output guard
  - Converter.__init__ and native_batch.prepare refuse any output outside a dedicated artifacts folder, under the realpath of public/l2 or through a junction or symlink
  - the scan test tests/pipeline/test_converter_output_guard.py for every lane entry point with --output
  - the measured unit and pipeline red baseline for later plans
affects: [02-02, 02-03, 02-04, 02-06, 02-08, 02-09, 02-17, every lane converter step]
tech-stack:
  added: []
  patterns:
    - "Converter outputs go through require_converter_output(project_root, output) as the first statement, before any read or mkdir"
    - "Path helpers come from native_store.store_paths only; no module defines its own checked or child"
key-files:
  created:
    - scripts/native_store/__init__.py
    - scripts/native_store/store_paths.py
    - tests/pipeline/test_store_paths.py
    - tests/pipeline/test_converter_output_guard.py
  modified:
    - scripts/native_assets.py
    - scripts/native_batch.py
    - scripts/stage_native_players.py
    - scripts/export-native-map-audio.py
    - scripts/export-native-sounds.py
    - scripts/stage_native_world_audio.py
    - scripts/stage_native_stepsound_package.py
    - scripts/stage_native_combat_audio.py
    - scripts/stage_native_stepsound_deco_grass.py
    - scripts/stage_native_animation_audio.py
    - scripts/native_assets_lib/animation_audio_bundle.py
    - scripts/native_assets_lib/combat_audio_bundle.py
    - scripts/native_assets_lib/effect_readiness.py
    - scripts/native_assets_lib/footstep_event_inventory.py
    - scripts/native_assets_lib/placement_audio.py
    - scripts/native_assets_lib/skill_audio_bundle.py
    - scripts/native_assets_lib/stepsound_deco_grass.py
    - scripts/native_assets_lib/stepsound_package_bundle.py
    - scripts/native_assets_lib/world_ambience.py
    - scripts/native_assets_lib/world_music.py
    - tests/pipeline/test_native_assets.py
    - tests/pipeline/test_native_assets_manifest_v2.py
    - tests/pipeline/test_native_texture_validation.py
    - tests/pipeline/test_umodel_import_closure.py
    - tests/pipeline/test_reference_client_guard.py
    - tests/pipeline/test_native_player_stage.py
    - tests/pipeline/test_native_batch.py
    - .planning/lanes.json
    - docs/OUTPUT_CONTRACT.md
    - .planning/OVERNIGHT-DECISIONS.md
    - .planning/phases/02-stage-a-breadth/deferred-items.md
key-decisions:
  - "Plan 02-01 ran without the self-contained repo merge, per the orchestrator: tool path constants untouched (OVERNIGHT-DECISIONS row 71)"
  - "Converter takes keyword-only project_root; export-native-map-audio.py and export-native-sounds.py pass their ROOT (row 74)"
  - "One relative-name rule with the stricter character set and unified messages (row 75)"
  - "The 5000 ms unit timeouts are recorded as the measured baseline; no timeout or worker count changed (row 77)"
  - "Converter caches under scratch/ are refused; converter outputs live only under artifacts/ (row 79)"
requirements-completed: []
duration: 25min
completed: 2026-11-08
commits: 3
plan_head_before: db2a9bd81c690a2751014963a690c30ecd75c016
plan_head_after: 693e4b2619d9ddb0fdadcb1c96e9ae8a04d92d2b
actuals:
  tokens: 47000
  tasks: 3
  commits: 3
---

# Phase 2 Plan 01: Store paths and output guard Summary

**One store-paths module now owns the reparse check, confined child paths, portable names, lane store paths and `require_converter_output`. `Converter` and `native_batch.prepare` call it first. Tests prove it against real NTFS junctions: an output through `public/l2` is refused before any byte is written.**

## Performance

- Duration: about 25 min (15:13 to 15:38 Riga, Sunday, outside the relay window)
- Tasks: 3 of 3
- Files: 33 changed in the three task commits, plus the docs commit

## Accomplishments

- `scripts/native_store/store_paths.py` (117 lines, standard library only) provides these names:
  - `StorePathError` and `ConverterOutputRefusedError`
  - `refuse_reparse_points`, `confined_child_path` and `require_portable_relative_path`
  - `read_lane_parts_by_name` and `require_known_lane_name`
  - `require_converter_output`
  - `lane_store_root`, `lane_work_root`, `lane_gap_rows_path` and `lane_load_check_path`
- `require_converter_output` refuses an output that is empty, `artifacts/` itself, outside `<project>/artifacts/`, under the realpath of `public/l2`, or reached through any junction or symlink. It creates nothing.
- Paths are compared by components and case-insensitively, so `ARTIFACTS/x` is accepted, while `PUBLIC/L2/x`, `public/l2x/x` and `artifacts-extra/x` are refused.
- `Converter.__init__` calls the guard as its first statement, before `require_reference_client` and before `mkdir`. The reference-client guard still runs for every client root.
- `native_batch.prepare` uses the guard in place of its old artifacts allowlist.
- The two copies of `checked`, `child`, `relative_name` and `safe_relative` are deleted. All 15 importers and both former owners call the store_paths names.
- `test_converter_output_guard.py` checks five things with AST scans:
  - the guard runs before `mkdir` in `Converter.__init__`
  - `native_batch.prepare` calls it
  - every `scripts/{world,actors,data}` entry point with `--output` calls it (none exist yet)
  - a negative sample proves the scan catches a missing call
  - the helpers have one owner
- `.planning/lanes.json` gives `scripts/build_dat_table_inventory.py` to data-ui. `docs/OUTPUT_CONTRACT.md` has a "Lane stores" section.

## Task commits

1. Task 1, tracer: store_paths guard bound in Converter and proven against a real junction - `565ed3d` (feat)
2. Task 2: one owner for the path helpers, the batch guard and the scan test - `3bfee36` (refactor)
3. Task 3: lanes.json amendment and the lane-store contract note - `693e4b2` (docs). The SUMMARY, decision rows and state are in the final docs commit.

The tracer gate passed: the Task 1 `<verify>` ran end to end, and the junction cases reported `ok`, not `skipped`.

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_store_paths.py" -v`: 20 tests ok, 0 skipped. All junction cases ran with `_winapi.CreateJunction`.
- `python -B -m unittest discover -s tests/pipeline -p "test_converter_output_guard.py" -v`: 5 tests ok.
- The Task 1 Converter suites:
  - `test_native_assets*.py`: 21 tests, 4 skipped, all skips present before this plan
  - `test_reference_client_guard.py`: 23 ok
  - `test_umodel_import_closure.py`: 4 ok
  - `test_native_texture_validation.py`: 8 ok
- `pnpm test:pipeline` at BelowNormal: 946 tests OK, 103 skipped. The pre-plan baseline was 921 OK and 103 skipped; this plan adds 25 tests.
- `pnpm vitest run tests/unit/laneOwnership.test.ts`: 36 of 36 passed.
- `node scripts/check-lane-ownership.mjs --base db2a9bd --part adapter-dispatch`: "lane integration: 0 foreign paths", exit 0.
- The comment and docstring scan (tokenize and ast) over every edited script and test file found nothing. `grep -c '"""'` prints 0 for each, and `wc -c < scripts/native_store/__init__.py` prints 0.
- `grep -rlE "from stage_native_players import.*\b(checked|child|relative_name)\b" scripts` prints nothing. `grep -rlE "^def refuse_reparse_points|^def confined_child_path|^def require_portable_relative_path" scripts` prints only `scripts/native_store/store_paths.py`.
- `git status --short public` shows nothing. No store-writing script ran, and every junction test wrote into its own temp folders only.

## Known red baseline

Measured at commit 3bfee36 on DATABASE-PC at BelowNormal, 2026-11-08 15:33 to 15:35 Riga, with no other test, build or dev server running.

`pnpm test:unit` (Vitest 5.1.0, 121 files, 1523 tests), three runs:

| Run | Riga time | Failed | Passed | Skipped | Failing cases |
| --- | --- | --- | --- | --- | --- |
| 1 | 15:33 | 2 | 1439 | 82 | the 2 nativeNpcProfiles cases |
| 2 | 15:33 | 3 | 1438 | 82 | the 2 nativeNpcProfiles cases and 1 nativeEffectRegistration timeout |
| 3 | 15:35 | 2 | 1439 | 82 | the 2 nativeNpcProfiles cases |

- `tests/unit/nativeNpcProfiles.test.ts > source-backed native NPC profile loading > uses one catalog snapshot and exact hashed metadata in https:` fails with "Error: Native player body source identity mismatch." at `validateNativePlayerAssets` (`src/assets/native/loadNativePlayerProfiles.ts:166`). It fails on every run.
- `tests/unit/nativeNpcProfiles.test.ts > source-backed native NPC profile loading > uses one catalog snapshot and exact hashed metadata in file:` fails with the same error on every run.
- `tests/unit/nativeEffectRegistration.test.ts > optional exact effect catalog registration > refuses a stale plan and preserves a newer door-owner catalog edit` failed with "Error: Test timed out in 5000ms." in run 2 only. The file alone passes 17 of 17 in 3.4 s.
- Test files: 1 failed, 115 passed, 5 skipped (121) in runs 1 and 3.

`pnpm test:pipeline` (unittest): 946 tests, OK, 103 skipped, 0 failures, at commit 3bfee36. Before the plan, at db2a9bd, it was 921 tests, OK, 103 skipped.

Compared with the research list:
- The 2 `nativeNpcProfiles.test.ts` cases matched and are deterministic.
- `nativeEffectStage.test.ts` did not fail in any of the three runs.
- The 23 to 26 failures that 02-10 logged at 14:35 Riga did not reproduce. On an otherwise idle machine at most one timeout appears.
- Decision (row 77): no timeout or Vitest worker count is changed. The timeout item stays open in deferred-items.md for a fixture-cost fix.

## Decisions made

OVERNIGHT-DECISIONS rows 71 to 79:
- precondition handling (71)
- `--part adapter-dispatch` (72)
- module names (73)
- the `project_root` keyword and the two export scripts (74)
- the unified character set and messages (75)
- lane names from the repository lanes.json (76)
- the red baseline decision (77)
- `step-sounds/` in the prefix list (78)
- converter outputs under `artifacts/` only (79)

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] The two export scripts pass their own project root to Converter**
- Found during: Task 1 (full pipeline run after binding the guard)
- Issue: `test_native_map_audio.py` and `test_native_sounds.py` run `export-native-map-audio.py` and `export-native-sounds.py` with `ROOT` patched to a temp project, so 41 cases were refused against the repository's `artifacts/`.
- Fix: both scripts call `Converter(snapshot, output/'cache', args.umodel, project_root=ROOT)`. Their module docstrings became `MAP_AUDIO_EXPORT_DESCRIPTION` and `SOUND_EXPORT_DESCRIPTION`. The plan had said these call sites stay unedited.
- Files: `scripts/export-native-map-audio.py`, `scripts/export-native-sounds.py`
- Commit: 565ed3d

**2. [Rule 1 - Bug] The reparse check reads attributes through `Path.lstat`**
- Found during: Task 2
- Issue: the first version used `os.lstat`. That bypassed the `Path.lstat` seam that `test_stage_native_animation_audio.py` patches to fake a reparse point, so the stager no longer refused.
- Fix: `is_reparse_entry` calls `entry.lstat()`, as both old copies did.
- Files: `scripts/native_store/store_paths.py`
- Commit: 3bfee36

**3. [Rule 3 - Blocking] `tests/pipeline/test_native_batch.py` updated**
- Found during: Task 2
- Issue: it called `batch.safe_relative` and expected "artifacts subdirectory".
- Fix: it imports `require_portable_relative_path` from store_paths and expects "converter output must be a dedicated folder under". Its comments and docstring were removed.
- Commit: 3bfee36

**4. [Rule 2 - Missing test] `native_batch.prepare` refusal test**
- Added `NativeBatchBindingTests` to `test_store_paths.py`. It covers `prepare` with a `public/l2` junction output and with `artifacts` itself, and checks that the junction target snapshot is unchanged.
- Commit: 3bfee36

**5. [Code rules] Renames where removed comments carried meaning**
- In `stage_native_players.py`, `browser_string` is now `is_browser_string_within_utf16_units`, and the 96 MiB literal is now `MAXIMUM_MODEL_JSON_CHUNK_BYTES`.
- The unused `stat` imports in `native_batch.py` and `stage_native_players.py` are removed.

**6. [Docs accuracy] `step-sounds/<sha>/` added to the Lane stores prefixes**
- A read-only listing of `public/l2` and `catalog.json` shows the prefix in use (row 78).

### Precondition

The plan's decision I check fails: `scripts/stage-world-assets.mjs` and `src/scene/world/foliageCutout.ts` exist, and no `native-tools` default is present. The self-contained repo commit has not landed on native-world-slice. The orchestrator dispatch said to run the plan anyway, so this plan touches no tool path constant and adds no path into the retired sibling workspaces (row 71). When that merge lands, it changes `UMODEL` in `scripts/native_assets.py`. This plan changed only the import block, `REPOSITORY_ROOT` and `Converter.__init__` there, so the overlap is at most adjacent lines.

## Issues encountered

- In this session the Bash guard refuses `cmd //c start /belownormal` and `powershell.exe`. Heavy runs used an ignored scratch wrapper (`artifacts/scratch/02-01/run_below_normal.py`) that calls `SetPriorityClass(BELOW_NORMAL)` on itself, so its children inherit the priority. All throwaway scripts live in the ignored `artifacts/scratch/02-01/`.

## Process cleanup

Every command this plan started ran in the foreground, or ran in the background to completion with the exit reported. `ps -W` at 15:35:46 Riga lists only these python and node processes:
- node.exe 71236, 71240 and 91264, started Oct 29
- python.exe 95412, started 21:43:32

None was started by this plan. No dev server, Vite preview, Playwright or browser was started.

## Next phase readiness

- Later lane converters import `require_converter_output` and the `lane_*` paths from `native_store.store_paths`. 02-17 widens the scan test to `scripts/native_catalog/cli.py`.
- INT-01 and CONV-01 stay Pending: plans 02-02 to 02-09, 02-17 and 02-55 deliver the rest of each requirement.

## Self-Check: PASSED

- FOUND: scripts/native_store/__init__.py, scripts/native_store/store_paths.py, tests/pipeline/test_store_paths.py, tests/pipeline/test_converter_output_guard.py
- FOUND: commits 565ed3d, 3bfee36, 693e4b2 on HEAD
