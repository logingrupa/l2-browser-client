---
phase: 02-stage-a-breadth
fixed_at: 2026-11-11T08:28:38+02:00
review_path: .planning/phases/02-stage-a-breadth/02-REVIEW.md
iteration: 1
findings_in_scope: 63
fixed: 62
skipped: 1
status: partial
---

# Phase 2: code review fix report

Fix scope critical and warning: the 1 critical and 62 warning findings that at least two of three checkers confirmed in 02-REVIEW.md. Two fixer lanes ran at the same time in this worktree, pipeline scripts (slices 01 to 11) and browser code and tools (slices 12 to 21), one gsd-code-fixer per slice in order. 62 fixed, 1 deferred to NET-09. Every fixer re-read and confirmed its finding first; where the cited line had moved, the entry says where the code is. Behaviour fixes ship with a test, in most cases shown failing before the fix; dead-code and duplicate-owner fixes keep their existing tests green; test-only fixes were mutation-checked where the entry says so. Every slice passed `pnpm typecheck` and left no process running. Info findings are out of scope.

## Fixed Issues

### CR-01: Distance fog never applies in the right-handed native scene: view depth is negative

**File:** `src/materials/ue2/babylon/material.ts:88`
**Commit:** 339ebb5
**Test:** `tests/unit/fogViewDepth.test.ts` (negates view-space z in a right-handed scene, keeps it in a left-handed one; real Babylon view z and the generated material and particle vertex sources)
**Applied fix:** The native material and particle vertex stages take fog depth from one owner, `forwardViewDepthExpression(scene, viewSpacePosition)` in the new `src/materials/ue2/babylon/fogViewDepth.ts`, which negates view-space z when `scene.useRightHandedSystem` is set. The sign comes from handedness rather than `abs()`, so the depth stays linear on triangles that cross the camera plane.

### WR-01: is_sound_package_reference holds an `if False else` branch that can never run

**File:** `scripts/actors/actor_sound_conversion.py:90`
**Commit:** 04944e9
**Test:** existing `tests/pipeline/test_actor_sound_bindings.py` and `test_actor_sound_bundle_reseal.py` pass unchanged
**Applied fix:** Removed the unreachable arm. The check reads `lock_equal_paths_by_stem` through `package_name_of` from `actor_census`, so the package-name split has one owner. No behaviour change.

### WR-02: data-ui manifest path from the lane catalog is not confined, and the logic has a second, stricter owner

**File:** `scripts/actors/actor_sound_conversion.py:128`
**Commit:** 84baad2
**Test:** `tests/pipeline/test_data_ui_table_manifest.py` (a manifest path escaping the data-ui store and a wrong byte length refused by the sound route, an escaping NPC profile manifest refused, and more)
**Applied fix:** `data_ui_table_manifest` moved to the new `scripts/actors/data_ui_table_manifest.py` (since c92ccee in `scripts/native_store/`), the one owner for the character, item and sound routes; the sound route keeps only its own client-table check as `required_data_ui_table_manifest`. The new `native_resource_store_path` in `npc_store_records` requires the `/l2/` prefix and confines the path, and the NPC profile reads go through it; the now unused `CharacterConversionError` is deleted.

### WR-03: Sound and bundle refusal reasons keep absolute host paths

**File:** `scripts/actors/actor_sound_conversion.py:214`
**Commit:** 9297264
**Test:** `tests/pipeline/test_actor_sound_refusal_reasons.py` (a refused sound conversion and a refused bundle build seal reasons without host, lane or client paths)
**Applied fix:** The sound refusal goes through `path_free_reason` with the client root and `converter.output`; the bundle builder refusal uses the client root and the lane folder, which holds the recipe under `work/` and the store under `l2/`.

### WR-04: The character census reports receipts whose fingerprint is stale as current results

**File:** `scripts/actors/character_census.py:207` (the code is at line 60)
**Commit:** 4cb97cd
**Test:** `tests/pipeline/test_character_conversion_run.py` `test_the_census_reports_rows_sealed_under_an_older_converter_as_pending`
**Applied fix:** The new `current_character_receipt` computes each row's current fingerprint through `run.unit_work` and reports a receipt only when `ledger.is_sealed` confirms it; every other row is pending.

### WR-05: The character conversion run, batch and census have no pipeline test

**File:** `scripts/actors/character_conversion.py:398` (the file has 189 lines)
**Commit:** dd40169
**Test:** `tests/pipeline/test_character_conversion_run.py` (7 cases: cache hit, refused conversion, padding row, batch limit, census counts, stale census, reconversion gap) and `tests/pipeline/test_data_ui_table_manifest.py` (SHA-256 and locked-source refusals)
**Applied fix:** Test-only. A synthetic `CharacterConversionRun` runs over the real `UnitLedger`, census file shape and gap-row validation, faking only `converted_model_reason`, `implementation_hash` and the archive store-file builder.

### WR-06: A character that turns into a gap on reconversion keeps its old model record in the store catalog

**File:** `scripts/actors/character_conversion.py:426` (the code is at line 181)
**Commit:** b587d05
**Test:** `tests/pipeline/test_character_conversion_run.py` `test_a_row_reconverted_into_a_model_gap_loses_its_catalog_model_record`; `tests/pipeline/test_actor_sound_bundle_reseal.py` (a bundle resealed without a manifest, a bundle that loses its sound row)
**Applied fix:** The new `write_catalog_without_record` in `npc_store_records` removes the `character-model` or `actor-sounds` record when the sealed outcome has no outputs or a bundle loses its sound row, and writes the catalog only when a record was removed. `write_model_record` is now `synchronize_model_record`, and `catalog_with_record_replaced` reuses `catalog_without_record`.

### WR-07: Single-NPC profile ledger fingerprint lacks npc_profile_tool_pins, which decision row 365 requires for the same bundles

**File:** `scripts/actors/convert_actors.py:227`
**Commit:** 76182eb
**Test:** `tests/pipeline/test_npc_requests.py` `ConvertNpcGapTests.test_a_sealed_profile_is_a_cache_hit_until_its_profile_tool_pins_change`
**Applied fix:** `NpcConversionRun` takes an injectable `profile_tool_pins` (default `npc_profile_tool_pins`, the single owner) and puts it in the profile config as `profileToolPins`, the key the batch pack config uses, so any pin change changes the fingerprint and `NPC_PROFILE_ALGORITHM_VERSION` stays. The suggested sound-package inputs were not added, because they depart from decision row 286.

### WR-08: Each item batch slice re-hashes the converter implementation and re-parses the 2.5 MB client lock for every already-sealed unit

**File:** `scripts/actors/item_census.py:75`
**Commit:** 8a30d1c
**Test:** `tests/pipeline/test_item_conversion_run.py` (one converter hash and one lock read per run; the batch preflights only the units it converts and writes the catalog once; no write when every record is in the catalog)
**Applied fix:** `ItemConversionRun` hashes the converter once and reads the locked input records of all units with one `locked_input_records` call; `run_item_batch` skips sealed units before the preflight, and `write_item_records` reads and writes the catalog at most once per slice while still republishing sealed records the catalog lacks. Fingerprints are unchanged, so existing seals stay valid.

### WR-09: Item census and gap rows count sealed receipts whatever their fingerprint, so stale units read as converted

**File:** `scripts/actors/item_conversion.py:165`
**Commit:** 55ff726
**Test:** `tests/pipeline/test_item_conversion_run.py` `ItemConversionRunTests.test_the_census_reports_units_sealed_under_an_older_converter_as_pending`
**Applied fix:** `sealed_outcomes_by_unit_key` keeps only units for which `is_unit_sealed(unit)` holds, the current-fingerprint check the batch uses; other units are pending (the test read converted 4, pending 0 before and 1 and 3 after).

### WR-10: Second owner of path-free reason scrubbing next to actors/path_free_messages.py

**File:** `scripts/actors/skill_effect_conversion.py:87`
**Commit:** 382c9b1
**Test:** existing `tests/pipeline/test_skill_binding_table.py`, `test_skill_effect_store_pins.py` and `test_skill_effect_root_outcomes.py` pass
**Applied fix:** Deleted the local `path_free_reason`; both call sites use `actors.path_free_messages.path_free_reason` with the client root and the unit step folder, so skill gap reasons read `<source>` and `<output>` like the other lanes.

### WR-11: Skill root fingerprint omits the emitter-class coverage list, so sealed roots keep a stale simulated-class check

**File:** `scripts/actors/skill_effect_conversion.py:143`
**Commit:** 9d1189d
**Test:** `tests/pipeline/test_skill_effect_root_outcomes.py` `SealedSkillRootOutcomeTests.test_a_root_sealed_before_its_unbound_class_was_simulated_is_refused_and_not_published_once_it_is`
**Applied fix:** The unbound simulated component check moved out of the conversion into `root_outcomes` (`converted_root_outcome`), which checks each sealed root's staged manifest against the current coverage list; such a root becomes a `converter-refused` gap and is not published. Seals no longer depend on the list, so no algorithm version bump.

### WR-12: Section manifest path from the catalog is read before it is validated, and can escape dist

**File:** `scripts/check-private-preview-burst.mjs:30`
**Commit:** 211863f
**Test:** `tests/unit/privatePreviewTargets.test.ts` ('validates the section manifest path from the catalog record alone, before any manifest is read'; 'reads each section manifest only through its validated path inside dist in the burst check')
**Applied fix:** `private-preview-targets.mjs` exports `nativeSectionManifestPath`, which the burst check calls before `readDistFile`, and one `distFilePath` resolves every dist read and stat and refuses a path outside dist.

### WR-13: Pinned manifest SHA and length verification has three owners

**File:** `scripts/data/table_name_indexes.py:82`
**Commit:** 6b9771b
**Test:** `tests/pipeline/test_table_name_indexes.py` (manifest bytes that differ from the catalog pin refused by the shared reader); `tests/pipeline/test_interface_layout_adapter.py` (decoded window manifests read through the shared reader)
**Applied fix:** `verified_source_manifest_bytes` and the local check in `convert_ui` are deleted; both read through `native_store.catalog_writer` `read_pinned_file` and `require_file_pin`, gaining the confined path and reparse-point refusal. Refusals are now `CatalogWriteError`, and the unused `NATIVE_RESOURCE_PREFIX` in `convert_ui` is deleted.

### WR-14: Resolved field-binding gaps leave stale field-<x> gap rows in the data-ui lane

**File:** `scripts/data/ui_texture_step.py:193`
**Commit:** 14a49b3
**Test:** `tests/pipeline/test_ui_texture_step.py` `ConvertWindowTexturesTests.test_a_resolved_field_binding_removes_its_field_gap_row_on_the_next_run`
**Applied fix:** The new `replace_window_gap_rows` replaces the window's row across the textures step, every `field-*` step that already held a row for it, and every step of the new rows.

### WR-15: asset_coordinates has no production caller

**File:** `scripts/native_assets_lib/asset_manifest.py:102`
**Commit:** cacbd58
**Test:** `tests/pipeline/test_asset_manifest_v2.py` (the function's test deleted with it; the other 14 pass)
**Applied fix:** Deleted the function and its test; `readAssetPackage.ts` is the one reader of v1 and v2 coordinates (`docs/OUTPUT_CONTRACT.md` updated).

### WR-16: New shared module re-adds second owners for helpers already consolidated, and uses abbreviated names

**File:** `scripts/native_assets_lib/sound_export_guards.py:17`
**Commit:** 15f79ef
**Test:** `tests/pipeline/test_converter_output_guard.py` `test_path_helpers_have_one_owner` (now scans `export-native-sounds.py` and `sound_export_guards.py`); `test_native_sounds.py` and `test_reference_client_guard.py` pass
**Applied fix:** Deleted `digest`, `HASH`, `load_json`, `reject_links`, `relative_name` and `child`; `export-native-sounds.py` imports the owners (`sha256_hex_digest`, `decode_strict_json` with a 32 MiB cap, `refuse_reparse_points`, `confined_child_path`, `require_portable_relative_path` and others). The guards module keeps only sound-specific code under full names, and the exporter implementation pins `native_store/store_paths.py`.

### WR-17: implementation_hash omits modules the converter now depends on, so converterVersion and the cache key miss their changes

**File:** `scripts/native_assets.py:141`
**Commit:** 47fd758
**Test:** `tests/pipeline/test_converter_implementation_hash.py` `test_every_module_the_converter_imports_is_hashed`
**Applied fix:** `implementation_source_paths` now lists `reference_client_guard.py` and `native_store/store_paths.py`, the two unhashed non-empty modules in the import closure of `native_assets`, and the test fails on any later unhashed import.

### WR-18: The new emitter-class-unconverted branch has no test

**File:** `scripts/native_effect_bundle.py:357`
**Commit:** 6f613dd
**Test:** `tests/pipeline/test_native_effect_bundle_extraction.py` `EffectBundleExtractionTests.test_spark_emitter_is_retained_as_an_unconverted_gap_while_the_sprite_emitter_references_still_convert`
**Applied fix:** Test-only. `_extract_bundle` with a SpriteEmitter and a SparkEmitter child converts only the sprite texture and records one `emitter-class-unconverted` gap; removing the `continue` on a temporary copy made it fail.

### WR-19: A converter work folder outside the bundle output puts absolute host paths into bundle gaps and the staged store manifest

**File:** `scripts/native_effect_bundle.py:376`
**Commit:** d4b5eb6
**Test:** `tests/pipeline/test_native_effect_bundle_extraction.py` `EffectBundleExtractionTests.test_converter_failure_under_a_converter_folder_outside_the_output_keeps_gap_reasons_path_free`
**Applied fix:** `_normal_reason` became `_path_free_gap_reason`, which also replaces the converter output with `<converter>` after `<source>` and `<output>`; all four call sites pass it, and the default nested converter folder gives the same bytes as before.

### WR-20: Winding refusal and out-of-grid BSP node gap rows have no test

**File:** `scripts/world/bsp_step.py:100`
**Commit:** 5ca5853
**Test:** `tests/pipeline/test_world_bsp_step.py` `BspNodeGapRowTests` (a node outside every chunk rectangle; a reversed or edge-on winding)
**Applied fix:** The outside-grid loop moved into `chunk_grid_nodes` so it is testable without a client tree, and both gap paths take the brush actor name from `node_brush_actor_name`. No behaviour change, no step version bump.

### WR-21: OB_Masked Shader surfaces are classified translucent

**File:** `scripts/world/bsp_surface_materials.py:58`
**Commit:** 83917cc
**Test:** `tests/pipeline/test_world_bsp_step.py` `SurfaceMaterialTests.test_only_the_depth_writing_shader_and_final_blend_members_are_opaque` and `test_a_root_without_a_blend_field_is_opaque`
**Applied fix:** `program_blend_is_translucent` reads the decoded enum member and keeps only Shader `OB_Normal` and `OB_Masked` and FinalBlend `FB_Overwrite` opaque, as the runtime blend table does; recipe row `bsp.translucent-program-blend` states the rule and stays unconfirmed. `BSP_STEP_ALGORITHM_VERSION` 2 to 3.

### WR-22: A class chain that fails to resolve silently drops the actor from the lighting records

**File:** `scripts/world/light_actors.py:221` (the code is at lines 66-72 and 124-138)
**Commit:** 6bef4f8
**Test:** `tests/pipeline/test_world_lighting_step.py` `LightingActorTests.test_an_actor_whose_class_chain_cannot_be_read_stays_a_named_gap_instead_of_vanishing`
**Applied fix:** `read_lighting_actors` matches LevelInfo by exact class and collects every other class whose chain cannot be read into `unresolved_classes`; `tile_lighting_payload` writes `lighting-class-chain-unresolved:<class>` (world gap reasons listVersion 15). `LIGHTING_STEP_ALGORITHM_VERSION` 1 to 2.

### WR-23: An emitter reference decoded from the map indexes the export table without a bounds check

**File:** `scripts/world/map_emitter_records.py:48`
**Commit:** 986e461
**Test:** `tests/pipeline/test_world_map_emitter_step.py` `MapEmitterExportTests.test_an_emitter_reference_past_the_export_table_is_refused_as_a_format_error`
**Applied fix:** `emitter_record` checks `1 <= reference <= len(package.exports)` and raises a `FormatError` naming the index and the export count, the pattern of `read_static_mesh_light_list`. Only the crash path changes.

### WR-24: An Engine.Emitter export missing from actors.json crashes the whole emitters step with KeyError

**File:** `scripts/world/map_emitter_step.py:72`
**Commit:** c043be3
**Test:** `tests/pipeline/test_world_map_emitter_step.py` `MapEmitterExportTests.test_an_emitter_actor_missing_from_the_raw_actors_is_a_named_gap_and_the_other_emitters_still_export`
**Applied fix:** A missing actor becomes the per-object gap `decode-failed:emitter-actor-not-extracted`, and the tile's other emitters still convert.

### WR-25: Minimap unit config does not fingerprint the converter, so radar archives and licensee gaps go stale

**File:** `scripts/world/minimap_step.py:51`
**Commit:** ef59b34
**Test:** `tests/pipeline/test_minimap_step.py` `MinimapStepTests.test_a_changed_converter_implementation_reconverts_a_sealed_tile`
**Applied fix:** `minimap_unit_config` adds `converterSha256` from `implementation_hash()`, as `static_mesh_step`, `bsp_step` and `mover_step` do. Latent today: all 153 tiles stop at the radar-texture join gap.

### WR-26: Environment and integrity failures during radar conversion are sealed as permanent decode-failed gaps

**File:** `scripts/world/minimap_step.py:164`
**Commit:** f3ee024
**Test:** `tests/pipeline/test_minimap_step.py` (an environment failure and a misreported archive hash propagate and leave the unit unsealed; a converter refusal is still a sealed decode gap)
**Applied fix:** The Converter is built outside the catch and only `converter.convert` is guarded, by the shared `MODEL_CONVERSION_ERRORS`; `store_converted_radar_texture` runs after it, and `png_dimensions` raises `MinimapStepError` for a non-PNG output.

### WR-27: sky_zone_node_indices calls .casefold() on None for a sky-zone node whose surface has no material

**File:** `scripts/world/sky_geometry.py:52`
**Commit:** d86be85
**Test:** `tests/pipeline/test_world_sky_step.py` `SkyZoneGeometryTests.test_a_sky_zone_node_without_a_material_is_skipped_by_every_root`
**Applied fix:** One generator, `sky_zone_material_nodes`, yields the sky-zone nodes that have a material; `sky_zone_node_indices` and `sky_zone_material_identities` both read through it.

### WR-28: sky_geometry re-implements GLB writing and vector maths that already have owners

**File:** `scripts/world/sky_geometry.py:115`
**Commit:** cc11252
**Test:** `tests/pipeline/test_world_sky_step.py` `SkyZoneGeometryTests.test_only_the_position_accessor_carries_bounds_like_the_served_sky`, plus the existing sky, terrain chunk and BSP tests
**Applied fix:** Deleted `GlbBuffer`, the GLB framing constants and the local vector helpers; `sky_geometry` uses `world.gltf_builder.GltfBuilder` (its accessor gains a bounds switch) and `world.terrain_coordinates`. The served 20_20 sky.glb rebuilt from its served sky.json is byte-identical before and after (SHA-256 `fce08c30...`).

### WR-29: The new 118/0 sky package reader and its texture mip parser have no test that always runs

**File:** `scripts/world/sky_materials.py:51`
**Commit:** 1113ba2
**Test:** `tests/pipeline/test_world_sky_materials.py` `SkyLayoutPackageTests` (8 cases)
**Applied fix:** Test-only. Synthetic 118/0 packages built from `ue2_package_fixture.package_bytes` cover one valid DXT1 record and seven refusals, each matched by its own message.

### WR-30: An unreviewed texture package layout is relabelled as a texture format gap

**File:** `scripts/world/sky_materials.py:193`
**Commit:** 2998b0c
**Test:** `tests/pipeline/test_world_sky_materials.py` `TableLayoutTextureRefusalTests` (an unreviewed licensee is a licensee gap; an unreviewed format in a reviewed package is a format gap)
**Applied fix:** A 123 package outside `texture_mips.REVIEWED_VERSIONS` is refused first with `texture-licensee-unsupported:<v>/<lic>` from `data.texture_package_census.unsupported_licensee_reason`; `sky-texture-format-unsupported` stays for format refusals.

### WR-31: Audio step seals gaps that depend on the machine (missing ffmpeg, converter failure), and a re-run never clears them

**File:** `scripts/world/world_audio_step.py:219`
**Commit:** 6c4cfa6
**Test:** `tests/pipeline/test_world_audio_step.py` `WorldAudioRerunTests` (a music gap sealed without the encoder converts again once the pinned encoder is present; a sound converter that refuses to start fails the step) and `MusicJoinTests.test_an_unpinned_encoder_is_a_derivative_gap_without_a_music_bundle`
**Applied fix:** `tile_music.pinned_music_encoder()` resolves the encoder once per run and `world_audio_unit_config` records it as `musicEncoder`, so a changed environment changes the fingerprint; the sound converter is built outside the per-sound catch, so a UModel pin refusal fails the step without sealing.

### WR-32: Equipped-item lookups build a second catalog index next to the runtime's

**File:** `src/assets/native/NativeCharacterVisual.ts:106`
**Commit:** d9950d1
**Test:** `tests/unit/nativeEquippedItemSource.test.ts` (4 cases: lookups through the given index, an unavailable index reported, an aborted request, a model outside the catalog)
**Applied fix:** `servedCatalogEquippedItemSource` is replaced by `catalogEquippedItemSource(catalog, catalogIndex)`; `nativeCharacterFactory` takes the item source as a required parameter, which `createNativeSliceRuntime` builds from its own served catalog and index, so an unavailable index shows as its not-in-catalog reason.

### WR-33: No Vitest for the lifecycle of body-part item attachments

**File:** `src/assets/native/nativeEquippedBodyPartItems.ts:360` (the class has 106 lines)
**Commit:** 5620800
**Test:** `tests/unit/nativeEquippedBodyPartItems.test.ts` (6 cases)
**Applied fix:** Test-only. Deferred lookups and model loads over the real `presentEquippedItem` cover dispose, unequip during a pending lookup or load, a same-slot swap, gap order and a load that ends after dispose; a temporary mutation failed 3 of the 6.

### WR-34: start() and stop() leave the previous effect in the scheduler

**File:** `src/effects/particles/render/emitterActorPlayback.ts:116`
**Commit:** 8a7423f
**Test:** `tests/unit/emitterActorPlayback.test.ts` (only the latest start's effect stays on the scheduler across stop and restart; dispose removes it)
**Applied fix:** One `releaseEffect` owner calls `scheduler.removeEffect` before `start` replaces the effect, in `stop` and in `dispose`.

### WR-35: No test pins any of the stage-plan compile diagnostics

**File:** `src/materials/ue2/model/stagePlan.ts:84`
**Commit:** 2ed59c2
**Test:** `tests/unit/ue2StagePlan.test.ts` 'compileMaterialStagePlan diagnostics'
**Applied fix:** Test-only. Synthetic programs assert the status and exact reason of each of the nine diagnostics, including `material-graph-depth-exceeds:64` and `material-modifier-chain-exceeds:128`.

### WR-36: An absent Shader Diffuse or Combiner Material1/Material2 is silently replaced by white with no reason and no constants row

**File:** `src/materials/ue2/model/stagePlan.ts:138`
**Commit:** c161775
**Test:** `tests/unit/ue2StagePlan.test.ts` 'compileMaterialStagePlan absent inputs'
**Applied fix:** An absent Shader Diffuse is `material-reference-absent:<shader>.Diffuse`; an absent Combiner Material1 or Material2 reads white through the new unconfirmed constants row `combiner.absent-material` in `combinerConstants.ts`, sourced from `.planning/reference/lineage2js/01-materials-fog.md`.

### WR-37: Graph compile has no cycle detection or memo, so a self-referencing or diamond program blows up exponentially

**File:** `src/materials/ue2/model/stagePlan.ts:178`
**Commit:** 26a3adf
**Test:** `tests/unit/ue2StagePlan.test.ts` 'compileMaterialStagePlan graph walk' (a Combiner that reaches itself through one or both inputs; a chain of Combiners that each read the next twice compiles to one sampler)
**Applied fix:** `CompileState` tracks the compile stack, so a re-entered node fails as `material-graph-cycle:<node>`, and memoises each node and modifier chain, so a shared subgraph compiles once and a shared texture is one sampler.

### WR-38: A FadeColor with a non-positive FadePeriod compiles as 'compiled', then throws at material creation and takes the whole tile binding down

**File:** `src/materials/ue2/model/stagePlan.ts:194`
**Commit:** 0f3aea1
**Test:** `tests/unit/ue2StagePlan.test.ts` 'compileMaterialStagePlan colour sources' (a non-positive FadePeriod; an unset ColorFadeType)
**Applied fix:** `fadeColourGapReason` in `modifiers.ts` owns the fade rules; the stage plan turns its result into `material-feature-unported:FadePeriod` or `:ColorFadeType`, and `fadeColourBytes` keeps the check as an invariant. ColorFadeType stays unresolved when unset.

### WR-39: Chunk manifest reading and chunk collision-cell decoding duplicated from existing owners

**File:** `src/runtime/tileCollisionCells.ts:35`
**Commit:** 454290a
**Test:** `tests/unit/tileCollisionCells.test.ts`, `loadCollisionCells.test.ts`, `loadNativeTileChunks.test.ts`, `worldMovementWiring.test.ts`
**Applied fix:** `loadTileCollisionCells` calls `readTileChunkManifests` and `loadChunkCollisionCell`; the local copies, the duplicate label and an unused export are deleted. Chunk manifests now load one after another, as the shared owner does.

### WR-40: loadTileCollisionCells has no test

**File:** `src/runtime/tileCollisionCells.ts:52`
**Commit:** bf86702
**Test:** `tests/unit/tileCollisionCells.test.ts` (3 cases)
**Applied fix:** Test-only. A stubbed fetch serves a fake store and pins both chunk gap reasons, the resident cells, the tile BSP tree rule and both refusal messages.

### WR-41: Follow camera loses the player's zoom whenever the wall-clamped radius falls below the camera's lower radius limit

**File:** `src/runtime/worldMovementWiring.ts:153`
**Commit:** 4d3436b
**Test:** `tests/unit/worldMovementWiring.test.ts` 'keeps the follow camera zoom across camera updates when the wall-clamped radius falls below the camera lower radius limit'
**Applied fix:** The applied radius is clamped to the camera's live `lowerRadiusLimit` and `upperRadiusLimit` before it is stored and assigned, so the next-frame comparison holds and the user zoom returns once the wall is gone. No Lineage II value was added.

### WR-42: A decoded zone fog range with end <= start throws RangeError every frame and stops the render loop

**File:** `src/scene/world/cameraEnvironment.ts:63`
**Commit:** 6e5feab
**Test:** `tests/unit/cameraEnvironment.test.ts` 'names a decoded zone fog range whose end does not pass its start as a gap instead of throwing in the frame loop'
**Applied fix:** Fixed at the decode boundary: `readZone` in `tileLightingRecords.ts` records such a zone as unresolved, with fog null and `lighting-zone-fog-range-not-increasing:<zone>:<start>:<end>`.

### WR-43: Streaming chunk loader and tile model template cache have no Vitest coverage

**File:** `src/scene/world/loadResidencyChunk.ts:30`
**Commit:** d75f13d
**Test:** `tests/unit/loadResidencyChunk.test.ts` (10 cases)
**Applied fix:** Test-only. NullEngine cases with mocked fetchers cover the built parts, gap reasons, the footprint refusal, cleanup on failure and abort, template sharing, the archive conflict, retry and late-resolve disposal; a temporary mutation failed 3 cases.

### WR-44: Duplicate trust-boundary helpers with a second owner

**File:** `src/scene/world/nativeBspResources.ts:43`
**Commit:** 044cee5
**Test:** existing `nativeBspResources`, `nativeTileChunkManifest`, `nativeTileManifestResources` and `minimapJoin` tests
**Applied fix:** `isPlainRecord`, `hasExactKeys` and `nativeTileSha256Pattern` moved to the new `src/scene/world/nativeManifestRecordGuards.ts` (a separate module avoids an import cycle); five tile manifest parsers import them and their private copies are deleted.

### WR-45: Source-to-scene axis swap and unit scale re-implemented outside sourceFrame

**File:** `src/scene/world/nativeTileChunkContents.ts:42`
**Commit:** de65df6
**Test:** existing `minimapJoin`, `loadNativeTileChunks` anchor and `worldMapView` tests
**Applied fix:** `authoredAnchorPosition` calls `sourcePositionToWorld`, and `minimapTexturePosition` takes a `WorldPosition` and calls `worldPositionToSource`; `sourceUnitsToGltfMetres`, `nativeUnitsPerSceneMetre` and `NativeTileMinimapScenePosition` are deleted. Output is unchanged.

### WR-46: Residency plan only recomputes when the set of chunks under the focus changes, so diagonal rings go stale while the player walks inside a chunk

**File:** `src/scene/world/nativeTileChunkResidency.ts:201`
**Commit:** 6d8318e
**Test:** `tests/unit/collisionInputsFromCellsOnly.test.ts` 'shows a diagonal chunk once the focus walks within the visual ring inside the same chunk, without an explicit update'
**Applied fix:** The render observer plans from the live focus every frame and applies the plan when any ring's sorted cell id set changes; `onFocusChunks` still fires only when the holding chunks change. The test-only `update()` is removed, and the tests drive the observer the runtime uses.

### WR-47: A malformed material program pin leaks the per-frame advance observer

**File:** `src/scene/world/lighting/attachTileLighting.ts:84`
**Commit:** ec6f426
**Test:** `tests/unit/attachTileLighting.test.ts` 'leaves no per-frame observer on the scene when a static mesh holds a malformed material program pin'
**Applied fix:** The static mesh and terrain unlit counts run before the presentation clock and the observer are created.

### WR-48: collisionFocusSourcePosition is exported but has no caller in src

**File:** `src/scene/world/movement/collisionCellContext.ts:30`
**Commit:** 1b0fef8
**Test:** `tests/unit/loadCollisionCells.test.ts` collision cell context cases
**Applied fix:** Deleted the function, its unused imports, its source-unit assertion and the null-focus case, and renamed the remaining test.

### WR-49: No test covers the readLeafHull refusals

**File:** `src/scene/world/movement/core/bspCollisionTrace.ts:194`
**Commit:** ee23774
**Test:** `tests/unit/movementLineCheck.test.ts` (a plane reference past the node array; as many plane references as the hull plane limit)
**Applied fix:** Test-only. Three of the five refusals moved to the decoder in 9075936 and are tested there; the two that stay in `readLeafHull` are covered by box sweeps across the wall tree fixture.

### WR-50: BSPT LeafHulls runs, volume scale and polygons, and terrain scale are only validated during traces, so bad payloads throw from the frame loop instead of failing the load

**File:** `src/scene/world/movement/core/decodeNativeTileCollision.ts:208`
**Commit:** 9075936
**Test:** `tests/unit/decodeNativeTileCollision.test.ts` (seven new refusals, and a volume with no nodes keeps the zero DrawScale the converter writes)
**Applied fix:** The decoder checks every leaf hull run a node names (terminator, six-word hull box, finite box), refuses volumes with nodes but a singular DrawScale or DrawScale3D or no polygon vertices, and refuses a non-positive TerrainScale; the matching trace-time guards are removed. The plane-limit and plane-node-range checks stay at trace time because the decoder does not receive the rules.

### WR-51: Every world sweep tests every triangle of every resident placement and mover, with no bounds check first

**File:** `src/scene/world/movement/core/staticMeshTrace.ts:81`
**Commit:** f0c21bd
**Test:** `tests/unit/movementTraceReuse.test.ts`; the line-check, point-check, presenter and pawn golden traces pass unchanged
**Applied fix:** Each placement or mover matrix caches world bounds, and triangles are built only when a sweep or overlap box reaches them, by the same comparison the triangle box clip planes use; cell primitives and convex hull clip planes are cached per cell or hull and rules. There is no spatial index yet.

### WR-52: traceTerrain tests every triangle of the chunk on every sweep and allocates per triangle

**File:** `src/scene/world/movement/core/terrainTrace.ts:87`
**Commit:** cf84bf6
**Test:** `tests/unit/terrainSweepQuadWindow.test.ts` (5 cases)
**Applied fix:** The new `terrainSweepQuadWindow.ts` limits `traceTerrain` to the quads inside the sweep footprint widened by the cached largest edge tolerance growth plus one quad of padding, in the same scan order and with no per-triangle array. A temporary comparison of 12,000 sweeps on 30 terrains was bit-identical to the full scan.

### WR-53: New pinned-fetch helper duplicates fetchVerifiedNativeResource

**File:** `src/ui/fetchCatalogPinnedBytes.ts:4`
**Commits:** 2998b0c (the file deletion) and 1113ba2 (the owner module and its importers), both under the pipeline lane's slice-10 subjects (see Notes)
**Test:** `tests/unit/readNativeTableNameIndex.test.ts` (the hash and length mismatch case matches `Native resource hash/length mismatch`); `tests/browser/nativeStartup.spec.ts` wording updated, not run
**Applied fix:** `fetchCatalogPinnedBytes` is deleted and `fetchVerifiedNativeResource` moved from `loadNativeSection.ts` to the neutral `src/assets/native/fetchVerifiedNativeResource.ts`, used by the 8 scene importers and the 4 UI call sites. The error text is now 'Native resource ...: <url>'.

### WR-54: NativeWindowLayer.openWindowIds has no caller, and close is used only by dispose

**File:** `src/ui/nativeWindows/nativeWindowLayer.ts:25`
**Commit:** 1780ff7
**Test:** `tests/unit/nativeWindowLayer.test.ts` dispose case (added in 8d9e7e1); the `mountSandboxWindowLayer` and `nativeSliceRuntime` tests pass
**Applied fix:** `openWindowIds` and `close` are removed from the interface, the implementation and both test doubles; `dispose` disposes each open window and revokes its texture URLs inline.

### WR-55: Layer open deduplication, dispose during open and object URL revocation are untested

**File:** `src/ui/nativeWindows/nativeWindowLayer.ts:45`
**Commit:** 8d9e7e1
**Test:** `tests/unit/nativeWindowLayer.test.ts` (shared concurrent open, dispose while textures resolve, revoke after a failed texture fetch, dispose) and `tests/unit/minimapControl.test.ts` (a radar URL that resolves after dispose is revoked)
**Applied fix:** Test-only. The real layer and loader run over a synthetic catalog with spies on the object URL calls; removing any of the three revokes fails a test. The former overflow-only test moved into the new file.

### WR-56: Window anchors are resolved once against the container size at open time and never re-laid out

**File:** `src/ui/nativeWindows/nativeWindowLayer.ts:54`
**Commit:** e0225b4
**Test:** `tests/unit/nativeWindowLayer.test.ts` (re-places on resize, stops observing on dispose); Playwright `tests/browser/native-window-resize.spec.ts` (a bottom-right window follows the viewport from 1440 x 900 to 932 x 430); both failed on the old layer and pass
**Applied fix:** The layer owns a ResizeObserver on its container and calls the new `RenderedNativeWindow.layout(screen)`, which re-resolves the anchors and re-places every control, texture image and gauge fill; `MinimapControl.resize` redraws the minimap. The first placement uses the same path.

### WR-57: An unresolved first control texture is silently replaced by a later texture of the same control

**File:** `src/ui/nativeWindows/nativeWindowRenderer.ts:57`
**Commit:** 6e0c483
**Test:** `tests/unit/nativeWindowRenderer.test.ts` 'draws only the first texture of a control and keeps it a gap instead of substituting a later resolved texture'
**Applied fix:** The renderer draws only the control's first texture; an unresolved one records its gap reason and draws no substitute.

### WR-58: A field binding whose control is missing or ambiguous is dropped with no gap

**File:** `src/ui/nativeWindows/nativeWindowRenderer.ts:67`
**Commit:** 733b637
**Test:** `tests/unit/nativeWindowRenderer.test.ts` 'marks the window root with a gap for a field binding whose control is missing or ambiguous and draws no gauge for it'
**Applied fix:** `uniqueBindingNodes` returns the bindings it cannot place, and the renderer records `binding-control-missing:<control>` or `binding-control-ambiguous:<control>` on the window root and in `window.gaps`. Latent with today's data.

### WR-59: stop record built from a stale local heading turns the player to the wrong yaw

**File:** `src/world/NativeSliceAdapter.ts:195`
**Commit:** 740fc92
**Test:** `tests/unit/nativeSliceAdapter.test.ts` 'stops a local move at the last reported heading when an animation interrupts it' and the updated mirror case
**Applied fix:** `acceptReportedPosition` also stores the validated reported heading through `sourceHeadingToWorldYaw`, as cannot-move already did.

### WR-60: WorldPosition is declared twice, in sourceFrame.ts and worldTypes.ts

**File:** `src/world/sourceFrame.ts:7`
**Commit:** 1834fa6
**Test:** none new; `pnpm typecheck` and the 10 affected test files (113 tests) pass
**Applied fix:** `sourceFrame.ts` owns `WorldPosition`; `worldTypes.ts` imports it, and the 16 source and 6 test importers import it from `sourceFrame.ts` directly, with no re-export. Comments in the touched files were removed.

### WR-61: sourceRotationToWorld and RotationMatrix have no production caller

**File:** `src/world/sourceFrame.ts:37`
**Commit:** 0bc29c1
**Test:** `tests/unit/sourceFrame.test.ts` (the rotation cases deleted; the position and heading cases pass)
**Applied fix:** Removed `sourceRotationToWorld`, `RotationMatrix` and `swappedAxisByAxis` with their two test cases.

## Deferred

### WR-62: Overlap gate passes silently when an area's source globs match no file

**File:** `tools/reference-overlap/referenceOverlap.mjs:146`
**Deferred to:** NET-09
**Reason:** Confirmed: line 145 guards empty reference globs, but line 146 builds the source corpus with no empty-match guard, so `--area network` (no `src/net`, no `src/world/mobius`) exits 0 with no source files and the gate checks nothing for NET-09 yet. The fix rules forbade editing `tools/reference-overlap/`, and the fix needs an owner decision: throwing on an empty source corpus turns the network area into a setup error (exit 2), while OVERNIGHT-DECISIONS row 193 and the 02-57 SUMMARY record "no sources, exit 0" as intended.
**To fix:** decide how the network area is treated before `src/net` exists, then add a per-glob and whole-list empty-match `ReferenceOverlapSetupError` on the source side, with a case in `tests/unit/referenceOverlap.test.ts`.

## Notes

### Commits carrying the other lane's subject

The browser lane's WR-53 change landed in two commits that carry the pipeline lane's slice-10 subjects, because the pipeline fixer committed from the shared index while the slice-19 paths were staged: 2998b0c ("Name an unreviewed sky texture package layout as a licensee gap") also holds the deletion of `src/ui/fetchCatalogPinnedBytes.ts`, and 1113ba2 ("Test the 118/0 sky package reader and its mip parser on synthetic bytes") also holds the new `src/assets/native/fetchVerifiedNativeResource.ts`, its 12 importer changes, the startup spec wording and the name index test. History was not rewritten, because reset and rebase are forbidden.

### Checks the fixers could not run

- `tests/browser/nativeStartup.spec.ts` (WR-53): not run, because `pnpm dev` runs `scripts/stage-webgpu-compilers.mjs`, a stage script the fixers were forbidden to run. Its expected text changed from 'Native section resource returned HTTP 502' to 'Native resource returned HTTP 502'.
- No Playwright check for slices 12 and 16 (WR-32 to WR-34, WR-43 to WR-46): no game UI changed; the residency fix changes which chunks are drawn, and its unit test checks that. The one browser check the dispositions record as run is `native-window-resize.spec.ts` (WR-56), which passes.
- Fog (CR-01) is not checked at the pixel level: Vitest checks the shader sources and the sign of Babylon's view matrix, the swatch harness binds `FOG_DISABLED`, and no fogged-zone screenshot exists.
- `scripts/check-private-preview-burst.mjs` (WR-12) was not run: it reads the private access key and sends HEAD requests to the live origin.
- `RealClientSkyTests` in `test_world_sky_step.py` (WR-27 to WR-30) were not run: `convert_tile_sky` writes material resources under `artifacts/lane-store/world`, which the fixers could not write. The served-GLB equality of WR-28 was checked read-only with `C:/laragon/l2b-orchestration/autonomous-roadmap/slice-10/rebuild_served_sky_glb.py`.
- `python -B -m unittest discover -s tests/pipeline -t .` fails for the new sky materials test file because `tests/pipeline` is not an importable package; it ran with `discover -s tests/pipeline -p <file>` and by module name.
- WR-50 was checked read-only against `artifacts/lane-store/integration`: all 23 tile BSPT payloads and every current chunk payload decode. 31 older chunk payloads without MOVR arrays fail on `array MOVR.exportIndex is not in the payload`, as before this change; they need a restage.
- The fixers ran targeted test files only, never the full unit or pipeline suite.

### Residual defects handed to the residual fixer

The fixers found these outside their findings' files. The commit after each one is the residual fix that has landed on this branch since the round.

- `scripts/native_store/gap_census_denominators.decoded_table_manifest` was a third reader of data-ui tables manifests with its own validation, beside the WR-02 owner. Fixed in c92ccee: the owner moved to `scripts/native_store/data_ui_table_manifest.py` and serves the actor routes and the item census.
- `scripts/actors/item_conversion.write_item_records` returned early when the status was not pass and never removed the item model records, the stale-record pattern of WR-06. Fixed in 4fee86f.
- `scripts/actors/actor_sound_batch.py` `npc_profile_rows` read a `/l2` manifest and checked only its SHA-256 by hand instead of `read_pinned_file`. Fixed in 281753e.
- The BSP classification kept an OB_Normal Shader with an Opacity input opaque, while the runtime blend table blends it source-alpha, inverse-source-alpha with no depth write. Fixed in edda6ba (`BSP_STEP_ALGORITHM_VERSION` 4).
- `scripts/world/static_collision_sources.py:27` defined a second `GLTF_FLOAT_COMPONENT = 5126`, which `visibility_members.py` imported. Fixed in 8d57fc5.
- `cameraEnvironmentOf` in `src/scene/world/lighting/attachTileLighting.ts` tested `scene.activeCamera === null`, but a fresh Babylon Scene has `undefined`, so a scene with no camera yet threw on `globalPosition`. Fixed in 96daa5b.
- Seven asset loaders inlined the fetch, length and SHA-256 check beside `fetchVerifiedNativeResource` (`loadNativeNpcProfiles`, `loadNativePlayerProfiles`, `loadNativeStepSounds`, `loadNativeStepDecoGrass`, `loadNativeWorldAudio`, `loadNativeAnimationAudio`, `loadNativeCombatAudio`). Fixed in b77255d.
- Still open: one window with two bindings absent on the same adapter field gives a sealed receipt with two field rows while the lane gap file holds one row per key and step (last wins). Pre-existing.
- Still open, named in the WR-44 entry and outside its files: the private record guard and `sha256Pattern` copies in `actorClipEvents` and in `src/assets`, `src/ui` and `src/materials`.

### Behaviour changes that reseal units on the next integration run

- BSP (83917cc, then edda6ba): `BSP_STEP_ALGORITHM_VERSION` 2 to 3, and 4 with the residual OB_Normal Opacity fix, plus the changed recipe row text in the unit config, make every sealed bsp unit stale; served chunks carry the corrected translucent flags only after the integration thread re-runs the bsp step.
- Item records (4fee86f, residual): an item unit that reconverts into a gap now drops the model records of its items on the next batch.
- Lighting (6bef4f8): `LIGHTING_STEP_ALGORITHM_VERSION` 1 to 2 reconverts every sealed lighting unit; world gap reasons listVersion 14 to 15.
- World audio (6c4cfa6): `musicEncoder` joins the unit config, so every world audio unit sealed before it is stale and reconverts on the next `--step audio` run; the tile manifest step reads `sealed_world_audio` with the same config and waits for that run. The audio algorithm version stays 1.
- Minimap (ef59b34): `converterSha256` joins the unit config, so tiles sealed in the lane work root reseal; latent on the locked client, where all 153 tiles stop at `minimap-join-unresolved:radar-texture` and L2_RadarMap is 118/0.
- Converter version (47fd758, d4b5eb6, 6f613dd): `implementation_hash` now covers `reference_client_guard.py` and `native_store/store_paths.py`, and `native_effect_bundle.py` is in that hash and in the `effectBundleSha256` tool pin, so cached converter outputs, effect bundles and staged `converterSha256` values change; staged skill effect manifests holding a converter-folder gap reason move only when the integration thread restages.
- Sound exporter (15f79ef): the `export-native-sounds.py` fingerprint pins `native_store/store_paths.py`, so `run.json` fingerprints of earlier exports no longer match and an existing sound output needs a fresh destination or `--reuse-from`.
- NPC profiles (76182eb): `profileToolPins` joins the single-NPC profile config, so sealed `--npc` profile units reseal once.
- Reporting only, no reseal: the character and item census report units sealed under an older fingerprint as pending (4cb97cd, 55ff726); actor sound and skill gap reasons change only the text of future refusals (9297264, 382c9b1); skill effect seals stay valid (9d1189d); the sky step version is not bumped (d86be85, 2998b0c).
- Other behaviour changes: a single `--item` run now fails up front when any unit's lock record is missing, because `ItemConversionRun` resolves all of them at construction (8a30d1c); a locked-source hash mismatch inside the sound exporter's `Sources.package` is now a fatal integrity error instead of unsupported-package, with no dedicated test (15f79ef); default-route chunk manifests load one after another (454290a); native resource fetch errors read 'Native resource ...: <url>' (1113ba2).

### Reference overlap

Fix commits in DEC-OWN-12 areas: materials 339ebb5, 26a3adf, 0f3aea1, c161775; particles 8a7423f and the `particleMaterialBinding.ts` part of 339ebb5; movement f0c21bd, 9075936, cf84bf6, 1b0fef8, 0bc29c1. After 0bc29c1 a read-only `node tools/reference-overlap/referenceOverlap.mjs --area movement --reference-root C:/laragon/www/l2-browser-client --require-reviewed` shows reviewed row `cab6ef0d...` in `tools/reference-overlap/reviewedRuns/movement.json` stale and two new unreviewed runs at `src/world/sourceFrame.ts` lines 31-34 (12 and 14 tokens), none blocking. The same run reported 20 blocking runs, 9 stale sign-offs, 635 unreviewed runs and 238 stale rows area-wide, with no pre-change baseline. No fixer edited `tools/reference-overlap/` or signed anything off. Independent reviews of the added runs landed as 40cde98 (particles and materials), 3f63a3b (the stage plan cycle guard) and 5f88b9e (movement).

### Decisions

The fixers returned 37 decision rows (the choices named in the entries above, such as the `<converter>` placeholder, the blend-table translucency rule and the fog depth sign); they wait for the decision log in the orchestrator's pending rows P45 to P81.

---

_Fixed: 2026-11-11T08:28:38+02:00_
_Fixer: gsd-code-fixer, two lanes of slices 01 to 21_
_Iteration: 1_
