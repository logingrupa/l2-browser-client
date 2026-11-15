---
phase: 02-stage-a-breadth
reviewed: 2026-11-11T08:45:00Z
depth: standard
files_reviewed: 489
diff_range: 2ede78f..cb09cdc
findings:
  critical: 14
  warning: 52
  info: 81
  dropped_by_verification: 26
status: issues_found
---

# Phase 2 independent review

## Method

- Reviewer setup: fresh-context general-purpose Claude agents that did not write the code and did not see 02-REVIEW.md or 02-REVIEW-FIX.md. They replace the Codex cross-model review (Codex is out of credits until 2026-11-12, OVERNIGHT-DECISIONS row 40).
- Inputs: the Phase 2 section of REQUIREMENTS.md, the ROADMAP Phase 2 goal and success criteria, AGENTS.md, docs/OUTPUT_CONTRACT.md and the code changed between `2ede78f` and `cb09cdc` (after the code review fix round), in 14 slices of about 3,200 added lines.
- Lens: requirements and contracts across module boundaries (does the code deliver what its requirement says; does converter output match the reader; source fidelity; server boundary), plus defects met on the way.
- Verification: each critical or warning finding went to three fresh checkers (trace, refute, project rules); kept when at least two confirm. The refute lens also dropped findings the code review fix round had already fixed.
- Fix round: one round, recorded in 02-REVIEW-INDEPENDENT-FIX.md.

## Critical issues

### CR-01: actor-sounds batch stalls on skills without a skillsound row because they are never sealed

- File: `scripts/actors/actor_sound_batch.py:86` (bug, slice-01)
- Evidence: ActorSoundBundles.is_sealed returns False whenever actor_rows is None, which happens for every skill whose binding has soundRowOrdinal None. convert() then calls no_sound_row_bundle_outcome. That writes a gap row but seals no ledger unit. run_actor_sound_slice counts that outcome toward --limit, and the next run picks the same key again. I counted from the data-ui skillsoundgrp manifest: about 2,930 of the 3,064 skill keys in the actors lane catalog have no exact (skill_id, skill_level) row. The first is skill:4:2. The slice test (FakeSoundBundles) has no bundle that never seals.
- Failure: Once the 1,000 NPC bundles are sealed, every `--batch actor-sounds --limit 20` run re-processes the same first 20 no-row skill keys and stops. Skill bundles that do have a sound row are never reached by the batch, and every run reports 20 'converted' outcomes.
- Suggested fix: Seal the no-row outcome as a ledger unit, fingerprinted by the skillsoundgrp source SHA and the binding row, so is_sealed is True for it. Or skip keys whose current gap row already records no-exact-skillsound-row. Add a slice test with a bundle that resolves to no sound row.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### CR-02: Character conversion always fails: the shared data-ui reader refuses the hairgrp and helmetgrp manifests

- File: `scripts/actors/character_conversion.py:51` (contract-mismatch, slice-01)
- Evidence: read_character_sources reads hairgrp and helmetgrp through native_store.data_ui_table_manifest. Since c92ccee, that reader requires isinstance(manifest['records'], dict). The elbera-adapter manifests that convert_tables.elbera_hair_table_manifest writes hold a list: 15 rows of 15 [a, b] pairs for hairgrp, and [{key, pairs}] for helmetgrp. I ran data_ui_table_manifest against the real artifacts/lane-store/data-ui store. It raised DataUiTableManifestError for both hairgrp (/l2/tables/f4c71595.../hairgrp.json) and helmetgrp, and returned classinfo-e normally. tests/pipeline/test_character_requests.py passes list-shaped synthetic manifests straight into CharacterSources, so no test goes through the real reader. The committed character-census.json (layoutRecordFields hairgrp []) was written before the reader change.
- Failure: `python -B scripts/actors/convert_actors.py --client E:/Lineage2-client --character 0` or `--batch characters --limit 15` exits 1 with 'Actor conversion failed: data-ui lane manifest /l2/tables/f4c71595.../hairgrp.json must be a native-table v1 manifest of hairgrp with a sourcePath and records'. No chargrp row can be converted or re-censused while the data-ui lane holds the DATA-02 hair tables.
- Suggested fix: Make the shared reader accept the records shape of each route: a dict for local-descriptor, a list for elbera-adapter. Pin that shape in OUTPUT_CONTRACT, which currently says only that recordCount equals the length of records. Add a pipeline test that runs read_character_sources against a lane store holding an elbera-adapter hairgrp manifest.
- Checkers: trace:yes/high/critical; refute:yes/high/critical; rules:yes/high/critical

### CR-03: Elbera hair table manifests store a list in records, but the shared data-ui reader only accepts a dict, so the character route fails

- File: `scripts/data/convert_tables.py:79` (contract-mismatch, slice-02)
- Evidence: elbera_hair_table_manifest writes 'records': decoded_hair_table['records'], which is a list: 15 pair rows for hairgrp, and lists of {key, pairs} for helmetgrp and hairaccessarygrp. scripts/native_store/data_ui_table_manifest.py:44-46 refuses any manifest whose records is not a dict. That check came in with c92ccee, which unified the reader during the Phase 2 review fixes. character_conversion.read_character_sources (lines 49-51) calls data_ui_table_manifest for hairgrp and helmetgrp. I ran the reader against the current lane store. data_ui_table_manifest(repo, 'hairgrp') and the same call for 'helmetgrp' both raise DataUiTableManifestError: 'must be a native-table v1 manifest of hairgrp with a sourcePath and records'. classinfo-e passes. OUTPUT_CONTRACT.md (native-table v1) also says 'recordCount equals the length of records'. That holds only on the elbera-adapter route; local-descriptor records are a dict holding the count field and one list. tests/pipeline/test_data_ui_table_manifest.py only uses records {}.
- Failure: Run the character census or the character batch (character_census.py, then read_character_sources) against the current data-ui lane store. It raises DataUiTableManifestError before any chargrp row is processed. ACT-01 character conversion cannot run, and the committed character-census.json cannot be regenerated or rechecked.
- Suggested fix: Give native-table records one shape on both routes, for example wrap the Elbera rows as {"<collection>": [...]} the way the local-descriptor route does, and bump the hair unit algorithm version. Then fix the OUTPUT_CONTRACT sentence on recordCount. Add a test that passes an elbera-adapter manifest through data_ui_table_manifest and read_character_sources.
- Checkers: trace:yes/high/critical; refute:yes/high/critical; rules:yes/high/critical

### CR-04: The lane merge pin walk misses sky bundle files and native-materials programs, so a world restage publishes tiles whose sky.glb and BSP material programs are absent

- File: `scripts/native_store/catalog_writer.py:289` (contract-mismatch, slice-04)
- Evidence: merge_lane_store.py:158 copies only pinned_store_files(lane_root, records_by_slice). pinned_file_references (catalog_writer.py:289-298) follows only /l2 path fields and bundle members shaped {file, sha256} (is_bundle_member_pin, line 253). The sky manifest written by scripts/world/sky_step.py:217 pins its payloads as a name-keyed map 'files': {'sky.glb': {bytes, sha256}, 'WhiteCloud.png': {...}} with no 'file' field. The BSP chunk GLBs point to native-materials/<sha>/program.json only through glTF extras (nativeMaterialProgram), which the walk never parses. A structural walk of artifacts/lane-store/world/l2 with these same functions reaches 6,672 files. The 22 skies/<sha>/sky.glb files and their textures are left out. So are all 98 native-materials folders, 95 of which are named by 804 nativeMaterialProgram references in the native-tile-chunk-bsp GLBs. The browser fetches /l2/skies/<sha>/sky.glb (nativeTileSkySource.ts:52, nativeSkyPresentation.ts:36) and /l2/native-materials/<sha>/program.json (loadNativeMaterial.ts:23, called from attachTileLighting.ts:89). OUTPUT_CONTRACT.md still lists skies/ as 'Outside the catalog', although tile manifests now reach it. No merge test has a sky or GLB-extras reference.
- Failure: The integration thread runs the restage command that write_lane_catalog.py --plan --lane world prints. merge_lane_store copies tile.json, the chunk manifests, skies/<sha>/manifest.json and the BSP GLBs into public/l2, then writes catalog.json. The browser then loads tile 20_20. readSelectedTileSkySource pins sky.glb from the copied manifest, the fetch of /l2/skies/<sha>/sky.glb answers 404, and attachTileLighting's loadNativeMaterial gets 404 for every BSP surface program. The world lane store served through NATIVE_STORE_ROOT=world loads fine, so the loss shows only after the restage.
- Suggested fix: Make every manifest pin its payloads in one shape the walk understands: change the sky manifest 'files' map to a list of {file, sha256, bytes}. Make the BSP and model producers list their native-materials program and graph pins in a JSON resource the walk reaches, for example a materials list in the chunk manifest with /l2/native-materials/<sha>/program.json and its sha256. Alternatively, have merge_lane_store refuse a bundle folder that holds files no pin reaches. Add a merge test with a sky resource and a GLB-extras material program, and fix the 'skies/ outside the catalog' row in OUTPUT_CONTRACT.md.
- Checkers: trace:yes/high/critical; refute:yes/high/critical; rules:yes/high/critical

### CR-05: A catalog-listed key is reported pass even when its steps failed, so failed tiles never count as gaps

- File: `scripts/native_store/gap_census.py:146` (requirement-gap, slice-04)
- Evidence: census_row (lines 146-152) sets status 'converted' and reason None whenever the catalog lists the key, before deciding_row is consulted (GAP_CENSUS_STATUS_PRECEDENCE puts 'converted' ahead of 'failed'). build_coverage_report.coverage_row maps that status to 'pass', and count_part_rows counts gap only from rows whose status is gap or failed. In artifacts/lane-store/integration/l2/coverage.json, all 62 converted world rows carry non-pass steps. 40 of them have collision 'failed decode-failed', every downstream step pending 'upstream-step-failed', and loads 'failed'. One example is tile:15_20: bsp gap map-licensee-unsupported:123/25, collision failed, loads failed, row status 'pass', reason null. The same holds for all 1,000 converted npcs, 3,064 skills and 96 items, and for 208 of 248 ui rows (controls gap control-type-unsupported, textures gap decode-failed).
- Failure: Success criterion 1 says 'tiles or steps that failed appear in the coverage report as gaps'. A developer reads parts.world as converted 62, gap 22, pending 79 and the row tile:15_20 as status pass. That tile has no collision and no BSP and fails to load. The sandbox index answers 'converted' for it as well, so the developer picks it as available.
- Suggested fix: Keep 'converted' as the catalog fact, but derive the row status from the worst step: a row whose steps include failed or gap gets that status and reason even when converted is true. Count such rows in parts.gap, or add a separate 'convertedWithGaps' count. Update CENSUS_RULE_TEXT and the coverage section of OUTPUT_CONTRACT.md, and add a census test with a converted key that has a failed step.
- Checkers: trace:yes/high/warning; refute:no/medium/warning; rules:yes/medium/warning

### CR-06: Collision fails with a wrong 'run --step bsp first' message when the bsp step ended as a known gap

- File: `scripts/world/collision_step.py:239` (bug, slice-05)
- Evidence: `if static_meshes is None or config['bspFingerprint'] is None or unit.movers is None: raise FormatError(... 'run --step meshes, --step bsp and --step movers first')` runs before read_level_model (line 245), which would have returned the LevelModelLayoutError gap. A bsp gap is never sealed, so bspFingerprint is None for good. collision.json holds 41 rows `decode-failed:FormatError:collision of tile:15_2x needs sealed meshes, bsp and movers units; run ...`, and EVIDENCE.md records 40 tile load checks failing with `pins no native-tile-collision resource`.
- Failure: On a tile whose map licensee the level model reader does not review (123/18, 23, 25 or 30), the bsp step has already run and recorded `map-licensee-unsupported`. Collision then reports status failed instead of a gap with the licensee reason, tells the operator to rerun a step that cannot succeed, and writes no collision at all. Terrain and static-mesh collision need no level model, but none is written for those 41 tiles, and the failure triggers the batch cascade above.
- Suggested fix: Read the level model, or the recorded bsp gap, before requiring the bsp seal, and return the step-level gap with the BSP layout reason. Better still, write the chunk collision groups that do not need the level model (SMSH, PLAC, TERR, MOVR) and give the BSPT and VOLS groups a per-group gap row.
- Checkers: trace:yes/high/warning; refute:no/medium/warning; rules:yes/medium/warning

### CR-07: Batch seal inspection counts any seal as current, so stale units are never redone and their rows read as current

- File: `scripts/world/eligible_tile_selection.py:52` (bug, slice-05)
- Evidence: sealed_unit_step uses a ledger with SEAL_INSPECTION_ALGORITHM_VERSION=1 and `ledger.sealed_receipt(unit_key)`, which checks neither the fingerprint nor algorithmVersion. convert_tile_batch.tile_has_work/is_step_sealed and tile_rows build on it. All 22 bsp receipts in artifacts/lane-store/world/work hold algorithmVersion 2, while BSP_STEP_ALGORITHM_VERSION is 4, and all 22 tiles have every step sealed. Commit edda6ba says 'the BSP step version moves to 4 so sealed BSP units are re-derived'. STATE.md:428 records this as open.
- Failure: The documented resume command `convert_tile_batch.py --eligible --limit 4` skips the 22 fully sealed tiles and calls them done. It also derives their bsp, collision, bsp-visibility and manifest coverage rows from the v2 receipts. The OB_Normal Opacity translucency fix and any other converter or recipe change never reach those tiles, and coverage reports the old products as current. The same applies in convert_tile.seal_derived_step_row when a rerun returns an unsealed gap but an old seal is still on disk.
- Suggested fix: Have the batch ask each step for its current fingerprint (the step's own `sealed_*` or `current_sealed_receipt` helpers) and treat a seal with another fingerprint or algorithm version as unsealed work.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### CR-08: Engine.MovableStaticMeshActor placements are silently dropped from meshes, collision, light lists and placement audio

- File: `scripts/world/raw_map_extraction.py:54` (requirement-gap, slice-06)
- Evidence: raw_map_extraction.py:54 sets staticMesh and adds a static mesh request only when className == 'StaticMeshActor'. static_placement_plan.py:66 keeps only classObject == 'Engine.StaticMeshActor'. light_actors.py:187 reads instance light lists only for that exact class, and so does placement_audio_inventory.py:31. No step writes a gap row for any other class. The world lane raw products hold 314 Engine.MovableStaticMeshActor actors on 12 converted tiles plus Lobby (18_24: 64, 19_20: 60, 18_20: 44, 19_10: 35, ...). All of them carry a StaticMesh property, and 6 resolve their collision flags from class defaults (Primitive_InDecotree002/003, owl_head, blood001). No doc, test or reason list mentions the class.
- Failure: Run the batch on 18_24: the 64 SSQ_fire002 meshes never reach static-mesh-requests.json, a chunk, the collision resource or the lighting SMLL arrays. Collision for tile:18_24 still records pass, and the meshes object-gaps count leaves them out. The tile renders without those objects, and the coverage report gives no sign that anything is missing. Tiles whose decotree placements block lose that collision with no gap row.
- Suggested fix: Select placements by class chain (subclasses of Engine.StaticMeshActor), not by exact class name. That applies to raw_map_extraction (staticMesh and static_refs), static_placement_plan, light_actors and placement_audio_inventory. Until a subclass rule is qualified, write a per-object gap row with a listed reason (for example placement-class-unsupported:<class>) for every placement actor the steps skip. Add a pipeline test with a MovableStaticMeshActor fixture.
- Checkers: trace:yes/high/critical; refute:yes/high/warning; rules:yes/high/warning

### CR-09: Engine.MovableStaticMeshActor placements are silently dropped: never placed, never gapped, never in collision

- File: `scripts/world/static_placement_plan.py:65` (requirement-gap, slice-07)
- Evidence: static_mesh_actors() keeps only classObject == 'Engine.StaticMeshActor' (line 8, 65-67). raw_map_extraction.py:54 sets actor['staticMesh'] only for className == 'StaticMeshActor', so the StaticMesh reference of a MovableStaticMeshActor never becomes a static-mesh request. static_mesh_step.placement_accounting_difference (static_mesh_step.py:238-241) counts the same filtered list, so its 'every actor placed or gapped' check cannot see the omission. The collision step iterates the same static_mesh_actors(). In the local world lane raw products (43 tiles) there are 311 Engine.MovableStaticMeshActor exports, each with a serialized StaticMesh (e.g. 17_20.MovableStaticMeshActor20 -> SSQ_dungeon_S.SSQ_Original.SSQ_fire002) and 305 of them with serialized bCollideActors/bBlockPlayers. No file under scripts, src, tests, docs or recipes mentions the class.
- Failure: Tile 18_24 has 64 MovableStaticMeshActor exports and 19_20 has 60. None appear in work/tile__18_24/meshes/products/static-meshes.json placements or gapRows, so the meshes row 'object-gaps:294' undercounts. The meshes are not drawn and have no collision, and no gap row names them. On 20_16 (3 movable actors), once the Combiner material adapter lands, the meshes step would read pass while those meshes are missing.
- Suggested fix: Select static-mesh placements by the StaticMesh property (or by the class chain resolved through class defaults), not the exact Engine.StaticMeshActor class. Give each subclass the static-mesh step does not handle, such as MovableStaticMeshActor with its L2RotatorRate motion, a per-object gap row with a listed reason. Extend placement_accounting_difference to count every actor with a StaticMesh reference. Add a test with a MovableStaticMeshActor fixture.
- Checkers: trace:yes/high/critical; refute:yes/high/critical; rules:yes/high/critical

### CR-10: Clip event parser refuses the null notify object and the normalizedTime > 1 that the converter writes, so the native model fails to load

- File: `src/assets/native/actorClipEvents.ts:80` (contract-mismatch, slice-08)
- Evidence: The producer scripts/native_catalog/ue2.py:320-325 (notification_sidecar) writes 'object': event['notifyObject'], and object_name(0) returns None for a function-only notify with no AnimNotify export, which gives type 'unresolved-native-notify'. It also writes normalizedTime as the raw source float with only a finite check. The reader actorClipEvents.ts:80 calls requireText(source, ordinal, "object"), which throws on null, and line 54 accepts normalizedTime only in [0, 1]. NativeCharacterVisual.ts:236 calls parseActorClipEvents(asset.manifest.animationEvents) inside initialize() whenever a clipPreview hub is passed, and createNativeSliceRuntime.ts:198 always passes one. A scan of artifacts/lane-store/actors/l2/*/asset.l2asset found 29 events with object null and 16 with normalizedTime outside [0, 1] (e.g. Elf.MElf_anim Atk01_Hand_MElf event 6: object null, normalizedTime 1.86). They are in interlude:assembly:character-6, interlude:assembly:character-7, Elf.MElf_m001_u/_m002_u/_m005_u, Elf.FElf_m001_u, LineageMonsters.ol_mahum_m00, devastator_m00, batur_orc_m00, monster_eye_m00 and others. The unit test only pairs 'unresolved-native-notify' with a non-null object, so it misses this.
- Failure: Spawn character:6 or character:7 (male or female elf) or NPCs using ol_mahum_m00 / devastator_m00 in the sandbox. initialize() throws ActorClipEventsError 'asset.json animationEvents[6].object is missing or invalid.', the visual records it as loadFailureDiagnostic and disposes itself, and the actor never appears. ACT-04 (marked Complete) and ACT-01/ACT-02 fail for every actor whose animation set has a function-only notify.
- Suggested fix: Make the reader accept exactly what the writer emits: notifyObject string | null, and a finite normalizedTime with no [0, 1] clamp (or a range that comes from the source). Add a unit test built from a real ue2.py sidecar row with object null and normalizedTime 1.86. Also consider building the clip listing lazily so a listing failure cannot take down actor loading.
- Checkers: trace:yes/high/critical; refute:yes/high/critical; rules:yes/high/critical

### CR-11: Every sprite draws as a camera-facing billboard: UseDirectionAs and ProjectionNormal are ignored, and no gap is reported

- File: `src/effects/particles/render/particleMaterialBinding.ts:85` (requirement-gap, slice-09)
- Evidence: The PARTICLE_SPRITE vertex stage (lines 85-93) builds the corners from cameraRight/cameraUp only. particleInstances.ts:68 writes an identity basis for sprites and passes no direction. UseDirectionAs is read only to force UniformSize (spriteEmitter.ts:30). ProjectionNormal is parsed (emitterRecords.ts:83) and never read. listUnportedEmitterFeatures (particleEmitter.ts:38) does not list UseDirectionAs. The plan reference defines a basis for each mode (.planning/reference/lineage2js/04-particles.md:206 and 391, plus a required PTDU_Up test at :387). Lane-store staged manifests: 46 of 113 SpriteEmitter components use UseDirectionAs Up (22), Normal (18) or Forward (6). They sit in 13 skills that have 719 'pass' rows in artifacts/lane-store/actors/gap-rows/skills.json. Power Strike SpriteEmitter9 is UseDirectionAs=Up (04-particles.md:297).
- Failure: Cast skill 4, 8, 18, 69 or any skill whose sprite has UseDirectionAs=Up, Forward or Normal. Streaks that L2.exe stretches along the particle motion, and quads that lie on the ProjectionNormal plane, are drawn as screen-facing quads. The census says pass and the playback featureGaps list is empty, so nothing names the difference before the Phase 3 side-by-side check.
- Suggested fix: Port the direction bases in the sprite vertex stage: per-instance direction from Location - OldLocation, and ProjectionNormal per emitter. Add the PTDU_Up test the plan specifies. Until that lands, add UseDirectionAs outside None and Scale to listUnportedEmitterFeatures, so it reports emitter-feature-unported:UseDirectionAs.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### CR-12: Tile visibility, lighting, movers and emitters are bound once, to the startup chunks only, on the streamed tile route

- File: `src/scene/world/streamNativeTileChunks.ts:100` (requirement-gap, slice-11)
- Evidence: Lines 92-100 take `activeResidency.residentChunks()` once after `ready()` (only the initial collision ring: requiredCellIds within 2 chunk edges, worldResidencyRing.ts:81, nativeTileChunkResidency.ts:175) and pass those bspChunks, instances and terrain meshes to `attachNativeTileSystems`. No caller attaches or re-binds systems when the residency loads, unloads or reloads a chunk later: attachTileVisibility, bindTileLighting and attachNativeTileSystems are called only here and in loadNativeTileChunks. babylonTileVisibilityTargets.sectionMeshes (line 92) returns a gap as soon as any BSP range names a chunk ordinal that is not in the passed chunks. bindTileLighting plans lightmaps only for the meshes it receives. Neighbour-tile chunks never get their own systems.
- Failure: (1) Open `?map=XX_YY` where the PlayerStart lies in an edge chunk, for example column 0, and BSP geometry exists in column 3, which is more than 2 chunk edges away. bspVisibility.gap then reads `bsp-visibility-section-unmapped: range of node N is not in the chunk BSP of chunk K`, so translucent BSP order is off and the gap wrongly blames a valid resource. (2) Walk more than 3 chunk edges (about 246 m) away and back. The startup BSP chunk is disposed and reloaded with plain glTF materials, no UV2 lightmap and no culling or translucent order, while lighting.inspection() still counts its sections as library-compiled. (3) Cross into a neighbour tile: its BSP is unlit, and its movers, emitters and visibility never load. This is the only route createNativeSliceRuntime uses for `?map=`, because it always provides a collision cell context.
- Suggested fix: Bind the tile systems per resident chunk. Attach and detach section and placement targets and lightmap sections in the residency load and dispose path, keyed by tile, and attach each tile's systems when its first chunk becomes resident. Never compute VIS-01 or MAT-02 targets from a startup snapshot. Add a test that loads a chunk after startup and asserts it is lit and bound.
- Checkers: trace:yes/high/warning; refute:no/high/info; rules:yes/medium/warning

### CR-13: Tile lighting and BSP visibility bind once to the startup-resident chunks, so chunks streamed in later stay unlit and unculled

- File: `src/scene/world/lighting/attachTileLighting.ts:66` (requirement-gap, slice-12)
- Evidence: streamNativeTileChunks.ts:97-100 builds bspChunks, instances and terrainMeshes from `activeResidency.residentChunks()` at startup and calls attachNativeTileSystems once. attachTileLighting.ts:87 / bindTileLighting.ts:85 plan and replace materials only for those meshes. attachTileVisibility.ts:52 and babylonTileVisibilityTargets.ts:92 require every RNGE range to sit in a supplied chunk, else `bsp-visibility-section-unmapped`. loadResidencyChunk.ts:99 builds fresh BSP meshes on every chunk load, and the residency disposes chunks beyond the 245.76 m retain ring. No API adds or removes chunks after attach.
- Failure: On `?map=XX_YY` with the PlayerStart in a corner chunk, chunk (3,3) is about 231 m away, outside the 163.84 m collision ring, so it is not resident at startup. (1) If that chunk has BSP, sectionMeshes returns 'range of node N is not in the chunk BSP of chunk 15'. The whole tile loses its visibility binding: no translucent ordering, although VIS-01 says it is on. cameraFrame() also returns null, so computeCameraEnvironment reports camera-zone-unknown and zone distance fog is dropped. (2) When the player walks there, the chunk streams in with its GLB material: no lightmap page, no native material, no hour update. (3) A startup chunk that the player leaves and re-enters is reloaded as new meshes without lightmaps, while the binding keeps updating materials of disposed meshes. The lighting inspection still counts only the startup sections, so nothing reports the unlit chunks.
- Suggested fix: Make lighting and visibility per-chunk bindings driven by residency load and dispose events: plan lightmap sections and visibility targets per loaded chunk, and drop them on dispose. Or have the visibility walk treat ranges of non-resident chunks as absent instead of failing the whole tile. Add a streamed-route test that walks into a chunk that was not resident at startup and asserts it is lightmapped and listed in the inspection.
- Checkers: trace:yes/high/critical; refute:no/high/info; rules:yes/medium/warning

### CR-14: Source heading to world yaw is 90 degrees off the visual facing convention, so MOVE-01 pawns face sideways

- File: `src/world/sourceFrame.ts:34` (contract-mismatch, slice-14)
- Evidence: sourceHeadingToWorldYaw(h) = -h*PI/32768 assumes rotation.y 0 faces world +x (tests/unit/sourceFrame.test.ts:9-38 rotates {x:1}). NativeCharacterVisual.ts:213-215 rotates the asset so its forward is root +z ('yawAligningAssetForwardWithAdapterHeadingZero'), and tests/unit/nativeCharacterVisual.test.ts:117-130 pins root.rotation.y = atan2(x, z) as facing the movement (x, z). worldMovementWiring.ts:147 feeds sourceHeadingToWorldYaw(pawn.heading) into the pose, and EntityRegistry.ts:191 writes it straight to root.rotation.y. pawnRotation.ts:9 sets yaw = atan2(Y, X). I checked with Babylon 9.27.1 NullEngine using the staged forwardAxis [1,0,0]: heading 0 (moving +x) faces [0,0,1], and heading 16384 (moving +z) faces [-1,0,0]. NativeSliceAdapter mixes both conventions in one file: previewAction (line 177) writes atan2(dx, dz), while stop, report-position and cannot-move (lines 195, 200, 206) go through worldYawToSourceHeading and sourceHeadingToWorldYaw.
- Failure: Tap the ground east of the fighter on / or ?map=20_21. The presenter yaw turns to 0, the pose orientation is 0 and the model faces +z while it runs along +x, so it runs sideways. tests/browser/nativeFacing.spec.ts (forward dot displacement > 0.995) would fail, and no Phase 2 record shows it ran after 02-67. After a special-attack preview toward the Musveren (orientation pi/2), a following set-animation emits a stop with heading 49152. That puts the presenter yaw 90 degrees from the visual, and Phase 4 position reports would send that heading to the server.
- Suggested fix: Use one convention: either map heading to atan2 semantics (worldYaw = PI/2 - h*PI/32768, with the inverse to match), or change the visual placement to align the asset forward with +x. Fix sourceFrame.test.ts so it rotates the same forward vector the visual uses, and add a Vitest test that a presenter pose moving along source +X yields a visual forwardDirection along world +x.
- Checkers: trace:yes/high/critical; refute:yes/high/critical; rules:yes/high/critical

## Warnings

### WR-01: Character sound bundles are unreachable and the census reports them silently once the character census exists

- File: `scripts/actors/actor_sound_batch.py:67` (requirement-gap, slice-01)
- Evidence: ActorSoundBundles.keys holds only NPC profile keys and skill keys. ACTOR_SOUND_KEY and BUNDLE_KIND_ORDER accept 'character:N', but actor_rows raises '<key> is not an actor bundle of the actors lane catalog' for it. actor_sound_census writes character {'count': 0, 'skippedReason': character_census_reason}. That reason is None now that docs/parts/player-characters/character-census.json exists.
- Failure: `--actor-sounds character:0` always exits 1. The next actor-sound census reports character count 0 with skippedReason null: player voices and combat sounds are missing with no gap row and no reason, while docs/parts/audio/EVIDENCE.md still says characters are 'skipped (character-census-absent)'.
- Suggested fix: Either build character bundles from the census rows (all four chargrp roles are currently unresolved, so they become listed gap rows) or keep a non-null skippedReason that names the missing route. Remove 'character' from the key pattern until bundles exist.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-02: --output outside the actors lane folder breaks actor sounds and splits catalog records from gap rows and ledger

- File: `scripts/actors/actor_sound_conversion.py:318` (contract-mismatch, slice-01)
- Evidence: convert_actors accepts any require_converter_output folder as --output. built_bundle writes the bundle under store_root/combat-audio/<sha>, then calls file_output_record(self.lane_folder, ...), which uses Path.relative_to. combat_audio_manifest_outputs expects paths that start with ('l2', 'combat-audio'). Separately, every route writes gap rows, ledger receipts and the coverage refresh to the default actors lane, while catalog records go to --output.
- Failure: `--actor-sounds npc:20001 --output artifacts/actors-trial/l2` writes the combat-audio bundle files, then fails with a ValueError (not in subpath) before sealing. For --npc, --item or --character with that output, the trial store gets catalog records while the actors lane gets sealed receipts and gap rows for outputs it does not hold.
- Suggested fix: Refuse any --output other than lane_store_root(actors), or derive the ledger, gap-row and lane-folder roots from the output root.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/medium/warning

### WR-03: Single --npc store write refuses any reconversion because it merges records that must replace

- File: `scripts/actors/convert_actors.py:264` (bug, slice-01)
- Evidence: NpcConversionRun.write_store_records uses merge_catalog_slice for the models and npcProfiles records. That raises 'record ... differs; preserved' when an id already exists with other content. Both ids are stable: npc-model:<sha of selection> and interlude:npc-profiles:<npcId>. asset.json carries converterVersion = implementation_hash(), so any converter change changes the archive SHA. The batch, item and character paths use catalog_with_record_replaced. No test reruns convert_npc after a change.
- Failure: Run `--npc 20001`, then change any converter module and run `--npc 20001` again. The model unit is refingerprinted, reconverted and sealed, and the store write then fails with 'catalog models record npc-model:... differs; preserved'. Every later run is a cache hit that fails the same way, so the CONV-01 single-unit path can write an NPC only once.
- Suggested fix: Use catalog_with_record_replaced for both slices, as npc_batch, item_conversion and character_conversion do. Add a test that converts an NPC, changes the converter hash, and converts it again.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-04: Roots with an unported emitter class are published, so coverage and the catalog index report their keys as converted

- File: `scripts/actors/skill_effect_conversion.py:204` (requirement-gap, slice-02)
- Evidence: converted_root_outcome returns status gap, reason emitter-class-unported:<class> and converted True. write_store_records (lines 229-235) publishes catalog records for every converted root. gap_census.census_row lets catalog presence win ('converted' when a catalog lists it), and buildNativeCatalogIndex answers converted. docs/parts/skills-effects/EVIDENCE.md: lane coverage 'skills-effects 3,064 converted'. That is 2,542 pass plus 522 emitter-class-unported:Engine.BeamEmitter keys.
- Failure: The coverage report and the sandbox list skill:1011:1 (root skill.wh.1011, with a BeamEmitter) as converted and available. ACT-06 and success criterion 3 require it to show as an explicit gap naming Engine.BeamEmitter. The part's converted count is inflated by 522 keys and its gap count understated by the same amount.
- Suggested fix: Do not count a key whose skills-step row is not pass as converted. Either keep emitter-class-unported roots out of the catalog, or make the gap census and catalog index honour the step gap row for skill keys. Add a coverage test with an unported-class root.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-05: Skill effect catalog writer uses a different JSON serializer from every other actors-lane writer, so the lane catalog SHA changes with no content change

- File: `scripts/actors/skill_effect_conversion.py:237` (bug, slice-02)
- Evidence: write_store_records serializes the catalog with native_store.canonical_json.canonical_json_bytes (indent=2, ensure_ascii, trailing newline). These writers all use compact gltf.json_bytes for the same artifacts/lane-store/actors/l2/catalog.json: convert_actors.py:268, npc_batch.py:366, item_conversion.py:181, character_conversion.py:165, actor_sound_conversion.py:344, npc_store_records.py:66 and write_lane_catalog.py:103. The actors lane catalog is compact today. write_store replaces the file whenever the after bytes differ from the before bytes. OUTPUT_CONTRACT: 'an identical one is kept once, so a re-merge leaves the catalog bytes unchanged.'
- Failure: Run an NPC batch, then 'convert_actors.py --batch skills' with every root already sealed. finish() rewrites the same records in indented form and the lane catalog SHA-256 changes. The next NPC or item write flips it back to compact. Each flip orphans the load-check file keyed by the old catalog SHA (artifacts/lane-store/actors/load-checks/<sha>.json), so loads drop to unverified. It also makes coverage.json catalogSha256 disagree with the served lane catalog.
- Suggested fix: Serialize the catalog with the same function as the other lane writers (gltf.json_bytes or one shared catalog serializer owned by catalog_writer). Add a test that a finish() with unchanged outcomes leaves catalog bytes identical.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-06: A missing decoded-tables catalog silently writes a degraded committed inventory

- File: `scripts/build_dat_table_inventory.py:99` (error-handling, slice-02)
- Evidence: read_decoded_table_records returns [] when the catalog path is not a file. build_dat_table_inventory then gives every descriptor-linked table route local-layout-only with status 'layout pinned, not decoded'. validate_dat_table_inventory accepts that, and main overwrites docs/parts/data/dat-table-inventory.json. Gap rows always come from read_gap_rows(REPOSITORY_ROOT, 'data-ui') even when --decoded-tables-catalog names another store.
- Failure: Run 'python scripts/build_dat_table_inventory.py --client E:/Lineage2-client' in a checkout without artifacts/lane-store/data-ui (a fresh lane, or a typo in --decoded-tables-catalog). The committed inventory is rewritten from 37 local-decoded rows to 'layout pinned, not decoded', and the command exits 0. DATA-01 then reads as not delivered, with no error.
- Suggested fix: Refuse when the decoded-tables catalog is missing or has no tables slice. Read gap rows from the same store as the catalog.
- Checkers: trace:yes/high/warning; refute:no/medium/info; rules:yes/high/warning

### WR-07: --output outside the lane folder writes the store and drops the lane gap row, then fails at seal

- File: `scripts/data/lane_unit_outcomes.py:49` (error-handling, slice-02)
- Evidence: convert_tables.py, convert_ui.py and table_name_indexes.py accept --output, and require_converter_output allows any dedicated folder under artifacts/. The ledger always lives in the data-ui lane work root. seal_unit_manifest first calls replace_unit_gap_row (line 48), which removes the unit's lane gap row. It then computes lane_relative_path(ledger, manifest_path) (line 50), which raises LaneUnitOutcomeError for a manifest outside artifacts/lane-store/data-ui. write_pinned_manifest_to_store has already written the manifest and catalog into the other store.
- Failure: Run 'convert_tables.py --client E:/Lineage2-client --table npcgrp --output artifacts/tables-scratch'. The npcgrp manifest and catalog land in artifacts/tables-scratch. The table:npcgrp decode gap row is removed from the lane. The run then dies with LaneUnitOutcomeError and the unit is begun but not sealed. The lane's gap rows and catalog now disagree.
- Suggested fix: Remove the speculative --output option, or require it to be under the lane folder before ledger.begin. Compute the lane-relative output path before any side effect.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/medium/warning

### WR-08: Transient and lock-guard errors are sealed as permanent texture gaps

- File: `scripts/data/ui_texture_step.py:132` (error-handling, slice-02)
- Evidence: TEXTURE_CONVERSION_ERRORS = (ValueError, OSError, subprocess.SubprocessError) (line 28). The caught error becomes 'decode-failed:<ErrorName>', and convert_window_textures seals the unit. That includes ReferenceClientLockError (a ValueError subclass, reference_client_guard.py:16), disk or IO errors, and UModel timeouts (TimeoutExpired). The actors routes (skill_effect_conversion.py:161-165, npc_requests.TRANSIENT_FAILURES) re-raise ReferenceClientLockError and leave OSError and SubprocessError unsealed as failed.
- Failure: A UModel timeout or a full disk during '--step textures --batch windows' seals each affected window with decode-failed:TimeoutExpired or decode-failed:OSError. Every rerun skips those sealed units, so the windows stay gaps for a non-source reason until the algorithm version changes. A changed client file is recorded as a texture gap instead of stopping the run.
- Suggested fix: Re-raise ReferenceClientLockError. Treat OSError and SubprocessError as failed outcomes that are not sealed, as the actors routes do. Seal only FormatError-class decode refusals.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-09: The golden native-table fixture and the contract describe `records` as a list, but the local-descriptor converter writes an object

- File: `scripts/generate_golden_fixtures.py:138` (contract-mismatch, slice-03)
- Evidence: The golden table manifest uses route 'local-descriptor' with `'recordCount': 1, 'records': [{'id': 0}]`, and OUTPUT_CONTRACT.md:202 says 'recordCount equals the length of records'. scripts/data/convert_tables.py:72 writes `'records': decoded_table['data']` for local-descriptor tables. That value is an object such as {'data': 2083, 'string': [...]}, and recordCount comes from tables.decoded_table_record_count (the length of its single inner list). The elbera-adapter route (convert_tables.py:79) writes a list. scripts/native_store/data_ui_table_manifest.py:47 refuses any manifest whose records is not a dict.
- Failure: A reader written against the golden fixture or the documented contract treats `records` as a list. It breaks on every real local-descriptor table, where len(records) is the number of keys (2), not recordCount (2083). Code that follows data_ui_table_manifest refuses the hairgrp and helmetgrp elbera-adapter manifests. The golden fixture, which should pin the output contract, pins a shape that no converter writes.
- Suggested fix: Choose one shape for native-table v1 `records`, for example always the decoded object, with recordCount defined as the length of its single record list. Write it the same way on both routes, update OUTPUT_CONTRACT and regenerate the golden table fixture from the real manifest builder (native_table_manifest) rather than a hand-built dict.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/medium/warning

### WR-10: Class-default cache is never invalidated when the parser or helper changes

- File: `scripts/native_assets_lib/class_defaults.py:175` (bug, slice-03)
- Evidence: cached_class_definition reuses a cached definition whenever `cached.get('schemaVersion') == CLASS_DEFAULT_CACHE_SCHEMA_VERSION and cached.get('identity') == identity`. The identity holds only object, superClass, package, packageSha256 and uelibSha256. It does not include a hash of class_defaults.py (declared_fields, enum ordering), native_catalog/effects.py parse_uc or extract_ue_defaults.ps1, and the cached JSON is trusted without any shape check. The stored scriptSha256 is never checked again.
- Failure: A fix to declared_fields, for example the type of a multi-modifier var, or to the parse_uc enum indexing changes the parsed result. The world lane reruns bsp or sky steps, artifacts/lane-store/world/work/class-defaults/<Class>.json still matches by identity, and program.json is written with the old enum names, ordinals and provenance. Its converter fingerprint and the graphSha256 suggest the current code produced it.
- Suggested fix: Add an implementation hash of class_defaults.py, native_catalog/effects.py (parse_uc) and extract_ue_defaults.ps1 to the cache identity, or bump the schema version from that hash. Validate the cached definition's fields before using it.
- Checkers: trace:yes/high/warning; refute:yes/medium/warning; rules:yes/high/warning

### WR-11: Four static-material licensees count as reviewed, but their evidence cites real-client cases that do not exist

- File: `scripts/native_assets_lib/static_materials.py:25` (requirement-gap, slice-03)
- Evidence: LAYOUT_REVIEWED_LICENSEES = (16, 19, 20, 22, 23, 25, 28, 30, 31). layout_reviewed_version_evidence() gives each of them 'realClientCases': 'tests/pipeline/fixtures/static-material-versions.json'. That fixture holds cases only for licensees 0, 12, 14, 15, 16, 18, 22, 23, 25 and 31, so 19, 20, 28 and 30 have none. tests/pipeline/test_static_material_reviewed_versions.py:43-44 skips every layout-reviewed version (`if version in LAYOUT_REVIEWED_VERSIONS: continue`) and only asserts 20 cases with 280 slots overall. docs/parts/adapter-dispatch/static-mesh-package-census.json marks 56 packages as reviewed:true with these licensees: 123/19 x14, 123/20 x7, 123/28 x32, 123/30 x3.
- Failure: world/static_mesh_step.py:119 lets any package with licensee 19, 20, 28 or 30 pass the static-material-layout gate. Its slots are read with the FStaticMeshMaterial layout, which has never been checked against those packages, and the tile step is recorded as pass, not as gap `static-material-layout-unreviewed:123/<n>`. The coverage report then counts those tiles as converted, backed only by an evidence record that names a fixture with no case for them.
- Suggested fix: Remove 19, 20, 28 and 30 from LAYOUT_REVIEWED_LICENSEES until a real-client case or an equal Elbera cross-check row exists for each. Make reviewed_version_evidence_problems require at least one VERSION_CASES row for every layout-reviewed licensee.
- Checkers: trace:yes/high/warning; refute:yes/medium/info; rules:yes/high/warning

### WR-12: The Python tile validator accepts manifests the browser reader refuses

- File: `scripts/native_store/tile_manifest_validation.py:168` (contract-mismatch, slice-04)
- Evidence: require_tile_resources (lines 168-184) allows the same kind several times and any hash-addressed path. OUTPUT_CONTRACT.md says 'One kind may appear several times'. The TS reader nativeTileManifest.ts:58 and :96 refuses a repeated kind other than world-audio, and :99 requires the exact per-kind template (for example /l2/skies/<sha>/manifest.json). require_component_resource (224-228) accepts any hash-addressed terrain, bsp or collision path, while nativeTileChunkManifest.ts:138 and :147 require native-tile-chunk-terrain/terrain.glb and native-tile-chunk-collision/asset.json. require_chunk_models (231-245) accepts a model with placements [] and has no cap. The TS reader (:184, :180, :192) refuses empty placements, more than 1,024 models and more than 4,096 placements, and validates every placement field. The Python validator checks none of these.
- Failure: A world step writes a tile with two minimap resources, or a model whose placements are all filtered out to []. validate_tile_manifest and validate_tile_chunk_manifest pass, the tile record enters the catalog and coverage counts the tile converted. readNativeTileManifest or parseNativeTileChunkManifest then throws in the browser, and the tile fails to load. The current world lane data happens to avoid these shapes, so the drift is latent.
- Suggested fix: Give the Python validator the same per-kind path templates, repeatable-kind set, non-empty placements, placement field checks and model and placement caps as the TS reader, from one shared vocabulary file. Correct the 'One kind may appear several times' sentence in OUTPUT_CONTRACT.md, and add paired Python and TS refusal tests.
- Checkers: trace:yes/medium/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-13: require_equal_file_with_locked_sha256 returns None on the reference root, and callers handle that None differently

- File: `scripts/reference_client_guard.py:101` (contract-mismatch, slice-04)
- Evidence: On the locked reference root (IMPORTA-PC C:/Lineage2-client), requires_lock is False and the function returns (path, None) (lines 101-102). converter_source_digests.py:10 and native_catalog/cli.py:115 hash the file in that case. world/world_audio_step.py:128-133 instead treats None as 'not lock-equal'. reader_cross_check_rows.py:155 records lockSha256: null.
- Failure: Run the world audio step on IMPORTA-PC against C:/Lineage2-client. core_library_radius receives locked_sha256 None, skips system/Core.dll and records the gap 'reference-file-not-lock-equal:system/Core.dll', although that file is the reference itself. The tile's audio radius is then reported as a gap with a false reason, and reader cross-check rows written there carry lockSha256 null.
- Suggested fix: Return a real SHA-256 on both branches: hash the file through sha256_of_file_cached_by_identity on the reference root. Alternatively, rename the function so callers cannot read None as 'not lock-equal'. Add a guard test for the reference-root branch through world_audio_step.
- Checkers: trace:yes/medium/warning; refute:yes/high/warning; rules:yes/medium/warning

### WR-14: Converter point-to-leaf rule falls back to the other leaf; the runtime locateZone does not

- File: `scripts/world/bsp_leaf_membership.py:38` (contract-mismatch, slice-05)
- Evidence: leaf_for_point uses `node.i_leaf[side] if node.i_leaf[side] != INDEX_NONE else node.i_leaf[1 - side]` and takes the zone from that leaf. src/scene/world/bspVisibility/core/locateZone.ts returns `nodeLeaf[node*2+side]` and `nodeZone[node*2+side]` with no fallback. The recipe row `locate-tie` describes the fallback. The tie test also differs: Python `plane_dot >= 0` in double, TS `Math.fround(dot) < 0`.
- Failure: Take a light actor or member centre just on the solid side of a leaf node, where the front leaf is -1 and the back leaf is L. The converter puts it in zone leaves[L].zone (light_actors.py:110 and the visibility_members sky flag). The runtime locates a camera at the same point in nodeZone[front] with leaf -1. Converter-time zone membership and the runtime camera zone then disagree for the same position.
- Suggested fix: Give the locate rule one owner: either drop the fallback in Python, or implement the recipe's fallback in locateZone.ts. Add a shared fixture case that both test suites assert.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-15: PhysicsVolume subclasses are silently left out of collision while the collision step reports pass

- File: `scripts/world/collision_step.py:178` (requirement-gap, slice-05)
- Evidence: volume_records keeps only `actor['classObject'] in context['rules'].volume_classes`, an exact match against ['Engine.BlockingVolume', 'Engine.PhysicsVolume'] in collision-declaration-rules.json. Gameplay.WaterVolume, a PhysicsVolume subclass (EVIDENCE.md:42), is dropped with no gap row. lighting.json reports `lighting-water-volume-unlinked:Gameplay.WaterVolume` on 18 tiles, and collision.json reads `pass` for 10 of them (16_12, 17_12, 18_11, 18_12, 18_17, 18_24, 19_10, 19_14, 20_10, 20_14).
- Failure: On tile 18_11 the native-tile-collision VOLS group has no WaterVolume and collision coverage reads pass, so MOVE-01 swimming over converted collision never finds water. WORLD-08 asks for PhysicsVolumes and for an unreadable object to be a per-object gap. Here the object is neither exported nor listed as a gap.
- Suggested fix: Match volume classes through the class chain (as light_actors does with is_subclass) and map each subclass to its kind code. Until then, write a per-object collision gap row for every PhysicsVolume subclass actor that is skipped.
- Checkers: trace:yes/high/warning; refute:no/medium/info; rules:yes/high/warning

### WR-16: Single-step command writes the manifest step's foreign pending rows over other steps' recorded gap or failed rows

- File: `scripts/world/convert_tile.py:49` (contract-mismatch, slice-05)
- Evidence: main records every row run_tile_step returns: `for row in rows: record_tile_step_gap_row(REPOSITORY_ROOT, row)`. For --step manifest, tile_manifest_step_rows returns `step-pending:<step>` rows for every unsealed step in PENDING_TILE_STEPS, including 'terrain-material', which has no registered converter. The batch keeps only its own step's row (own_step_row). The world lane gap-rows/terrain-material.json holds 11 rows written this way, so only tiles converted through convert_tile.py carry that permanently pending step.
- Failure: `convert_tile.py --map 15_20 --step manifest` replaces bsp.json's `gap map-licensee-unsupported:123/25` row and collision.json's failed row with `pending step-pending:bsp` and `step-pending:collision`. Coverage loses the real gap reason, and the tile's step list now differs from batch-converted tiles.
- Suggested fix: Record only the row of the requested step, as the batch does, and leave other steps' rows to their own runs.
- Checkers: trace:yes/high/warning; refute:no/medium/info; rules:yes/high/warning

### WR-17: A step that raises records no row, so an older pass row stays in coverage

- File: `scripts/world/convert_tile.py:51` (error-handling, slice-05)
- Evidence: When run_tile_step raises OSError or ValueError, main prints 'Tile conversion failed' and returns 1 without calling record_tile_step_gap_row. The batch's step_result catches the same error and records a `decode-failed:<type>:<message>` failed row. test_the_single_step_row_follows_the_same_seal_rule_as_the_batch shows the two drivers are meant to agree.
- Failure: A tile's collision.json row reads pass from an earlier seal. After an upstream change, `convert_tile.py --step collision` raises (for example the 'needs sealed ... units' FormatError). The command exits 1, but collision.json and the refreshed coverage still show pass for a step whose current run failed.
- Suggested fix: Catch the step error the way TileStepRun.step_result does, record failed_step_row for that tile and step, then exit 1.
- Checkers: trace:yes/high/warning; refute:yes/medium/info; rules:yes/high/warning

### WR-18: Water volumes can never link: the collision volume export it reads holds only exact BlockingVolume and PhysicsVolume

- File: `scripts/world/lighting_step.py:119` (contract-mismatch, slice-06)
- Evidence: water_volume_links looks up each Gameplay.WaterVolume by exportIndex in sealed_collision()['volumes']. collision_step.volume_records (line 178) exports only actors whose classObject is in recipes/world/collision-declaration-rules.json volumeClasses, which is ["Engine.BlockingVolume", "Engine.PhysicsVolume"]. The 151 Gameplay.WaterVolume actors on converted tiles are therefore never in that export. Lane gap rows show lighting-water-volume-unlinked:Gameplay.WaterVolume on 18 of the 22 tiles with a lighting row. tests/pipeline/test_world_lighting_step.py:142 hand-builds a collision volume record of class GamePlay.WaterVolume, which the real producer never writes.
- Failure: Every tile with water gets a lighting gap whatever its lighting data holds, and the tile row reports only that first reason. Water fog and the MOVE-01 swimming input are never available, because the volume export that MAT-02 says supplies water volumes contains none.
- Suggested fix: Have the collision step export PhysicsVolume subclasses (resolved through the class chain) with their full transform, as WORLD-08 asks for PhysicsVolumes. Alternatively, change the MAT-02 source of water volumes. Then make the lighting test take its volumes from the real collision producer instead of a synthetic record it never writes.
- Checkers: trace:yes/high/warning; refute:no/high/info; rules:yes/high/warning

### WR-19: Map emitters treat BeamEmitter and VertMeshEmitter as ported, so they never get emitter-class-unported

- File: `scripts/world/map_emitter_records.py:54` (contract-mismatch, slice-06)
- Evidence: 'converted': item['classObject'] in CONVERTED_EMITTER_CLASSES. native_effect_bundle.py:31 defines that set as Sprite, Mesh, Beam, Ribbon and VertMesh. It records which classes the actor bundle can convert, not which classes the FX-01 port runs. src/effects/particles/sim has Sprite, Mesh and Ribbon simulations only. FX-01 requires BeamEmitter and VertMeshEmitter to be explicit gaps with emitter-class-unported:<class> until they are ported.
- Failure: A tile among the 131 not converted yet places an Emitter whose Emitters array names an Engine.BeamEmitter. The emitters step gives it no gap row and reports pass, although the runtime has no simulation for it. The 22 converted tiles happen to hold only Sprite and Mesh emitters, so the defect stays hidden.
- Suggested fix: Gap map emitters against the set of classes the FX-01 simulation ports (one exported constant owned by the effects port or a shared recipe). Do not use the actor-lane conversion set.
- Checkers: trace:yes/high/warning; refute:no/medium/info; rules:yes/medium/warning

### WR-20: The emitters step reports pass for placements the runtime can never play

- File: `scripts/world/map_emitter_step.py:61` (requirement-gap, slice-06)
- Evidence: tile_map_emitter_row returns pass whenever no gap row was raised. map_emitter_records.emitter_record (line 54) gaps only a class missing from CONVERTED_EMITTER_CLASSES. It keeps authored properties only, without class defaults, with struct fields as unparsedHex and with texture and mesh references unconverted. tileMapEmitterPlacements.ts:48 adds map-emitter-class-defaults-unmerged to every placement and sets playing: false. docs/parts/world/EVIDENCE.md:41 says no placement reaches playTileMapEmitters. The lane gap rows show emitters pass on all 22 converted tiles, which hold 1,118 SpriteEmitter and 63 MeshEmitter records.
- Failure: Coverage and the per-tile steps list emitters: pass on 20_21, so the WORLD-01 item 'placed Emitter actors (played through FX-01)' reads as converted. In fact no map emitter plays on any tile, and the reasons appear only in a runtime inspection that coverage never records.
- Suggested fix: Raise per-object gap rows for what blocks playback: unmerged class defaults, unconverted material and mesh references, and emitter-feature-unported:<property> for raw struct fields. A placement passes only when its record is complete enough for the FX-01 port to run it.
- Checkers: trace:yes/high/warning; refute:no/medium/info; rules:yes/medium/warning

### WR-21: Scaled movers are refused as non-rigid-key-transform, although their key transforms are rigid

- File: `scripts/world/mover_records.py:124` (requirement-gap, slice-06)
- Evidence: endpoint_source_rows builds static_matrix rows that multiply the rotation by DrawScale3D and DrawScale. is_rigid_rows then demands unit rows within 1e-5, so any actor scale fails. In the lane products, 25 of the 79 movers on converted tiles are gapped with mover-unsupported:non-rigid-key-transform. Their DrawScale3D values are Z 1.02 (8), X 1.005 (8), X 0.979 (6), X 0.93 (2) and X -1 (1). BasePos+KeyPos and BaseRot+KeyRot are rigid in every case.
- Failure: About a third of the doors and movers on converted tiles never load and never enter the MOVR collision group. The reason sends triage to the key data, but the actual cause is the actor's authored DrawScale3D.
- Suggested fix: Check rigidity on the rotation and translation of the keys alone, and carry DrawScale and DrawScale3D as a separate source-preserved scale. moverPose in nativeMoverManifest.ts already refuses scale and needs the same change. Until scale is supported, give it its own reason (for example mover-unsupported:actor-scale) and list it in MOVER_UNSUPPORTED_TOKENS.
- Checkers: trace:yes/high/warning; refute:no/medium/info; rules:yes/medium/warning

### WR-22: CollisionRules.placement_class, transform_fields and rows are loaded from the recipe and never read

- File: `scripts/world/static_collision_sources.py:31` (dead-code, slice-07)
- Evidence: load_collision_rules stores document['placementClass'], document['transformFields'] and the rule ids in the NamedTuple (lines 31-51). git grep finds no reader of placement_class, transform_fields or rules.rows in scripts (rows is read only by a TS test of another rules file). Placement selection is hard-coded in static_placement_plan.STATIC_MESH_ACTOR_CLASS, and the transform fields in static_placement.STATIC_TRANSFORM_FIELDS.
- Failure: An owner edits recipes/world/collision-declaration-rules.json placementClass, for example to add Engine.MovableStaticMeshActor, or edits transformFields. The converter output does not change and no test fails, so the recipe claims to govern behaviour it does not control.
- Suggested fix: Drive static_mesh_actors and resolved_transform_values from the recipe fields, or delete placementClass and transformFields from the recipe and the NamedTuple (AGENTS.md: no dead code).
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-23: Static mesh collision depends on the visual model conversion, so material-adapter failures delete collision

- File: `scripts/world/static_collision_sources.py:121` (requirement-gap, slice-07)
- Evidence: decide_placement_collision returns gap 'field:nativeSlotProperties' when model_slot_properties is None, which collision_step.py:128-132 passes whenever the placement has no converted model. static_mesh_collision_triangles reads triangles and slot extras only from the converted render GLB. Visual-only failures therefore remove collision: across the sealed world meshes products, 2,543 placements fail with 'No diffuse material adapter for Combiner' and 1,368 with 'UModel cannot safely select this duplicate leaf name'. The sealed collision products hold 1,249 decisions 'gap field:nativeSlotProperties'. WORLD-08 asks for collision from source declarations (EnableCollision, the mesh's serialized collision data), kept apart from visual output.
- Failure: A rock StaticMeshActor whose mesh uses a Combiner material fails visual conversion. The collision step then has no GLB, records it as collision-unreadable, and the MOVE-01 pawn walks through the rock, even though its geometry and EnableCollision flags are readable from the package.
- Suggested fix: Read collision triangles and per-section EnableCollision from the StaticMesh export (sections, index and vertex streams, or the serialized collision triangles and kDOP data) through a collision-only reader. If the UModel route stays, export geometry for collision even when a material adapter is missing, and record the material failure only on the visual step.
- Checkers: trace:yes/high/warning; refute:no/medium/info; rules:yes/medium/warning

### WR-24: One unsupported terrain material layer fails the whole tile, blocking geometry, meshes, BSP, collision and the tile manifest

- File: `scripts/world/terrain_chunk_step.py:178` (requirement-gap, slice-07)
- Evidence: layer_records() (terrain_layers.py:81-84, 102-103) raises FormatError for any XZ/YZ layer (TextureMapAxis 1 or 2), any pan, or a half-filled slot (tile_layer_summaries, terrain_chunk_step.py:55-56). It is called inside the same try block as the height and topology reads, so the whole terrain step returns 'failed' unsealed. The layer data only reaches glTF extras: the runtime draws terrain with the neutral inspection material, and terrain-material is a pending step. The world lane gap rows show 6 tiles failed this way: 18_23, 19_23, 19_24, 20_16, 20_17 (cliff layers with TextureMapAxis 1/2) and 16_25 ('Terrain layer 10 names only one of Texture and AlphaMap'). On those tiles meshes, bsp, collision and the later steps are 'upstream-step-failed:terrain', and the manifest step fails.
- Failure: Tile 18_23 has layers 9 and 10 with TextureMapAxis 1 and 2. The terrain step fails, no terrain.glb is written, and convert_tile_batch marks every later step upstream-failed. The manifest step raises TerrainChunkStepError, so 18_23 gets no tile.json and cannot be walked, although its heightmap, static meshes and BSP decode.
- Suggested fix: Emit the terrain geometry and collision independently of layer UV support. Record each unsupported layer as a per-layer gap (for example material-feature-unported:TextureMapAxis) under the terrain-material step, or as an object gap row, and keep the layer summary with its status. Only geometry decode errors should fail the terrain step.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-25: OUTPUT_CONTRACT says the typed tile resources are .l2asset packages, but the writer emits a loose asset.json + payload.bin folder

- File: `scripts/world/typed_payload.py:98` (contract-mismatch, slice-08)
- Evidence: docs/OUTPUT_CONTRACT.md:256-259 says native-tile-collision, bsp-visibility and lighting 'are `.l2asset` packages whose `asset.json` records units `source`...'. write_tile_typed_payload_resource writes maps/<sha>/<folder>/asset.json and payload.bin as plain files, with no ZIP_STORED archive and no v2 asset.json fields (schemaVersion, id, files, clientBuild). The asset.json holds only units/axes/sourceSha256/converterVersion/arrays/payload. readTypedPayload (src/shared/typedPayload.ts) reads that loose form.
- Failure: A consumer or validator written against the documented contract (readAssetPackage, the .l2asset limits, the asset.json v2 fields) refuses or misreads these resources. The doc also claims clientBuild provenance that these resources do not carry. AGENTS.md requires the doc to be fixed in the same change.
- Suggested fix: Update OUTPUT_CONTRACT.md to describe the typed payload folder (asset.json fields, payload pin, 4-byte alignment, no schemaVersion), or make the writer produce real .l2asset v2 packages.
- Checkers: trace:yes/high/info; refute:yes/high/info; rules:yes/high/warning

### WR-26: NPC and item catalog-key rules in TS/Python differ from OUTPUT_CONTRACT

- File: `src/assets/native/loadNativeNpcProfiles.ts:35` (contract-mismatch, slice-08)
- Evidence: OUTPUT_CONTRACT.md:144 and :152-154 say modelCatalogId matches ^[a-z0-9][a-z0-9:-]{0,95}$ and that a profile without it keeps the single-mesh join. The writer (native_actor_profiles.py:31) and the TS reader (loadNativeNpcProfiles.ts:29) require ^npc-model:[a-f0-9]{64}$, while catalog_index_keys.py:21 still uses the loose doc pattern. TS throws for any bundle other than 'native-npc-profiles' whose profile lacks modelCatalogId (line 35), but Python joins it by mesh. The TS legacy join (nativeNpcModelJoin.ts:21) ignores npc-model:* models, while Python model_ids_by_source_object counts them and raises CoverageReportError on more than one match. The doc's item: row omits the interlude:item:<id>:body-part:<bp>:weapon|armor:<race> model-record route that both nativeCatalogIndex.itemModelLookups and catalog_index_keys.item_model_keys use.
- Failure: A lane NPC profile pack without modelCatalogId passes the Python coverage and merge checks but makes loadNativeNpcProfiles throw in the browser, so the whole catalog index is unavailable. A legacy profile whose mesh also has an npc-model:<sha> record joins in TS but aborts the Python coverage report.
- Suggested fix: Make one rule: the same modelCatalogId pattern and the same missing-field and legacy-join behaviour in catalog_index_keys.py and the TS reader, and document both the npc-model:<sha> form and the item model-record route in OUTPUT_CONTRACT.md.
- Checkers: trace:yes/high/warning; refute:yes/medium/info; rules:yes/medium/warning

### WR-27: Two readers parse the same glTF extras key nativeMaterialProgram with incompatible shapes

- File: `src/assets/native/nativeSkeletalMaterials.ts:34` (contract-mismatch, slice-08)
- Evidence: The only producer, scripts/world/bsp_chunk_geometry.py:187, writes extras.nativeMaterialProgram as an object {directory: 'native-materials/<sha>', programSha256}, and src/scene/world/lighting/surfaceMaterialProgram.ts:11-13 reads that object. nativeSkeletalMaterials.ts:27-38 reads the same key (SKELETAL_SLOT_PROGRAM_EXTRAS_FIELD) as a bare 64-hex string and throws on anything else. docs/parts/skills-effects/EVIDENCE.md:114 says no actor GLB writes it yet, so this branch has no producer.
- Failure: When the actor converter starts writing the program pin the way the existing converter does (the object form), every actor load throws in bindSkeletalSlotMaterials with "nativeMaterialProgram {...} is not a material program SHA-256". No character or NPC renders at all.
- Suggested fix: Give the extras pin one owner: a shared reader (one shape, one validation) used by both surface and skeletal binding, and write the actor pin in the same shape. Or drop the skeletal program branch until an actor producer exists (no speculative path).
- Checkers: trace:yes/medium/warning; refute:yes/medium/warning; rules:yes/high/warning

### WR-28: Converted per-actor sound bundles (actor-sounds:<key>) are never loaded at runtime

- File: `src/audio/loadNativeCombatAudio.ts:126` (requirement-gap, slice-08)
- Evidence: loadNativeCombatAudio loads only id 'native-combat-audio' by default, and its single caller (runtime/loadNativeSliceAudio.ts:25) passes no id. The actors lane catalog has 26 combatAudio records, all 'actor-sounds:npc:<id>' (e.g. actor-sounds:npc:12077, npc:20001). No src code requests an actor-sounds bundle. The only reference to the prefix is combatAudioRoleRouting.ts:6, whose branch can therefore never run in production.
- Failure: Spawn NPC 12077 in the sandbox and attack it: its converted, exactly bound combat sounds (bundle actor-sounds:npc:12077) are never fetched, so the developer cannot 'hear the sounds bound to its bundle' (Phase 2 success criterion 2). Only the hand-typed 20_20 bundle can play, and coverage counts the bundle as converted.
- Suggested fix: Resolve the combat bundle from the spawned actor's catalog key (actor-sounds:npc:<id> / character:<n>) and load it per entity. Then delete the generatedActorSoundBundlePrefix guard if it stays unreachable, or cover it with a runtime test.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-29: BlendBetweenSubdivisions is simulated but never drawn: the next-cell cross-fade is dropped

- File: `src/effects/particles/render/particleInstances.ts:52` (requirement-gap, slice-09)
- Evidence: atlasRectangle returns only the current cell's scale and offset, and the particle fragment shader samples one texel. SpriteAtlasCell.nextCell and blendWeight come from the corrected-interlude fx.atlas-cells row (spriteEmitter.ts:51-52), and grep finds no reader outside spriteEmitter.ts. The plan asked for a per-instance buffer holding the next-cell UV and the weight (04-particles.md:391). Lane store: 20 sprites set BlendBetweenSubdivisions on a multi-cell atlas, in 8 skills with 454 pass rows.
- Failure: An atlas-animated sprite with BlendBetweenSubdivisions=true jumps from cell to cell instead of cross-fading by the byte-truncated weight. No gap or unresolved field reports this.
- Suggested fix: Upload the next-cell offset and the weight as a per-instance attribute and mix two samples in the particle fragment stage, with a Vitest test. Until then, report emitter-feature-unported:BlendBetweenSubdivisions.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-30: The live emitter rotation is applied to world-stored (Spray and Independent) particles, so Spray particles are rotated twice

- File: `src/effects/particles/render/particleInstances.ts:65` (bug, slice-09)
- Evidence: writeParticleInstances rotates every stored location (line 65) and every mesh axis (line 73) by the actor's current emitterRotation. It ignores ParticleEmitterSimulation.storageSpace, which is computed at particleEmitter.ts:139 and has no renderer reader. Spray particles are already rotated by emitterRotation at birth (particleSpawn.ts:102 sprayRotation) and are stored in world space (fx.world-space-storage). Lane store: lineageeffect.sp_decay_ca SpriteEmitter9 and SpriteEmitter11, mo_reflect_damage_ca.SpriteEmitter2 and mo_reflect_damage_ta.MeshEmitter5 are Spray emitters in bRotEmitter actors. They belong to skills 86 and 102 (139 pass rows).
- Failure: In a bRotEmitter actor, a Spray particle born at rotation R0 is drawn at R(t)*R0*p. Released particles keep orbiting with the emitter instead of flying off on their birth heading, and mesh particles also turn with it.
- Suggested fix: Apply emitterRotation only when storageSpace is 'owner'. Add a test with a Spray emitter under a nonzero RotPerSecond.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-31: A ForcedMaxParticles shrink after initialization leaves frozen particles that are drawn forever and keep the emitter alive

- File: `src/effects/particles/sim/emitterNatives.ts:76` (bug, slice-09)
- Evidence: After initialization, forcedMaximumParticles returns Math.min(forced, columns.capacity). That value can be below counters.activeSlots or nextSlot, and it can be negative. updateParticles visits only min(activeSlots, MaxParticles) slots (particleUpdate.ts:173). listLiveSlots (particleState.ts:130) still lists every active slot up to min(capacity, activeSlots). spawnIntoNextSlot can still write slot nextSlot >= MaxParticles before it wraps. Only the path before initialization is tested (emitterNatives.test.ts:31-42).
- Failure: An emitter with MaxParticles 10 runs until all 10 slots are active. AdjustparticleLife then forces MaxParticles to 4. Slots 4-9 are never aged or killed and stay drawn as frozen particles. activeSlots - deadCount stays above 0, so the emitter never reports dead and an AutoDestroy actor is never destroyed.
- Suggested fix: On a shrink after initialization, clear the active flag of slots >= the new MaxParticles and clamp activeSlots and nextSlot (or keep visiting the full capacity). Add a test for the shrink.
- Checkers: trace:yes/medium/warning; refute:no/medium/info; rules:yes/medium/warning

### WR-32: The skill census marks effects pass that the runtime refuses, and nothing ever writes emitter-feature-unported gap rows

- File: `src/effects/particles/sim/particleEmitter.ts:38` (requirement-gap, slice-09)
- Evidence: bindParticleMaterial (particleMaterialBinding.ts:125) throws 'emitter-feature-unported:UseMeshBlendMode' for any MeshEmitter whose UseMeshBlendMode is true. True is the Interlude class default. listUnportedEmitterFeatures does not list UseMeshBlendMode. scripts/actors/skill_binding_table.py emitter_class_root_outcome (line 131) compares emitter classes only. So no producer writes emitter-feature-unported:<property>, although recipes/actors/gap-reasons.json registers it. In the lane store, lineageeffect.el_ice_bolt_ta MeshEmitter3 and MeshEmitter6 have UseMeshBlendMode=true. They belong to the skill 105 bundle (manifest 3df33a17...), and all 84 skill:105:* rows are status pass.
- Failure: Cast skill 105 at any level. loadEmitterActorPlayback for el_ice_bolt_ta throws inside bindParticleMaterial and the actor never draws. The INT-01 coverage report and the sandbox availability marks still list skill:105:N as pass. A skill that sets UseCollision, UseActorForces, MeshSpawning and so on would also count as pass while only the playback inspect() names the gap.
- Suggested fix: Make listUnportedEmitterFeatures the single owner of feature gaps, including UseMeshBlendMode=true and the other render-side refusals. Have the binding table apply the same rule to the staged component effectiveProperties and write emitter-feature-unported:<property> rows. Have bindParticleMaterial consume that list instead of throwing its own string.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-33: The tested combiner evaluator is a CPU twin no runtime path calls, and the GPU combiner that does render is untested

- File: `src/materials/ue2/model/combiner.ts:99` (test-gap, slice-09)
- Evidence: Only tests/unit/ue2Combiner.test.ts imports evaluateColourExpression, combineColour, combineAlpha and combinerMaskValue. The runtime evaluates Combiner and Shader through the GLSL from fragmentChain.ts combinerColour, combinerAlpha and emitShader (lines 49-107). No test checks colour operations 0-7 or alpha operations 0-4 on that path: ue2Lighting.test.ts checks only the lightmap strings, and material-swatch.spec.ts renders one FinalBlend over a Shader.
- Failure: A change to fragmentChain.ts changes every Combiner material on screen while ue2Combiner.test.ts stays green. Examples: swapping material1 and material2 in operation 5, or dropping the clamp. The repo then has two owners of the combiner rule that can drift apart, against AGENTS.md DRY and no-dead-code.
- Suggested fix: Delete the CPU evaluator, or make it the oracle for the GPU chain by rendering each operation on the swatch harness and comparing pixels. Either way, keep one owner of the combiner rule.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/medium/warning

### WR-34: Display gamma ramp is built but never applied at runtime; the handoff to 02-67 was dropped

- File: `src/materials/ue2/model/displayGamma.ts:30` (requirement-gap, slice-10)
- Evidence: `buildDisplayGammaTable`, `defaultDisplayGammaSettings` and `DISPLAY_GAMMA_ENTRY_COUNT` are imported only by tests/unit/ue2Fog.test.ts. Nothing in src/ uses a gamma PostProcess or ramp. docs/parts/adapter-dispatch/EVIDENCE.md:77 and 02-60-SUMMARY.md:81 say the 'display gamma PostProcess is runtime wiring (02-67)', but no 02-67 plan or summary mentions gamma. MAT-01 says 'the L2 fog targets and the display gamma ramp apply'.
- Failure: Every native frame renders without the UpdateGamma ramp (G 1.2 from Option.ini), so side-by-side checks against L2.exe in Phase 3 show a global brightness and contrast mismatch. The evidence docs make the ramp read as delivered or scheduled, while no plan owns it.
- Suggested fix: Wire the 256-entry table into a final-pass PostProcess (or a 1D LUT) on the native route, with a Vitest test and a Playwright check. Alternatively, record it as an explicit open gap with an owning plan, and correct the EVIDENCE line that assigns it to 02-67.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-35: Model evaluators that nothing at runtime calls; tests pin a CPU twin, not the shader that renders

- File: `src/materials/ue2/model/fog.ts:72` (dead-code, slice-10)
- Evidence: These are referenced only by their own unit tests: `fogFamilyForBlend` (fog.ts:72), `applyFog` and `fogFactor` (fog.ts:89-100; the GPU uses its own GLSL in fragmentChain.ts:155-156 and particleFragmentChain.ts:21), `applyModulate2xLighting` (lighting.ts:7; the GPU uses litColour in fragmentChain.ts:128-131), `environmentMapCoordinates` (modifiers.ts:143; material.ts:152 refuses every TexEnvMap anyway), and the `material-sequence` branch of textureFrames.ts:47-58 (stagePlan.ts:177-181 makes every MaterialSequence a diagnostic, and materialFrame.ts:26 only ever passes `anim-next`). modifiers.ts:123-124 also reports TexEnvMap/TexCoordSource as `evaluated`, while the Babylon factory reports them unported.
- Failure: Someone edits the fog or Modulate2X GLSL. ue2Fog.test.ts and ue2Lighting.test.ts keep passing because they test the unused TypeScript copies, so a rendering regression ships with green tests. AGENTS.md 'No dead code' and 'One owner per piece of logic' are breached.
- Suggested fix: Delete the test-only exports, or make the GLSL the single owner and test it directly (shader source or swatch readback). Let one module decide whether TexEnvMap and TexCoordSource channels are ported.
- Checkers: trace:yes/high/warning; refute:yes/medium/warning; rules:yes/high/warning

### WR-36: Program reader requires a Texture `image` member that no converter writes and the output contract does not document

- File: `src/materials/ue2/model/materialProgram.ts:156` (contract-mismatch, slice-10)
- Evidence: materialProgram.ts:129-137,156 reads an optional `image` {path, sha256, bytes} on Engine.Texture nodes, and stagePlan.ts:110-111 turns any Texture frame without one into `texture-image-absent:<node>`. The only producer, scripts/native_assets_lib/material_program.py:132-139 (`program_node`), writes id/class/status/gapReasons/fields only. No script under scripts/ sets `image` on a program node. docs/OUTPUT_CONTRACT.md:279 describes program.json without any image member. STATE.md:422 and OVERNIGHT-DECISIONS row 693 confirm that all 89 20_21 programs compile to `texture-image-absent`.
- Failure: On a real store, every BSP surface and skeletal slot program that reaches a Texture compiles to a diagnostic. bindTileLighting.ts reports `library-diagnostic` and keeps the GLB material, so lightmaps (MAT-02) and the UE2 library (MAT-01) never draw on any converted tile. Only hand-built test fixtures with `image` reach the compiled path, so the reader and writer can drift with every test still green.
- Suggested fix: Make `program_node` (or the step that writes the texture PNG) emit `image: {path, sha256, bytes}` per Texture node. Document the member in the OUTPUT_CONTRACT native-materials row. Add a pipeline-to-reader contract test that parses a Python-derived program with parseMaterialProgram and compiles it.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-37: Tile mover reader bounds that the converter never enforces turn one mover into a whole-tile load failure

- File: `src/scene/world/nativeMoverManifest.ts:44` (contract-mismatch, slice-11)
- Evidence: The reader refuses moveTimeSeconds > 120 (lines 36 and 44), more than 32 models or 512 movers (lines 34-35 and 124-125), and negative serverObject ids (line 106). scripts/world/mover_records.py qualified_motion only requires `duration > 0` and passes L2ServerObject* values unchecked, and mover_step.py has no count bound. attachNativeTileSystems.ts:45 lets a mover parse error propagate, so the whole tile fails, while lighting, visibility and emitter decode failures degrade to per-tile gaps.
- Failure: A tile with one Mover whose MoveTime is 150 s, or with 33 distinct mover meshes, passes the Python step and the tile manifest validation. In the sandbox `?map=` then fails with 'Native tile mover identity, motion or timing is invalid.', and requireWorld turns that into a failed scene startup instead of a movers gap.
- Suggested fix: Enforce the same bounds in the converter, so such movers become per-object gap rows. In attachNativeTileSystems, turn a movers decode failure into a movers gap like the other systems.
- Checkers: trace:no/medium/info; refute:yes/medium/info; rules:yes/medium/warning

### WR-38: The production tile route (streamNativeTileChunks, readResidencyTile) has no Vitest coverage

- File: `src/scene/world/streamNativeTileChunks.ts:28` (test-gap, slice-11)
- Evidence: No file under tests/ imports streamNativeTileChunks, readResidencyTile or readCatalogTileIds. Coverage is limited to the world-tile-* Playwright specs, which call `test.skip` unless NATIVE_STORE_ROOT=world and a converted 20_21 exists, and they assert on a single tile whose BSP fits the startup ring.
- Failure: Defects such as systems bound only to startup chunks, the neighbour-tile gap handling and the fabricated terrain record ship with no unit test failing. AGENTS requires a Vitest test for every behaviour change.
- Suggested fix: Add unit tests with a stub residency: a chunk loaded after startup is bound to visibility and lighting, a neighbour read failure becomes a streamedTiles gap, and dispose releases every template.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/medium/warning

### WR-39: Tile movers are loaded and drawn, but `NativeSection.moverTargets` has no production reader, so tile doors never move

- File: `src/scene/world/streamNativeTileChunks.ts:126` (dead-code, slice-11)
- Evidence: streamNativeTileChunks (line 126) and loadNativeTileChunks (line 130) set `moverTargets: attached.movers?.targets`, but only tests/unit/loadNativeTileChunks.test.ts reads `section.moverTargets`. The runtime builds door interactions only from the legacy catalog movers: loadNativeSliceWorld.ts:112 calls `loadNativeMovers(scene, section.manifest.terrain.sha256)`. On the tile route that terrain record is fabricated (`terrain: { file: "terrain.glb", sha256: anchorChunk.terrain.sha256, ... }`, line 103), so it never matches and doors are null.
- Failure: Open any `?map=XX_YY` with a movers resource: the mover meshes appear in the closed pose but can never be hovered, activated or animated. Meanwhile a field and a legacy lookup run with a synthetic terrain identity.
- Suggested fix: Wire section.moverTargets into createNativeDoorInteractions on the tile route (through the adapter, see the door finding), or drop the field. Stop calling the legacy loadNativeMovers with a fabricated terrain record on the tile route.
- Checkers: trace:yes/high/warning; refute:no/medium/info; rules:yes/medium/warning

### WR-40: Coverage marks the emitters step pass while the runtime never plays any placed emitter

- File: `src/scene/world/tileMapEmitterPlacements.ts:70` (requirement-gap, slice-11)
- Evidence: Every placement is returned with `playing: false` and the reason `map-emitter-class-defaults-unmerged` (lines 29, 48, 70). The TS reader also derives `map-emitter-struct-unparsed:*` and `map-emitter-resource-unconverted:*` itself. The converter (scripts/world/map_emitter_step.py tile_map_emitter_row) writes `emitters` status `pass` whenever its own gap rows are empty, and those rows include only class-unported, actor-default and reference-not-local reasons.
- Failure: A tile whose Emitter actors all decode gets an `emitters: pass` step row in the tile manifest and the coverage report, yet in the sandbox none of its placed emitters plays. WORLD-01 requires placed Emitter actors played through FX-01, so the coverage reads as converted when the work did not happen.
- Suggested fix: Have the converter write the unmerged class defaults, unparsed structs and unconverted resources as emitters gap rows, so the step is not pass while placements cannot play. Drop the duplicate reason derivation in the TS reader.
- Checkers: trace:yes/high/warning; refute:no/medium/info; rules:yes/medium/warning

### WR-41: isReady treats a position outside every known cell as ready, so a pawn where no collision exists is simulated and falls instead of being held and reported

- File: `src/scene/world/movement/core/collisionWorld.ts:103` (requirement-gap, slice-12)
- Evidence: isReady returns false only when a required, non-resident footprint holds the point; any point outside all footprints returns true. The test 'stays ready outside every missing cell footprint' pins this. movementPresenter.ts:193 holds a pawn only when isReady is false. Decision row 743 records the pawn falling 116.8 m in the 128-unit strip between 17_12 and 18_12 that no cell covers. streamNativeTileChunks.ts:64-70 drops uncatalogued neighbours and neighbours whose read failed, so they are never required.
- Failure: The player walks east off a tile whose eastern neighbour is not in the catalog, or failed to read and sits only in tileGaps. The position is in no required footprint, so isReady is true and the pawn runs with an empty collision set: no floor, it falls indefinitely, and heldReason stays null. MOVE-01 and ARCH-03 require it to be held and reported.
- Suggested fix: Make readiness positive: ready only when a resident cell footprint holds the point. Treat any other point as held with a reason that tells 'not loaded' apart from 'no converted cell', and surface the second as a gap. Update the unit test accordingly.
- Checkers: trace:yes/high/warning; refute:no/medium/info; rules:yes/medium/warning

### WR-42: Unsourced 1-chunk-edge visual ring and LOD cull distance cap draw distance at about 82 m, overriding the most-visible visibility limits

- File: `src/scene/world/worldResidencyRing.ts:39` (source-fidelity, slice-12)
- Evidence: visualRadiusChunkEdges = 1 and lodCullDistanceChunkEdges = 1 give 81.92 m. nativeTileChunkResidency.ts:154 adds addLODLevel(81.92, null) to every BSP and model mesh, and chunks outside the visual ring are removed from the scene. recipes/world/bsp-visibility.json keeps static-mesh-range at runtimeDefault 'infinity' and far-plane at camera maxZ, under VIS-01's rule that a limit with no Interlude source runs at its most-visible value. bindTileVisibility.inspection().limitRules still reports static-mesh-range Infinity.
- Failure: In a town on `?map=`, a building or BSP wall about 100 m from the camera is not drawn, and terrain chunks more than about 82 m from the player's chunk are taken out of the scene, while L2.exe draws them out to fog distance. The dev sheet's visibility limit rows report static meshes as unlimited, so the inspection misstates what is culled, and the Phase 3 side-by-side differs for reasons the rules do not record.
- Suggested fix: Record the residency radii and culling distance as rule rows with status and provenance (owner review), and report the effective draw limit in the visibility inspection. Or derive the visual and culling distance from the sourced far-plane or fog end instead of the chunk edge.
- Checkers: trace:yes/medium/warning; refute:no/medium/info; rules:yes/medium/warning

### WR-43: The UE2 FRotationMatrix built from the sine table is duplicated in the movement core and the particle simulation

- File: `src/scene/world/movement/core/volumeTrace.ts:25` (code-rules, slice-13)
- Evidence: ue2ActorLocalToWorld builds the pitch, yaw and roll rows from rotatorSineFromTable (lines 22-29). src/effects/particles/sim/particleRotation.ts:19-30 (rotatorAxes) computes the same forward, right and up rows from the same table. Both were added in Phase 2. AGENTS.md says 'One owner per piece of logic. Reuse before adding'.
- Failure: A POL-04 correction to the rotator convention, for example sign or table index rounding, applied to one copy leaves volumes and particles rotating differently. Brush volumes and emitters would then disagree for the same Rotation.
- Suggested fix: Move one `rotatorAxes` or rotation-row function into src/shared/math/rotator.ts, which the movement core may import, and use it from both volumeTrace.ts and particleRotation.ts.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-44: The run moveType has two owners: a recipe row in the presenter and hard-coded constants in the adapter

- File: `src/scene/world/movement/movementPresenter.ts:139` (contract-mismatch, slice-13)
- Evidence: The presenter decides `runs: event.moveType === rules.pawn.runMoveType` from the row recipes/world/movement-native-rules.json movement.runMoveType (unconfirmed, 1). NativeSliceAdapter.ts:18-19 hard-codes `walkMoveType = 0` and `runMoveType = 1`, and walk 0 has no rules row or provenance.
- Failure: When POL-04 corrects movement.runMoveType in the recipe, the sandbox adapter keeps sending 1 for run. The presenter then treats every run as a walk: wrong speed, and no run-start handling. No test ties the two values together.
- Suggested fix: Have NativeSliceAdapter read the moveType values from the same parsed rules, or add walk and run moveType rows and import them from one place. Add a test that the adapter's run record makes the presenter run.
- Checkers: trace:yes/medium/info; refute:no/medium/info; rules:yes/high/warning

### WR-45: The speed-unresolved hold turns into a protocol cannot-move after 0.6 s and the hold diagnostic disappears

- File: `src/scene/world/movement/movementPresenter.ts:197` (bug, slice-13)
- Evidence: advancePawn sets heldReason 'speed-unresolved' and still runs emitReports for the local player. advanceOneTick returns the pre-tick simulation, so the pawn does not move while goal stays non-null. checkProgress (positionReports.ts:32-38) then sees less than 2 units of progress in 0.6 s, so emitReports dispatches 'cannot-move' and clears the goal. On the next frame speed is 0, speedUnresolved becomes false and heldReason becomes null. NativeSliceAdapter.ts:189 sends only walk and run speeds, and movement.physicsVolumeIsWater (unknown, true) makes every containing PhysicsVolume water.
- Failure: The local player walks into any PhysicsVolume (water once VOLS carries water volumes). The mode resolves to swimming, swimWalk and swimRun are null, and the pawn freezes as speed-unresolved. 0.6 s later the client dispatches cannot-move, which NativeSliceAdapter turns into a stop. The client has reported a movement outcome caused by its own missing speed data, and the held state is no longer visible in inspection.
- Suggested fix: Skip the stuck rule and position reports while heldReason is set, as is already done for collision-not-ready. Keep speed-unresolved visible until a record that supplies the speed arrives.
- Checkers: trace:no/medium/info; refute:yes/high/warning; rules:yes/high/warning

### WR-46: Shared math exports that only tests use

- File: `src/shared/math/affineMatrix.ts:47` (dead-code, slice-13)
- Evidence: IDENTITY_AFFINE_MATRIX (line 10), multiplyAffineMatrices (47), transformDirection (58) and invertAffineMatrix (62) in affineMatrix.ts, and rotatorSineExact in rotator.ts:85, have no caller in src/. Their only references are tests/unit/sharedMath.test.ts and a tools/reference-overlap listing. AGENTS.md says 'No dead code. Delete unused functions, exports'.
- Failure: No runtime failure, but these speculative helpers break a rule the repository enforces. They also add surface that future code may pick up without a native derivation behind it.
- Suggested fix: Delete the unused exports and their tests. inverseTransposeLinear can stay, since plane.ts uses it.
- Checkers: trace:yes/high/warning; refute:yes/high/info; rules:yes/high/warning

### WR-47: UI-03 (and UI-02's 'filled with sandbox data') read as Complete while windows show no client skin, fonts or labels

- File: `.planning/REQUIREMENTS.md:47` (requirement-gap, slice-14)
- Evidence: UI-03 is checked [x] and the traceability says Complete. It requires 'skin, fonts and icons from the client's converted UI textures'. docs/parts/ui/EVIDENCE.md says 4 of 1,094 references converted, 918 fail on UE2 118 packages, and under Open: 'no window shows its skin' and 'TextBox labels stay label-unresolved'. nativeWindowRenderer.ts:105 marks every TextBox label-unresolved even when the manifest carries textLayout.defaultText or textId. The only sandbox field drawn is the HP gauge width (CP, MP and all text are gaps).
- Failure: A Phase 3 or milestone audit reads UI-02 and UI-03 as delivered and plans CHECK-01 UI screenshots against L2.exe. The sandbox windows are unskinned boxes with no text, so every paired screenshot is a mismatch caused by unconverted input, not by a converter defect.
- Suggested fix: Set UI-03 (and UI-02's fill clause) back to Pending, or split it so the satisfied 'no custom styling' constraint stays separate from the unmet 'skin, fonts and icons converted' deliverable. Keep the 118 package reader and label text as open items tied to the requirement.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/medium/warning

### WR-48: Adapter contract dropped advance() while the decision record and ARCH-02 still freeze five methods including advance

- File: `src/world/GameWorldAdapter.ts:3` (contract-mismatch, slice-14)
- Evidence: Phase 2 (commit d62ef44, plan 02-67) removed advance(deltaTimeSeconds), and gameWorldAdapterContract.test.ts:9 now freezes four methods. .planning/PROJECT.md:50 (which wins over every other doc) still says 'its five methods (getInitialState, subscribe, dispatch, advance, dispose) stay frozen'. REQUIREMENTS.md:20 ARCH-02 says five methods, and docs/ARCHITECTURE.md:19 lists advance and the deleted src/scene/navigation/meshNavigation.ts. The Phase 4 design in .planning/reference/lineage2js/05-network.md:187,256,301,305 drains queued packets in advance(dt) and emits environment in the first advance(). DECISIONS.md has no entry for the change.
- Failure: A Phase 4 implementer follows PROJECT.md and the network notes and writes a Mobius adapter with advance(dt) that drains queued packets and emits environment on first advance. Nothing calls it now (the frozen contract test rejects the method), so no environment event is emitted and queued server records are never applied. Or the implementer re-adds advance and breaks the frozen-contract test.
- Suggested fix: Record the four-method contract as a dated decision, update PROJECT.md:50, ARCH-02, docs/ARCHITECTURE.md (also drop the retired meshNavigation path) and the 05-network notes to say how a transport adapter orders and drains records without advance(). Or restore advance() if Phase 4 needs it.
- Checkers: trace:yes/high/warning; refute:yes/high/warning; rules:yes/high/warning

### WR-49: Run moveType is hard-coded in the adapter while the presenter reads it from the movement recipe row

- File: `src/world/NativeSliceAdapter.ts:19` (code-rules, slice-14)
- Evidence: NativeSliceAdapter.ts:18-19 declares walkMoveType = 0 and runMoveType = 1 and emits them at line 188. movementPresenter.ts:139 decides running with event.moveType === rules.pawn.runMoveType, read from recipes/world/movement-native-rules.json row movement.runMoveType (status 'unconfirmed', to be re-derived under POL-04 or mapped in Phase 4, OVERNIGHT-DECISIONS row 672). That gives two owners for one value (AGENTS.md DRY, single owner).
- Failure: POL-04 or MOVE-02 corrects movement.runMoveType (for example to the Mobius field value). The presenter then reads the new value, but the sandbox adapter still emits 1, so every run request is presented at walk speed (or the reverse) and no test notices.
- Suggested fix: Have the adapter take the run and walk moveType from the same committed movement rules (pass them in with the speed profile), or move both constants into one shared owner. Add a test that the emitted moveType equals rules.pawn.runMoveType when locomotion is run.
- Checkers: trace:yes/medium/warning; refute:yes/medium/info; rules:yes/medium/warning

### WR-50: Unsourced player classes move at an invented 70 UU/s instead of being held as speed-unresolved

- File: `src/world/NativeSliceAdapter.ts:187` (source-fidelity, slice-14)
- Evidence: nativeSliceSpeedProfile (lines 40-46) returns SYNTHETIC_SLICE_SPEED (walk = run = 70 source units/s, 'presentation choice', line 34) for every profile except the two human fighters. moveLocalPlayer (lines 187-190) emits those numbers in the move record's speeds with no unresolved marker. The MOVE-01 presenter already holds a pawn as 'speed-unresolved' when a speed is absent (pawnPhysics.ts:68, movementPresenter.ts:196), but it never sees one. By contrast, a missing collision cylinder is rejected with command-rejected 'local-collision-cylinder-absent' (line 183).
- Failure: Open /?character=human-male-mystic and tap to move. The pawn walks and runs at the same invented 0.7 m/s through the MOVE-01 port. The only signs are a sheet note and the 'unverified' status, while the native route shows procedural motion values (AGENTS.md: no procedural stand-ins, unresolved stays visibly unresolved; ARCH-03).
- Suggested fix: Drop SYNTHETIC_SLICE_SPEED. For an unsourced profile, either reject move-local with a command-rejected 'speed-unresolved:<profile>' reason or omit the walk and run speeds so the presenter's speed-unresolved hold applies, and add a Vitest case for it.
- Checkers: trace:yes/medium/warning; refute:no/high/info; rules:yes/high/warning

### WR-51: WorldNavigation members left unused after meshNavigation was retired

- File: `src/world/WorldNavigation.ts:20` (dead-code, slice-14)
- Evidence: Phase 2 deleted src/world/meshNavigation.ts (and src/scene/navigation/meshNavigation.ts), the only full implementation. The remaining implementation, src/runtime/collisionWorldNavigation.ts, is consumed only by nativeDoorInteractions.ts:63-65, which calls destination() and move(). Nothing in src reads origin, ground(), groundContact?(), spawn() (only tests/unit/worldMovementWiring.test.ts:223 calls it), spawn's occupied parameter, or move().contact. AGENTS.md: delete unused members in the same change that makes them unused.
- Failure: Readers and future adapters keep implementing origin, ground, spawn and an optional groundContact or contact that no production path consumes. The optional contact field suggests footsteps still come from navigation, while they now come from sampleFootstepSurfaceContact.
- Suggested fix: Narrow WorldNavigation to destination() and move() returning {position, blocked}. Drop the unused members from createCollisionWorldNavigation and the test that only exercises spawn.
- Checkers: trace:yes/high/info; refute:yes/high/info; rules:yes/high/warning

### WR-52: Clean-room overlap check never scans the Python converters that the area notes put in scope

- File: `tools/reference-overlap/overlapAreas.json:35` (requirement-gap, slice-14)
- Evidence: Every sourceGlobs entry is under src/ (bsp-visibility: src/scene/world/bspVisibility/**, src/shared/math/*; movement: src/scene/world/movement/**). .planning/reference/lineage2js/02-bsp-visibility.md:396 names scripts/world/bsp_visibility*.py, scripts/world/bsp_leaf_membership.py and scripts/world/level_zones.py as this area's sources, checked against lineage2js un-model.ts and un-static-mesh-actor.ts. 03-movement.md:476 includes 'the collision steps' (scripts/world/collision_step.py, collision_payload_groups.py, static_collision_sources.py, terrain_collision_source.py). sourceTokens.mjs only tokenises JS/TS syntax (no '#' comments).
- Failure: A converter that decodes ULevel.Model nodes or collision hulls by paraphrasing lineage2js un-model.ts passes `referenceOverlap.mjs --area bsp-visibility --require-reviewed` with exit 0, because no Python file is in the corpus. The evidence then reads as a completed DEC-OWN-12 overlap review for VIS-01 and MOVE-01 while the decoder half was never compared.
- Suggested fix: Add the named Python sources to the area globs and teach the tokenizer Python comments and strings, or record a dated decision that converter code is out of overlap scope and update the two reference notes to match.
- Checkers: trace:yes/high/warning; refute:no/medium/info; rules:yes/medium/warning

## Info (not verified, not fixed in this round)

| ID | File | Title |
|----|------|-------|
| IN-01 | `scripts/actors/actor_sound_conversion.py:115` | Decoded-table pins are keyed by source SHA only, so a decoder change needs a manual folder delete |
| IN-02 | `scripts/actors/actor_unit_inventory.py:18` | Census emits constant hair and helmet 'undecoded' units that nothing reads |
| IN-03 | `scripts/actors/actor_unit_inventory.py:78` | Pending census rows use 'conversion-pending' instead of the contract's step-pending reason |
| IN-04 | `scripts/actors/combat_role_routes.py:12` | Combat role routes depend on an uncommitted research file found through a hard-coded main checkout path |
| IN-05 | `scripts/actors/actor_sound_bindings.py:81` | Leaf-name candidate sounds are bound with no gap row, while ACT-05 asks for exact identities |
| IN-06 | `scripts/actors/effect_bundle_packing.py:38` | Pack limit refuses a class closure of exactly MAX_CLASSES that the class reader accepts |
| IN-07 | `scripts/actors/actor_sound_batch.py:17` | Shared constants have several owners |
| IN-08 | `scripts/actors/skill_effect_conversion.py:105` | Skill effect component records omit manifestBytes |
| IN-09 | `scripts/actors/skill_unit_inventory.py:21` | Skill row to gap reason logic has two owners that can disagree |
| IN-10 | `scripts/audit-material-census.py:25` | Material census excludes .u packages while claiming every lock-equal package |
| IN-11 | `scripts/data/ui_texture_step.py:131` | Known unsupported texture packages are sent to the converter and recorded as decode-failed:FormatError |
| IN-12 | `scripts/actors/skill_binding_table.py:145` | The reviewed-source-dispatch key is permanently pending with conversion-pending |
| IN-13 | `scripts/actors/npc_store_records.py:76` | profile_record_npc_ids reads a catalog-pinned manifest without its SHA or byte pin |
| IN-14 | `scripts/check-private-preview-burst.mjs:31` | Private preview checks were rewritten against the legacy map-section-runtime kind, which leaves with the restage |
| IN-15 | `scripts/native_store/catalog_index_keys.py:23` | Skill and item key rules are looser in Python than in the browser index |
| IN-16 | `scripts/native_store/catalog_index_keys.py:21` | Python and OUTPUT_CONTRACT accept a broader modelCatalogId than the writer and the browser |
| IN-17 | `scripts/native_assets_lib/material_program.py:80` | Class-default object references are written as {class, object}, which the browser reference reader refuses |
| IN-18 | `scripts/measure-native-world.mjs:145` | Tile baseline receipts record scenario facts the tile path never checks |
| IN-19 | `scripts/native_assets_lib/world_music.py:104` | MusicVolume brush planes use an identity transform for class defaults that are still unresolved |
| IN-20 | `scripts/native_catalog/cli.py:286` | Two owners of the decoded-table record count, with different rules |
| IN-21 | `scripts/native_catalog/cli.py:219` | --verify on a catalog written before this phase crashes with an uncaught KeyError |
| IN-22 | `scripts/native_assets_lib/asset_manifest.py:94` | The Python asset.json validator accepts manifests that the browser validator refuses |
| IN-23 | `scripts/native_assets_lib/strict_json.py:7` | The shared strict JSON decoder reports every failure as player staging JSON |
| IN-24 | `scripts/native_store/data_ui_table_manifest.py:32` | The item census and actor conversions read decoded tables only from the data-ui lane store, never from the shared store |
| IN-25 | `scripts/native_store/lane_coverage_refresh.py:38` | The refresh at exit runs only for OSError and ValueError, not for every run that stops on an error |
| IN-26 | `scripts/native_store/unit_ledger.py:253` | A sealed unit's outputs are checked only by byte length |
| IN-27 | `scripts/private-preview-targets.mjs:27` | The private-preview burst check enumerates only legacy section resources, not the tile route that / now loads |
| IN-28 | `scripts/stage_native_players.py:28` | Shortened names and triplicated audio staging logic in the touched stage scripts |
| IN-29 | `scripts/world/bsp_surface_materials.py:33` | A BSP surface with no material crashes the bsp step instead of becoming a magenta diagnostic |
| IN-30 | `scripts/world/bsp_leaf_membership.py:65` | zones_for_box is used only by tests |
| IN-31 | `scripts/world/ambient_sound_inventory.py:70` | Inventory accepts AmbientSound at arrayIndex 0 but the emitter row refuses any array index |
| IN-32 | `scripts/world/mover_records.py:110` | The Python mover qualification accepts manifests the TS reader refuses as a whole |
| IN-33 | `scripts/world/map_emitter_records.py:49` | One bad emitter fails the whole emitters step and blocks later unrelated steps for the tile |
| IN-34 | `scripts/world/placement_audio_inventory.py:7` | The tile-general audio step reads its property list from the legacy 20_20 recipe |
| IN-35 | `scripts/world/freeze_world_oracle.py:154` | The world oracle freezes file hashes it never reads |
| IN-36 | `scripts/world/lighting_payload.py:29` | The typed payload size arithmetic is duplicated outside its owner |
| IN-37 | `scripts/world/reader_licensee_layouts.py:62` | Licensee-16 maps are gapped as 'map-licensee-unsupported' although the map readers are reviewed; the blocker is the TerrainInfo reader |
| IN-38 | `scripts/world/tile_chunk_plan.py:139` | Any height-texture decode failure is reported as 'terrain-height-package-missing' |
| IN-39 | `scripts/world/tile_census.py:101` | An unreadable height-package header aborts the whole census instead of gapping the tile |
| IN-40 | `scripts/world/terrain_lighting.py:8` | TerrainSector lighting layout has no recorded source and no licensee gate |
| IN-41 | `scripts/world/sky_step.py:215` | Sky bundle manifest carries no converter version or client build |
| IN-42 | `scripts/world/tile_chunk_plan.py:28` | Duplicated constants and helpers across the slice (DRY) |
| IN-43 | `scripts/world/tile_step_gap_rows.py:24` | The tile step summary row takes the first gap row's status, so a failed row can be reported as gap |
| IN-44 | `src/assets/native/loadNativeWorldAudio.ts:12` | AmbientSoundObject class defaults have two owners |
| IN-45 | `src/audio/combatAudioRoleRouting.ts:8` | The runtime still plays combat sounds through role columns the converter now refuses as unresolved |
| IN-46 | `src/effects/particles/render/mapEmitterPlayback.ts:45` | playTileMapEmitters and its view and settings types have no production caller |
| IN-47 | `src/materials/ue2/babylon/particleFragmentChain.ts:29` | PTDS_Modulated particles throw a RangeError instead of returning a named gap |
| IN-48 | `src/materials/ue2/model/blendTable.ts:156` | The runtime PTDS Translucent and Brighten pairs cite a source file that Phase 2 deleted |
| IN-49 | `src/materials/ue2/babylon/material.ts:29` | MaterialSequence never compiles, but the evidence says it evaluates; its frame branch and several re-exports are dead |
| IN-50 | `src/materials/ue2/babylon/fogUniforms.ts:8` | sourceDistanceToMetres duplicates sourceFrame.sourceDistanceToWorld |
| IN-51 | `src/effects/particles/sim/emitterConstants.ts:84` | The fx.actor-draw-scale row says DrawScale3D is passed to the renderer, but no renderer reads it |
| IN-52 | `src/effects/particles/render/emitterActorPlayback.ts:69` | Subset (component) playback re-seeds the emitters and remaps sibling indices |
| IN-53 | `src/materials/ue2/model/constants/fogConstants.ts:46` | fog.range-unit row prefers the reference 2048 over the client's own 2000, and no code reads it |
| IN-54 | `src/materials/ue2/model/constants/blendConstants.ts:99` | PTDS 3 and 6 runtime pairs cite a file deleted in Phase 2 as their only source |
| IN-55 | `src/runtime/createNativeSliceRuntime.ts:139` | Unused destructured locals in the runtime assembler |
| IN-56 | `src/runtime/attachNativeSliceWorldSheet.ts:108` | Sheet copy and the default collision tile still assume the single 20_20 slice |
| IN-57 | `src/scene/world/nativeTileManifest.ts:58` | Reader allows only world-audio to repeat, while the contract and the Python validator allow any kind to repeat |
| IN-58 | `src/scene/registerSceneShaders.ts:2` | Editor-scene-only loader registrations stay on the eager default route |
| IN-59 | `src/scene/world/nativeTileChunkContents.ts:134` | collisionMeshCount is a stale mesh-collision metric that reads 0 on the streamed route |
| IN-60 | `src/scene/world/nativeMovers.ts:9` | Single-letter and abbreviated identifiers in files touched this phase |
| IN-61 | `src/scene/world/lighting/bindTileLighting.ts:87` | Lightmap UV placement reads the live index buffer that the visibility binding rewrites for translucent sections |
| IN-62 | `src/scene/world/lighting/attachTileLighting.ts:80` | An environment program without type 0 fails the whole tile load instead of becoming a lighting gap |
| IN-63 | `src/scene/world/lighting/worldEnvironmentClock.ts:45` | Fallback environment type 0 is a hard-coded value with no rule row or provenance |
| IN-64 | `src/scene/world/bspVisibility/core/tileVisibilityFrame.ts:63` | A model with no leaves takes the outdoor view instead of showing everything as the design states |
| IN-65 | `src/scene/world/bspVisibility/core/decodeBspVisibility.ts:186` | The decoder does not require RNGE nodes to be reachable from the root, and translucent reordering then zero-fills their indices |
| IN-66 | `src/scene/world/movement/core/decodeNativeTileCollision.ts:247` | The BSPT decode does not validate tree shape or leaf-hull node references; failures surface mid-move |
| IN-67 | `src/scene/world/lighting/decodeTileLighting.ts:107` | The units check cannot fail; readTypedPayload already enforces units 'source' |
| IN-68 | `src/scene/world/movement/core/bspCollisionTrace.ts:90` | Exports with no consumer outside their module |
| IN-69 | `src/scene/world/bspVisibility/bspVisibilityRules.ts:22` | Duplicate status guard for the shared ReferenceConstantStatus type |
| IN-70 | `src/scene/world/movement/core/movementRules.ts:131` | Rule statuses never reach the runtime, and the required `value` field is never read |
| IN-71 | `src/scene/world/movement/movementPresenter.ts:177` | The teleport raise may double-count CollisionHeight |
| IN-72 | `src/scene/world/movement/movementPresenter.ts:87` | A missing NonAttackSpeedRate silently becomes 1 |
| IN-73 | `src/scene/world/movement/core/volumeTrace.ts:32` | No test covers the volume transform with a non-zero PrePivot, pitch or roll, and none cross-checks it against the converter's static_matrix |
| IN-74 | `src/scene/world/movement/core/volumeTrace.ts:39` | volumeWorldGeometry takes an unused `owner` parameter |
| IN-75 | `src/ui/devSheet/equipPicker.ts:37` | The body-part slot null branch cannot run |
| IN-76 | `src/ui/devSheet/DevSheet.ts:158` | Alias API kept in the rewritten DevSheet: setSticky has no callers, and isSticky is read only by a test |
| IN-77 | `src/ui/WorldInterface.ts:98` | The sound cue swallows a synchronous unlock error and calls renderSound on both paths. UI copy keeps em dashes. |
| IN-78 | `docs/OUTPUT_CONTRACT.md:255` | The typed payload container is documented only as '.l2asset packages', and the movement evidence names a loader that does not exist |
| IN-79 | `tools/reference-overlap/referenceOverlap.mjs:164` | A sign-off clears a 20+ token run from blockingRuns, unlike the documented 'blocks the merge' rule |
| IN-80 | `src/ui/nativeWindows/nativeWindowManifestLoader.ts:49` | ui-texture catalog records and native-table-name-index manifests are read but not in the output contract |
| IN-81 | `recipes/data/window-field-bindings.json:9` | HP gauge fill texture is not supported by the source line it cites |

## Dropped by verification

Fewer than two of the three checkers confirmed these; they are not fixed.

| File | Title | Checkers |
|------|-------|----------|
| `scripts/actors/item_requests.py:173` | Coverage counts items as converted although the converter marks their equip slot as undecoded | trace:yes, refute:no, rules:no |
| `scripts/actors/character_requests.py:151` | Hair and helmet join can never bind on the decoded tables, and its gap reason calls a decoded layout undecoded | trace:no, refute:no, rules:no |
| `scripts/actors/skill_effect_conversion.py:176` | A visual root whose skills have no exact skillsoundgrp row is never converted, even though its visual resolves from skillgrp | trace:yes, refute:no, rules:no |
| `scripts/actors/skill_effect_conversion.py:121` | The unbound-component check treats RibbonEmitter as a mesh emitter, so every ribbon root stays refused and unpublished | trace:no, refute:no, rules:no |
| `scripts/native_store/catalog_index_keys.py:144` | Python legacy NPC mesh join differs from the browser join and can fail the whole coverage report | trace:no, refute:no, rules:yes |
| `scripts/native_store/build_coverage_report.py:65` | Building the actors coverage report writes integration gap rows and needs the data-ui lane store | trace:yes, refute:no, rules:no |
| `scripts/stage_native_players.py:113` | The player staging profile shape refuses the documented optional chargrpIndex, and no writer emits it | trace:yes, refute:no, rules:no |
| `scripts/world/convert_tile_batch.py:131` | One failed step marks every later step pending, including steps that do not depend on it, and the tile then stays settled | trace:yes, refute:no, rules:no |
| `scripts/world/bsp_visibility_step.py:157` | An unreadable tile model gives a failed visibility row with a wrong instruction instead of the per-tile gap | trace:yes, refute:no, rules:no |
| `scripts/world/convert_tile_batch.py:253` | Batch skips the coverage refresh on a disk-floor stop or error, and creates a coverage file the contract says a lane run never creates | trace:yes, refute:no, rules:no |
| `scripts/world/environment_program.py:109` | A missing or repeated TimeRatio or StartTime becomes null with no unresolved reason, but the runtime refuses the whole lighting resource | trace:no, refute:no, rules:yes |
| `scripts/world/static_collision_sources.py:96` | Unresolved static-mesh collision selectors (including CollisionModel) still yield decision 'slots' and a passing collision step | trace:yes, refute:no, rules:no |
| `scripts/world/tile_chunk_plan.py:89` | A tile without a PlayerStart gets no manifest, which leaves a hole when walking across tile borders | trace:yes, refute:no, rules:no |
| `scripts/world/convert_tile_batch.py:131` | A failed step marks every later step upstream-failed, so sky and audio never convert when collision fails | trace:yes, refute:no, rules:no |
| `scripts/world/tile_manifest_step.py:326` | Tiles get a catalog record, and so count as 'converted', while collision failed and sky, audio and lighting never ran | trace:yes, refute:no, rules:no |
| `src/effects/castSkillIndex.ts:26` | Two effect components for the same skill:id:level make the whole browser catalog index throw, while the Python key census silently dedups | trace:no, refute:no, rules:no |
| `src/effects/loadEffectComponent.ts:179` | RibbonEmitter counts as simulated in coverage but the browser refuses to load it, and the whole emitter actor fails | trace:no, refute:no, rules:no |
| `scripts/world/tile_music.py:84` | A missing or hash-mismatched encoder becomes a per-tile source gap and withholds the original Ogg bytes | trace:no, refute:no, rules:no |
| `src/effects/particles/sim/emitterNatives.ts:137` | ForcedLifeTime and ForcedMaxParticles emitters play without AdjustparticleLife, and nothing marks them unresolved | trace:yes, refute:no, rules:no |
| `src/runtime/sandboxNpcAppearances.ts:142` | Every converted NPC gets Greater Musveren's literal clip names, matched case-sensitively | trace:no, refute:no, rules:no |
| `scripts/world/bsp_surface_materials.py:67` | Converter translucency flag disagrees with the runtime blend table for modifier-wrapped and bAlphaTexture roots | trace:no, refute:no, rules:yes |
| `src/runtime/sandboxCharacterVisual.ts:111` | Only the profile loaded at startup can be spawned by chargrp index, while the picker reports the others as converted | trace:no, refute:no, rules:yes |
| `src/scene/world/nativeDoorInteractions.ts:59` | Door open state changes locally, outside GameWorldAdapter, and never reaches the collision world | trace:no, refute:no, rules:no |
| `src/scene/world/bspVisibility/core/locateZone.ts:23` | Camera locate skips the documented other-slot leaf fallback that the converter census uses | trace:yes, refute:no, rules:no |
| `src/scene/world/movement/movementPresenter.ts:193` | A pawn is held only when its cell is required but not resident. Where no cell is required, it simulates against empty collision. | trace:no, refute:no, rules:yes |
| `src/ui/nativeWindows/minimapControl.ts:134` | One failing tile minimap turns the whole MinimapCtrl into a single load-failed gap | trace:no, refute:no, rules:yes |
