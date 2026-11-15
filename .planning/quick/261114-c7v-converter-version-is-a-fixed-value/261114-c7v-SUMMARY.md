---
phase: 261114-c7v-converter-version-is-a-fixed-value
plan: 01
subsystem: asset-pipeline
tags: [converter-version, fingerprints, guard-test]
requires: []
provides: [fixed converter output version, converter source guard]
affects: [scripts/native_assets.py, every request key and unit fingerprint that holds the converter hash]
key-files:
  modified:
    - scripts/native_assets.py
    - tests/pipeline/test_converter_implementation_hash.py
    - tests/pipeline/test_native_assets_source_cache.py
    - tests/pipeline/test_actor_sound_slice_bookkeeping.py
    - docs/OUTPUT_CONTRACT.md
    - docs/BATCH_PIPELINE_SPEED.md
decisions:
  - implementation_hash() returns the constant c4bf8e6c... and reads no file
  - The guard digest of this checkout is a2321966fe9a00d7ee0416f2fbd1d966aac4907fc4e6f8b7e0bbf7d28aefa20a
metrics:
  completed: 2026-11-14
  tasks: 2
actuals:
  tokens: 36000
  tasks: 2
  commits: 2
plan_head_before: ee9c2b85ef2d5f6eb7f4c79e4c6f2772557f9273
plan_head_after: 876d2961b4c460ee7e84d6f2221e629d44510641
status: complete
---

# Quick task 261114-c7v plan 01: the converter version is a fixed value - summary

`implementation_hash()` now returns a hand-set constant, the value the real store is sealed under; a guard test hashes the 55 converter sources (CRLF read as LF) against a recorded digest.

## Task 1: the constant, the changed tests and the guard - `a861e0f`

- Gate: 64 tests OK in 8.0 s (58 at HEAD); `implementation_hash()` prints `c4bf8e6cf5f61bddf65a35e6fb65f6af34199e0589b978930aeb92d2f15a2bd8`.
- `scripts/native_assets.py`: 2 insertions, 2 deletions, 811 lines as before. Its SHA-256 is now `f5bb699a...`.
- Guard digest (`RECORDED_CONVERTER_SOURCE_DIGEST`): `a2321966fe9a00d7ee0416f2fbd1d966aac4907fc4e6f8b7e0bbf7d28aefa20a`, computed after the edit (before it: `060b3870...`).
- Golden values, read from the unchanged code with `implementation_hash` patched to the constant, twice each with equal results:
  - `MEDIA_REQUEST_KEY_UNDER_THE_CONVERTER_OUTPUT_VERSION` `7cbe13a29e5dd8dff91794646ae911241bef77dbb97c4fa97b6f6a467959fb78`: stem of the single `index` file after `SourceDigestMemoTests` converts `MEDIA_REQUEST`.
  - `FIRST_SOUND_UNIT_FINGERPRINT_UNDER_THE_CONVERTER_OUTPUT_VERSION` `e0b0b5e96ef673a264fa6dae580904668576043953e59b538e35f2c8ac20c13c`: `sound_works[0].fingerprint` in `ActorSoundHashReuseTests`.
- Red first: before step D the five new or renamed tests failed (2 failures, 3 errors of 26).

### R2 evidence (precondition, read only)

| Checkout | `batch.json` folders | `native_assets.py` SHA-256 before the edit |
|---|---|---|
| `C:/laragon/www/l2b-speed` | 0 | `a7c4f1ae...` |
| roadmap worktree | 0 | `a7c4f1ae...` |
| `C:/laragon/www/l2-browser-client` | 11, all under `artifacts/native-parity/research` | `442bf173...` |

All 11 `owner.json` pin `fb6de3de...` (three of them also hold jobs without the pin). No pin equals any of the three file hashes, nor the new `f5bb699a...`.

## Task 2: the two docs and the whole suite - `876d296`

- Suite log: `C:/laragon/l2b-orchestration/autonomous-roadmap/pipeline-261114-c7v.log`. Gate exits 0.

| | Tests | ok | skipped | ERROR | FAIL | Time |
|---|---|---|---|---|---|---|
| Baseline `pipeline-261113-h7k.log` | 2,571 | 2,503 | 66 | 2 | 0 | 376 s |
| This run | 2,578 | 2,510 | 66 | 2 | 0 | 445 s |

- The two ERROR lines are the baseline's: `test_world_audio_step` 20_20 ambient counts and `test_world_bsp_step` 20_20 brush nodes.
- Tests whose status differs between the logs: none. Names only in the baseline: the three renamed or moved tests. Names only in this run: those three under their new names, the six added tests, and `test_share_identical_lane_files...test_a_new_twin_whose_name_sorts_first...` (added by `c065522`, after the baseline).
- Tests whose outcome changed because this lane store was sealed under `0bb618...`: none. Both `ConversionClientDiagnosticSlotTests` stayed `ok`; they converted again instead of hitting the cache (R1).

### R1 folder `artifacts/lane-store/integration/work/diagnostic-slots`

| Index key | Folder | Asset | Version | When |
|---|---|---|---|---|
| `25be4977...` | `ffecb0b6...` | `rhion_orc_dungeon_s.rhion_orc_dungeon48` | `0bb618...` | before |
| `bb61d6df...` | `20d375ef...` | `FX_E_S.Flameset.Default_Flame01` | `0bb618...` | before |
| `7e46d9bffca08bb4fea740e6c0c4046452f0c9916b0f872e64db1d189ab09ec0` | `97862dee38add95777de4545e3d7e7ccaaa3671dc070eb2ea5513c62378e802e` | `FX_E_S.Flameset.Default_Flame01` | `c4bf8e6c...` | new |
| `fc875281542aa987d3c750864be583f333a6dd497a72bc2a083f1515d852c979` | `7301e7abcb197bf22a0dd17a56c91b7315bbc78a2417b28e88faa8be2a8454f5` | `rhion_orc_dungeon_s.rhion_orc_dungeon48` | `c4bf8e6c...` | new |

### On-disk holders of the converter hash

| Holder | Measured in this run |
|---|---|
| Real store receipts of the 11 steps | No. The orchestrator's listing: 6,224 receipts, one value |
| This lane's receipts of tiles 15_20 and 18_20 (bsp, meshes, minimap, movers) | Yes: 8 receipts, all `0bb618...` |
| `index` keys, `provenance.json`, `asset.json` of the R1 cache | Yes: table above |
| The two converter caches of this lane's world lane (`sound-converter` 143 index keys, `static-mesh-converter` 182) | Keys counted; archive members not read |
| Published archives `<lane>/l2/<sha>/asset.l2asset` (`converterVersion`, `converterSha256`) | No. Nothing on the new route compares them at read |
| `owner.json` of old batch outputs | Yes: R2 above |
| `export-native-sounds.py` outputs, converter caches outside lane stores | No; none in the real store |
| `artifacts/native-parity/migration` | Absent here (only `research` exists); elsewhere `test_native_material_graph.py:75` errors under another value |

## Deviations from plan

- **Commit order of task 2.** The plan commits the docs in step B, before the suite. The orchestrator's constraint commits a task after its gate, so the docs were committed after the suite passed.
- **`ConverterImplementationHashTests` and `ConverterSourceGuardTests` share a small base class** (`TemporaryScriptsRootTestCase`) for the temporary folder; four one-line byte changers are module functions passed to `copied_converter_sources`.
- **Docs list.** `native_batch_adapters.py:116-137` is listed with every file its adapters hash, read at the site.

## Notes for the orchestrator

- Two `pythonw.exe` processes (PIDs 10652, 11676, started 2026-11-13 15:24 by the task scheduler) have an unreadable command line. No process named `scripts/test_pipeline.py`; the suite was started on that evidence.
- A `convert_actors.py --batch skills --limit 235` run of another session started at 02:08:17, during the suite, and was left alone. It explains the longer wall time. This checkout has no `actors` lane, so it does not write here.
- No python process of this run is left.

## Self-check: PASSED

- `a861e0f` and `876d296` are ancestors of HEAD; `git diff --name-only ee9c2b8 HEAD` names exactly the six files of `files_modified`.
- Among hashed or pinned files only `scripts/native_assets.py` changed.
