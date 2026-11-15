# Phase 2 deferred items

Out-of-scope problems found while executing a plan. Each is left for its owning plan.

## Found during 02-10

- `pnpm test:unit` on DATABASE-PC at BelowNormal, 2026-11-08 14:35 and 14:37 Riga, at commit c6b2e3f: 23 and then 26 failing cases. All but the 2 known `nativeNpcProfiles.test.ts` cases ("Native player body source identity mismatch") are 5000 ms timeouts, and the failing set changes between runs: nativeEffectStage, nativeEffectRegistration, nativeTerrainPreview, nativeMaterialGraph, nativePowerStrikeSource, nativeDeathCuePreview, nativeEffectRetained, nativeEnvironmentStage, nativeFlameMaterials, nativeCombatAudio and laneOwnership. Run alone, the first 8 files fail only on the 2 nativeNpcProfiles cases. None of these files depends on `src/world` behaviour (nativeDeathCuePreview imports only the `WorldEntity` type). Owner: 02-01, which records the real red baseline; a fix must remove the load contention, not raise the timeouts.
  - 02-01 measured it (see 02-01-SUMMARY.md "Known red baseline"): three `pnpm test:unit` runs at BelowNormal with no other test or build running, 2026-11-08 15:33 to 15:35 Riga, at commit 3bfee36. Runs 1 and 3: only the 2 nativeNpcProfiles cases fail. Run 2: those 2 plus one 5000 ms timeout in `nativeEffectRegistration.test.ts` ("refuses a stale plan and preserves a newer door-owner catalog edit"); that file alone passes 17 of 17 in 3.4 s. So the timeouts come from parallel load, and the 14:35 runs were heavier than an idle machine. 02-01 decision (OVERNIGHT-DECISIONS row 77): no timeout or worker count is changed. The item stays open for the integration thread. A fix makes the slow fixtures cheaper (for example nativeEffectRegistration copies and hashes real Power Strike resources per case) and never adds a longer timeout. Resolved 2026-11-09 (OVERNIGHT-DECISIONS row 300): root causes were CPU oversubscription and avoidable fixture work; fixed with cheaper fixtures, one helper owner and Vitest `maxWorkers: "50%"`.

## Found during 02-12

- `pnpm vitest run tests/unit/laneOwnership.test.ts`, 2026-11-09 01:06 Riga, at commit 7ee97ad: 1 of 36 fails, "has an evidence doc for adapter-dispatch under 30 KB": `docs/parts/adapter-dispatch/EVIDENCE.md` is 33,680 bytes. Plan 02-12 did not touch that file (lane integration). Owner: the adapter-dispatch evidence writer (02-57, 02-59, 02-60), which must shorten the doc to its current facts.

## Found during 02-20

- `pnpm test:unit`, 2026-11-09 01:34 Riga, at commit 92e27d2: 15 failed of 1,878. Rerun of the 7 failing files alone: only the known `laneOwnership.test.ts` adapter-dispatch evidence size case fails (33,680 bytes, recorded under 02-12); the others are parallel-load timeouts as in the 02-01 baseline, plus the 2 known `nativeNpcProfiles` cases. Plan 02-20 touched none of those files.

## Found during 02-27

- `scripts/data/convert_tables.py` merges `tables` records with `TABLES_CATALOG_CAPACITY = 40`, and the capacity counts every record of the slice, including the three derived name index records. The data-ui lane holds 36 records now and 02-28 adds at most 3, so nothing is refused today; the plan that fixes the eula-e, questname-e, servername-e or sysstring-e decode makes the 41st record and must raise the capacity to the inventory rows plus the name indexes (OVERNIGHT-DECISIONS row 295).
- PERF-02 (OVERNIGHT-DECISIONS row 302): native route startup parses and walks the fighter's 24.8 MB glTF JSON in four owners (catalog, cue preview, `NativeActor`, Power Strike) plus once per bone anchor in `sourceBoneBinding`, all on the main thread. Give model inspection one owner (computed once per model byte array) when Phase 6 measures startup.

## Found during 02-44

- `tests/unit/nativeWindowLayoutTree.test.ts` "parses every window manifest the layout step wrote to the data-ui lane store" timed out at the 5,000 ms default inside the full `pnpm test:unit` run (164 workers at lowered priority) and passes alone in 431 ms. It reads every real data-ui window manifest; the data-ui part owns it (a per-test timeout or a cheaper read).

## Found during 02-71

- `pnpm test:editor`, 2026-11-09 18:45 Riga, on branch `plan/autonomous-roadmap`: `tests/editor/editorGeometryCompat.test.ts` refuses its fixture: `tests/fixtures/editor-5.5.3-geometry.cjs` is `i/lf w/crlf` in this CRLF checkout, so it reads 4,686 bytes instead of the pinned 4,597 and fails "Installed Editor writer fixture changed". Plan 02-71 did not touch that fixture or test; a `.gitattributes` eol rule for the fixture is the fix (same cause as the vendored BSP reader pin). `tests/editor/nativeEditorScene.test.ts` timed out at 5,000 ms only while the pipeline suite ran beside it and passed on the idle rerun.
- `src/materials/ue2/model/constants/combinerConstants.ts:43` cites `scripts/native_sky.py:166` for the sky RGBA colour order; that line already held the texture receipt before 02-71, and the colour tag read is now `scripts/native_sky.py:160`. The render-materials owner re-points or drops the line citation; 02-45 deletes `native_sky.py`.

## Found during 02-48

- `pnpm test:unit`, 2026-11-10 02:48 Riga: `tests/unit/laneOwnership.test.ts` "has an evidence doc for player-characters under 30 KB with the three sections" fails because `docs/parts/player-characters/EVIDENCE.md` (actors lane, last edited by 02-40) has `## Passes now` and `## Open` but no `## Evidence` heading. 02-48 did not touch that doc; the actors part adds the heading. Every other test passes (2,430 passed, 72 skipped).

## Found during 02-82

- `python scripts/test_pipeline.py`, 2026-11-11 17:55 Riga: `test_converter_output_guard.ConverterOutputGuardScanTests.test_every_lane_entry_point_with_an_output_option_calls_the_guard` fails on `scripts/world/terrain_seam_facts.py` (added by 02-81 commits 445b6a8 and 35c51a4), an entry point with an output option that does not call the converter output guard. 02-82 did not touch that file; every other test passes (2,145 run, 57 skipped). Resolved in 7f6659f: the option is dropped and the script writes its committed path through require_committed_destination.

## Found during 02-85

- `python -B -m unittest discover -s tests/pipeline -p "test_converter_output_guard.py"`, 2026-11-12 17:34 Riga: `test_every_lane_entry_point_with_an_output_option_calls_the_guard` fails on `scripts/actors/character_class_sources.py` (added by 02-83 commit 2d018f8, actors lane), an entry point with an output option that does not call the converter output guard. 02-85 did not touch that file; the other 11 cases pass.

## Found during 02-97

- `python scripts/test_pipeline.py`, 2026-11-13 22:30 Riga: `test_world_tile_general_steps.TileGeneralWorldStepTests.test_no_world_step_module_names_a_tile_identity_or_the_20_20_map_hash` fails on `scripts/world/convert_tile_batch.py:257`, the `--retry-tiles` usage error text `like 17_18` added by 02-96. Outside the minimap files this plan changes; the fix is a tile-free example in that message. The same run also failed `test_client_entry_points` on the new route command, fixed by this plan in 038466f.
