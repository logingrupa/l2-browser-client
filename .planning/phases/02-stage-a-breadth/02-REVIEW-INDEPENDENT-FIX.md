---
phase: 02-stage-a-breadth
fixed_at: 2026-11-11T11:55:39+02:00
review_path: .planning/phases/02-stage-a-breadth/02-REVIEW-INDEPENDENT.md
iteration: 1
findings_in_scope: 66
fixed: 45
not_a_defect: 3
deferred: 18
status: partial
---

# Phase 2: independent review fix report

Fix scope critical and warning: the 14 critical and 52 warning findings that at least two of three checkers confirmed in 02-REVIEW-INDEPENDENT.md. One gsd-code-fixer ran per review slice (slices 01 to 14), pipeline scripts and browser code at the same time in this worktree. 45 fixed, 3 not a defect (the same defect as a finding an earlier slice of this round fixed), 18 deferred with their requirement IDs to the gap plans that now own them. Every fixer re-read and confirmed its finding first. Behaviour fixes ship with a test, shown failing before the fix where the entry says so; dead-code and duplicate-owner fixes keep their existing tests green. No slice failed, no slice recorded a `pnpm typecheck` failure, and no slice left a process running. Info findings are out of scope.

## Fixed Issues

### CR-01: actor-sounds batch stalls on skills without a skillsound row because they are never sealed

**File:** `scripts/actors/actor_sound_batch.py:86`
**Commit:** 33a3c12
**Test:** `tests/pipeline/test_actor_sound_bundle_reseal.py` `ActorSoundBundleResealTests.test_a_skill_bundle_without_a_sound_row_is_sealed_once_and_skipped_by_the_next_slice` (and `test_a_bundle_that_loses_its_sound_row_loses_its_combat_audio_record`, now on the sealed route); both errored before the fix
**Applied fix:** `ActorSoundConversionRun` seals the no-row outcome as an `actor-sounds` bundle ledger unit. Its fingerprint covers the locked skillsoundgrp SHA-256 and the binding's sound fields (key, skillId, level, soundRowOrdinal, soundReason), and its receipt holds the `no-exact-skillsound-row` gap row with the receipt as evidence. `ActorSoundBundles` checks that seal, so a later slice skips the bundle until the source table or the binding changes. The unsealed helper is deleted and the skill binding lookup is indexed by key. About 2,930 of the 3,064 skill keys in the actors lane catalog have no exact row.

### CR-02: Character conversion always fails: the shared data-ui reader refuses the hairgrp and helmetgrp manifests

**File:** `scripts/actors/character_conversion.py:51`
**Commit:** 21a7a94
**Test:** `tests/pipeline/test_data_ui_table_manifest.py` `DataUiTableManifestTests.test_the_character_route_reads_elbera_adapter_hair_and_helmet_manifests_beside_a_local_descriptor_classinfo`, `test_a_manifest_with_list_records_on_the_local_descriptor_route_is_refused`, `test_an_elbera_adapter_manifest_is_refused_where_the_caller_reads_the_local_descriptor_route` (2 failures and 1 error on the old reader)
**Applied fix:** `scripts/native_store/data_ui_table_manifest.py` owns both decode routes and the records type of each. The caller names the route it reads: `local-descriptor` by default (object records), `elbera-adapter` (list records) for the character hair and helmet tables. Any other route or records shape is refused, so the item and sound callers still receive only object records. `convert_tables` and `table_name_indexes` import the route, kind and schema version from that owner, and the gap census fixture's invented route `local-decoded` is now `local-descriptor`. Read-only check on the real data-ui lane store: hairgrp 15 rows, helmetgrp 3, classinfo-e and itemname-e object records. This closes the defect the code review fix round introduced (WR-02 of 02-REVIEW-FIX.md).

### CR-04: The lane merge pin walk misses sky bundle files and native-materials programs, so a world restage publishes tiles whose sky.glb and BSP material programs are absent

**File:** `scripts/native_store/catalog_writer.py:289`
**Commit:** a190cba
**Test:** `tests/pipeline/test_bundle_member_pins.py` `WorldTileRuntimePinTests` (`test_the_walk_reaches_sky_bundle_files_named_by_a_files_map_and_material_programs_named_by_glb_extras`, `test_the_merge_copies_the_sky_glb_and_the_material_program_the_browser_fetches` and three refusal cases); all five fail on the old walk
**Applied fix:** The walk treats a manifest's name-keyed `files` map of `{sha256, bytes}` entries as bundle member pins (a `files` map of evidence strings is still not a pin). For every GLB it reaches, it pins `native-materials/<sha>/program.json` from each material's `extras.nativeMaterialProgram` after checking that the directory matches the program SHA-256. The GLB container reader moved from `world/static_collision_sources.py` to `native_store/glb_container.py` (magic, version, length and chunk type checks), and `native_material_program_pins.py` owns the folder name, the program file name and the extras field, which `material_resources.py` and `bsp_chunk_geometry.py` import. A read-only walk of `artifacts/lane-store/world/l2` reaches 7,207 files (6,672 before), including all 22 `sky.glb` files and the 95 programs the BSP chunks name. No sky manifest format change and no restage.

### CR-05: A catalog-listed key is reported pass even when its steps failed, so failed tiles never count as gaps

**File:** `scripts/native_store/gap_census.py:146`
**Commit:** 6d189c8
**Test:** `tests/pipeline/test_gap_census.py` `test_a_catalog_listed_key_with_a_failed_or_gap_step_takes_that_status_and_stays_converted`; `tests/pipeline/test_coverage_report.py` `test_a_converted_tile_whose_collision_step_failed_is_a_failed_row_counted_as_converted_and_as_gap`, `test_a_pass_row_that_is_not_converted_is_refused`; all fail on the old census
**Applied fix:** Decision row 346 had set converted first, but WORLD-03, DEC-OWN-3 and DEC-OWN-7 list a failing tile as a gap, and PROJECT.md wins. Census precedence is now failed, gap, converted, pending: a catalog-listed key keeps `converted` true but takes the status and reason of its latest failed or gap step, a pending step does not override converted, and the part gap count includes the key. The coverage validator requires only that a pass row is converted, the Lobby line reads the row status, and `CENSUS_RULE_TEXT` states the rule. The browser catalog index is unaffected, because catalog entries win there. The committed lane coverage.json files are stale until the next coverage run (for example tile:15_20, collision failed).

### CR-06: Collision fails with a wrong 'run --step bsp first' message when the bsp step ended as a known gap

**File:** `scripts/world/collision_step.py:239`
**Commit:** 057476e
**Test:** `tests/pipeline/test_world_collision_step.py` `CollisionStepOrderTests.test_a_level_model_layout_gap_is_the_collision_gap_even_without_a_bsp_seal`, `test_a_readable_level_model_without_a_bsp_seal_names_only_the_bsp_step` (both failed before with the old FormatError)
**Applied fix:** `bsp_step` returns the `LevelModelLayoutError` gap without sealing, so the old guard raised before `read_level_model` and the layout-gap branch was dead. The step now checks the meshes and movers seals first, then reads the level model and returns its layout gap (`map-licensee-unsupported:123/<x>`); only after that does it require the bsp seal, and the error names the bsp step alone. The 41 tiles of map licensees 18, 23, 25 and 30 change their collision rows only after a collision rerun. Writing the partial SMSH, TERR and MOVR groups for those tiles is a scope change and was not done.

### CR-08: Engine.MovableStaticMeshActor placements are silently dropped from meshes, collision, light lists and placement audio

**File:** `scripts/world/raw_map_extraction.py:54`
**Commit:** 56b9555
**Test:** `tests/pipeline/test_world_static_mesh_step.py` `PlanStaticPlacementsTests.test_a_static_mesh_actor_subclass_is_one_gap_row_naming_its_class_and_an_unreadable_class_is_skipped`, `StaticMeshAssignmentTests.test_every_static_mesh_actor_with_a_mesh_is_placed_once_or_is_one_gap_row`; `tests/pipeline/test_world_collision_step.py` `UnadmittedVolumeClassTests.test_a_static_mesh_actor_subclass_is_a_collision_gap_row_naming_its_class`
**Applied fix:** Four filters matched only the exact `Engine.StaticMeshActor` class. `static_placement_plan` now owns a class-chain test (`static_mesh_actor_subclass_actors` over the existing `ClassChains`), and the meshes and collision steps each write one per-object gap row `placement-class-unsupported:<class>` for every StaticMeshActor subclass actor; `placement_accounting_difference` counts them. World gap reasons listVersion 17, meshes step algorithm 3, collision step algorithm 4. `STATIC_MESH_ACTOR_CLASS` has one owner in `static_placement_plan`. Light lists and placement audio stay tied to placed exact-class placements, so a gapped subclass placement carries neither, and `raw_map_extraction` is unchanged. 314 such actors sit on converted tiles, 64 on 18_24; those tiles read meshes and collision gap after the restage. Supporting a subclass waits for a qualified subclass rule (WORLD-03).

### CR-10: Clip event parser refuses the null notify object and the normalizedTime > 1 that the converter writes, so the native model fails to load

**File:** `src/assets/native/actorClipEvents.ts:80`
**Commit:** cad4905
**Test:** `tests/unit/actorClipEvents.test.ts` > keeps a function-only notify with no notify object and a source time past the clip end, as the converter writes it (a real sidecar row, normalizedTime 1.860465168952942; fails on the old reader)
**Applied fix:** `ue2.py` `notification_sidecar` writes object None for a function-only notify and copies the raw source time with only a finite check; a read-only scan of `artifacts/lane-store` found 117 null-object events and 64 with normalizedTime above 1 (duplicates across lane stores included) and none negative. The reader types `notifyObject` as string or null and accepts any finite `normalizedTime` and `timeSeconds`; NaN and Infinity replace the old range refusals. Clip playback only sorts and lists by normalizedTime, so a value above 1 changes no dispatch. Elf and ol_mahum/devastator actors with function-only notifies now load with the clip hub attached.

### CR-11: Every sprite draws as a camera-facing billboard: UseDirectionAs and ProjectionNormal are ignored, and no gap is reported

**File:** `src/effects/particles/render/particleMaterialBinding.ts:85`
**Commit:** 52ed33e
**Test:** `tests/unit/spriteEmitter.test.ts` > reports every UseDirectionAs basis except None and Scale as an unported feature, because sprites draw camera-facing; `tests/unit/emitterActor.test.ts` > Power Strike real-client traces (now expects the p_u004_a SpriteEmitter9 `UseDirectionAs` gap)
**Applied fix:** The missing gap report is fixed (the AGENTS rule that an unresolved value stays visible): `listUnportedEmitterFeatures` reports `emitter-feature-unported:UseDirectionAs` for the Up, Right, Forward, Normal, UpAndNormal and RightAndNormal bases; None and Scale face the camera and are not reported. The direction usage constant carries the full fx.enums ordinal table. The bases themselves are not ported into the vertex stage: per-instance direction, the ProjectionNormal basis and the PTDU_Up sign test stay open under FX-01, because the reference notes hold them only as unconfirmed defaults (POL-04). The skill census still marks these skills pass (WR-32, deferred).

### CR-14: Source heading to world yaw is 90 degrees off the visual facing convention, so MOVE-01 pawns face sideways

**File:** `src/world/sourceFrame.ts:34`
**Commit:** 7a8b12f
**Test:** `tests/unit/sourceFrame.test.ts` 'faces the visual root forward along every source movement direction the pawn heading is taken from' (plus the heading 0 and 16384 cases); `tests/unit/nativeSliceAdapter.test.ts` 'stops after a special-attack preview toward the monster on world +x with the source heading along source +X'; all 6 new or changed assertions failed on the old formula
**Applied fix:** `NativeCharacterVisual` places the asset forward on root +z, so root yaw atan2(x, z) faces world (x, z), but `sourceHeadingToWorldYaw` returned -h * pi / 32768, which assumes yaw 0 faces +x. The one owner now returns pi/2 - h * pi / 32768 and `worldYawToSourceHeading` is its inverse, which brings the pose, report-position, cannot-move and the stop heading in line with `previewAction`'s atan2(dx, dz). Two adapter expectations move with the convention: the stop from the initial yaw 0 is heading 16384, and the report-position heading 16384 is yaw 0.

### WR-01: Character sound bundles are unreachable and the census reports them silently once the character census exists

**File:** `scripts/actors/actor_sound_batch.py:67`
**Commit:** b4ba6b7
**Test:** `tests/pipeline/test_actor_sound_bindings.py` `test_characters_are_skipped_with_their_census_reasons_and_an_absent_census_is_named`, `test_a_character_key_is_refused_as_an_actor_sound_bundle`
**Applied fix:** Following plan 02-44 (a character is processed only when the census lists it converted, otherwise skipped with the census reason), the actor-sound census character entry is `{count: 0, skippedReason, skippedByReason}`. `skippedReason` is `character-census-absent` only when the census file is missing; `skippedByReason` counts each non-padding census row under its profile gap reason, `character-profile-pending` or `character-sound-bundle-not-built` (no character bundle route exists). The real census gives `{class-template-mapping-undecoded: 14}`. `character` left `ACTOR_SOUND_KEY` and `BUNDLE_KIND_ORDER`, so `--actor-sounds character:N` is refused at argument parsing, and the census path constant comes from `character_census`. Real character sound bundles remain ACT-05 work once profiles are written.

### WR-02: --output outside the actors lane folder breaks actor sounds and splits catalog records from gap rows and ledger

**File:** `scripts/actors/actor_sound_conversion.py:318`
**Commit:** 6cbebe6
**Test:** `tests/pipeline/test_npc_requests.py` `ActorsLaneStoreOutputTests.test_only_the_actors_lane_store_is_an_admitted_output`, `test_the_command_line_refuses_a_trial_output_before_it_reads_the_client`
**Applied fix:** Mirroring decision row 393 for the world lane, `convert_actors.main` calls `require_actors_lane_store_output` before it reads the client. It runs `require_converter_output` and refuses anything other than `lane_store_root(actors)`, so every route (npc, item, character, actor sounds, skills) writes only to the lane whose ledger seals it.

### WR-03: Single --npc store write refuses any reconversion because it merges records that must replace

**File:** `scripts/actors/convert_actors.py:264`
**Commit:** 3055973
**Test:** `tests/pipeline/test_npc_requests.py` `ConvertNpcGapTests.test_a_reconverted_npc_replaces_its_model_and_profile_records_in_the_lane_store` (raised 'catalog models record npc-model:... differs; preserved' before the fix)
**Applied fix:** `write_store_records` uses `catalog_with_record_replaced` for the `models` and `npcProfiles` slices, the owner the NPC batch, item and character paths already use; `convert_actors` no longer imports `merge_catalog_slice`.

### WR-04: Roots with an unported emitter class are published, so coverage and the catalog index report their keys as converted

**File:** `scripts/actors/skill_effect_conversion.py:204`
**Commit:** f5828ee
**Test:** `tests/pipeline/test_gap_census.py` `GapCensusPartTests.test_a_published_skill_key_whose_skills_row_is_an_unported_emitter_class_gap_stays_that_gap` (fails before); `test_coverage_report` and both lane coverage refresh tests still pass
**Applied fix:** The root cause was the census, not the converter: plan 02-43 keeps the bundle's `effectComponents` record. The census names the step that decides each part's conversion: for skills-effects a `skills` row that is not a pass keeps the key at that row's status and reason, so `emitter-class-unported:<class>` keys are gaps with `converted` false. Every other part still treats catalog presence as converted, so world tiles with emitter gap rows do not change. The 522 `emitter-class-unported:Engine.BeamEmitter` keys count as gaps (3,064 converted becomes about 2,542) once the integration thread regenerates lane coverage. Still open: the browser `nativeCatalogIndex.ts` lists those keys as converted in the sandbox (ACT-06, FX-01; 02-VERIFICATION SC3c).

### WR-05: Skill effect catalog writer uses a different JSON serializer from every other actors-lane writer, so the lane catalog SHA changes with no content change

**File:** `scripts/actors/skill_effect_conversion.py:237`
**Commit:** f48c353
**Test:** `tests/pipeline/test_skill_effect_root_outcomes.py` `SealedSkillRootOutcomeTests.test_a_rewrite_with_unchanged_outcomes_keeps_the_compact_lane_catalog_bytes_the_other_actor_writers_wrote` (fails on the old `canonical_json_bytes` code)
**Applied fix:** `write_store_records` writes the catalog with the compact `gltf.json_bytes`, the serializer of the other seven actors-lane catalog writers, so a skills finish with unchanged outcomes keeps the catalog bytes, its SHA-256 and its load-check file.

### WR-06: A missing decoded-tables catalog silently writes a degraded committed inventory

**File:** `scripts/build_dat_table_inventory.py:99`
**Commit:** 50c2062
**Test:** `tests/pipeline/test_dat_table_inventory.py` `DecodedTablesCatalogBoundaryTests` (four cases); `test_dat_table_inventory` and `test_hair_table_adapter` pass
**Applied fix:** `read_decoded_table_records` refuses a catalog that is missing or has no tables records, so `main` exits 1 before it writes anything. `--decoded-tables-catalog` stays, because plan 02-17 chose it, but the catalog must sit at `artifacts/lane-store/<lane>/l2/catalog.json`, and the decode gap rows come from that same project and lane instead of always the repository's data-ui lane.

### WR-07: --output outside the lane folder writes the store and drops the lane gap row, then fails at seal

**File:** `scripts/data/lane_unit_outcomes.py:49`
**Commit:** ccf4478
**Test:** `tests/pipeline/test_convert_tables.py` `ConvertTablesOutputGuardTests` and `SealUnitManifestTests`; `tests/pipeline/test_table_name_indexes.py` `TableNameIndexCommandTests`; `tests/pipeline/test_interface_layout_adapter.py` `ConvertUiCommandTests`; all new tests fail on the old code
**Applied fix:** Following plan 02-27 T-02-27-03 ('lane root only'), `convert_tables`, `convert_ui` and `table_name_indexes` no longer accept `--output` and always write the data-ui lane store root through `lane_store_root`, which applies the converter output guard. `seal_unit_manifest` works out the lane-relative manifest path before it removes the unit's gap row. The old `public/l2` `--output` refusal tests are replaced by tests that `--output` is rejected before any client read. Residual: `tests/pipeline/test_converter_output_guard.py` still lists `scripts/data/convert_tables.py` as an entry point whose `main` must call `require_converter_output`, so it fails since this commit (Notes).

### WR-08: Transient and lock-guard errors are sealed as permanent texture gaps

**File:** `scripts/data/ui_texture_step.py:132`
**Commit:** edaa2f0
**Test:** `tests/pipeline/test_ui_texture_step.py` `ConvertWindowTexturesTests.test_a_transient_converter_failure_leaves_the_window_unsealed_with_no_gap_row_and_no_store_write`, `test_a_reference_client_lock_error_propagates_and_leaves_the_window_unsealed` (both fail before)
**Applied fix:** `convert_reference` re-raises `ReferenceClientLockError` (decision row 288) and seals only `ValueError` decode refusals as `decode-failed` gaps, as the rules checker asked. An `OSError` or `SubprocessError` (a UModel `TimeoutExpired` included) returns the window as failed with no seal, no gap row and no store write, like the actors routes, and `convert_ui` exits 1 when any window failed.

### WR-09: The golden native-table fixture and the contract describe `records` as a list, but the local-descriptor converter writes an object

**File:** `scripts/generate_golden_fixtures.py:138`
**Commit:** d9f9dd5
**Test:** `tests/pipeline/test_catalog_record_shapes.py` `CatalogRecordShape.test_golden_table_manifest_holds_records_in_the_shape_its_route_writes` (failed before: list is not dict)
**Applied fix:** On the local-descriptor route the golden fixture pinned `records` as `[{'id': 0}]`, against decision 226 and `DECODED_TABLE_RECORDS_TYPE_BY_ROUTE`; the reader half was already fixed in 21a7a94. `native_table_manifest` moved from `data/convert_tables.py` to `native_store/data_ui_table_manifest.py`, which owns the native-table kind, version, routes and record types, and `convert_tables` and the golden generator both build through it. The regenerated golden fixtures move only the syntheticfixture table manifest (`5e4cbff3` to `cb5cd696`, 343 to 365 bytes), `catalog.json` and `fixtures.lock.json`; the two Vitest pins and the convert_tables test import follow. Table units stay versioned by `DECODE_TABLE_ALGORITHM_VERSION` and real manifests are byte-identical, so nothing restages. The contract wording landed with this report (docs/OUTPUT_CONTRACT.md, native-table v1).

### WR-10: Class-default cache is never invalidated when the parser or helper changes

**File:** `scripts/native_assets_lib/class_defaults.py:175`
**Commit:** 950bd2b
**Test:** `tests/pipeline/test_class_defaults.py` `SyntheticClassChainTests.test_the_cache_is_rebuilt_when_the_class_default_parser_changes`, `test_a_current_cache_entry_with_an_unexpected_shape_is_refused` (both failed before)
**Applied fix:** Each cached definition records `parserSha256`, a canonical hash of `class_defaults.py`, `native_catalog/effects.py` and `native_catalog/extract_ue_defaults.ps1`, and an entry is reused only when `schemaVersion`, `parserSha256` and the source identity are all current. A current entry must hold exactly the seven definition fields with their types or it is refused with `ClassDefaultError`, and a cache file that is not a JSON object is refused. `CLASS_DEFAULT_CACHE_SCHEMA_VERSION` 1 to 2, so the world lane's schema 1 entries rebuild the next time a step reads them.

### WR-11: Four static-material licensees count as reviewed, but their evidence cites real-client cases that do not exist

**File:** `scripts/native_assets_lib/static_materials.py:25`
**Commit:** 2139876
**Test:** `tests/pipeline/test_static_material_reviewed_versions.py` `ReviewedVersionEvidenceTests.test_every_reviewed_version_has_an_evidence_record_and_cross_checked_ones_an_equal_row`, `test_a_reviewed_version_without_a_real_client_case_fails` (failed before with four 'no real-client case' rows)
**Applied fix:** 123/19, 20, 28 and 30 were layout-reviewed with no real-client case, and the evidence test skipped layout-reviewed versions. A read-only probe of the pinned Elbera `l2lib` cross-check (12c9656) on the first census package of each licensee was equal, and `scripts/record_static_material_cross_check.py` wrote only the two fixtures: `aden_hunter_tunnel_s.usx` 8 exports (references SHA-256 `672cc46f...`), `aden_castle_door_s.usx` 5 (`acce0cc0...`), `Aden_Castle_S.usx` 54 (`490e4d43...`), `aden_village_s.usx` 35 (`1d361cfb...`). `LAYOUT_REVIEWED_LICENSEES` is now (16, 22, 23, 25, 31), and `reviewed_version_evidence_problems` fails any reviewed version with no real-client case. `REVIEWED_VERSIONS` did not change, so the committed static mesh package census and the world static mesh gate behave the same and nothing restages.

### WR-12: The Python tile validator accepts manifests the browser reader refuses

**File:** `scripts/native_store/tile_manifest_validation.py:168`
**Commit:** 15583d0
**Test:** `tests/pipeline/test_catalog_record_shapes.py` `test_tile_manifest_refusals` (two minimap, two sky, untemplated sky paths), `test_chunk_manifest_refusals` (terrain, bsp and collision paths, empty placements, placement field checks, model and placement bounds), `test_a_vocabulary_kind_without_a_path_template_is_refused`, `TileManifestBrowserParityTests`
**Applied fix:** The validator applies the browser reader's rules: the per-kind tile resource path templates and the world-audio-only repeatable kind; the terrain, BSP and collision chunk path templates; non-empty placements with every field checked (id unique in the chunk, `modelId` equal to its model, qualified `sourceActor`, `exportIndex` of at least 1, non-empty `sourceMesh`, an invertible affine matrix, empty `materialOverrides` and a collision object); at most 1,024 models and 4,096 placements per chunk; and a vocabulary kind without a path template is refused. Instead of a new shared file TypeScript would have to read, a Python parity test reads `nativeTileManifest.ts`, `nativeTileChunkManifest.ts` and `nativeBspResources.ts` and fails if templates, repeatable kinds, path regexes or bounds drift. All 62 world lane tile manifests and their 992 chunk manifests pass; no golden fixture and no TypeScript changed.

### WR-13: require_equal_file_with_locked_sha256 returns None on the reference root, and callers handle that None differently

**File:** `scripts/reference_client_guard.py:101`
**Commit:** fc72b5d
**Test:** `tests/pipeline/test_reference_client_guard.py` `test_equal_file_with_sha256_returns_the_lock_digest_on_a_lock_checked_root_and_the_file_digest_on_the_reference_root` (fails on the old guard)
**Applied fix:** The guard owns the digest: `require_equal_file_with_sha256` returns the lock eSha256 on a lock-checked root and a fresh file SHA-256 on the reference root (hashed on every read, no identity cache: decision row 147; corrected in 81f050a after fc72b5d first used the cache), and refuses a missing file there by name; `require_equal_file` stays hash-free. Every caller dropped its None branch (`converter_source_digests`, the `native_catalog` cli with `read_scope_file_sha256` deleted, `actor_sound_conversion`, `reader_cross_check_rows`, `world_audio_step`), and `actor_sound_batch` calls `require_equal_file` because it never used the digest. On IMPORTA-PC `world_audio_step` therefore compares the real Core.dll digest with the recipe instead of recording a false `reference-file-not-lock-equal:system/Core.dll` gap. `reader_cross_check_rows` keeps its `lockSha256` field name, which now holds the read package's digest on both roots.

### WR-14: Converter point-to-leaf rule falls back to the other leaf; the runtime locateZone does not

**File:** `scripts/world/bsp_leaf_membership.py:38`
**Commit:** bde8d15
**Test:** `tests/pipeline/test_world_bsp_visibility_step.py` `ZoneLocateTests.test_an_empty_leaf_slot_keeps_index_none_and_the_node_side_zone_with_no_fallback`, `test_a_plane_distance_that_rounds_to_float32_zero_goes_front` (returned (1, 2) and (-1, 0) before)
**Applied fix:** Matching `locateZone.ts` and decision row 705 (Engine.dll `UModel::PointRegion` 0x10746910), `leaf_for_point` uses the float32 plane distance (back when below 0) and returns the last node's `i_leaf[side]` and `i_zone[side]` with no fallback; `f32` comes from `world.terrain_coordinates`. The recipe row `locate-tie` cites Engine.dll instead of Lineage2JS and is `confirmed-interlude`. `LIGHTING_STEP_ALGORITHM_VERSION` 3 re-derives light zones, and bsp-visibility re-derives through its rules hash. No shared Python and TypeScript fixture was added; the `bspTranslucentOrder` tests pin the TypeScript side.

### WR-15: PhysicsVolume subclasses are silently left out of collision while the collision step reports pass

**File:** `scripts/world/collision_step.py:178`
**Commit:** 8ad3264
**Test:** `tests/pipeline/test_world_collision_step.py` `UnadmittedVolumeClassTests.test_a_physics_volume_subclass_left_out_of_vols_is_a_gap_row_naming_its_class`
**Applied fix:** Row 666 keeps the admitted classes and VOLS kind codes, so subclasses were not admitted here (that changes the MOVE-01 payload codes; WR-18, deferred). As the finding's interim fix, the step walks each actor's class chain through `light_actors.ClassChains` and writes the per-object gap `collision-volume-class-unadmitted:<class>` for every subclass of an admitted volume class that VOLS leaves out. The reason is registered in `recipes/world/gap-reasons.json` (listVersion 16) and `COLLISION_STEP_ALGORITHM_VERSION` became 3 (4 since 56b9555). The records stay out of the product `volumes` list, so lighting still reports `lighting-water-volume-unlinked`. The 10 water tiles that read collision pass become object-gap rows after a collision rerun.

### WR-16: Single-step command writes the manifest step's foreign pending rows over other steps' recorded gap or failed rows

**File:** `scripts/world/convert_tile.py:49`
**Commit:** 02e0a5e
**Test:** `tests/pipeline/test_world_raw_step.py` `ConvertTileCommandTests.test_a_manifest_run_records_only_its_own_row_and_keeps_the_rows_of_other_steps` (the foreign pending row was recorded and printed before)
**Applied fix:** `own_step_row`, `StepSealMissingError` and `locked_tile_source_identity` moved from `convert_tile_batch` to `eligible_tile_selection`, which owns them, and the batch imports them from there. `convert_tile` records and prints only the requested step's seal-derived row. The 11 orphan terrain-material rows an earlier `--step manifest` wrote stay in `gap-rows/terrain-material.json` until they are removed.

### WR-17: A step that raises records no row, so an older pass row stays in coverage

**File:** `scripts/world/convert_tile.py:51`
**Commit:** 9f78c56
**Test:** `tests/pipeline/test_world_raw_step.py` `ConvertTileCommandTests.test_a_step_that_raises_records_its_failed_row_over_an_older_pass_row` (the old pass row stayed before)
**Applied fix:** When a tile step raises `OSError` or `ValueError`, `convert_tile` records the batch's `failed_step_row` (`decode-failed:<type>:<message>`) inside the coverage refresh block and re-raises, so the command still prints 'Tile conversion failed' and exits 1. A non-tile raw map with a malformed name records nothing, as before.

### WR-19: Map emitters treat BeamEmitter and VertMeshEmitter as ported, so they never get emitter-class-unported

**File:** `scripts/world/map_emitter_records.py:54`
**Commit:** 6859f46
**Test:** `tests/pipeline/test_world_map_emitter_step.py` `MapEmitterExportTests.test_a_converted_emitter_class_the_simulation_does_not_port_is_a_named_unported_gap`
**Applied fix:** The gap tested `CONVERTED_EMITTER_CLASSES`, which includes Beam and VertMesh, while FX-01 simulates only Sprite, Mesh and Ribbon. The step reads the simulated set from `recipes/actors/emitter-class-coverage.json` through `read_simulated_emitter_classes`, the reader the skills lane uses, and gaps every class outside it; the set is pinned in the unit fingerprint config (emitters step algorithm 2). The record keeps its converted flag for the bundle conversion set chosen in row 596.

### WR-20: The emitters step reports pass for placements the runtime can never play

**File:** `scripts/world/map_emitter_step.py:61`
**Commit:** d70fe6d
**Test:** `tests/pipeline/test_world_map_emitter_step.py` `MapEmitterExportTests.test_an_emitter_record_with_an_unparsed_struct_or_an_unconverted_reference_is_a_named_gap`
**Applied fix:** Each emitter record gets one per-object gap row for its first blocker, in this order: `emitter-class-unported:<class>`, `map-emitter-struct-unparsed:<property>` (array elements named `property[index]`), `map-emitter-resource-unconverted:<object>`; a record passes only when it has none. World gap reasons listVersion 18, emitters step algorithm 3. The class-default merge is not a converter gap, because row 651 gives it to the runtime binding, and the reason names match the runtime inspection reasons of row 696. The 22 converted tiles read emitters gap after the restage; runtime playback stays open (WR-40, deferred).

### WR-21: Scaled movers are refused as non-rigid-key-transform, although their key transforms are rigid

**File:** `scripts/world/mover_records.py:124`
**Commit:** 59db4a9
**Test:** `tests/pipeline/test_world_mover_step.py` `MoverUnsupportedTokenTests.test_a_rigid_key_on_a_scaled_or_mirrored_actor_names_the_actor_scale`, `test_the_token_list_is_the_closed_set_of_qualification_failures`
**Applied fix:** `static_matrix` folds DrawScale and DrawScale3D into the key rows, so movers with an actor scale read non-rigid. When a key fails the rigidity check, the step rebuilds its rows at unit scale; if those rows are rigid, the token is `mover-unsupported:actor-scale`, now in `MOVER_UNSUPPORTED_TOKENS` (movers step algorithm 2). Keys that stay non-rigid keep `non-rigid-key-transform`. Scaled movers stay gapped, as the T-02-313 rigid-matrix rule and `moverPose` require (25 of 79 movers on converted tiles); carrying scale through the mover manifest, `moverPose` and MOVR is WORLD-08 work that needs its own qualified rule.

### WR-22: CollisionRules.placement_class, transform_fields and rows are loaded from the recipe and never read

**File:** `scripts/world/static_collision_sources.py:31`
**Commit:** 65bdd71
**Test:** `tests/pipeline/test_world_collision_step.py` `test_a_rules_recipe_naming_a_field_no_collision_step_reads_is_rejected` (the old loader accepted a recipe carrying `placementClass`)
**Applied fix:** `placementClass` and `transformFields` are deleted from `recipes/world/collision-declaration-rules.json`, and `placement_class`, `transform_fields` and `rows` from `CollisionRules`; `load_collision_rules` rejects a recipe whose top-level fields differ from the fields the collision and mover steps read, so a key that governs nothing fails loudly. The recipe hash moves, so the collision and mover units re-run on their next call.

### WR-26: NPC and item catalog-key rules in TS/Python differ from OUTPUT_CONTRACT

**File:** `src/assets/native/loadNativeNpcProfiles.ts:35`
**Commit:** 411fae3
**Test:** `tests/pipeline/test_catalog_index_keys.py` `test_an_npc_profile_model_catalog_id_must_be_an_npc_model_id_like_the_browser_catalog_index`, `test_an_npc_profile_without_a_model_catalog_id_outside_the_shared_store_bundle_is_refused_like_the_browser_catalog_index`, `test_a_shared_store_npc_profile_without_a_model_catalog_id_never_joins_an_npc_model_record_like_the_browser_catalog_index`, `test_a_shared_store_npc_profile_without_a_model_catalog_id_joins_exactly_one_legacy_model_with_its_mesh` (all fail on the old module)
**Applied fix:** The TypeScript reader and join already follow decision rows 326 and 327 and are unchanged. `scripts/native_store/catalog_index_keys.py` now follows the same rule: the strict `^npc-model:[a-f0-9]{64}$` pattern; a profile without `modelCatalogId` refused outside the shared-store bundle `native-npc-profiles`; `npc-model` records never legacy candidates; several legacy matches answering `not-in-catalog` instead of raising. `side_by_side_key_digest.py` passes the pack record id. The golden key fixture, side-by-side digest, gap census, coverage report, merge, union and lane writer tests still pass, and no golden or fixture was regenerated. `native_actor_profiles.py` was not edited, because it is a converter implementation file and editing it moves the fingerprints. The OUTPUT_CONTRACT `npc:` and `item:` rows landed with this report.

### WR-27: Two readers parse the same glTF extras key nativeMaterialProgram with incompatible shapes

**File:** `src/assets/native/nativeSkeletalMaterials.ts:34`
**Commit:** b51e75b
**Test:** `tests/unit/nativeSkeletalMaterials.test.ts` > renders a slot pinned in the converter's native-materials pin form ... and refuses a slot pin holding a bare SHA-256 instead of the pin object (5 of 5 fail on the old reader); the attachTileLighting, decodeTileLighting, nativeSkyPresentation, selectedNativeTile, nativeActor and nativeCharacterVisual tests still pass
**Applied fix:** The new `src/assets/native/nativeMaterialProgramPin.ts` (`readNativeMaterialProgramPin`) is the one reader. It takes the `{directory, programSha256}` object that the only producer, `bsp_chunk_geometry.py`, writes, reads null as no program and refuses everything else. The skeletal binding, `attachTileLighting`, `bindTileLighting` and `nativeSkyPresentation` use it, and `surfaceMaterialProgram.ts` is deleted. An actor GLB writer must use the same object shape.

### WR-29: BlendBetweenSubdivisions is simulated but never drawn: the next-cell cross-fade is dropped

**File:** `src/effects/particles/render/particleInstances.ts:52`
**Commit:** c1f67be
**Test:** `tests/unit/spriteEmitter.test.ts` > reports an age-driven BlendBetweenSubdivisions atlas as an unported feature, because the renderer samples one cell
**Applied fix:** `listUnportedEmitterFeatures` reports `emitter-feature-unported:BlendBetweenSubdivisions` for a sprite that sets it on a multi-cell atlas without `UseRandomSubdivision`; with random subdivision the simulation's blend weight is always 0, so no gap. The two-cell blend is not drawn: how the native D3D stage combines the next-cell texel with the byte weight has no Interlude-derived row, and a linear mix would be an invented rule, so drawing stays open under FX-01 (POL-04). `nextCell` and `blendWeight` stay as the corrected-interlude simulation model the renderer will read.

### WR-30: The live emitter rotation is applied to world-stored (Spray and Independent) particles, so Spray particles are rotated twice

**File:** `src/effects/particles/render/particleInstances.ts:65`
**Commit:** b9092b3
**Test:** `tests/unit/particleInstances.test.ts` > draws a world-stored Spray particle where it was born, without the live bRotEmitter rotation (fails before) and turns an owner-stored Relative particle with the live bRotEmitter rotation
**Applied fix:** The instance location takes the live emitter rotation only when `storageSpace` is `owner`, following the `fx.world-space-storage` row. Mesh particle orientation still turns with the live emitter rotation, matching the reference, which renders Spray particles under the current emitter matrix and re-bases only positions (`base-emitter.ts:1064-1087`); the checkers did not confirm the finding's orientation claim, so it is unchanged.

### WR-31: A ForcedMaxParticles shrink after initialization leaves frozen particles that are drawn forever and keep the emitter alive

**File:** `src/effects/particles/sim/emitterNatives.ts:76`
**Commit:** d238922
**Test:** `tests/unit/emitterNatives.test.ts` > keeps ageing every allocated slot when AdjustparticleLife lowers ForcedMaxParticles after initialization (fails before)
**Applied fix:** `updateParticles` visited min(Active, MaxParticles) slots while `listLiveSlots` listed min(Active, allocated); the checkers corrected the never-dead claim, but the old dead rule (dead >= MaxParticles) could end an emitter with live slots past the new limit. Following the reference, which keeps `maxActiveParticles` after initialization, the update and the live listing share one `countVisitedSlots` rule over the allocated columns, and the dead rule compares with the allocated slots; the `fx.dead-rule` row text says so (docs/parts/skills-effects/PARTICLE_SEMANTICS.md updated with this report, status still unconfirmed). No flags are cleared. Before a shrink the allocated slots equal MaxParticles, so the sprite, mesh, ribbon and Power Strike golden traces are unchanged.

### WR-35: Model evaluators that nothing at runtime calls; tests pin a CPU twin, not the shader that renders

**File:** `src/materials/ue2/model/fog.ts:72`
**Commit:** 0113612
**Test:** `tests/unit/ue2Fog.test.ts` 'fog shader source' (both cases); `tests/unit/ue2Modifiers.test.ts` 'passes TexCoordSource channel 0 through and reports another channel and every TexEnvMap unported' (fails before, because TexEnvMap returned evaluated)
**Applied fix:** `fogFamilyForBlend`, `fogFactor`, `applyFog`, `applyModulate2xLighting`, `environmentMapCoordinates`, `applyTextureCoordinateMatrix` and the MaterialSequence branch of `selectTextureFrame` had no runtime caller and are deleted with the kind discriminator; the `materialFrame.ts` and `loadEffectComponent.ts` callers moved. Fog GLSL has one owner, `fogFactorExpression` and `foggedColourExpression` in `babylon/fragmentChain.ts`, used by the material and particle chains; the generated shader text is byte-identical, so no golden moves, and a test pins that source. `textureCoordinateModifierMatrix` owns the porting decision (TexEnvMap unported with EnvMapType, a TexCoordSource channel other than 0 with SourceChannel), and `material.ts` `unsupportedCoordinateReason` is deleted. The CPU combiner evaluator stays (WR-33, deferred).

### WR-37: Tile mover reader bounds that the converter never enforces turn one mover into a whole-tile load failure

**File:** `src/scene/world/nativeMoverManifest.ts:44`
**Commit:** e2e9b69
**Test:** `tests/unit/loadNativeTileChunks.test.ts` > keeps the tile and reports a movers gap when the tile mover manifest refuses a mover; `tests/unit/nativeTileMoverManifest.test.ts` > accepts any positive move time the movers step converts
**Applied fix:** A mover decode failure propagated out of `attachNativeTileSystems` and failed the whole tile, while visibility, lighting and emitter failures became gaps, and the unsourced 120 s move-time cap was stricter than the converter's duration > 0. The cap is deleted, so the move-time check is finite and positive for both readers, and a refused or mismatched mover manifest leaves the tile loaded with `movers` null and `moverGap` `movers-invalid:<reason>` in the tile inspection; aborts still propagate. The 32-model and 512-mover bounds and the non-negative server id check stay as trust-boundary checks and now degrade to that gap. No converter change was needed.

### WR-38: The production tile route (streamNativeTileChunks, readResidencyTile) has no Vitest coverage

**File:** `src/scene/world/streamNativeTileChunks.ts:28`
**Commit:** 11dfb80
**Test:** `tests/unit/streamNativeTileChunks.test.ts` (5 cases: the startup-only binding pinned; an unreadable neighbour becomes a streamed tile gap; focused-tile neighbours added once, each tile read once; dispose releases systems, residency and every tile's templates once; a missing tile returns null)
**Applied fix:** Test-only. The route runs against a stub residency and a mocked tile reader. As the rules checker asked, the late-chunk case pins the current row 740 startup-only binding (CR-12, deferred). `readResidencyTile`'s own decoding is mocked and is not covered by this change.

### WR-39: Tile movers are loaded and drawn, but `NativeSection.moverTargets` has no production reader, so tile doors never move

**File:** `src/scene/world/streamNativeTileChunks.ts:126`
**Commit:** 91574b9
**Test:** `tests/unit/loadNativeTileChunks.test.ts` > hands the tile movers to the slice world as its door targets instead of looking up catalog movers by terrain (on the old loader `loadNativeMovers` ran and `world.movers` was null)
**Applied fix:** `loadNativeSliceWorld` called `loadNativeMovers` with the fabricated anchor-chunk terrain hash, which never matches, so tile doors were null. `NativeSection` carries `tileMovers` (the loaded `NativeTileMovers`, which now carry `manifestSha256`); the slice world uses them as its doors (hover, approach and local toggle through `createNativeDoorInteractions`) and calls the catalog terrain lookup only for sections without tile movers. The section stays the one owner of their disposal, and the unread `NativeMovers.collisionMeshes` field is deleted. Tile door meshes stay out of collision (`moverCollisionMeshCount` 0), and neighbour-tile movers never load (row 740, CR-12).

### WR-41: isReady treats a position outside every known cell as ready, so a pawn where no collision exists is simulated and falls instead of being held and reported

**File:** `src/scene/world/movement/core/collisionWorld.ts:103`
**Commit:** e5b7326
**Test:** `tests/unit/movementPresenter.test.ts` > holds a pawn outside every collision cell and reports collision-cell-absent instead of letting it fall (fails before: the pawn at x 4200, outside the fixture footprint, was simulated and moved); `tests/unit/collisionWorldCells.test.ts` > is ready only inside a resident cell footprint and names a point outside every footprint as holding no collision cell
**Applied fix:** `CollisionWorld.isReady` is replaced by `collisionReadiness`, which answers `ready` only inside a resident cell footprint, `cell-not-resident` inside a required cell not loaded yet (a missing cell still wins on a shared edge) and `no-collision-cell` elsewhere. `movementPresenter` holds the pawn for both non-ready answers, with `heldReason` `collision-not-ready` or the new `collision-cell-absent`; callers and tests moved to the one method. The 17_12 to 18_12 border walk (row 743) should now stop at the seam with `collision-cell-absent` instead of dropping 116.8 m; the seam itself stays open (plan 02-81).

### WR-43: The UE2 FRotationMatrix built from the sine table is duplicated in the movement core and the particle simulation

**File:** `src/scene/world/movement/core/volumeTrace.ts:25`
**Commit:** 9c1fa7b
**Test:** existing `tests/unit/particleInstances.test.ts`, `collisionWorldCells.test.ts`, `movementPointCheck.test.ts`, `pawnPhysicsModes.test.ts` (golden traces), `importBoundaries.shared.test.ts`, `importBoundaries.movement.test.ts` and `importBoundaries.particles.test.ts` pass unchanged
**Applied fix:** `rotatorAxes`, with the `RotatorAxes` and `RotatorUnits` types, moved to `src/shared/math/rotator.ts` and uses that file's quarter-turn constant. `volumeTrace.ts` (`ue2ActorLocalToWorld`, which hard-coded quarterTurn 16384), `particleSpawn.ts`, `particleInstances.ts` and `particleRotation.ts` (`rotateByRotators`) call it, and the copy in `particleRotation.ts` is deleted. The arithmetic is the same, so the movement and particle golden traces did not move.

### WR-44: The run moveType has two owners: a recipe row in the presenter and hard-coded constants in the adapter

**File:** `src/scene/world/movement/movementPresenter.ts:139`
**Commit:** c77a88f
**Test:** `tests/unit/nativeSliceAdapterSpeed.test.ts` > has its run move record presented at run speed by the movement presenter reading the same rules; `tests/unit/nativeSliceAdapter.test.ts` > refuses move-local with a named reason when the movement rules gave it no walk and run move types; `tests/unit/moveActor.test.ts` > reads one walk and one run move type and refuses them equal or fractional
**Applied fix:** `NativeSliceAdapter` hard-coded walk 0 and run 1, and walk 0 had no rule row. The new row `movement.walkMoveType` (value 0, unconfirmed, sourced from the 05-network.md command mapping ChangeMoveType2 0 walk) joins `movement.runMoveType`; `parseMovementNativeRules` requires two different integers, and `createNativeSliceRuntime` passes both rule values to the adapter as `moveTypes`, because src/world may not import scene or runtime code. Without them the adapter refuses move-local with `local-move-types-absent`, as it does for a missing collision cylinder. Row 720 still holds, since the adapter sends the same values from the one owner; test adapters take `committedMoveTypes` from the shared movement fixture.

### WR-45: The speed-unresolved hold turns into a protocol cannot-move after 0.6 s and the hold diagnostic disappears

**File:** `src/scene/world/movement/movementPresenter.ts:197`
**Commit:** ac8c5bc
**Test:** `tests/unit/movementPresenter.test.ts` > holds a local pawn whose move record lacks the swim speed as speed-unresolved without reporting cannot-move; > restarts the stuck window after a hold so a resumed swim is not reported as cannot-move (both failed before; the second still failed with only the report skip in place)
**Applied fix:** `advancePawn` still ran `emitReports` while speed-unresolved, so `checkProgress` sent cannot-move after 0.6 s and the next frame cleared `heldReason`. Every hold now goes through one `holdPawn` path that skips position reports and clears the progress anchor, for collision holds and speed-unresolved alike, so a pawn resuming after a hold starts a fresh stuck window.

### WR-46: Shared math exports that only tests use

**File:** `src/shared/math/affineMatrix.ts:47`
**Commit:** 14203e7
**Test:** `tests/unit/sharedMath.test.ts` (updated cases pass)
**Applied fix:** Deleted `multiplyAffineMatrices`, `transformDirection`, `invertAffineMatrix` and `rotatorSineExact`, the private `multiplyMatrix3` only they used, and their test-only cases; the table-to-exact sine test computes the exact sine inline. `IDENTITY_AFFINE_MATRIX` stays, unused: `tools/reference-overlap/overlapAreas.json` allowlists it, the overlap tool throws `ReferenceOverlapSetupError` for an allowlisted constant the source does not declare, and the fixer could not edit `tools/reference-overlap/`. Removing it needs the allowlist entry dropped in the same change (decision row P740).

### WR-51: WorldNavigation members left unused after meshNavigation was retired

**File:** `src/world/WorldNavigation.ts:20`
**Commit:** d32c711
**Test:** `tests/unit/worldMovementWiring.test.ts` and `tests/unit/nativeDoors.test.ts` (existing cases, spawn-only assertion removed); `tests/unit/importBoundaries.test.ts`
**Applied fix:** The only consumer, `nativeDoorInteractions`, reads `destination()` and `move().blocked`. `origin`, `ground`, `groundContact`, `spawn` and `move().contact` left `WorldNavigation` and `createCollisionWorldNavigation`, whose unused origin parameter is dropped; the one caller (`createNativeSliceRuntime`), the `nativeDoors` mock and the spawn-only test line follow. `WorldGroundContact` and `WorldSupportSample` stay, because the footstep and diagnostics code imports them.

## Not a defect

### CR-03: Elbera hair table manifests store a list in records, but the shared data-ui reader only accepts a dict, so the character route fails

**File:** `scripts/data/convert_tables.py:79`
**Test:** `tests/pipeline/test_data_ui_table_manifest.py` `test_the_character_route_reads_elbera_adapter_hair_and_helmet_manifests_beside_a_local_descriptor_classinfo` (already present)
**Reason:** The same defect as CR-02, already fixed by 21a7a94 in this round: `data_ui_table_manifest` takes the route and checks the records type for that route (object for local-descriptor, list for elbera-adapter), and `character_conversion` reads hairgrp and helmetgrp on the elbera-adapter route. A read-only run of the reader at HEAD against the real data-ui lane store returns hairgrp 15 rows, helmetgrp 3 and classinfo-e object records, with no error. The Elbera rows stay a list, as plan 02-28 requires; hairaccessarygrp has no reader caller.

### CR-09: Engine.MovableStaticMeshActor placements are silently dropped: never placed, never gapped, never in collision

**File:** `scripts/world/static_placement_plan.py:65`
**Test:** `tests/pipeline/test_world_collision_step.py` `unsupported_placement_class_records` case (MovableStaticMeshActor fixture) and the `tests/pipeline/test_world_static_mesh_step.py` subclass accounting cases, both from 56b9555
**Reason:** The same defect as CR-08, already fixed at HEAD by 56b9555: `plan_static_placements` and the collision step walk each actor's class chain and write `placement-class-unsupported:<class>` for every StaticMeshActor subclass, `Engine.MovableStaticMeshActor` included, and `placement_accounting_difference` counts those actors (meshes step algorithm 3, collision step algorithm 4, gap reasons listVersion 17). Nothing left to change.

### WR-49: Run moveType is hard-coded in the adapter while the presenter reads it from the movement recipe row

**File:** `src/world/NativeSliceAdapter.ts:19`
**Reason:** The same defect as WR-44, already fixed in c77a88f: the adapter has no constants. It takes `NativeSliceMoveTypes`, which `createNativeSliceRuntime.ts:162` builds from `committedMovementRules.pawn.walkMoveType` and `runMoveType`, and rejects move-local with `local-move-types-absent` when they are missing. The tests use `committedMoveTypes` from the rules fixture.

## Deferred

The gap-plan amender ran at the same time as this report (decision rows P801 to P812) and may still add tasks; each owner below is named by its plan's objective.

### CR-07: Batch seal inspection counts any seal as current, so stale units are never redone and their rows read as current

**File:** `scripts/world/eligible_tile_selection.py:52`
**Requirement:** WORLD-03
**Owned by:** plan 02-90, the batch seal inspection plan (one current-seal check for all 14 registered steps, seal inspection version 2, so one `convert_tile_batch.py --eligible` resume re-runs every stale unit); moved out of 02-75 Task 3 by decision row P801, rule in P804
**Reason:** Confirmed: `sealed_unit_step` uses `ledger.sealed_receipt` with `SEAL_INSPECTION_ALGORITHM_VERSION` 1 and checks neither the fingerprint nor algorithmVersion. A fix needs one uniform current-seal check for every registered step: `raw_map_step` and `tile_manifest_step` have no such helper (the manifest computes its fingerprint inline in `run_tile_manifest_step`), and the existing `sealed_*` helpers differ in return shape and raise when an upstream unit is unsealed. That is a refactor across all step modules, outside the finding's files (rows 758, P713).
**To fix:** a per-step current-seal registry next to `tile_step_registry` that `sealed_unit_step` and `convert_tile_batch.tile_has_work` and `sealed_tile_steps` query, so a stale seal counts as unsealed work, with a test of a version 2 receipt under a version 4 step.

### CR-12: Tile visibility, lighting, movers and emitters are bound once, to the startup chunks only, on the streamed tile route

**File:** `src/scene/world/streamNativeTileChunks.ts:100`
**Requirement:** VIS-01 and MAT-02, under WORLD-04
**Owned by:** plan 02-91, the chunk-incremental tile systems plan (residency chunk events, per-chunk and per-tile system binding, a streamed-route browser check); decision rows P735 and P805, which supersede row 740
**Test pinning today's behaviour:** `tests/unit/streamNativeTileChunks.test.ts` > binds the tile systems once, to the selected tile's startup chunks only, and leaves neighbour and later chunks unbound (11dfb80)
**Reason:** Confirmed: `attachNativeTileSystems` runs once, on the selected tile's chunks resident after `ready()`. Chunks loaded later, reloaded chunks and neighbour tiles never get visibility, lighting, emitter or mover bindings. Row 740 chose this and called chunk-incremental binding a separate change; its premise that all 16 chunks are resident at startup is false on 18_24, 18_10, 20_10 and 18_22 (trace checker), so the selected tile itself can report `bsp-visibility-section-unmapped`. The fix redesigns both binders.
**To fix:** attach and detach per chunk in `attachTileVisibility` (section and placement targets) and `attachTileLighting` (lightmap plans), wired into the residency load and dispose path, plus per-tile system attach for neighbour tiles.

### CR-13: Tile lighting and BSP visibility bind once to the startup-resident chunks, so chunks streamed in later stay unlit and unculled

**File:** `src/scene/world/lighting/attachTileLighting.ts:66`
**Requirement:** MAT-02, with VIS-01 for the visibility side
**Owned by:** plan 02-91 (as CR-12)
**Reason:** Confirmed in the code: `streamNativeTileChunks.ts:92-100` calls `attachNativeTileSystems` once with the startup chunks, the residency has no load or dispose hook for tile systems, and `sectionMeshes` in `babylonTileVisibilityTargets.ts` returns `bsp-visibility-section-unmapped` for any RNGE range whose chunk is not in the supplied set. The trace checker lists 18_10, 18_22, 18_24, 19_16 and 20_10 with BSP chunks outside the startup ring; the fixer did not re-check that against the store.
**To fix:** a residency chunk-loaded and chunk-disposed event API, per-chunk lighting and visibility binding with lightmap pages re-planned per chunk, and a streamed-route test that walks into a chunk not resident at startup and asserts it is lightmapped, listed in the inspection and covered by the visibility binding.

### WR-18: Water volumes can never link: the collision volume export it reads holds only exact BlockingVolume and PhysicsVolume

**File:** `scripts/world/lighting_step.py:119`
**Requirement:** WORLD-08 with MAT-02
**Owned by:** plan 02-77, the WaterVolume plan (VOLS admits every PhysicsVolume subclass by class chain with its kind and declared fields, lighting links water volumes, MOVE-01 swimming reads water from the data); decision row P803 supersedes row 666 and P710
**Reason:** Confirmed mechanism, but row 666 keeps WaterVolumes out of VOLS, and admitting PhysicsVolume subclasses changes the VOLS payload codes the MOVE-01 runtime reads. 8ad3264 already makes the omission visible as `collision-volume-class-unadmitted:<class>`, and lighting shows `lighting-water-volume-unlinked:<class>`.
**To fix:** VOLS kind codes for the admitted subclasses and the MOVE-01 volume reader, a collision and lighting restage, then the lighting test's volumes built from the real collision producer.

### WR-23: Static mesh collision depends on the visual model conversion, so material-adapter failures delete collision

**File:** `scripts/world/static_collision_sources.py:121`
**Requirement:** WORLD-08 (with MAT-01)
**Owned by:** plan 02-92, the static mesh slot, GPU combiner and display gamma plan (decision row P807: the model converts, and a slot whose material has no diffuse adapter keeps its geometry and `nativeSlotProperties` as a named magenta diagnostic slot)
**Reason:** Confirmed at HEAD: `decide_placement_collision` gaps with `field:nativeSlotProperties` whenever the placement has no converted GLB, and `static_mesh_collision_triangles` reads triangles only from the render GLB, the stopgap that rows 520 and 521 and the recipe rule `collision.static-mesh-triangles` record until the serialized collision triangles are decoded. The gaps stay visible, so nothing is fabricated. A fix needs a collision-only UStaticMesh reader or a converter route that exports geometry when a material adapter is missing, then a meshes and collision restage.
**To fix:** 02-92 as planned, then the meshes and collision restage of the affected tiles (about 2,543 world placements fail on the Combiner, TexPanner and TexOscillator adapters).

### WR-24: One unsupported terrain material layer fails the whole tile, blocking geometry, meshes, BSP, collision and the tile manifest

**File:** `scripts/world/terrain_chunk_step.py:178`
**Requirement:** WORLD-01 with WORLD-03
**Owned by:** plan 02-75, the terrain failures plan (per-layer gap rows, terrain step version bump, the six tiles re-run through terrain); decision rows P719 and P802 (a tile whose every layer is gapped writes `terrain.glb` with the mask UV set 0 only, no TEXCOORD_1, `baseLayerUvSet` null and `nativeLayers` [])
**Reason:** Confirmed at HEAD: `is_empty_layer_slot` (`terrain_chunk_step.py:52-57`) and `layer_records` (`terrain_layers.py:81-84`, `102-103`) raise `FormatError` inside the terrain try block, so the step returns failed with no seal. The full fix needs the per-layer gap reasons `terrain-layer-incomplete:<index>` and `terrain-layer-uv-unverified:<index>` with a gap reasons listVersion bump, the layer-less glTF contract above, and a terrain restage of 16_25, 18_23, 19_23, 19_24, 20_16 and 20_17, which the fixer could not run.

### WR-25: OUTPUT_CONTRACT says the typed tile resources are .l2asset packages, but the writer emits a loose asset.json + payload.bin folder

**File:** `scripts/world/typed_payload.py:98`
**Requirement:** FOUND-02
**Owned by:** done in this report's commit: docs/OUTPUT_CONTRACT.md describes `native-tile-collision`, `bsp-visibility` and `lighting` as typed payload folders `maps/<asset.json sha256>/<folder>/` holding `asset.json` and a 4-byte aligned `payload.bin` (rows 518 and 590). Plan 02-74 also carries this contract change (FOUND-02 added by P801), so its gate already passes at plan start.
**Reason:** A documentation defect only. The loose folder is the form rows 518 and 590 recorded and that every in-repo reader (`src/shared/typedPayload.ts`) uses, so no code changes; the fixer could not edit docs/.

### WR-28: Converted per-actor sound bundles (actor-sounds:<key>) are never loaded at runtime

**File:** `src/audio/loadNativeCombatAudio.ts:126`
**Requirement:** ACT-05
**Owned by:** plan 02-80, the spawned actor sound module (`loadSpawnedActorSounds(catalogKey, catalogIndex, signal)` through `loadNativeCombatAudio`), wired on spawn by plan 02-87, the runtime wiring plan for gaps SC2e and SC3a
**Reason:** Confirmed: `loadNativeSliceAudio.ts:25` only ever loads `native-combat-audio`, and `createNativeCombatAudio` holds one bundle. A per-entity spawn-time loader and multi-bundle routing in `nativeCombatAudio` (559 lines) go far beyond the finding. The `generatedActorSoundBundlePrefix` guard stays, because row 475 records it and 02-80 makes it reachable.

### WR-32: The skill census marks effects pass that the runtime refuses, and nothing ever writes emitter-feature-unported gap rows

**File:** `src/effects/particles/sim/particleEmitter.ts:38`
**Requirement:** ACT-06 with FX-01
**Owned by:** plan 02-94, the emitter feature census plan (a MeshEmitter with `UseMeshBlendMode` true loads as a listed gap with that emitter not drawn, and the skills census writes `emitter-feature-unported:<property>` rows from a recipe kept equal to the TypeScript feature list; decision row P812), with the skills gap rows restaged by 02-79's skill batch
**Reason:** Confirmed. It needed a decision the plans had not made: either a MeshEmitter with `UseMeshBlendMode=true` loads as a listed gap with that emitter not drawn, or the mesh-materials route through the UE2 material library is ported. Today `bindParticleMaterial` throws and the whole `el_ice_bolt_ta` actor (skill 105, MeshEmitter3 and MeshEmitter6) fails to load, so no runtime `featureGaps` entry is ever seen. The census rule in `skill_effect_conversion.py` `converted_root_outcome` must apply the TypeScript feature list, which now also covers `UseDirectionAs` (52ed33e) and `BlendBetweenSubdivisions` (c1f67be), to each staged component's `effectiveProperties`.

### WR-33: The tested combiner evaluator is a CPU twin no runtime path calls, and the GPU combiner that does render is untested

**File:** `src/materials/ue2/model/combiner.ts:99`
**Requirement:** MAT-01
**Owned by:** plan 02-92 (decision row P808: the CPU evaluators become the pixel oracle of the swatch harness for colour operations 0-7 and alpha operations 0-4, and `emitCombiner` clamps with `COMBINER_CONSTANTS.resultClamp`)
**Reason:** Confirmed, and the plans picked neither fix: deleting the CPU evaluator conflicts with plan 02-60, which asked for model evaluation, and making it the oracle needs new material-swatch fixtures and a Playwright spec that compares the GPU readback with `evaluateColourExpression`. Port 5173 was in use (PID 23296), so no Playwright check could run. The same choice applied to WR-35, whose fix deleted the fog, Modulate2X and modifier twins. The GLSL clamp in `fragmentChain.ts` `emitCombiner` hard-codes 0 to 1 while the CPU path reads `COMBINER_CONSTANTS.resultClamp`.

### WR-34: Display gamma ramp is built but never applied at runtime; the handoff to 02-67 was dropped

**File:** `src/materials/ue2/model/displayGamma.ts:30`
**Requirement:** MAT-01
**Owned by:** plan 02-92 (decision row P809: one final PostProcess on the native world camera with the 256-entry lookup from `buildDisplayGammaTable(defaultDisplayGammaSettings())`; DOM windows, the developer sheet and harness pages stay outside it)
**Reason:** Confirmed: only `tests/unit/ue2Fog.test.ts` calls `buildDisplayGammaTable`, `defaultDisplayGammaSettings` and `DISPLAY_GAMMA_ENTRY_COUNT`, src has no gamma PostProcess or LUT, and 02-67 never owned it. Wiring it changes every native frame and needs decisions on its place relative to UI and the sheet, the GLB route and re-baselined screenshots and goldens, plus a Playwright check. MAT-01 requires the ramp, so the code stays. The adapter-dispatch evidence line that assigned it to 02-67 is corrected in this report's commit.

### WR-36: Program reader requires a Texture `image` member that no converter writes and the output contract does not document

**File:** `src/materials/ue2/model/materialProgram.ts:156`
**Requirement:** MAT-01 (FOUND-02 for the contract row)
**Owned by:** plan 02-74, the material program image pins plan (the `image` member on Texture nodes from the caller that converted the texture, and its OUTPUT_CONTRACT row), and plan 02-86, the BSP and sky surface plan (each Texture node converted into a store PNG under /l2/, programs restaged)
**Reason:** Confirmed: `program_node` in `scripts/native_assets_lib/material_program.py` writes only id, class, status, gapReasons and fields, `read_material_graph` as used by `bsp_surface_materials.py` and `sky_materials.py` never sets an image on a Texture node, and `write_native_material_resources` writes only `graph.json` and `program.json`, so no per-Texture PNG exists for an image member to point at. The fix is a new converter step, the image member, a contract row, a pipeline-to-reader contract test and a restage of every native-materials program; lanes may not run stage or derive scripts.

### WR-40: Coverage marks the emitters step pass while the runtime never plays any placed emitter

**File:** `src/scene/world/tileMapEmitterPlacements.ts:70`
**Requirement:** WORLD-01, with playback under FX-01
**Owned by:** no dedicated gap plan at the time of writing. The converter half landed in d70fe6d (WR-20): struct and resource blockers are now gap rows, so converted tiles read emitters gap after the restage. Plan 02-89, the gap round closing plan, keeps map emitter playback in the STATE Open follow-ups it rewrites, and plan 02-91 moves map emitter placements to per-chunk binding, not to playback.
**Reason:** Confirmed: every placement reads `playing: false` with `map-emitter-class-defaults-unmerged`. The decision rows chose the split: row 596 and plan 02-61 scope the step to the actor export, row 668 keeps structs as `unparsedHex`, and rows 651 and 696 have the runtime merge defaults and derive the reasons. What stays open is the decision whether the emitters step status means exported or playable, the runtime class-default merge and playback.

### WR-42: Unsourced 1-chunk-edge visual ring and LOD cull distance cap draw distance at about 82 m, overriding the most-visible visibility limits

**File:** `src/scene/world/worldResidencyRing.ts:39`
**Requirement:** WORLD-04, with VIS-01 for the most-visible limit rule
**Owned by:** plan 02-91 (decision row P806: the row 735 values and the workload stay, and the tile visibility inspection reports them as presentation limit rows next to `limitRules`; the value itself is an owner item in 02-89's Needs Human); decision row P737
**Reason:** Confirmed: `lodCullDistanceChunkEdges = 1` gives an 81.92 m null-LOD cull on every BSP and model mesh, and the visual ring drops chunks beyond 1 chunk edge, while the bsp-visibility recipe keeps `static-mesh-range` at runtimeDefault infinity and `bindTileVisibility.inspection().limitRules` reports that. Row 735 chose these radii and this cull as presentation values for owner review. Deriving the cull from fog end or the far plane revises row 735, and raising it to most-visible changes the WORLD-04 and PERF-02 workload.

### WR-47: UI-03 (and UI-02's 'filled with sandbox data') read as Complete while windows show no client skin, fonts or labels

**File:** `.planning/REQUIREMENTS.md:47`
**Requirement:** UI-02, UI-03
**Owned by:** plan 02-89, the gap round closing plan (Task 3 sets UI-02 and UI-03 to Pending with their regression reasons), with plan 02-85, the UI skin plan, converting the UI textures through the shared texture library; decision row P743
**Reason:** Confirmed: UI-02 and UI-03 are `[x]` Complete while docs/parts/ui/EVIDENCE.md shows 4 of 1,094 textures converted, labels unresolved and only HPBarTex bound, and 02-VERIFICATION.md lists both as regressions. The fixer could not edit .planning/. Splitting UI-03 needs the owner; the UE2 118 package reader and the TextBox label text stay open under UI-03.

### WR-48: Adapter contract dropped advance() while the decision record and ARCH-02 still freeze five methods including advance

**File:** `src/world/GameWorldAdapter.ts:3`
**Requirement:** ARCH-02 (NET-04 for how a transport adapter drains queued records)
**Owned by:** no gap plan; the orchestrator's decision log (decision row P741: freeze the four methods and update PROJECT.md:50, ARCH-02, docs/ARCHITECTURE.md:19 and the 05-network.md notes). docs/ARCHITECTURE.md now states the four methods and names the PROJECT.md and ARCH-02 wording that waits for that decision.
**Reason:** The code is consistent: the four-method interface and `tests/unit/gameWorldAdapterContract.test.ts` match the 02-67 change (d62ef44, 02-67-SUMMARY line 181), and putting `advance()` back would add an unused method. What is wrong is the missing decision and the stale planning docs and notes (PROJECT.md:50, REQUIREMENTS ARCH-02, docs/ARCHITECTURE.md:19, 05-network.md:187, 256, 301 and 305), which the fixer could not edit.

### WR-50: Unsourced player classes move at an invented 70 UU/s instead of being held as speed-unresolved

**File:** `src/world/NativeSliceAdapter.ts:187`
**Requirement:** MOVE-01 with ARCH-03
**Owned by:** plan 02-93, the speed-unresolved and overlap scope plan (decision row P810: move-local for a profile without a sourced speed is rejected with `command-rejected` `speed-unresolved:<profile>`, `SYNTHETIC_SLICE_SPEED` and its readout values are deleted; the row 49 owner review stays in STATE Needs Human)
**Reason:** Confirmed in the code: `nativeSliceSpeedProfile` returns `SYNTHETIC_SLICE_SPEED` (70/70) for every profile except the two human fighters, and `moveLocalPlayer` sends it. The stand-in was chosen and recorded (01-REVIEW-FIX CR-101; rows 49, still open in STATE.md, and 720), and the fix makes every non-fighter profile unable to move in the sandbox. It reaches the constructor default speed, the sheet readout and locomotion card, `nativeSliceAdapterSpeed`, the adapter tests and `tests/browser/nativeSpeed.spec.ts`.

### WR-52: Clean-room overlap check never scans the Python converters that the area notes put in scope

**File:** `tools/reference-overlap/overlapAreas.json:35`
**Requirement:** VIS-01 and MOVE-01 (DEC-OWN-12 overlap review)
**Owned by:** plan 02-93 (decision row P811: a Python token scanner beside `sourceTokens.mjs`, and the scripts/world converter globs that 02-bsp-visibility.md:396 and 03-movement.md:476 name join the bsp-visibility and movement areas); decision row P742
**Reason:** Confirmed: every `sourceGlobs` entry is under src/, and `sourceTokens.mjs` reads only JS and TS syntax. The fixer may not edit `tools/reference-overlap/` or sign off overlap. The fix needs a Python tokenizer and scripts/world globs, or a dated decision that converter code is out of overlap scope with the area notes updated to match.

## Notes

### Evidence docs updated with this report

The 66 evidence notes that name a doc are applied, merged with what was there: docs/parts/world, movement-geodata (which also takes the notes addressed to `docs/parts/movement/`), skills-effects, adapter-dispatch, npcs (which takes the notes addressed to `docs/parts/actors/`, except the per-actor sound bundle note, which went to audio), audio, data, ui and player-characters EVIDENCE.md, plus docs/OUTPUT_CONTRACT.md, docs/ARCHITECTURE.md, docs/NATIVE_DOOR_MOVERS.md and docs/parts/skills-effects/PARTICLE_SEMANTICS.md. To stay under the 30,720-byte evidence limit, older text that a SUMMARY, 02-REVIEW-FIX.md, decision rows 420, 704 and 705, or a recipe or constants row already holds was condensed to a pointer. The world tile list per newly reviewed reader pair now points at the per-tile `licensee` and `terrainMapPackage.licensee` of the committed `tile-census.json`. The adapter-dispatch overlap report of 2026-11-09 at `f22f084` (exit 1 on three areas) is replaced by the current state, every area exiting 0 since cf2c891; its counts stay in that file's history. Stale lines next to the notes were corrected: the world Open line that left tile audio playback to 02-46 (it passed there), the skills-effects line saying no Interlude binary was read and its two "sign-off pending" overlap rows, the movement-geodata overlap line, the adapter-dispatch lines that gave the display gamma ramp to 02-67 and asked for a review that has happened, and the ARCHITECTURE.md "once it lands" for `sourceFrame.ts`.

### Checks the fixers could not run

- `tests/browser/nativeFacing.spec.ts` (CR-14): not run, port 5173 was in use (PID 12180).
- `tests/browser/world-tile-movers.spec.ts` (WR-37, WR-39): not run, port 5173 was in use (PID 14348, not started by the run); the spec also skips unless `NATIVE_STORE_ROOT=world` is set.
- `tests/browser/world-tile-border.spec.ts` (WR-41): not re-run; the border walk should now stop at the seam with `collision-cell-absent`.
- Material swatch GPU readback for the combiner (WR-33): port 5173 was in use (PID 23296).
- The Power Strike real-client trace (CR-11) ran with `POWER_STRIKE_EFFECT_SOURCE` pointing read-only at the main checkout's `artifacts/native-parity/migration/effects/power-strike-source-dispatch/effect-source.json`. It passed with the committed hashes, and its featureGaps expectation now names p_u004_a SpriteEmitter9 `UseDirectionAs`.
- No asset, stage, derive or preview script ran, and no lane store or client tree was written; re-deriving the touched steps is for the integration thread. The fixers ran targeted test files only, never the full unit or pipeline suite.
- Side effect to review: one targeted run, `test_world_static_mesh_step.py` `OracleSectionSubsetTests`, plans 20_20 against the real reference client and wrote 21 class-default cache files into `artifacts/lane-store/world/work/class-defaults` between 11:09:44 and 11:10:17 (for example Engine.Light, Engine.Mover, GamePlay.WaterVolume, Engine.PhysicsVolume). The cache is deterministic and keyed on identity and parser hash, the same output any step run writes; the unmodified baseline run of that test also rewrote Engine.StaticMeshActor.json at 11:06:16. The files were left in place, and the mover and static-mesh oracle classes were then left out, because with the bumped versions they would reconvert into the lane store.

### Residual defects

- `tests/pipeline/test_converter_output_guard.py` failed on `scripts/data/convert_tables.py` after ccf4478 (WR-07) removed `--output`, because the scan recognised only a direct `require_converter_output` call while `convert_tables.main` now reaches the guard through `lane_store_root`. Fixed in 78d506b: the scan accepts `lane_store_root` as the guard (a new test proves it returns `require_converter_output`), keeps the first-call-after-parse rule, and pins that the three data-ui entry points take no `--output`. Two more regressions from this round were fixed the same day: 093f9d5 (the lane NPC profile fixture now carries a model catalog id, as the browser reader requires) and 81f050a (the reference root hashes every read).
- `tests/pipeline/test_bundle_member_pins.py` `ProfileBundleLaneTests`: 4 errors, 'NPC profile 20001 ... has no model catalog id', the same on HEAD before slice-04's fix.
- `IDENTITY_AFFINE_MATRIX` stays declared and unused until its overlap allowlist entry goes in the same change (WR-46, decision row P740).
- The browser `nativeCatalogIndex.ts` still answers converted for `emitter-class-unported` skill keys (WR-04; ACT-06, FX-01).
- The committed `docs/parts/player-characters/character-census.json` (`layoutRecordFields` hairgrp `[]`) predates 21a7a94 and refreshes at the next `--batch characters` run, which only the integration thread may run.

### Behaviour changes that reseal units on the next integration run

- World steps: meshes algorithm 2 to 3 (56b9555), collision 2 to 4 (8ad3264, 56b9555), emitters 1 to 3 (6859f46, d70fe6d), movers 1 to 2 (59db4a9), lighting 2 to 3 (bde8d15), world gap reasons listVersion 15 to 18; bsp-visibility re-derives through its rules hash (the `locate-tie` row), and the collision and mover units re-run through the changed collision rules recipe hash (65bdd71). Only the integration thread may restage; then the StaticMeshActor subclass tiles read meshes and collision gap, the 10 water tiles collision object gaps, and the 22 converted tiles emitters gap.
- Class-default cache (950bd2b): schema 1 to 2, so every cached class default rebuilds on its next read.
- Actor sounds (33a3c12): skill bundles with no exact skillsoundgrp row become sealed units on the next `--batch actor-sounds` slices; the character census entry changes shape at the next census write (b4ba6b7).
- Coverage (6d189c8, f5828ee): reporting only, no reseal. The committed lane coverage.json files stay stale until the integration thread reruns coverage: converted tiles with a failed or gap step read that status, and the 522 BeamEmitter skill keys become gaps.
- Skills catalog (f48c353): writes use the compact serializer; a lane catalog the skills writer last wrote with the old serializer may change bytes once on its next skills write, and then stays byte-stable for unchanged outcomes.
- Golden fixtures (d9f9dd5): the syntheticfixture table manifest, `catalog.json` and `fixtures.lock.json` moved; real table units are byte-identical and do not reseal.
- No reseal: the static material reviewed set is unchanged (2139876); the stricter tile validator passes every current manifest (15583d0); the store walk reaches more files with no manifest change (a190cba).
- Command changes: `convert_tables.py`, `convert_ui.py` and `table_name_indexes.py` take no `--output` (ccf4478); `convert_actors.py --output` must be the actors lane store (6cbebe6); `--actor-sounds` refuses character keys (b4ba6b7); `build_dat_table_inventory.py` refuses a missing or empty catalog (50c2062); `convert_ui` exits 1 when a window failed (edaa2f0).
- Runtime: source headings map to yaw pi/2 - h * pi / 32768 (7a8b12f), so stop and report-position headings shift a quarter turn against the old values; pawns outside every collision cell are held (e5b7326); speed-unresolved pawns send no cannot-move (ac8c5bc); move-local needs the walk and run move type rows (c77a88f); a refused tile mover manifest no longer fails the tile (e2e9b69); tile movers become the doors on `?map=` (91574b9); actors with function-only notifies load (cad4905).

### Reference overlap

The fixes changed DEC-OWN-12 area files: particles 52ed33e, c1f67be, b9092b3, d238922; materials 0113612; movement and shared math 9c1fa7b, 14203e7, ac8c5bc, c77a88f, e5b7326, 7a8b12f. No fixer edited `tools/reference-overlap/` or signed anything off. Fresh independent reviews then signed off every run the fixes added in cf2c891 (bsp-visibility 11, movement 118 with 5 blocking, particles 91 with 5 blocking, materials 94), removed 572 stale rows and 12 stale sign-offs, and all five areas exit 0 (decision row P800). The Python converters stay outside the scan until plan 02-93 (WR-52).

### Decisions

The fixers returned 45 decision rows, the choices named in the entries above; they wait for the decision log as the orchestrator's pending rows P700 to P744. P800 records the outcome of the review and this round, and P801 to P812 record how the gap-plan amender folded the 18 deferred findings into plans 02-74, 02-75, 02-77, 02-80, 02-86 to 02-89 and the new 02-90 to 02-94.

---

_Fixed: 2026-11-11T11:55:39+02:00_
_Fixer: gsd-code-fixer, one per slice of 02-REVIEW-INDEPENDENT.md (slices 01 to 14)_
_Iteration: 1_
