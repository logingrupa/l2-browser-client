---
phase: 02-stage-a-breadth
reviewed: 2026-11-11T05:05:00Z
depth: standard
files_reviewed: 478
diff_range: 2ede78f..166038b
findings:
  critical: 1
  warning: 62
  info: 73
  dropped_by_verification: 15
status: issues_found
---

# Phase 2 code review

## Method

- Scope: every TypeScript, JavaScript and Python file under src, scripts and tools changed between `2ede78f` (end of Phase 1) and `166038b`, 543 files in 21 slices of about 2,200 added lines (`git diff --numstat`). Plan 02-55 changed no code after that range.
- Review: one gsd-code-reviewer per slice, reading each file whole with its diff, callers and tests, for bugs, trust-boundary handling, source fidelity, the server boundary, AGENTS.md code rules, test gaps and avoidable hot-path work.
- Verification: each critical or warning finding went to three fresh checkers (trace the failure with real data shapes, try to refute it against the code and the recorded decisions, judge it against AGENTS.md and DEC-OWN decisions). A finding is kept when at least two of the three confirm it. Info findings are listed without verification and are not fixed in this round.
- Fixes: see 02-REVIEW-FIX.md.

## Critical issues

### CR-01: Distance fog never applies in the right-handed native scene: view depth is negative

- File: `src/materials/ue2/babylon/material.ts:88` (bug, slice-13)
- Evidence: material.ts:88 writes `ue2ViewDepth = (worldView * vec4(position, 1.0)).z;` and fragmentChain.ts:155 computes `clamp((ue2ViewDepth - range.x) / max(range.y - range.x, ...), 0.0, 1.0)`. Every native world scene sets `scene.useRightHandedSystem = true` (buildPresentationScene.ts:44, authoredNativeWorld.ts:22), and loadNativeSection, loadNativeTileChunks and loadAuthoredNativeSection refuse a scene that is not right-handed. In a right-handed scene Babylon builds the view with Matrix.LookAtRH, so geometry in front of the camera has negative view-space z. The particle path does the same: particleFragmentChain.ts:21 takes `viewDepth` from `(view * vec4(worldPosition, 1.0)).z` (particleMaterialBinding.ts:97).
- Failure: bindTileLighting.ts:124-130 passes the camera-zone fog from computeCameraEnvironment to every tile material on each frame. In a zone with DistanceFog the fog uniforms are bound (range.z = 1), but ue2ViewDepth is about -50 m for a wall 50 m away. That makes (depth - start) negative, the factor clamps to 0, and no tile or particle is ever fogged. Unit tests only check the uniforms, and the swatch harness binds FOG_DISABLED, so nothing catches this.
- Suggested fix: Send a positive distance along the view axis: `ue2ViewDepth = -(worldView * vec4(position, 1.0)).z;` for right-handed scenes, or `abs(...)`, which works in either handedness. Do the same for particleViewDepth. Add a test that renders a fogged material in a right-handed scene and checks that the fog colour reaches the pixels.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

## Warnings

### WR-01: is_sound_package_reference holds an `if False else` branch that can never run

- File: `scripts/actors/actor_sound_conversion.py:90` (dead-code, slice-01)
- Evidence: `paths = self.package_census.resolve_package_paths(reference, ('',)) if False else \
    self.package_census.lock_equal_paths_by_stem.get(reference.split('.', 1)[0].casefold(), ())` - the first arm of the conditional expression is unreachable code left in the file.
- Failure: The dead arm is never evaluated. It reads like a half-finished change and breaks the repo rule against dead or commented-out code. A reader may also think suffix filtering happens here when it does not.
- Suggested fix: Delete the dead arm: `paths = self.package_census.lock_equal_paths_by_stem.get(package_name_of(reference).casefold(), ())`. Reuse `package_name_of` from actor_census rather than repeating the split.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-02: data-ui manifest path from the lane catalog is not confined, and the logic has a second, stricter owner

- File: `scripts/actors/actor_sound_conversion.py:128` (security, slice-01)
- Evidence: `payload = (store_root.parent / records[0]['manifest'].lstrip('/')).read_bytes()` joins a catalog-supplied string onto the store parent with no confinement. The same lookup in character_conversion.data_ui_table_manifest (line 281-297) uses `confined_child_path`, checks `manifestBytes` and checks the locked `sourcePath`. actor_sound_batch.npc_profile_rows (line 149) repeats the same unconfined join for `npcProfiles` manifests.
- Failure: A store catalog record whose manifest is `/l2/../../..`-style escapes the lane store and reads any file. The data-ui manifest lookup has two owners with different validation, so a manifest whose byte length disagrees with its record is accepted by the sound route and refused by the character route.
- Suggested fix: Make one shared `data_ui_table_manifest` owner that uses `confined_child_path(store_root, manifest.removeprefix('/l2/'))` and checks sha256, bytes and the locked source. Call it from both the character and sound runs. Read npcProfiles manifests through `confined_child_path` the same way npc_store_records.profile_record_npc_ids does.
- Checkers: trace:yes/medium/info; refute:yes/high/warning; rules:yes/high/warning

### WR-03: Sound and bundle refusal reasons keep absolute host paths

- File: `scripts/actors/actor_sound_conversion.py:214` (bug, slice-01)
- Evidence: `return {'status': 'refused', 'reason': CONVERTER_REFUSED_REASON_PREFIX + ' '.join(str(error).split())}` (line 214), and the same at line 320 for the bundle builder. Every other converter route (character_conversion, item_conversion, npc_batch, skill_effect_conversion) runs the message through `path_free_reason(str(error), client_root, converter.output)`.
- Failure: A converter or builder ValueError that names the client file, such as `C:/Lineage2-client/...`, ends up in the sealed sound-outcome.json, in the converter reasons in the bundle fingerprint config, in the gap rows and in unresolved-references.json. Results then depend on the host and hold machine paths, so a run on a host with another client root changes fingerprints and reseals units.
- Suggested fix: Use `path_free_reason(str(error), self.client_access.root, self.converter.output)` in both converted_sound_outcome and built_bundle.
- Checkers: trace:yes/medium/warning; refute:yes/medium/warning; rules:yes/high/warning

### WR-04: The character census reports receipts whose fingerprint is stale as current results

- File: `scripts/actors/character_census.py:207` (bug, slice-01)
- Evidence: `character_census_row(index, run.ledger.sealed_receipt(character_key(index)))` - UnitLedger.sealed_receipt returns whatever seal exists and never compares it with the current unit fingerprint (only `is_sealed(key, fingerprint)` does). run_character_batch stops at `--limit`, then write_character_census reads every row.
- Failure: The converter hash or the classinfo/hairgrp manifest changes, and a `--limit 5` batch reconverts only the first 5 rows. The census written afterwards still counts every other row as `converted`/`gap` with the old config, next to the new `chargrpSourceSha256`/`classinfoSourceSha256` header. modelsConverted and gapKeys then describe inputs that no longer apply.
- Suggested fix: Compute each row's current fingerprint through `run.unit_work(index)` and report the row as pending unless `run.ledger.is_sealed(key, fingerprint)`. Alternatively, record the receipt fingerprint and mark mismatches as stale.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/medium/warning

### WR-05: The character conversion run, batch and census have no pipeline test

- File: `scripts/actors/character_conversion.py:398` (test-gap, slice-01)
- Evidence: Only `CharacterSources`, `model_gap_reason` and `padding_census_row` are imported by tests/pipeline/test_character_requests.py. Nothing under tests/ exercises CharacterConversionRun.convert, write_model_record, data_ui_table_manifest (with its sha, bytes and lock checks), run_character_batch (limit and cache-hit counting), character_census_row or census_counts.
- Failure: Regressions in the seal and cache-hit path, the catalog record write, the data-ui manifest refusal or the batch limit counting would go unnoticed. The stale-record and stale-census defects above are examples that no test catches.
- Suggested fix: Add a pipeline test with a fake converter and a temporary ledger covering: convert then cache hit, a refused conversion, a data-ui manifest with a wrong sha or byte length refused, a batch stopping at the limit while counting only non-cached, non-padding rows, and census counts for converted, gap, pending and padding rows.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-06: A character that turns into a gap on reconversion keeps its old model record in the store catalog

- File: `scripts/actors/character_conversion.py:426` (bug, slice-01)
- Evidence: `write_model_record` returns early `if not outcome['outputs']`, so it only ever adds or replaces `character-model:<index>`. Nothing removes the record. In actor_sound_conversion.sealed_bundle_outcome (line 331-332) the `combatAudio` record is likewise only written when a manifest exists, never removed.
- Failure: Row 5 converts and the catalog gets character-model:5. Later an input or the converter hash changes, `begin` wipes the old step folder, and the reconversion is refused, which seals a gap row with no outputs. The catalog still lists character-model:5 and points at the old model files, so the game serves a model whose gap row says it does not exist. A bundle resealed as refused keeps its stale actor-sounds record in the same way.
- Suggested fix: When the outcome has no outputs, remove the `character-model:<index>` record (and the `actor-sounds:<key>` record for bundles) from the catalog. Add a pipeline test that converts, then reconverts into a gap, and checks the record is gone.
- Checkers: trace:yes/high/warning; refute:yes/medium/warning; rules:yes/high/warning

### WR-07: Single-NPC profile ledger fingerprint lacks npc_profile_tool_pins, which decision row 365 requires for the same bundles

- File: `scripts/actors/convert_actors.py:227` (bug, slice-02)
- Evidence: convert_profile uses config = {'npcId', 'modelCatalogId', 'nameTable'} with NPC_PROFILE_ALGORITHM_VERSION = 1. The NPC batch pack ledger (npc_batch.py line 285) puts 'profileToolPins': npc_profile_tool_pins() in its config. OVERNIGHT-DECISIONS row 365 gives the reason: 'A pin change would otherwise leave a sealed pack whose bundle no longer verifies.' The single-NPC path produces the same migrate_npc_profiles bundle but never got that pin. It also reads sound packages (sound_package_exports) whose hashes are missing from inputs.
- Failure: Edit native_actor_profiles.py or any file in its pinned implementation set, or change UELib or PowerShell, then run `convert_actors.py --npc <id>`. The profile unit is a cache hit (sealed_outcome). write_store_records then calls profile_bundle_store_files_and_record -> verify_npc_profiles on the stale bundle. Verification refuses it, and the run aborts with 'Actor conversion failed' until someone deletes the unit folder by hand. Without that refusal, a profile built by the old tool would ship.
- Suggested fix: Add 'profileToolPins': npc_profile_tool_pins() to the convert_profile config and bump NPC_PROFILE_ALGORITHM_VERSION. Put the resolved sound package paths into the locked inputs. Cover it with a test that changes the pins and expects a reseal.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-08: Each item batch slice re-hashes the converter implementation and re-parses the 2.5 MB client lock for every already-sealed unit

- File: `scripts/actors/item_census.py:75` (performance, slice-02)
- Evidence: run_item_batch iterates all run.units from the start on every slice and calls preflight() and run.convert(unit) for each one. convert calls unit_work. unit_work calls implementation_hash(), which hashes every native_catalog/native_assets_lib script, and locked_input_records, which parses recipes/reference-client-tree.lock.json (2,478,387 bytes) on every call. Each cache hit then goes through write_item_records, which reads the store catalog. NpcConversionRun caches implementation_hash once (convert_actors.py line 78) and SkillEffectConversionRun caches its input records.
- Failure: The item census lists 2969 convertible units. Once most are sealed, every `--batch items --limit N` slice spends thousands of lock parses and full script-tree hashes, plus catalog reads, on units it only skips. Slice cost grows with the number already converted, which makes the batch quadratic overall.
- Suggested fix: Compute implementation_hash() once in ItemConversionRun.__init__. Read the lock once and reuse it for all units. Skip a sealed unit before write_item_records unless its record is missing from the catalog, and read the catalog once per slice.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:no/medium/info

### WR-09: Item census and gap rows count sealed receipts whatever their fingerprint, so stale units read as converted

- File: `scripts/actors/item_conversion.py:165` (bug, slice-02)
- Evidence: sealed_outcomes_by_unit_key keeps every unit whose ledger.sealed_receipt(...) is not None, and sealed_outcome reads that receipt directly. Neither checks the receipt fingerprint against unit_work(unit)[2]. convert() correctly uses is_sealed(key, fingerprint). The NPC batch also filters by fingerprint (is_convertible_model_unit_sealed).
- Failure: After a converter implementation change (implementation_hash is part of the item fingerprint), every previously sealed item unit is stale. write_item_census_and_gap_rows still counts them as 'converted' in docs/parts/items/item-census.json and emits their gap rows (equipment-slot-meaning-undecoded) as if current, until a batch slice reaches and reconverts each unit. With about 3000 units that lasts many slices, and the census overstates conversion the whole time.
- Suggested fix: Inside sealed_outcomes_by_unit_key, compute the fingerprint for each unit and keep only units where self.ledger.is_sealed(unit['unitKey'], fingerprint). Report the rest as pending. Add a test with a stale receipt.
- Checkers: trace:yes/high/warning; refute:yes/medium/warning; rules:yes/high/warning

### WR-10: Second owner of path-free reason scrubbing next to actors/path_free_messages.py

- File: `scripts/actors/skill_effect_conversion.py:87` (code-rules, slice-02)
- Evidence: skill_effect_conversion.path_free_reason(message, *roots) replaces each root spelling with '<path>' and collapses whitespace. actors/path_free_messages.path_free_reason(message, source_root, output_root), added in the same phase and used by convert_actors, npc_batch (through run.path_free_reason) and item_conversion, does the same job with '<source>'/'<output>' placeholders. AGENTS.md: 'One owner per piece of logic. Reuse before adding.'
- Failure: Gap reasons from the skill lane use different placeholders than NPC and item reasons for the same kind of scrubbed path, and a fix to one scrubber (for example a new path spelling) misses the other lane.
- Suggested fix: Delete the local path_free_reason. Call actors.path_free_messages.path_free_reason(message, self.client_access.root, step_directory) at lines 166 and 194.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-11: Skill root fingerprint omits the emitter-class coverage list, so sealed roots keep a stale simulated-class check

- File: `scripts/actors/skill_effect_conversion.py:143` (bug, slice-02)
- Evidence: root_work builds config = {visualRoot, representativeKey, tools}. tools covers UMODEL, UELIB, implementation_hash and TOOL_IDENTITY_FILES (native_effect_bundle.py, stage-native-effect.mjs, effect_readiness.py). It does not cover recipes/actors/emitter-class-coverage.json. root_conversion_outcome (line 197) runs unbound_simulated_component_reason against self.simulated_emitter_classes and seals the result in root-outcome.json. Later, root_outcomes (lines 209-211) runs emitter_class_root_outcome again against the current list, but never repeats the unbound-resource check. e5c9250 (02-69) raised listVersion from 1 to 2 by adding Engine.RibbonEmitter after 02-43 had already sealed roots under list 1.
- Failure: A skill root that holds a RibbonEmitter was sealed as 'converted' under listVersion 1. The unbound check skipped the ribbon then, because ribbons were not simulated. After listVersion 2, the fingerprint is unchanged, so the batch skips the root as already sealed. root_outcomes now finds every class simulated, reports the skills gap row as 'pass', and write_store_records publishes the effect component. At runtime loadEffectComponent throws 'ribbon-texture-unstaged' for that component. Coverage reports pass for a root that cannot render.
- Suggested fix: Add the coverage document's listVersion (or the sorted simulated set) to the root_work config, or add emitter-class-coverage.json to the hashed tool identity files, so that a list change reseals every root. Bump SKILL_EFFECT_ROOT_ALGORITHM_VERSION so existing seals are invalidated. Add a pipeline test that changes the simulated set and expects is_sealed to turn false.
- Checkers: trace:yes/medium/warning; refute:yes/medium/warning; rules:yes/medium/warning

### WR-12: Section manifest path from the catalog is read before it is validated, and can escape dist

- File: `scripts/check-private-preview-burst.mjs:30` (security, slice-03)
- Evidence: `nativeSectionResourcePaths(sectionRecord, JSON.parse(await readDistFile(sectionRecord.manifest)))`: the argument is evaluated first. readDistFile (line 25) is `fs.readFile(path.join(distDirectory, `.${urlPath}`))` with no containment check. The hash-addressed path check inside nativeSectionResourcePaths and the startsWith(distDirectory) check at lines 35-37 both run only after the read.
- Failure: A built catalog with sections[0].manifest = '/../.assets/private-preview/access-key' makes the script read the private access key. JSON.parse then throws, and recent Node versions put a snippet of the input in the SyntaxError message. The top-level await rejection prints that message without passing it through sanitize(), which can leak part of the key to the console or CI log.
- Suggested fix: Validate the manifest path before reading it. Split nativeSectionResourcePaths so the sectionRecord.manifest hash-addressed check runs first, or move the check to before readDistFile. Also make readDistFile resolve the path and require it to start with distDirectory + path.sep.
- Checkers: trace:no/medium/info; refute:yes/medium/info; rules:yes/high/info

### WR-13: Pinned manifest SHA and length verification has three owners

- File: `scripts/data/table_name_indexes.py:82` (code-rules, slice-03)
- Evidence: verified_source_manifest_bytes (table_name_indexes.py:82-87) and decoded_window_manifests_with_records (convert_ui.py:129-131) each re-implement reading a /l2 manifest and checking its catalog sha256 and byte length. native_store.catalog_writer already owns this as require_file_pin + read_pinned_file, and build_dat_table_inventory.in_use_slot_status uses that owner. table_name_indexes also skips confined_child_path and builds the path with Path(output_root) / ...; today only the catalog path regex keeps that path confined.
- Failure: A later change to pinned-file reading in read_pinned_file (bundle-folder confinement, reparse-point refusal, size caps) does not reach these two copies. The name-index and controls/textures steps would then accept store files that the shared reader refuses.
- Suggested fix: Replace both helpers with read_pinned_file(output_root, require_file_pin(record, 'manifest', 'manifestSha256', 'manifestBytes', label)) and delete the local copies.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-14: Resolved field-binding gaps leave stale field-<x> gap rows in the data-ui lane

- File: `scripts/data/ui_texture_step.py:193` (bug, slice-03)
- Evidence: convert_window_textures clears or replaces only the 'textures' step row (line 192). For the field steps it calls replace_step_gap_row only for rows that are present in gap_rows now (lines 193-195). replace_step_gap_row (lane_unit_outcomes.py:25-30) removes a key only when it is called for that step. Nothing else in scripts/ names the 'field-' steps (grep ABSENT_FIELD_STEP_PREFIX finds only this file).
- Failure: window-field-bindings.json has {windowId: StatusWnd, controlName: CPBar, gapReason: 'adapter-field-absent:cp'}, and a textures run writes the gap row field-cp/window:StatusWnd. Once the adapter gains cp, the binding's gapReason is set to null. The changed config changes the fingerprint, so the unit re-runs and seals with gapRows that no longer hold field-cp. But the lane file gap-rows/field-cp.json still holds the window:StatusWnd row, so lane coverage and evidence keep reporting a CP field gap that is gone. The ledger receipt and the lane gap file now disagree.
- Suggested fix: Before writing the new rows, remove every row with key == unit_key from all field-* step files. For example, read read_gap_rows(project_root, lane) and call replace_step_gap_row(..., step, unit_key, None) for each field-* step that is not in the new gap_rows. Then write the current rows. Add a test to tests/pipeline/test_ui_texture_step.py that runs once with a gapReason, runs again with gapReason null, and asserts the field-cp row is gone.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-15: asset_coordinates has no production caller

- File: `scripts/native_assets_lib/asset_manifest.py:102` (dead-code, slice-04)
- Evidence: A grep of scripts/, src/ and tests/ finds `asset_coordinates` only in asset_manifest.py and tests/pipeline/test_asset_manifest_v2.py:121-122. The browser reads v1 and v2 coordinates in src/assets/package/readAssetPackage.ts. No Python pipeline step reads coordinates back through this function.
- Failure: The function and its v1 fallback (model.unit/sourceUnitsPerMetre/sourceToGltf) are kept alive only by a test. They can drift from the TS reader, which is the real owner of v1/v2 coordinate reading, and give false confidence that the Python side handles both versions.
- Suggested fix: Delete asset_coordinates and its test, or give it a real pipeline caller. If a Python reader is needed, make it the one owner of the coordinate contract that the TS reader mirrors.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-16: New shared module re-adds second owners for helpers already consolidated, and uses abbreviated names

- File: `scripts/native_assets_lib/sound_export_guards.py:17` (code-rules, slice-04)
- Evidence: Commit 96c09fe (02:16) gave strict JSON, SHA-256 and guard helpers one owner each (strict_json.decode_strict_json, sha256_identity.sha256_hex_digest/SHA256_HEX_PATTERN, guard_clauses.require_condition, store_paths.refuse_reparse_points/require_portable_relative_path). Commit b1c1a0b (18:39 the same day) then created sound_export_guards.py with its own `require`, `digest`, `canonical`, `load_json` (a duplicate-key/nonfinite strict decoder), `HASH`, `reject_links` (the 0x400 reparse check), `relative_name` (the reserved-device-name regex) and `child`. These names are vague or abbreviated (`HASH`, `REFERENCE`, `child`, `digest`, `canonical`, `Sources`).
- Failure: Path-safety and strict-JSON rules now have two owners that already differ: `require` raises FormatError, while require_condition raises ValueError. A fix to reparse-point handling or the portable-name rules in store_paths does not reach export-native-sounds, which keeps the old rule.
- Suggested fix: Import decode_strict_json, sha256_hex_digest, SHA256_HEX_PATTERN, require_condition, refuse_reparse_points and confined_child_path/require_portable_relative_path from their single owners. Keep only the sound-specific logic here (Sources, files_receipt, clean_adapter_work, write_exact) and give it full-word names (for example LockedSoundSources, write_exact_output_file).
- Checkers: trace:yes/high/warning; refute:yes/medium/warning; rules:yes/medium/warning

### WR-17: implementation_hash omits modules the converter now depends on, so converterVersion and the cache key miss their changes

- File: `scripts/native_assets.py:141` (bug, slice-04)
- Evidence: implementation_hash hashes native_assets.py, native_audio, native_animation_families, native_effect_bundle, native_catalog/* and native_assets_lib/*. Phase 2 made the converter path depend on reference_client_guard.py (converter_source_digests, asset_manifest, umodel_import_closure, Converter.source digests) and native_store/store_paths.py (require_converter_output). native_assets_lib modules also import native_store/canonical_json.py, native_store/catalog_writer.py and world/* (class_defaults, material_program, material_resources, static_material_cross_check, world_music). None of these are hashed. The hash is written into asset.json v2 as converterVersion and is part of base_key.
- Failure: A change to reference_client_guard digest semantics or the lock reading that feeds clientBuild/dependency digests keeps the same base_key. convert() returns the old cached archive as a cache hit, and new archives record a converterVersion that does not identify the code that produced them.
- Suggested fix: Add reference_client_guard.py and the native_store/*.py modules (plus any world/* module that native_assets_lib imports on the conversion path) to the implementation_hash path list. Add a test that changing one of them changes implementation_hash.
- Checkers: trace:yes/high/warning; refute:no/medium/info; rules:yes/medium/warning

### WR-18: The new emitter-class-unconverted branch has no test

- File: `scripts/native_effect_bundle.py:357` (test-gap, slice-05)
- Evidence: Lines 357-360 add a branch: an emitter child whose class is not in `CONVERTED_EMITTER_CLASSES` appends an `emitter-class-unconverted` gap and skips enqueueing its references. The only test that touches this is `tests/pipeline/test_skill_binding_table.py:140-145`, which compares the constant set. No test runs `_extract_bundle` or `migrate_effect_bundle` with a SparkEmitter or TrailEmitter child, and none asserts the gap row or that its references are not converted. A grep for `emitter-class-unconverted` under tests/ returns nothing.
- Failure: A later change could drop the `continue`, append the gap after the references are already queued, or compare a short class name with the `Engine.`-qualified set. Every emitter would then be marked unconverted, or a SparkEmitter's textures would still be converted while the manifest claims they are not, and no test would fail.
- Suggested fix: Add a test to tests/pipeline/test_native_effect_bundle.py with a fixture effect that has one SpriteEmitter child and one SparkEmitter child. Assert that exactly one `emitter-class-unconverted` gap names the SparkEmitter object and class, and that only the SpriteEmitter references reach the converter.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-19: A converter work folder outside the bundle output puts absolute host paths into bundle gaps and the staged store manifest

- File: `scripts/native_effect_bundle.py:376` (bug, slice-05)
- Evidence: Phase 2 added `converter_output` (lines 330, 376). `scripts/actors/skill_effect_conversion.py:185` passes `self.ledger.lane_folder / 'converter'`, which is not under the bundle `output`. Converter failures are made path-free only by `_normal_reason(error, client, output)` (lines 325-328). That function replaces the client and bundle-output spellings and the random `.work/<job>` segment, but not the converter folder. `Converter.run` raises `UModel failed or reported an error; inspect {work / log_name}` (native_assets.py:233), with `work` under `<lane>/converter/.work/...`. The text lands in `node['conversionGap']` and `gaps` (lines 431-434), then in the bundle manifest `gaps`. `effect_readiness.py:285` copies those gaps into `bundleGaps`, and `stage-native-effect.mjs:137` writes `bundleGaps` into the content-addressed runtime manifest.
- Failure: During `convert_actors` skill-effect conversion, UModel fails on one effect texture. The staged `native-effect-components` manifest then holds `C:\laragon\www\l2b-actors\artifacts\lane-store\actors\converter\.work\<job>\003-export-....log`. The same sources converted in the main checkout give different manifest bytes, so a different manifest SHA and store folder. Lane merges then see two different pinned manifests for one skill root, and the store holds machine-specific paths.
- Suggested fix: Pass the converter output into `_normal_reason` and replace its spellings with a fixed placeholder such as `<converter>` before the `.work` regex runs. Add a test where the converter raises an error that names a path under an external converter_output, and assert that the manifest gap reason holds no absolute path.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-20: Winding refusal and out-of-grid BSP node gap rows have no test

- File: `scripts/world/bsp_step.py:100` (test-gap, slice-07)
- Evidence: drawable_chunk_nodes (lines 100-112) turns a BspPolygonError from fan_triangle_indices into a FAILED gap row per brush actor and drops the node. run_bsp_step (lines 188-190) records 'bsp-node-outside-chunk-grid' gap rows. No test in tests/pipeline references BspPolygonError, the winding message, drawable_chunk_nodes or the outside-chunk-grid reason. program_blend_is_translucent (bsp_surface_materials.py:52) is also untested.
- Failure: A change to the winding check (sign, the <= 0 tie) or to chunk assignment could silently drop or keep nodes, or lose their gap rows, without any test failing. The translucency rule bug above went unnoticed for the same reason.
- Suggested fix: Add pipeline tests: a reversed-winding node yields one failed gap row naming the brush actor and is absent from nodeRanges; a node whose centroid is outside every rectangle yields a 'bsp-node-outside-chunk-grid' gap row; the translucency classification of Shader and FinalBlend roots per enum member.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-21: OB_Masked Shader surfaces are classified translucent

- File: `scripts/world/bsp_surface_materials.py:58` (bug, slice-07)
- Evidence: program_blend_is_translucent returns `field['value']['ordinal'] != 0` for Engine.Shader OutputBlending and Engine.FinalBlend FrameBufferBlending. The repository's own blend table (src/materials/ue2/model/constants/blendConstants.ts:27-28, 66, 115, 138) gives OB_Masked ordinal 1 the opaque pair (one, zero), with an alpha test and depth write. FB_Invisible / OB_Invisible are also not translucent sorts. The material program already carries the enum `name` next to the ordinal, so the masked case can be told apart.
- Failure: A BSP surface whose material is a Shader with OutputBlending=OB_Masked (fences, grilles, foliage cut-outs) gets `translucent: true` in nativeBspSections. babylonTileVisibilityTargets.ts:127 then treats that section as a translucent section and reorders it back to front, which is wrong for an alpha-tested opaque surface. The bsp-chunks.json 'materials' list reports it as translucent too.
- Suggested fix: Classify by the blend the table defines rather than by `ordinal != 0`. Treat OB_Normal (0) and OB_Masked (1) as opaque for Shader and FB_Overwrite (0) as opaque for FinalBlend, keyed by the decoded enum name or a shared ordinal set. Add a Vitest/pipeline test that pins OB_Masked -> not translucent and OB_Translucent / FB_AlphaBlend -> translucent.
- Checkers: trace:yes/high/warning; refute:no/medium/info; rules:yes/medium/warning

### WR-22: A class chain that fails to resolve silently drops the actor from the lighting records

- File: `scripts/world/light_actors.py:221` (source-fidelity, slice-08)
- Evidence: ClassChains.chain catches ClassDefaultError and stores None (lines 219-222). casefolded_class_names then returns (), so is_subclass is False for every base class, and read_lighting_actors (lines 275-289) skips the actor. No gap reason is added to the reasons that tile_lighting_payload returns. class_defaults.py raises ClassDefaultError for real cases: an unreadable decompiled class, unparsed default properties, a superclass mismatch, a malformed declaration. test_world_lighting_step.py has no case for a chain that raises.
- Failure: A map places a Light subclass, FogInfo subclass or WaterVolume whose decompiled class script has an unparsed defaultproperties line. Its chain raises ClassDefaultError and the actor is missing from lights/fogInfos/waterVolumes. The lighting step still seals with status pass, so a source actor disappears from the native route instead of staying visibly unresolved.
- Suggested fix: Record the class names whose chain raised, for example as ClassChains.unresolved_classes. Have read_lighting_actors return them, and have tile_lighting_payload add one named gap reason per class (for example 'lighting-class-chain-unresolved:<class>'). Add a Vitest/pipeline case where read_chain raises ClassDefaultError for a light class and assert the gap reason.
- Checkers: trace:yes/high/warning; refute:yes/medium/warning; rules:yes/high/warning

### WR-23: An emitter reference decoded from the map indexes the export table without a bounds check

- File: `scripts/world/map_emitter_records.py:48` (error-handling, slice-08)
- Evidence: emitter_references (lines 34-44) reads compact indices from the Emitters array payload in the map file and drops only 0. emitter_bundle sends negative values to object_name. Any positive value goes straight to emitter_record, which runs `item = package.exports[reference - 1]` (line 48) with no check against len(package.exports). Other readers in this slice guard the same trust boundary, for example read_static_mesh_light_list (light_actors.py line 162) and zone_actor_export (level_zones.py line 40).
- Failure: A corrupt or unexpected Emitters array holds an index past the export count. This raises IndexError, not FormatError. The whole emitters step fails for the tile as 'decode-failed:IndexError:list index out of range', which means nothing to a reader. Downstream steps become upstream-failed, and the single-tile CLI (convert_tile.py catches only OSError/ValueError) ends with a traceback. An index that wraps on a negative-1 offset cannot happen here, but an out-of-range positive index can.
- Suggested fix: In emitter_bundle or emitter_record, guard `1 <= reference <= len(package.exports)` and either raise FormatError with the actor and index, or append a MapEmitterGap with a named reason such as 'decode-failed:emitter-reference-out-of-range'. Add a test with an out-of-range Emitters entry.
- Checkers: trace:yes/high/info; refute:no/medium/info; rules:yes/high/warning

### WR-24: An Engine.Emitter export missing from actors.json crashes the whole emitters step with KeyError

- File: `scripts/world/map_emitter_step.py:72` (bug, slice-08)
- Evidence: read_tile_map_emitters iterates over every export whose classObject is Engine.Emitter (emitter_actor_exports) and looks it up with `actors_by_object[item['object']]`. raw_map_extraction.py writes into actors.json only HAS_STACK exports whose actor tags decoded. A decode failure goes to `errors` (line 63 there) and the raw step still seals as 'partial-raw-data-extracted'. run_map_emitter_step catches nothing around read_tile_map_emitters.
- Failure: One emitter actor in a tile has tags the raw step cannot decode (or has no RF_HasStack). The raw and chunk steps seal. The emitters step then raises KeyError for that object, so every other emitter of the tile is lost and the step row becomes failed. bsp-visibility and the tile manifest, which read sealed_map_emitters, become upstream-failed. The result should have been one named per-object gap.
- Suggested fix: Iterate the actors that actors.json actually holds with classObject Engine.Emitter. Or, when an Engine.Emitter export has no actors.json entry, emit a MapEmitterGap(item['object'], 'decode-failed:emitter-actor-not-extracted') instead of indexing. Cover it with a test where actors.json omits one emitter.
- Checkers: trace:yes/medium/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-25: Minimap unit config does not fingerprint the converter, so radar archives and licensee gaps go stale

- File: `scripts/world/minimap_step.py:51` (bug, slice-09)
- Evidence: minimap_unit_config returns only rawFingerprint, chunkPlanFingerprint and joinAlgorithmVersion. The step still converts the radar texture through Converter/UMODEL (radar_texture_converter, convert_radar_texture), and it gates on REVIEWED_VERSIONS from native_assets_lib.texture_mips (minimap_join.texture_licensee_gap_reason). The other Converter steps (static_mesh_step.py:92, bsp_step.py:49, mover_step.py:66) all put 'converterSha256': implementation_hash() in their config, and implementation_hash covers native_assets_lib/*.py and native_catalog/*.
- Failure: A licensee such as 123/28 is added to texture_mips.REVIEWED_VERSIONS, or the UMODEL texture export path changes. current_minimap_receipt still matches, because config and inputs are unchanged. The tile keeps returning its sealed 'texture-licensee-unsupported' gap or its old radar archive, and tile_manifest_step embeds the stale minimap until someone bumps MINIMAP_JOIN_ALGORITHM_VERSION by hand.
- Suggested fix: Add 'converterSha256': implementation_hash() to minimap_unit_config, as static_mesh_step, bsp_step and mover_step do. Add a test that a changed implementation hash invalidates current_minimap_receipt.
- Checkers: trace:yes/high/warning; refute:yes/medium/info; rules:yes/medium/warning

### WR-26: Environment and integrity failures during radar conversion are sealed as permanent decode-failed gaps

- File: `scripts/world/minimap_step.py:164` (error-handling, slice-09)
- Evidence: tile_minimap catches (FormatError, ValueError, OSError) around convert_radar_texture. That block covers the converter subprocess, reading texture.png, verify_store_destinations, immutable_write, and MinimapStepError (a ValueError) raised when the archive differs from its reported SHA-256. Each error becomes a gap row reading 'decode-failed:<Type>:...', and run_minimap_step then seals the unit. static_mesh_step.MODEL_CONVERSION_ERRORS = (FormatError, ValueError, subprocess.TimeoutExpired) deliberately lets OSError propagate.
- Failure: Several things can go wrong during conversion: UMODEL is missing, a file is locked, the disk is full while writing the store, or the converter output is corrupted so its SHA-256 does not match. Each of these is recorded as a source decode failure of the radar texture and sealed. On later runs current_minimap_receipt matches and returns the cached gap, so the tile never converts again until its inputs change. A store integrity failure is reported as a client data gap instead of stopping the run.
- Suggested fix: Catch only source-decode errors (FormatError, plus the converter's own conversion error types) in tile_minimap. Let OSError and MinimapStepError propagate, so the batch records a failed step without sealing it. Keep store writes outside the try block.
- Checkers: trace:yes/high/warning; refute:no/medium/info; rules:yes/medium/warning

### WR-27: sky_zone_node_indices calls .casefold() on None for a sky-zone node whose surface has no material

- File: `scripts/world/sky_geometry.py:52` (bug, slice-10)
- Evidence: Line 52 runs `package.object_name(model.surfs[node.i_surf].material).casefold()` for every node in the zone. Package.object_name returns None for index 0 (native_catalog/ue2.py:149-150). The sibling sky_zone_material_identities (line 61) guards against this with `if identity is not None`, so the author expected material-less nodes. sky_zone_node_indices has no such guard. It is reached from convert_tile_sky -> build_sky_zone_parts (sky_step.py:235), which sits outside any try block.
- Failure: A tile's sky zone holds one textured surface plus any BSP node whose FBspSurf.Material is 0 (an invisible or portal surface). sky_zone_material_identities returns the textured root, so roots is non-empty and build_sky_zone_parts runs. The material-less node then raises AttributeError: 'NoneType' object has no attribute 'casefold'. The whole sky step for the tile fails (the batch turns it into a failed row) instead of drawing the textured nodes. The synthetic test model (test_world_sky_step.py:46-51) has no material-0 node, so nothing catches this.
- Suggested fix: Compute the identity once and skip None, the same way sky_zone_material_identities does: `identity = package.object_name(...); if identity is not None and identity.casefold() == material_identity.casefold()`. Add a material=0 polygon to the synthetic sky model in test_world_sky_step.py.
- Checkers: trace:yes/high/warning; refute:no/medium/info; rules:yes/high/warning

### WR-28: sky_geometry re-implements GLB writing and vector maths that already have owners

- File: `scripts/world/sky_geometry.py:115` (code-rules, slice-10)
- Evidence: GlbBuffer and the GLB framing in build_sky_glb (lines 115-166, with GLB_MAGIC, GLB_VERSION, 4-byte alignment, the JSON/BIN chunk headers and embedded PNG buffer views) duplicate world/gltf_builder.py (GltfBuilder.buffer_view, accessor, embedded_image and embedded_glb_bytes). float32, cross, difference and dot (lines 34-47) duplicate terrain_coordinates.f32, cross, subtract and dot. GLTF_FLOAT_COMPONENT is also defined again in static_collision_sources.py:27.
- Failure: There are now two owners of GLB container encoding and of the float32 rounding helper. A fix to one, such as accessor min/max rounding or chunk padding, will not reach the other, and sky and terrain GLBs can drift apart. AGENTS.md says 'DRY and single responsibility. One owner per piece of logic. Reuse before adding.'
- Suggested fix: Build the sky GLB with world.gltf_builder (GltfBuilder plus embedded_image and glb()), extending it with an optional unsigned-index accessor if needed. Import f32, cross, subtract and dot from world.terrain_coordinates. Regenerate the pinned served sky hash if the JSON bytes change.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-29: The new 118/0 sky package reader and its texture mip parser have no test that always runs

- File: `scripts/world/sky_materials.py:51` (test-gap, slice-10)
- Evidence: SkyLayoutPackage (lines 51-96) reads package tables and validates export bounds. sky_layout_texture_source (lines 151-185) parses lazy-array mips and checks dimensions against bits and tags. Both are binary readers at a trust boundary. In tests/, no file references SkyLayoutPackage, sky_layout_texture_source, read_sky_material_package, native_texture_source or sky_texture_products. The only coverage is RealClientSkyTests, which is skipped unless E:/Lineage2-client and the served sky are present.
- Failure: A regression in the export-bounds guard (line 93), the lazy-array end check (line 163) or the mip dimension and bits check (line 168) could fail open on a corrupt or unexpected package. CI and any machine without the E: client would not notice.
- Suggested fix: Add synthetic-byte tests: a 118/0 package with an export past the package end (refused), a mip whose lazy-array end differs from its payload (refused), mip bits that disagree with USize/VSize (refused), a non-118/0 layout (refused), and one valid DXT1 record that produces the expected metadata.
- Checkers: trace:yes/high/warning; refute:yes/high/info; rules:yes/medium/warning

### WR-30: An unreviewed texture package layout is relabelled as a texture format gap

- File: `scripts/world/sky_materials.py:193` (error-handling, slice-10)
- Evidence: native_texture_source catches every UnsupportedTextureSource from build_texture_source and re-raises it as `format_unsupported(<Format tag>, ...)`, which gives the reason `sky-texture-format-unsupported:<id>`. build_texture_source raises UnsupportedTextureSource in two cases (texture_mips.py:190 and :199). The first is a layout refusal: 'Native texture source layout supports reviewed UE123/licensee20,28,30 only'. It has nothing to do with the texture format.
- Failure: A sky material package at version 123 with licensee 23 or 25 (licensees the map census shows exist in the client) holds an ordinary DXT1 texture. The gap row reads `sky-texture-format-unsupported:3`, which claims DXT1 is unsupported. The real cause, an unreviewed 123/23 layout, is hidden, so anyone following up chases the wrong problem. The reason should say the layout is unreviewed, like static-material-layout-unreviewed:<v>/<lic>.
- Suggested fix: Check (package.summary['version'], package.summary['licenseeVersion']) against texture_mips.REVIEWED_VERSIONS before calling build_texture_source. Raise SkyTextureUnsupported with a layout reason (for example the registered static-material-layout-unreviewed:<v>/<lic>), and keep format_unsupported only for the format refusal. Add a unit test for both branches.
- Checkers: trace:yes/high/warning; refute:yes/medium/info; rules:yes/high/warning

### WR-31: Audio step seals gaps that depend on the machine (missing ffmpeg, converter failure), and a re-run never clears them

- File: `scripts/world/world_audio_step.py:219` (bug, slice-11)
- Evidence: run_world_audio_step returns the sealed row whenever current_world_audio_receipt matches. That check compares only algorithmVersion, config (rawFingerprint, placement properties, radius symbols, musicDerivativeSha256) and the locked input records. tile_music.pinned_encoder (tile_music.py:79-85) turns shutil.which('ffmpeg') returning None, a wrong ffmpeg hash or a SubprocessError into a sealed 'music-derivative-encoder-unpinned' gap with no music bundle. TileSounds.convert (world_audio_step.py:100-107) also seals a FAILED_STATUS row for any ValueError from world_sound_converter/convert_exact_sound, and that includes OSError-style tool failures wrapped as ValueError. The actual encoder identity or availability never enters the config or the fingerprint.
- Failure: The integration thread runs `--step audio` for a tile on a shell where the pinned ffmpeg is not on PATH. The unit seals with music-derivative-encoder-unpinned and no native-map-music manifest, and the tile manifest pins no music resource. After ffmpeg is installed, re-running `--step audio` returns the cached gap row because config and inputs are unchanged. The tile stays without music until someone bumps WORLD_AUDIO_STEP_ALGORITHM_VERSION or deletes the unit folder by hand.
- Suggested fix: Do not seal gaps caused by the environment. Raise (fail the step without sealing) when the pinned encoder or sound converter is unavailable, or add the resolved encoder identity (or an explicit 'absent' marker) to world_audio_unit_config so that a changed environment changes the fingerprint. Add a pipeline test: seal with the encoder missing, then re-run with the encoder present and get a music bundle.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/medium/warning

### WR-32: Equipped-item lookups build a second catalog index next to the runtime's

- File: `src/assets/native/NativeCharacterVisual.ts:106` (code-rules, slice-12)
- Evidence: `equippedItemSource: NativeEquippedItemSource = servedCatalogEquippedItemSource()` is the default. createNativeSliceRuntime.ts line 196 calls `nativeCharacterFactory(profiles, actionCues, footsteps, clipPreview)` without passing a source, even though the runtime already built `catalogIndex` from `servedCatalog` (line 93). servedCatalogEquippedItemSource (nativeEquippedItemSource.ts lines 16-27) reads the catalog again and calls buildNativeCatalogIndex again, which also fetches coverage.json.
- Failure: Two owners resolve item catalog keys. If the store is restaged between the two reads, body-part items resolve against a different catalog and coverage than the rest of the runtime and the developer sheet. When the runtime's index failed (catalogIndexFailure), the item source retries on its own and reports different diagnostics. Each session also downloads catalog.json and coverage.json a second time.
- Suggested fix: Make the source a required parameter, or build it in createNativeSliceRuntime from the existing `servedCatalog` and `catalogIndex`. Then delete the self-loading default `servedCatalogEquippedItemSource`.
- Checkers: trace:yes/high/warning; refute:no/medium/info; rules:yes/high/warning

### WR-33: No Vitest for the lifecycle of body-part item attachments

- File: `src/assets/native/nativeEquippedBodyPartItems.ts:360` (test-gap, slice-12)
- Evidence: NativeEquippedBodyPartItems is new. It aborts in-flight attaches when a slot changes, disposes the model and anchor on unequip, keeps one diagnostic per slot in canonical order and disposes everything on character dispose. No tests/unit file imports NativeEquippedBodyPartItems. nativeEquippedItemPresentation.test.ts covers only the pure presentEquippedItem decision, and nativeCharacterVisual.test.ts only checks that missingAssetDiagnostic is null or holds the load failure.
- Failure: A regression in the race handling would ship unnoticed. Examples: unequip while lookup or loadModel is pending, re-equip the same slot with another item before the first resolves, or dispose during NativeActor.create. A stale weapon model could stay parented to the hand bone, or a GPU mesh could leak, and no Vitest would catch it.
- Suggested fix: Add a Vitest with a fake NativeEquippedItemSource that holds deferred promises. Cover equip then unequip before resolve (no model created or it is disposed), swap item ids in one slot, a gap diagnostic in slot order, and dispose() disposing anchors and models.
- Checkers: trace:no/high/info; refute:yes/medium/info; rules:yes/high/warning

### WR-34: start() and stop() leave the previous effect in the scheduler

- File: `src/effects/particles/render/emitterActorPlayback.ts:116` (bug, slice-12)
- Evidence: start() runs `effect = scheduler.spawnEffect(actor, emitterRecords, actor.object)` without calling `scheduler.removeEffect` on the effect it replaces. stop() (line 120) only sets `effect = null`. The scheduler's `advanceFrame` steps every entry in `liveEffects` and drops an entry only once `actor.destroyed` is true. Nothing in src calls `removeEffect` except mapEmitterPlayback.
- Failure: The init and shot previews call `hide()` (playback.stop()) when an action is interrupted and `playback.start()` on each new special-attack sequence (nativeEffectInitPreview.ts line 90, nativeEffectShotPreview.ts lines 103 and 134). Each replay leaves the old emitter actor in `liveEffects`. On every later `advance()` it keeps simulating and spawning particles that are never drawn. An actor with AutoDestroy=false and LifeSpan=0 never leaves, so repeated Power Strike casts pile up simulations and CPU cost without limit for as long as the preview lives.
- Suggested fix: Keep the scheduled effect owned: in start() and stop(), call `if (effect) scheduler.removeEffect(effect)` before replacing or clearing it, and do the same in dispose(). Add a Vitest that runs start(), stop() and start() and asserts `scheduler.liveEffects` holds exactly one effect.
- Checkers: trace:yes/medium/info; refute:yes/high/warning; rules:yes/high/warning

### WR-35: No test pins any of the stage-plan compile diagnostics

- File: `src/materials/ue2/model/stagePlan.ts:84` (test-gap, slice-14)
- Evidence: A grep over tests/ finds none of these reason strings: texture-animation-chain-unclosed, material-combiner-mask-absent, material-graph-depth-exceeds, material-combiner-operation-unknown, material-sequence-items-untyped, texture-animation-frame-unreviewed, texture-image-absent, material-reference-external, material-modifier-chain-exceeds. All are produced in stagePlan.ts (lines 84-201) and blendTable.ts:152.
- Failure: A regression in animationFrames (for example accepting an AnimNext chain that loops back to a middle frame), in the combiner mask check, or in the depth limit would let a malformed program compile and render, or throw later in fragmentChain. No Vitest would fail.
- Suggested fix: Add a stagePlan Vitest with synthetic programs for each reason: an AnimNext chain that loops to a middle frame, an external AnimNext, a Combiner op 5/6/7 without Mask, an out-of-range op ordinal, a MaterialSequence, a texture without image, and a graph past the depth limit. Each should assert status 'diagnostic' and its reason.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-36: An absent Shader Diffuse or Combiner Material1/Material2 is silently replaced by white with no reason and no constants row

- File: `src/materials/ue2/model/stagePlan.ts:138` (source-fidelity, slice-14)
- Evidence: `diffuse: compileReference(state, node, "Diffuse", modifiers, depth) ?? { kind: "white" }` (line 138), and the same `?? { kind: "white" }` for Material1 and Material2 (lines 166-167). No reason is pushed. No row in src/materials/ue2/model/constants records 'missing input reads as white'. By contrast, compileRequired turns a missing FinalBlend or modifier Material into `material-reference-absent:<node>.<field>`.
- Failure: A Combiner with CO_Add or CO_Subtract and no Material2, or a Shader with no Diffuse, compiles to a 'compiled' plan. It draws a full-white stand-in (white + c1 clamps to 1) with no visible diagnostic. AGENTS.md requires an unresolved value to stay visibly unresolved.
- Suggested fix: Either use compileRequired for these slots, so an absent reference becomes `material-reference-absent:<node>.<field>`, or add a constants row (status unknown, with provenance) for the 'absent input reads as white' rule and add its id to the plan.
- Checkers: trace:yes/high/warning; refute:yes/medium/warning; rules:yes/high/warning

### WR-37: Graph compile has no cycle detection or memo, so a self-referencing or diamond program blows up exponentially

- File: `src/materials/ue2/model/stagePlan.ts:178` (security, slice-14)
- Evidence: compileNode recurses through compileReference for every reference: Shader has 6 slots, Combiner has Material1, Material2 and Mask. The only bound is `depth > maximumCompileDepth` (64). parseMaterialProgram (materialProgram.ts:176-190) rejects dangling references but not cycles or shared subgraphs, and the compile keeps no visited set and no memo.
- Failure: A served program.json (a trust boundary: store manifest or decoded package) has an Engine.Combiner whose Material1 and Material2 both name the Combiner itself, or a chain of Combiners that each reference the next twice. compileMaterialStagePlan, called from loadNativeMaterial, then makes about 2^64 to 3^64 recursive calls before the depth limit stops it. The browser tab hangs during tile lighting binding instead of showing a named diagnostic.
- Suggested fix: Keep an on-stack set of node ids in CompileState. When a node is entered while it is still on the stack, return `fail(state, `material-graph-cycle:${node.id}`)`. Memoise the compiled expression per (node id, modifier chain), or reject shared non-texture subgraphs. Add a Vitest that compiles a self-referencing Combiner and expects the cycle diagnostic.
- Checkers: trace:yes/high/warning; refute:no/medium/info; rules:yes/medium/warning

### WR-38: A FadeColor with a non-positive FadePeriod compiles as 'compiled', then throws at material creation and takes the whole tile binding down

- File: `src/materials/ue2/model/stagePlan.ts:194` (error-handling, slice-14)
- Evidence: compileNode adds Engine.FadeColor as a colour source without checking any field. fadeColourBytes (modifiers.ts:156-160) throws MaterialProgramError when `!(period > 0)` or when ColorFadeType is not FC_Sinusoidal or FC_Linear. createCompiledMaterial (material.ts:172) calls evaluateMaterialFrame at level time 0, outside any diagnostic path. bindTileLighting (lines 104-121) catches the error, disposes every section and rethrows.
- Failure: A FadeColor whose FadePeriod is 0 (authored, or a UE zero default) produces no `material-...` diagnostic. The MaterialProgramError escapes createNativeMaterial, and bindTileLighting tears down every lightmapped surface of the tile because of one material. An unported TexRotationType, by contrast, becomes a named diagnostic through the 'unported' evaluation status.
- Suggested fix: Validate FadeColor at compile time in stagePlan.ts: FadePeriod > 0 and a reviewed ColorFadeType. On failure, return `fail(state, "material-feature-unported:FadePeriod")` or the matching ColorFadeType reason, so the plan is a diagnostic. Pin it with a Vitest on compileMaterialStagePlan.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/medium/warning

### WR-39: Chunk manifest reading and chunk collision-cell decoding duplicated from existing owners

- File: `src/runtime/tileCollisionCells.ts:35` (code-rules, slice-15)
- Evidence: readChunkManifest (lines 35-39) repeats nativeTileChunkContents.readTileChunkManifests: the same fetchVerifiedNativeResource, parseNativeTileChunkManifest and tileId/chunkId identity check. decodeChunkCollisionCell (lines 46-50) repeats movement/loadCollisionCells.loadChunkCollisionCell: the same fetchNativeTypedPayloadFiles with the 'Collision resource' label and decodeNativeTileCollisionCell with nativeTileCollisionCellId. It even redeclares collisionResourceLabel.
- Failure: A later change to chunk collision validation, such as adding a byte pin or changing the cell id scheme, goes into loadChunkCollisionCell, which the residency ring and tile probes use. The default-route loader keeps the old behaviour, so the two routes decode collision differently. This breaks the repo's one-owner rule.
- Suggested fix: Call readTileChunkManifests(pinned.manifest, signal), or a parallel variant of it, and loadChunkCollisionCell(chunk, signal) from the existing modules. Delete the local copies and the duplicate label constant.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-40: loadTileCollisionCells has no test

- File: `src/runtime/tileCollisionCells.ts:52` (test-gap, slice-15)
- Evidence: No test imports loadTileCollisionCells. worldMovementWiring.test.ts imports only the TileCollisionLoad type and uses a fake loader. Several new rules are unpinned: chunks without collision recorded as chunk-collision-resource-absent, cells without a terrain footprint dropped as collision-cell-terrain-absent, requireCell before addCell, and setTileBspTree only when at least one cell is resident.
- Failure: Suppose a regression silently drops cells with BSP collision but no terrain footprint, or sets the tile BSP tree with no resident cell, which makes CollisionWorld throw. The default 20_20 route then loses collision or fails to start, and no unit test catches it.
- Suggested fix: Add a Vitest test with stubbed fetch responses for a tile manifest with three chunks: one with no collision, one whose cell has no terrain footprint, and one valid. Assert residentCellIds, the chunkGaps reasons, and that the collision world holds the cell and the tile BSP tree.
- Checkers: trace:yes/high/warning; refute:yes/medium/warning; rules:yes/high/warning

### WR-41: Follow camera loses the player's zoom whenever the wall-clamped radius falls below the camera's lower radius limit

- File: `src/runtime/worldMovementWiring.ts:153` (bug, slice-15)
- Evidence: constrainFollowCamera keeps the stored desired zoom only when `camera.radius === appliedRadius` (line 153). It then writes `appliedRadius = sourceDistanceToWorld(view.distance - rules.camera.wallMargin)` straight into camera.radius (lines 167-168), without clamping. When the hit lies within wallMargin (30 source units) of the pivot, this value can be below 0.4 m or even negative. On every frame, ArcRotateCamera._checkInputs -> _checkLimits clamps radius to lowerRadiusLimit (0.4 m from nativeSandboxPresentation) before the onBeforeRender observer runs. On the next frame camera.radius (0.4) !== appliedRadius, so the 0.4 clamp value overwrites desiredRadius. The unit test calls constrainFollowCamera back to back with no camera update in between, so it never sees this.
- Failure: The player stands with the camera at 4.25 m and backs into a wall. The trace clamps the radius to about 0.1 m, which can go negative and flip the camera. Babylon clamps it to 0.4 m on the next frame, and desiredRadius becomes 0.4. When the player walks away from the wall, the camera stays at 0.4 m instead of returning to 4.25 m. The player's zoom is lost for good.
- Suggested fix: Clamp appliedRadius to [camera.lowerRadiusLimit, camera.upperRadiusLimit] before assigning it and storing it, so the next-frame equality check holds. Or track the user's zoom from input (inertialRadiusOffset) instead of comparing radii. Add a test that runs camera.update() (or scene.render on NullEngine) between two constrainFollowCamera calls with a wall closer than lowerRadiusLimit.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-42: A decoded zone fog range with end <= start throws RangeError every frame and stops the render loop

- File: `src/scene/world/cameraEnvironment.ts:63` (error-handling, slice-15)
- Evidence: computeCameraEnvironment calls evaluateFogState, and requireFogRange throws RangeError unless endSourceUnits > startSourceUnits (fog.ts:43-45). The decode boundary in tileLightingRecords.ts:70 checks only that start and end are finite numbers. attachTileLighting calls computeCameraEnvironment inside scene.onBeforeRenderObservable with no guard. EngineHost.run stops the render loop on any exception from scene.render.
- Failure: A converted tile has one ZoneInfo with bDistanceFog and DistanceFogEnd <= DistanceFogStart. The tile loads fine. When the camera enters that zone, the per-frame observer throws, the render loop stops, and the world freezes behind an error panel. A per-zone data gap becomes a fatal runtime fault instead of a visible unresolved gap.
- Suggested fix: Validate end > start where the lighting records are decoded (tileLightingRecords). Either reject the payload, which becomes the lighting gap, or mark the zone with an unresolvedReason so computeCameraEnvironment returns fog null plus a gap row instead of throwing in the frame loop.
- Checkers: trace:yes/medium/warning; refute:yes/medium/warning; rules:yes/high/warning

### WR-43: Streaming chunk loader and tile model template cache have no Vitest coverage

- File: `src/scene/world/loadResidencyChunk.ts:30` (test-gap, slice-16)
- Evidence: No test under tests/ imports loadResidencyChunk, createTileModelTemplates or readResidencyTile (nativeTileResidencyTiles.ts). Untested behaviour includes: rejecting a model id listed with two archives (line 37), dropping a failed template load so a later chunk can retry (line 44), disposing templates that resolve after dispose (41-43, 50-53), refusing a collision cell whose terrain footprint differs from its sector range (94), and disposing the partially built parts on failure (111-113). This is the runtime path for every ?map= tile, because createNativeSliceRuntime always provides a collision cell context.
- Failure: A regression in footprint comparison, template sharing across chunks or failure cleanup would leak GPU meshes or accept mismatched collision. No unit test would catch it, since loadNativeTileChunks.test only covers the non-streaming path.
- Suggested fix: Add Vitest cases with NullEngine and fixture tile files for loadResidencyChunk: footprint mismatch rejection, the collision-null gap reason, and disposal on abort. Add cases for createTileModelTemplates: archive conflict, reuse of one load across chunks, and disposal after a late resolve.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-44: Duplicate trust-boundary helpers with a second owner

- File: `src/scene/world/nativeBspResources.ts:43` (code-rules, slice-16)
- Evidence: nativeBspResources.ts defines isRecord (43), hasExactFields (47) and sha256Pattern (38). These are identical to isPlainRecord, hasExactKeys and nativeTileSha256Pattern, which nativeTileChunkManifest.ts exports and minimapJoin/nativeTileManifest import. nativeTileSkySource.ts:34 adds another private isRecord. All three files were added or changed in this phase.
- Failure: Manifest validation has two owners. A tightening such as rejecting prototype-polluted keys or non-plain objects in hasExactKeys would not reach BSP section extras or the tile sky manifest, so those parsers would accept input the other tile manifests reject.
- Suggested fix: Move isPlainRecord, hasExactKeys and the SHA-256 pattern into one small module that both nativeTileChunkManifest and nativeBspResources import. A separate module avoids the import cycle, since nativeTileChunkManifest already imports nativeBspResources. Delete the private copies in nativeBspResources.ts and nativeTileSkySource.ts.
- Checkers: trace:yes/medium/info; refute:yes/high/info; rules:yes/high/warning

### WR-45: Source-to-scene axis swap and unit scale re-implemented outside sourceFrame

- File: `src/scene/world/nativeTileChunkContents.ts:42` (code-rules, slice-16)
- Evidence: authoredAnchorPosition does `new Vector3(x, z, y).scale(sourceUnitsToGltfMetres)` with a local `sourceUnitsToGltfMetres = 0.01` (line 35). minimapJoin.ts:108 and 251 likewise define `nativeUnitsPerSceneMetre = 100` and map scene z to native Y by hand. src/world/sourceFrame.ts already owns this logic (sourcePositionToWorld, worldPositionToSource), and this same phase moved nativeFlameBillboards onto sourceFrame for exactly this reason.
- Failure: Three places now own the UE2-to-Babylon axis swap and the 0.01 scale. If the source frame changes (for example a handedness flip or an origin offset for tile streaming), the spawn anchor and the minimap UV projection silently disagree with the collision footprints and residency rings, which go through sourceFrame.
- Suggested fix: Use sourcePositionToWorld in authoredAnchorPosition and worldPositionToSource in minimapTexturePosition. Delete sourceUnitsToGltfMetres and nativeUnitsPerSceneMetre.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-46: Residency plan only recomputes when the set of chunks under the focus changes, so diagonal rings go stale while the player walks inside a chunk

- File: `src/scene/world/nativeTileChunkResidency.ts:201` (bug, slice-16)
- Evidence: The onBeforeRenderObservable observer (201-208) returns early unless the joined cellIds of chunksHoldingFocus change. planWorldResidency uses Euclidean footprintDistanceMetres (worldResidencyRing.ts:68-71), so for diagonal neighbours the distance depends on where the focus sits inside its chunk. Example: chunk (+1,+1) is hypot(E-x, E-z) away, which is E*sqrt2 at the entry corner and close to 0 at the far corner. In production `update` (line 214) is never called: grep finds residency.update() only in tests/unit/collisionInputsFromCellsOnly.test.ts. Those tests use a single row of chunks and call update() by hand, so they hide the problem.
- Failure: With ?map=XX_YY, the player enters chunk C at its south edge (E/2, 0). The diagonal chunks (+-1,+1) are at hypot(E/2, E) = 1.12E, outside the visual radius E, so they are loaded but left out of the scene (visible=false). The player walks north to (E/2, E-0.1 m). Those chunks are now about E/2 away and should be drawn, but no replan runs until the player crosses into the next chunk, so their terrain and models stay missing right next to the player. The same staleness applies to required and retained rings on the diagonals.
- Suggested fix: Drive replan from the focus position, not from the holding-chunk key. For example, call replan whenever the focus moves more than a small source-derived step, or compute the plan each frame and only act on changes to its cell id sets. Add a 2-D Vitest that moves the focus inside one chunk without calling update() and expects the diagonal chunk to become visible. Then either remove the test-only `update` export or make it the path the runtime actually uses.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/medium/warning

### WR-47: A malformed material program pin leaks the per-frame advance observer

- File: `src/scene/world/lighting/attachTileLighting.ts:84` (error-handling, slice-17)
- Evidence: Line 80 adds `advance` to scene.onBeforeRenderObservable. Lines 84-85 (unlitSurfaceCounts -> surfaceMaterialProgramId) run before the try at line 86, and surfaceMaterialProgramId throws on a bad nativeMaterialProgram pin (surfaceMaterialProgram.ts:12-13). Only the catch at lines 92-94 removes the observer.
- Failure: A static mesh or terrain material whose glTF extras hold a malformed nativeMaterialProgram makes attachTileLighting throw, and the tile load fails. The `advance` observer stays on the scene and keeps calling computeCameraEnvironment and advancing the clock every frame for every later tile load on that scene, holding the decoded lighting model in memory.
- Suggested fix: Compute staticMeshSlots and terrainLayers before adding the observer, or move lines 80-85 inside the try so the catch removes `advance`.
- Checkers: trace:yes/medium/info; refute:yes/high/info; rules:yes/high/warning

### WR-48: collisionFocusSourcePosition is exported but has no caller in src

- File: `src/scene/world/movement/collisionCellContext.ts:30` (dead-code, slice-17)
- Evidence: grep finds collisionFocusSourcePosition only at its definition and in tests/unit/loadCollisionCells.test.ts:158,167. No production module imports it.
- Failure: Breaks the AGENTS.md rule against dead code: the function and its tests have to be maintained although no runtime path uses it.
- Suggested fix: Delete collisionFocusSourcePosition and its two test assertions, or use it where the runtime converts the focus position to source units.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-49: No test covers the readLeafHull refusals

- File: `src/scene/world/movement/core/bspCollisionTrace.ts:194` (test-gap, slice-18)
- Evidence: readLeafHull has five guard clauses: no terminator, a plane limit reached, a node reference out of range, no hull box, and a non-finite hull box. No test under tests/ covers any of them. Grepping tests for 'terminator', 'hull box' or hullPlaneLimit finds nothing. The only leafHulls fixture is the well-formed `[0, -1, 2, -1]` in tests/support/nativeTileCollisionFixture.ts:85.
- Failure: A refactor of the run reader could turn a guard into an out-of-bounds read: for example, dropping the `wordIndex >= tree.leafHulls.length` check makes `reference` undefined, and `undefined < 0` is false. That would loop or push NaN planes, and no test would fail.
- Suggested fix: Add movementLineCheck or decode tests with synthetic BSPT payloads for each malformed run (missing terminator, plane node >= nodeCount, 64 planes, truncated box, NaN box words). Once validation moves to decode as suggested above, put these tests there.
- Checkers: trace:yes/high/info; refute:yes/high/info; rules:yes/medium/warning

### WR-50: BSPT LeafHulls runs, volume scale and polygons, and terrain scale are only validated during traces, so bad payloads throw from the frame loop instead of failing the load

- File: `src/scene/world/movement/core/decodeNativeTileCollision.ts:208` (error-handling, slice-18)
- Evidence: decodeNativeTileBspTree checks that collisionBound is in range of leafHulls.length, but it never checks the run itself. That check happens later in readLeafHull (bspCollisionTrace.ts:194-212): the terminator, plane node < nodeCount, the hullPlaneLimit and a finite 6-word hull box are validated the first time a box sweep reaches that leaf, and failures throw CollisionWorldError. In the same way, decodeVolumes accepts drawScale 0 and blocking volumes with no polygon vertices (rejected later in volumeTrace.ts:43-48), and decodeTerrain accepts a non-positive TerrainScale (rejected later in terrainTrace.ts:35). These traces run from movementPresenter.advance, which worldMovementWiring.advance calls with no try/catch.
- Failure: A tile payload has a LeafHulls run with no terminator, or a volume with DrawScale 0. It loads cleanly, status becomes "resident", and the world counts as ready. The first time the player's box sweep reaches that leaf or volume, CollisionWorldError propagates out of WorldMovement.advance. Because the same geometry is still in front of the pawn, the error repeats every frame. A load failure (status "failed") would have been caught and inspected instead.
- Suggested fix: Move these checks to the decode boundary. In decodeNativeTileBspTree, walk each distinct collisionBound run once: require a negative terminator, plane nodes below nodeCount, fewer than hullPlaneLimit planes (pass the rules in or do it at addCell) and six finite box words. In decodeVolumes, reject zero drawScale/drawScale3D and blocking volumes with nodes but no polygon vertices. In decodeTerrain, reject non-positive terrainScale. readLeafHull can then trust the data.
- Checkers: trace:yes/high/warning; refute:yes/medium/warning; rules:yes/high/warning

### WR-51: Every world sweep tests every triangle of every resident placement and mover, with no bounds check first

- File: `src/scene/world/movement/core/staticMeshTrace.ts:81` (performance, slice-18)
- Evidence: traceStaticMesh loops `for (const triangle of worldTriangles(mesh, placementMatrix))` and runs clipSweepAgainstPlanes on each triangle's 8 to 17 clip planes. Nothing first checks the placement's world bounds against the sweep's bounds. residentPrimitives (residentPrimitives.ts:73-93) rebuilds the primitive closures for every resident cell on each call, and traceCollisionWorld (lineCheck.ts:37) calls it for every moveActor, floor probe, stepUp move and slide. For BSP box sweeps, convexHullClipPlanes (convexHullClip.ts:62-64) recomputes the O(n^2) bevel planes of each collected hull on every trace (bspCollisionTrace.ts:150). The first trace also builds the triangle cache for every resident placement at once.
- Failure: Tile 20_21 has 2,871 slot placements (world EVIDENCE). With the collision ring resident, each walking substep of each presented pawn runs at least two world traces. Each trace clips every triangle of every placement in the ring, even though the sweep spans a few tens of units. The cost per frame grows with pawn count times all resident triangles, so movement on a converted tile stalls the frame. The first sweep after cells load causes a large spike while it builds all world triangles.
- Suggested fix: Cache a world AABB per placement or mover matrix, next to the triangle cache. In traceStaticMesh and staticMeshOverlapsBox, return early when the swept box (start/end bounds widened by the extent) misses it. Build the ResidentPrimitive list once per collisionWorld revision instead of once per trace. Cache convexHullClipPlanes per ConvexHull in a WeakMap.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/medium/warning

### WR-52: traceTerrain tests every triangle of the chunk on every sweep and allocates per triangle

- File: `src/scene/world/movement/core/terrainTrace.ts:87` (performance, slice-19)
- Evidence: traceTerrain runs `for (const triangle of triangles)` over every triangle that terrainGeometry builds from the chunk's whole vertex rectangle (two per quad, terrainTrace.ts:63-70). Nothing culls by the sweep's 2D bounds first. Each triangle that passes the direction test also allocates a new lifted-vertex array of three objects (line 91), and a hitPoint object when the plane time is in range. residentPrimitives.ts:62-66 calls it for every resident terrain cell, both for sweeps and for overlappedBy, so every sweep pays this cost. The reference notes (.planning/reference/lineage2js/03-movement.md:135) describe walking cells nearest first until the next cell starts after the best hit. That cull is missing here.
- Failure: With a player-centred residency of several terrain chunks, each a sector rectangle of hundreds to thousands of quads, one pawn step makes several sweeps (move, step-up, floor probe). The behind-view camera trace and the click trace sweep too. Every one of them tests tens of thousands of triangles and creates thousands of short-lived objects per frame. On the GTX 1060 target this costs frame time and GC pauses that grow with terrain size and pawn count.
- Suggested fix: Before the triangle loop, clamp the sweep's local-space XY bounding box (start, end, plus extent) to the vertex rectangle. Visit only the quads inside it (column/row range to quadIndex). Compare against the lifted plane by adding extent.z to the plane constant instead of building a liftedVertices array, and keep the edge test on the unlifted vertices plus the z offset. Pin it with a movementLineCheck test that counts triangles visited, or with a large-terrain fixture.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:no/medium/info

### WR-53: New pinned-fetch helper duplicates fetchVerifiedNativeResource

- File: `src/ui/fetchCatalogPinnedBytes.ts:4` (code-rules, slice-19)
- Evidence: fetchCatalogPinnedBytes (new in Phase 2) does fetch(nativeResourceUrl(path)), checks response.ok, reads the arrayBuffer, calls signal.throwIfAborted, then checks the length and sha256. src/scene/world/loadNativeSection.ts:174-182 fetchVerifiedNativeResource is the same sequence line for line, and fetchNativeTypedPayloadFiles already uses it. Only the error wording differs, and the length is optional there.
- Failure: There are two owners of the trust-boundary check for pinned /l2 bytes. If one gains a guard (a size cap before reading the body, a streaming length check, a different abort order), the other path silently keeps the old behaviour. Native window, radar texture and name-index loads would then validate differently from section and collision payloads. This breaks the AGENTS.md rule of one owner per piece of logic.
- Suggested fix: Delete fetchCatalogPinnedBytes. Have readNativeTableNameIndex and nativeWindowManifestLoader call fetchVerifiedNativeResource, or move that single function to a neutral shared module and give it an optional label parameter for the error text.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-54: NativeWindowLayer.openWindowIds has no caller, and close is used only by dispose

- File: `src/ui/nativeWindows/nativeWindowLayer.ts:25` (dead-code, slice-20)
- Evidence: grep shows `openWindowIds` only in its own implementation (line 94) and in test doubles (tests/support/nativeSliceRuntimeHarness.ts:121, tests/unit/mountSandboxWindowLayer.test.ts:18). `close` is called only by the layer's own dispose, never through the interface (no src or test caller of layer.close).
- Failure: Unused public API that AGENTS.md 'No dead code' requires deleting. The doubles keep stubbing methods that no production code reads.
- Suggested fix: Remove openWindowIds from the interface, the implementation and both doubles. Make close a private helper inside createNativeWindowLayer unless a caller that closes windows lands in the same change.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-55: Layer open deduplication, dispose during open and object URL revocation are untested

- File: `src/ui/nativeWindows/nativeWindowLayer.ts:45` (test-gap, slice-20)
- Evidence: No unit test imports createNativeWindowLayer, loadNativeWindowManifest or resolveNativeWindowTextures. mountSandboxWindowLayer.test mocks the layer, and grep finds no revokeObjectURL, abort or pending-open assertions in nativeWindowRenderer.test.ts or minimapControl.test.ts. Untested paths: pendingOpens sharing one promise, revocation when the signal aborts after the textures resolve (lines 50-52), revocation when one texture fetch fails partway (resolveNativeWindowTextures catch), and minimap radar URL revocation after dispose.
- Failure: A refactor that drops one of the revokeNativeWindowTextures calls or the post-await abort check leaks blob URLs, or renders a window into a disposed layer, and no test fails.
- Suggested fix: Add Vitest cases with a fake catalog and fetchCatalogPinnedBytes: two concurrent open() calls share one promise; dispose() during texture resolution rejects and revokes every created URL; a failing second texture revokes the first; a disposed minimap revokes radar URLs that resolve late.
- Checkers: trace:yes/high/info; refute:yes/high/warning; rules:yes/high/warning

### WR-56: Window anchors are resolved once against the container size at open time and never re-laid out

- File: `src/ui/nativeWindows/nativeWindowLayer.ts:54` (bug, slice-20)
- Evidence: loadAndRender reads `container.getBoundingClientRect()` once and passes it as `screen` to renderNativeWindow, which bakes absolute px rectangles. refresh() only updates gauges and the minimap, and a second open of an already open window only re-appends the stale element. Nothing listens for container or viewport size changes.
- Failure: On the default phone (932x430 landscape) a window anchored to BottomRight or CenterRight is placed for the size at open time. After a rotation or a desktop browser resize it stays at the old coordinates, and the layer's overflow:hidden clips it partly or fully off-screen. Reopening it from the sandbox picker does not fix it.
- Suggested fix: Observe the container with a ResizeObserver, owned by the layer and disconnected in dispose, and re-resolve the rectangles (re-render or re-place each control) with the new screen size. Cover it with a test that changes the container bounds.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/medium/warning

### WR-57: An unresolved first control texture is silently replaced by a later texture of the same control

- File: `src/ui/nativeWindows/nativeWindowRenderer.ts:57` (source-fidelity, slice-20)
- Evidence: firstTextureGapOrImage draws `resolutions.find(resolution => resolution.status === "resolved")` and returns `gap: null` whenever any texture resolves. It records a gap only when none resolves (`resolutions[0]`). A node's `textures` list keeps the xdat order, for example a Button's normal, pushed and highlight textures.
- Failure: A Button whose normal texture is not in the catalog but whose pushed or highlight texture is converted gets drawn with the pushed or highlight art as its idle state, and no data-native-gap is set. The unresolved normal texture is hidden instead of staying visibly unresolved, and no test covers a mixed gap and resolved list.
- Suggested fix: Draw only the first texture (the control's own state texture). If it is a gap, record its reason and draw no substitute. Add a renderer test with textures [gap, resolved] that expects the gap and no img.
- Checkers: trace:yes/high/warning; refute:yes/medium/warning; rules:yes/high/warning

### WR-58: A field binding whose control is missing or ambiguous is dropped with no gap

- File: `src/ui/nativeWindows/nativeWindowRenderer.ts:67` (source-fidelity, slice-20)
- Evidence: uniqueBindingNodes binds only when `candidates.length === 1`. A binding whose controlName matches zero nodes, or more than one node, is skipped without any gap entry. renderNativeWindow then renders that control with no gauge, and neither `gaps` nor data-native-gap mention the binding.
- Failure: The recipe binds StatusWnd HPBarTex to health. If a re-converted StatusWnd renames that control or holds two nodes named HPBarTex, the HP gauge disappears silently and the window reports no gaps, so the unresolved binding looks like a correct window.
- Suggested fix: Return unmatched and ambiguous bindings from uniqueBindingNodes and add them to RenderedNativeWindow.gaps (for example `binding-control-missing` and `binding-control-ambiguous` on the window root). Add tests for both cases.
- Checkers: trace:yes/medium/warning; refute:no/medium/info; rules:yes/high/warning

### WR-59: stop record built from a stale local heading turns the player to the wrong yaw

- File: `src/world/NativeSliceAdapter.ts:195` (bug, slice-20)
- Evidence: stopLocalMove emits `heading: worldYawToSourceHeading(player.orientationRadians)`, but during a move the adapter never updates orientationRadians: acceptReportedPosition (line 200) stores only `position` and drops the validated `command.heading`, and the test 'mirrors an accepted reported source position' pins orientationRadians 0 after a heading-16384 report. movementPresenter.applyStop (src/scene/world/movement/movementPresenter.ts:159-163) sets the pawn `yaw` from the stop heading for the local player too, and EntityRegistry.update takes the root rotation from `movementPose().orientationRadians`, which is the pawn heading.
- Failure: The player spawns facing heading 0 and runs east. A set-animation command (an emote from the sheet) or a special-attack preview-action then arrives mid-run, so stopLocalMove emits stop with heading 0, and the local pawn snaps to face north. For preview-action with a target, the orientation toward the target in the following update is ignored because the pose wins, so the attack plays facing the stale direction.
- Suggested fix: Store the reported heading in acceptReportedPosition (`orientationRadians: sourceHeadingToWorldYaw(command.heading)`), as stopAtReportedPosition already does, and update the test. Then add a test: move-local, report-position with heading H, set-animation, and expect a stop with heading H.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-60: WorldPosition is declared twice, in sourceFrame.ts and worldTypes.ts

- File: `src/world/sourceFrame.ts:7` (code-rules, slice-21)
- Evidence: sourceFrame.ts:7-11 declares `export interface WorldPosition { readonly x; readonly y; readonly z }`. worldTypes.ts:3-7 declares the same interface, and worldTypes.ts already imports SourcePosition from sourceFrame. Some callers import WorldPosition from sourceFrame (collisionCellContext.ts:2, nativeTileChunkResidency.ts:5, tests/unit/collisionInputsFromCellsOnly.test.ts:14). Others import it from worldTypes (WorldNavigation.ts:1 and the adapter types).
- Failure: Two files own one type, which breaks the DRY and single-owner code rule. If one copy changes (for example a brand field that marks metre positions apart from source-unit positions), the other copy does not change with it. Structural typing would then let positions from either module pass where the other is expected, so the unit-frame protection is lost without any compiler error.
- Suggested fix: Keep a single WorldPosition, in sourceFrame.ts next to SourcePosition. In worldTypes.ts, re-export it or import it from there, and point the three sourceFrame importers and the worldTypes importers at that one owner.
- Checkers: trace:yes/high/info; refute:yes/high/info; rules:yes/high/warning

### WR-61: sourceRotationToWorld and RotationMatrix have no production caller

- File: `src/world/sourceFrame.ts:37` (dead-code, slice-21)
- Evidence: A search of src/ finds sourceRotationToWorld only in its own declaration (sourceFrame.ts:37). Its only other user is tests/unit/sourceFrame.test.ts. The RotationMatrix type (line 13) is also used only by this function and the test; nativeEffectShotPlacement.ts uses Babylon's Quaternion.FromRotationMatrix and not this type.
- Failure: AGENTS.md code rules say: no dead code and no speculative abstractions; delete unused exports. This export is kept alive only by its own test. Placement code written later could add a second rotation conversion without knowing this one exists, and the two would drift apart.
- Suggested fix: Delete sourceRotationToWorld, RotationMatrix, swappedAxisByAxis and their tests in this change. Add them back together with the first runtime caller that converts a source rotation matrix.
- Checkers: trace:yes/high/info; refute:yes/high/info; rules:yes/high/warning

### WR-62: Overlap gate passes silently when an area's source globs match no file

- File: `tools/reference-overlap/referenceOverlap.mjs:146` (error-handling, slice-21)
- Evidence: Line 145 refuses an area whose reference globs match nothing (`reference globs of ${areaName} match no file`), but line 146 builds the source corpus from `expandRepositoryGlobs(repositoryRoot, area.sourceGlobs)` with no matching guard. repositoryGlob.mjs expandGlob returns [] when the static directory is absent (line 57) or when a literal path is missing (line 54). The network area in overlapAreas.json lists `src/net/**/*.ts` and `src/world/mobius/**/*.ts`, and neither directory exists at HEAD, so `--area network` reports zero runs and exits 0 today.
- Failure: Someone renames src/scene/world/movement or src/world/sourceFrame.ts, or mistypes a source glob in overlapAreas.json. The movement or NET-09 check then compares an empty or partial corpus, finds no shared runs and exits 0. The DEC-OWN-12 clean-room gate reports a pass while checking no code, and the reference side never fails this way.
- Suggested fix: Expand the source globs once and throw ReferenceOverlapSetupError when the list is empty. Also expand each glob on its own and refuse any glob that matches nothing, the same way the reference globs are handled. Keep the network area out of the default run, or mark it as having no sources yet on purpose, until src/net exists. Add a Vitest case for an area whose source glob matches nothing.
- Checkers: trace:yes/high/warning; refute:no/medium/info; rules:yes/medium/warning

## Info (not verified, not fixed in this round)

| ID | File | Title |
|----|------|-------|
| IN-01 | `scripts/actors/actor_sound_batch.py:244` | config_routes rebuilds the config roles and the unresolved-reason format by hand |
| IN-02 | `scripts/actors/character_census.py:224` | The character census is written non-atomically and without the reparse-point guard the other census writers use |
| IN-03 | `scripts/actors/character_requests.py:217` | The profile is always a gap, so the census `written` branch and `profilesWritten` can never be non-zero |
| IN-04 | `scripts/actors/skill_effect_conversion.py:123` | RibbonEmitter components always fail the bound check with a misleading converter-refused reason |
| IN-05 | `scripts/actors/skill_unit_inventory.py:22` | Skill row reason logic and reason constants duplicated between skill_unit_inventory and skill_binding_table/npc_requests |
| IN-06 | `scripts/data/texture_package_census.py:120` | The reference-tree lock SHA-256 is computed in four places |
| IN-07 | `scripts/data/pinned_elbera_module.py:41` | require_pinned_elbera_script and strict_table_count_report have no production caller |
| IN-08 | `scripts/data/convert_tables.py:41` | SYSTEM_DAT_PATH_PATTERN is defined twice |
| IN-09 | `scripts/native_assets_lib/strict_json.py:7` | Shared strict JSON decoder reports 'player staging JSON' for every caller |
| IN-10 | `scripts/measure-native-world.mjs:145` | Tile measurement scenario records sky and crowd facts it never checks |
| IN-11 | `scripts/native_assets.py:665` | Converting host name is computed twice, with two owners |
| IN-12 | `scripts/native_store/catalog_index_keys.py:59` | Catalog-key validation and the /l2/ prefix each have two owners |
| IN-13 | `scripts/native_migration.py:20` | The migration adapter list is duplicated in native_batch_adapters |
| IN-14 | `scripts/native_store/catalog_writer.py:302` | A non-object record in a store catalog slice crashes with AttributeError instead of a CatalogWriteError |
| IN-15 | `scripts/native_store/load_check_records.py:16` | is_riga_timestamp accepts any UTC offset |
| IN-16 | `scripts/native_store/catalog_writer.py:75` | replace_file leaves its temporary file behind when the write fails |
| IN-17 | `scripts/native_store/write_lane_catalog.py:45` | Union merge copies every file in a union lane store, not only the files its catalog pins |
| IN-18 | `scripts/record_static_material_cross_check.py:71` | Recorder leaves stale real-client cases behind, and its two fixture writers have no test |
| IN-19 | `scripts/stage_native_players.py:28` | Phase-2 rename pass left vague abbreviated names that three other staging scripts import |
| IN-20 | `scripts/stage_native_combat_audio.py:89` | Three staging scripts each own the same WAV descriptor check and catalog write sequence |
| IN-21 | `scripts/static_material_package_census.py:35` | SHA-256 pattern and integration lane name are redefined instead of reused |
| IN-22 | `scripts/world/convert_tile_batch.py:80` | A settled gap tile never re-runs its later steps when they go stale |
| IN-23 | `scripts/world/collision_payload_groups.py:14` | Duplicated helpers and constants with several owners |
| IN-24 | `scripts/world/bsp_visibility_census.py:52` | Committed census write bypasses the committed-world-data guard |
| IN-25 | `scripts/world/bsp_chunk_geometry.py:106` | Recorded runtimeDefault for the BSP lightmap section key is stale |
| IN-26 | `scripts/world/bsp_reader_binding.py:24` | Single-letter name in PackageAdapter export mapping |
| IN-27 | `scripts/world/environment_program.py:59` | Env/TimeEnv properties before the first section are dropped silently |
| IN-28 | `scripts/world/exact_sound_sources.py:73` | Exact qualified sound resolution duplicates MapSources.resolve |
| IN-29 | `scripts/world/exact_sound_sources.py:45` | Hash helpers duplicated in new world modules |
| IN-30 | `scripts/world/lighting_payload.py:29` | typed_payload_byte_count is a second owner of the typed payload layout |
| IN-31 | `scripts/world/reader_cross_check_rows.py:43` | Cross-check projection collapses array properties by name, so 'equal' skips every array element except the last |
| IN-32 | `scripts/world/placement_audio_inventory.py:22` | Object-reference guard accepts a decoded dict with no 'object' key and reports it as a null reference |
| IN-33 | `scripts/world/mover_class_defaults.py:185` | load_mover_class_defaults builds a MoverDefaults that its only caller discards |
| IN-34 | `scripts/world/raw_map_extraction.py:29` | The raw map product path literal has several owners |
| IN-35 | `scripts/world/terrain_collision_source.py:9` | Chunk sector-rectangle lookup is written twice |
| IN-36 | `scripts/world/static_placement.py:80` | Abbreviated names in code split out during Phase 2 |
| IN-37 | `scripts/world/sky_step.py:183` | A sky texture leaf-name clash fails the whole sky step instead of adding a gap |
| IN-38 | `scripts/world/static_placement_plan.py:8` | Constants defined twice across the new modules |
| IN-39 | `scripts/world/tile_music.py:107` | Tile map path, coordinate note and gap reason are written again instead of reused from their owners |
| IN-40 | `src/assets/native/nativeCatalogIndex.ts:208` | Catalog index drops unresolved player profiles, so their character key shows a plain 'not in catalog' instead of the unresolved reason |
| IN-41 | `scripts/world/typed_payload.py:99` | Typed payload is packed twice for every tile resource |
| IN-42 | `src/effects/particles/render/mapEmitterPlayback.ts:52` | Partial construction leaks the effect when createPlacementView throws |
| IN-43 | `src/effects/loadEffectComponent.ts:269` | Pinned frame silently falls back to frame 0 for draws whose texture chain lacks it |
| IN-44 | `src/assets/native/nativeHumanHandAnchor.ts:53` | sourceSkinHasJoint swallows every error and reports it as an unresolved RightHandBone |
| IN-45 | `src/effects/particles/render/particleInstances.ts:64` | writeParticleInstances allocates several arrays and objects per particle per frame |
| IN-46 | `src/effects/nativeEffectComponents.ts:32` | simulatedEffectEmitterClasses is exported for tests only |
| IN-47 | `src/assets/native/readNativeCatalog.ts:98` | Catalog read has no size limit, unlike the coverage report |
| IN-48 | `src/entities/EntityRegistry.ts:189` | With a movement pose, ground clearance is always added, but snapshot reports 0 when no ground hook is configured |
| IN-49 | `src/effects/particles/sim/particleState.ts:131` | listLiveSlots bounds by column capacity, while the update loop bounds by MaxParticles, so slots past a lowered MaxParticles freeze but still draw |
| IN-50 | `src/effects/particles/sim/emitterNatives.ts:281` | ResetOnTrigger re-runs Initialize, not Reset, so ribbon emitters lose SampleTimer and bKilled |
| IN-51 | `src/materials/ue2/babylon/fogUniforms.ts:7` | sourceDistanceToMetres duplicates the existing sourceDistanceToWorld helper |
| IN-52 | `src/effects/particles/sim/meshEmitter.ts:29` | MeshEmitterSimulation.materialRoute and staticMesh are never read; the binding recomputes the route |
| IN-53 | `src/materials/ue2/model/stagePlan.ts:155` | Combiner operation guards check only the upper bound, so a negative ordinal compiles and throws later in the fragment chain |
| IN-54 | `src/materials/ue2/model/modifiers.ts:123` | The model reports TexEnvMap and TexCoordSource as evaluated identity matrices; the refusal lives only in the Babylon layer |
| IN-55 | `src/materials/ue2/model/modifiers.ts:143` | environmentMapCoordinates has no runtime caller |
| IN-56 | `src/materials/ue2/model/materialFrame.ts:17` | Per-frame material evaluation re-decodes static fields for every bound surface |
| IN-57 | `src/runtime/attachNativeSliceWorldSheet.ts:32` | The Frame world hint names tile 20_20 although the runtime now loads other tiles |
| IN-58 | `src/runtime/createNativeSliceRuntime.ts:340` | Ported behind-view collision trace pivots on a browser presentation offset, not on the pawn |
| IN-59 | `src/runtime/worldMovementWiring.ts:117` | pose() rebuilds the full presenter inspection for every lookup, several times per entity per frame |
| IN-60 | `src/scene/world/nativeTileResidencyTiles.ts:26` | tileIdPattern re-declared instead of imported from nativeCatalogRecords |
| IN-61 | `src/scene/world/loadResidencyChunk.ts:48` | TileModelTemplates.loadedCount counts pending and failed-in-flight loads as loaded |
| IN-62 | `src/scene/world/nativeTileChunkFootprints.ts:62` | Chunk edge for residency rings comes from the probe cell's own width, which is short for a partial edge chunk |
| IN-63 | `src/scene/world/nativeTileChunkResidency.ts:108` | Per-frame array spread, filter, sort and string join over every known chunk |
| IN-64 | `src/scene/world/nativeTileChunkManifest.ts:168` | isAffinePlacementMatrix is exported but only used inside its own module |
| IN-65 | `src/scene/world/bspVisibility/babylonTileVisibilityTargets.ts:38` | sourceDistance duplicates worldDistanceToSource from sourceFrame |
| IN-66 | `src/scene/world/lighting/attachTileLighting.ts:43` | lightingResourceAbsentReason is exported but used only inside its own module |
| IN-67 | `src/scene/world/movement/core/decodeNativeTileCollision.ts:227` | Decoded and validated BSPT and VOLS fields that no runtime code reads |
| IN-68 | `src/scene/world/movement/core/staticMeshTrace.ts:18` | Functions exported but only used inside their own module |
| IN-69 | `src/scene/world/movement/core/pawnRotation.ts:9` | Direction-to-heading conversion uses 32768/pi with no recipe row or provenance |
| IN-70 | `src/scene/world/movement/core/movementRules.ts:196` | Substep rules are not checked for positivity, so walkPawn can loop forever |
| IN-71 | `src/shared/math/affineMatrix.ts:10` | Shared math exports used only by tests |
| IN-72 | `src/world/sandboxCommands.ts:40` | Spawned sandbox NPCs and characters get invented health 100/100 |
| IN-73 | `tools/reference-overlap/referenceOverlap.mjs:213` | Command-line entry check can turn the gate into a silent exit 0 |

## Dropped by verification

Fewer than two of the three checkers confirmed these; they are not fixed.

| File | Title | Checkers |
|------|-------|----------|
| `scripts/actors/character_requests.py:113` | Face and hair texture citations always point at index 0, even when the bound texture sits at another index | trace:no, refute:no, rules:yes |
| `scripts/native_assets_lib/class_defaults.py:175` | Class-default cache is keyed only by source identity, so a reader change reuses stale or wrongly shaped records | trace:no, refute:no, rules:yes |
| `scripts/native_assets_lib/conversion_evidence.py:28` | Intermediate glTF exports are no longer retained, but the weight audit and two pipeline tests still read them from evidence/export | trace:yes, refute:no, rules:no |
| `scripts/native_assets_lib/material_program.py:68` | Missing static-array elements are filled with None and marked as typed authored values | trace:no, refute:no, rules:yes |
| `scripts/world/bsp_step.py:120` | A drawn BSP surface with a null Material reference crashes the whole bsp step | trace:no, refute:no, rules:yes |
| `scripts/world/minimap_sources.py:37` | zonename and huntingzone tables are decoded without checking the bytes against the reference lock | trace:no, refute:no, rules:yes |
| `scripts/world/minimap_join.py:90` | Hunting zones whose start point lies in the 128-unit seam between tile frames join no tile, and no gap is recorded | trace:no, refute:no, rules:no |
| `scripts/world/raw_map_step.py:145` | Raw unit fingerprint and receipt inputs cover only the map, although the products embed height-texture and other package bytes | trace:yes, refute:no, rules:no |
| `src/entities/EntityRegistry.ts:166` | A clip requested before the native model loads gets a false 'not in clip list' diagnostic and is never replayed | trace:yes, refute:no, rules:no |
| `src/materials/ue2/babylon/material.ts:157` | Every material update allocates new Vector3 and Color4 objects for each sampler, colour source and fog uniform, every frame | trace:no, refute:no, rules:no |
| `src/materials/ue2/model/blendTable.ts:82` | FinalBlend depth-write rule never applies to converted programs because a class-default ZWrite counts as an override | trace:no, refute:no, rules:yes |
| `src/runtime/attachSandboxCommandSheet.ts:35` | Any skill-cast event starts the local player's Power Strike preview, whatever its casterId or targetId | trace:no, refute:no, rules:yes |
| `src/scene/world/bspVisibility/core/locateZone.ts:23` | locateZone skips the recorded empty-leaf-slot fallback and takes the zone from the node side, unlike the pipeline | trace:no, refute:no, rules:no |
| `src/scene/world/streamNativeTileChunks.ts:100` | Tile lighting and visibility stay bound to the startup chunk meshes after residency disposes and reloads them | trace:yes, refute:no, rules:no |
| `src/scene/world/lighting/attachTileLighting.ts:78` | An environment program with no type 0 fails the whole tile instead of reporting a lighting gap | trace:no, refute:no, rules:yes |
