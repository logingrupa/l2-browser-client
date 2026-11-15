---
phase: 261114-c7v-converter-version-is-a-fixed-value
verified: 2026-11-14T00:29:04Z
status: passed
score: 6/6 must-haves verified
covered_files:
  - .planning/quick/261114-c7v-converter-version-is-a-fixed-value/261114-c7v-PLAN.md
  - .planning/quick/261114-c7v-converter-version-is-a-fixed-value/261114-c7v-SUMMARY.md
  - docs/BATCH_PIPELINE_SPEED.md
  - docs/OUTPUT_CONTRACT.md
  - scripts/native_assets.py
  - tests/pipeline/test_actor_sound_slice_bookkeeping.py
  - tests/pipeline/test_converter_implementation_hash.py
  - tests/pipeline/test_native_assets_source_cache.py
covered_digest: "v4:sha256:e130d3f8d8724270dc69a2c4ab332bc9741903b5d4f0c4a4b38ee2fd96e5214e"
behavior_unverified: 0
overrides_applied: 0
---

# Quick task 261114-c7v: verification report

**Goal:** `implementation_hash()` returns a fixed converter output version equal to the value the real store is sealed under, a guard test replaces the byte hash, and no sealed unit goes stale.
**Status:** passed. No gaps. Five warnings for the integration thread, none blocks the goal.
**Method:** code read at HEAD `876d296`; both task 1 gate commands run here; probes run in a temporary folder outside the repository (deleted); the real store read only (81 receipts, listings).

## Must-haves

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | `implementation_hash()` returns the constant and reads no file | VERIFIED | `scripts/native_assets.py:37`, `:161-162` (one `return`). Gate part 2 exits 0 and prints `c4bf8e6c...2bd8`. Point 4 below. |
| 2 | Only `scripts/native_assets.py` changes among hashed or pinned files | VERIFIED | Point 5 below. `.planning/PROJECT.md` and decision logs untouched (`git diff --name-only 3cdfc1e HEAD`: the six plan files). |
| 3 | Guard: one value for LF and CRLF, matches its record, fails after one byte | VERIFIED | Point 3 below. Gate part 1: 64 tests OK in 8.1 s; the guard file alone: 7 OK. |
| 4 | A request key and a unit fingerprint equal the values of the unchanged code patched to the constant | VERIFIED | An export of `ee9c2b8` in the temporary folder, `implementation_hash` patched to the constant: index stem `7cbe13a2...fb78` (also equal to `sha(json_bytes({request, implementation, umodel}))` by hand) and first sound unit fingerprint `e0b0b5e9...c13c`. Both equal the two literals in the tests. |
| 5 | Both docs state the fixed version, the guard and the still-hashed files | VERIFIED | `docs/OUTPUT_CONTRACT.md:35`, `:44-53`; `docs/BATCH_PIPELINE_SPEED.md:20-29`. Every site and file of the list was read in the code and is right. No `frozen` left, no dash, plans line updated. |
| 6 | The suite has no FAIL or ERROR line the baseline lacks | VERIFIED | `pipeline-261114-c7v.log`: 2,578 tests, 2,510 ok, 66 skipped, 2 ERROR. Baseline: 2,571, 2,503, 66, 2. The two ERROR lines are the same. Per-test comparison: no status differs; 3 names only in the baseline (renamed or moved), 10 only in the run (those 3, 6 new, 1 from `c065522`). R1 `index` holds 4 keys. |

Artifacts and key link: the constant is in `scripts/native_assets.py:37`; `RECORDED_CONVERTER_SOURCE_DIGEST` is in `tests/pipeline/test_converter_implementation_hash.py:17`; the guard calls `implementation_source_paths()` at `:62`, `:114`, `:118`, `:126`, `:131`.

## The six points

**1. Real store, read only.** `implementation_hash()` of this checkout is `c4bf8e6cf5f61bddf65a35e6fb65f6af34199e0589b978930aeb92d2f15a2bd8`. Sealed counts per step sum to 6,224. Sampled receipts, 8 per step spread over the listing (1 for minimap-route, which has one unit): every seal matches its receipt, every fingerprint is reproduced from `algorithmVersion`, `config` and `inputs`, and every recorded converter value equals the constant.

| Step | Sealed | Config field | Code that fills it |
|---|---|---|---|
| actors/actor-sound | 909 | `converterSha256` | `actors/actor_sound_conversion.py:104`, `:197` |
| actors/characters | 14 | `converterSha256` | `actors/character_conversion.py:107` |
| actors/items | 3,684 | `converterSha256` | `actors/item_conversion.py:89`, `:105` |
| actors/npc-model | 539 | `converterSha256` | `actors/convert_actors.py:82`, `:132` |
| actors/skill-effect-root | 245 | `tools.converterSha256` | `actors/skill_effect_conversion.py:151` |
| data-ui/textures | 248 | `converterIdentity.implementation` | `data/convert_ui.py:162` |
| world/bsp, meshes, movers | 146 each | `converterSha256` | `world/bsp_step.py:60`, `static_mesh_step.py:95`, `mover_step.py:69` |
| world/minimap | 146 | `converterSha256` | `world/minimap_step.py:57` |
| world/minimap-route | 1 | `converterSha256` | roadmap worktree only: `world/minimap_route_step.py:67` |

Proof that nothing goes stale: the old byte formula over the roadmap worktree's present bytes (40 CRLF, 15 LF) gives `c4bf8e6c...`, the constant; the roadmap worktree's `native_assets.py` is byte-equal to the pre-change file (`a7c4f1ae...`); a merge of this lane changes no other script. So every config the roadmap code builds is the same before and after.

Steps where another value of the same config differs between this checkout and the roadmap worktree:
- **movers** (146): `classDefaultsReceiptSha256` comes from the class-defaults unit, whose `implementationSha256` and `helperSha256` hash `world/mover_class_defaults.py` and `native_catalog/extract_ue_defaults.ps1`. Both are CRLF there and LF here (content equal). Recorded values match the roadmap bytes only.
- **characters** (14): the class sources result holds `classDefaultParserSha256` over `class_defaults.py`, `effects.py`, `extract_ue_defaults.ps1`, all CRLF there and LF here.
- **minimap** (146): not a byte value. This lane's step is algorithm version 1 with `joinAlgorithmVersion`; the store is sealed under version 2 with `routeFingerprint`. The roadmap branch is 45 commits ahead of the merge base `3cdfc1e`.
- **minimap-route** and **skill-dispatch-class**: this checkout has no code for them.
- No difference: actor-sound, items, npc-model, textures, bsp (`polyFlagsSha256` is canonical JSON), meshes, skill-effect-root (its three tool files are LF and byte-equal in both trees).
- Outside the eleven: actor-sounds bundles (`builderSha256`, 6,575) and npc-profile-pack (8 of 9 pins) match the roadmap bytes only.

**2. Other places that turn source bytes into a seal or cache decision.** None is in scope (decision 6). Each one found by `hash_file`, `file_hash`, `__file__` and `read_bytes` greps is in the docs list: `native_actor_profiles.py:83-86`; `actors/skill_effect_conversion.py:45`, `:152`; `native_effect_bundle.py:68`; `actors/actor_sound_conversion.py:105`; `world/mover_class_defaults.py:127`; `native_assets_lib/class_defaults.py:22-23`, `:171`; `native_catalog/effects.py:295`, `:478-480`; `native_batch_adapters.py:116-137`; `native_batch.py:123`, `:128`; `export-native-sounds.py:52-56`; `native_environment.py:175`; `audit_musveren_weights.py:239`. `scripts/native_assets.py` itself is hashed only by `adapter_pins` (old route, R2). Not in the docs list and not a seal decision: tool pins compared with constants (`UMODEL_SHA256`, `UELIB_SHA256`, Elbera pins, the DDS plugin pins of `world/sky_materials.py:91-92`); the bytes of `powershell.exe` and the Python version inside profile and effect tool pins; recipe byte pins of the old routes (`native_batch.py:120`, `native_migration.py:129-133`, `:268`); provenance-only self hashes (`native_texture_png.mjs:47`, `native_editor_import.mjs:74`, `native_editor_scene.mjs:339`, `build_reference_client_lock.py:188`).

**3. The guard.** Own implementation of the digest and the test's function agree. LF copy (0 files with CRLF) and CRLF copy (55 of 55) both give `a2321966fe9a00d7ee0416f2fbd1d966aac4907fc4e6f8b7e0bbf7d28aefa20a`, the recorded value and the value of this checkout. One flipped byte in the middle of `native_assets_lib/weights.py` gives `816dec75...`, and `require_recorded_converter_source_digest` raises with both digests and the way out; the restored copy gives the recorded value again; one added file in `native_assets_lib` changes the digest. Roadmap worktree: 55 files, same names, digest `060b3870...`. Exactly one file differs in content, `native_assets.py`, and it is this task's edit, so the digest there equals the recorded one after the merge.

**4. One changed byte.** A copy of the scripts tree of HEAD in the temporary folder: `implementation_hash()` is the constant before and after one byte is appended to `native_assets_lib/gltf.py`. Control, the same copy of `ee9c2b8`: `8c45da55...` before, `b12b2325...` after.

**5. The diff.** `git diff --name-only fd2cd24 HEAD -- scripts` names 24 files. Intersected with the 55 sources: only `scripts/native_assets.py`. Intersected with every file another fingerprint hashes: none. `git diff fd2cd24 HEAD -- scripts/native_assets.py`: 2 insertions, 2 deletions, the constant line and the body of `implementation_hash`; 811 lines as before.

**6. Leftovers.** `hash_file` is still used (`native_assets.py:173`, `:554`, `:564`, `:721`, `native_migration.py`, `native_source_stage.py`). No source hash cache existed or was left. No comment added; the changed test files hold none; no debt marker. Findings are W3, W4 and W5 below.

## Warnings (none fails a must-have)

- **W1. This checkout cannot drive the real store.** See point 1: minimap, minimap-route, skill-dispatch-class by code, movers and characters by line endings. The change must reach the store by a merge into the roadmap branch, which touches only `native_assets.py` among scripts.
- **W2. The merge conflicts in one hunk.** A three-way merge of `tests/pipeline/test_actor_sound_slice_bookkeeping.py` (base `3cdfc1e`, roadmap `d3c3da1`, this lane) conflicts at the `outcomes = run_actor_sound_slice(...)` line and the assertions below it: the roadmap added a third argument `[]`, this lane changed the next lines. Keep the roadmap call and this lane's assertions, then run the five test files of the task 1 gate there.
- **W3. One stale twin test.** `tests/pipeline/test_item_conversion_run.py:100` `test_a_run_hashes_the_converter_and_reads_the_client_lock_once_for_all_of_its_units` still asserts `implementation_hash.call_count == 1`. Nothing is hashed any more; its sound twin was renamed and changed by this task, this one was not.
- **W4. One new test passes without exercising anything.** `test_changed_bytes_and_flipped_line_endings_leave_the_version_unchanged` patches `implementation_source_paths`, which `implementation_hash()` no longer calls. The context allows a patched file list; the real proof is point 4.
- **W5. `implementation_source_paths()` has only test callers now** (kept by decision 3 as the guard's list). The list equals the old hash list, so it still lacks modules that listed files import lazily: `native_store/canonical_json.py`, `native_store/catalog_writer.py`, `native_store/native_material_program_pins.py`, `stage_native_players.py`, `stage_native_runtime.py`, three `world/` readers.

## Notes

- A twelfth step holds the converter hash: `actors/skill-dispatch-class`, 32 sealed, all equal to the constant. Plan, context and summary count eleven steps and 6,224 receipts; with it the count is 6,256.
- The guard is a test. No conversion checks the digest, so an edited source converts under the unchanged version until the suite runs (accepted, T-c7v-01).
- Converter outputs with a rigid attachment or an animation family embed `helperSha256`, the raw bytes of `extract_ue_defaults.ps1` (`native_assets.py:481`). One request key can therefore give different archive bytes in an LF and a CRLF checkout. This matters for the byte comparison the guard asks for.
- This lane's own store: the 8 receipts of tiles 15_20 and 18_20 hold `0bb618...` and are stale here (allowed, plan item 5).
- A `convert_actors.py --batch skills --limit 235` run of another session (PID 45464, started 02:08:17) was running during this verification and was left alone. Nothing this verification started is left.

_Verifier: Claude (gsd-verifier)_
