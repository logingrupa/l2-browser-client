# Genericity audit: is the 20_20 world built by one generic pipeline?

Date: 2026-11-08. Scope: everything that produces the 20_20 world on both routes, SOURCE (`/?world=interlude`) and AUTHORED (`/?world=interlude&authored=1`). This report merges six refuted area audits (map extraction, terrain, models/BSP/movers, Editor scene staging, runtime content) and an empirical run of the scripts on a second tile, 20_21. The work was read-only: no project file, catalog, scene, build, browser or Editor was touched. Outputs are this file, `INVENTORY.json` (merged, deduplicated inventory, 115 steps) and the generator scripts in `synthesis/`.

## 1. Answer

**Warning 7 is true.** The 20_20 world comes from a chain of per-tile, hand-pinned steps, not from one generic pipeline. Of 115 distinct steps, only 9 are both script-only (A) and generic (G). 45 are tile-specific: they need code edits before they would run for another tile. 24 more were hand-qualified on 20_20. 13 other steps also carry hand-qualified pins (12 of them tile-specific), so 37 steps are hand-qualified in total. 15 need a per-tile recipe or selection that a person writes. 33 are hand or interactive changes that no script reproduces.

Four facts carry the verdict:

1. **The world the owner sees is the end of a seven-link correction chain.** The live catalog section `map-20-20-section` points at manifest 2e73654e. That manifest came from 062218e6 through `migrate-native-terrain-runtime.py` (9841a8fa), `derive-native-map-overlap.py` (fdee1286), `derive-native-map-bsp.py` (93139ab0), `derive-native-map-model.py` (e006306d), `derive-native-map-terrain.py` (cbddefef) and `derive-native-map-building.py` (2e73654e). Each step pins its predecessor's exact hash and rewrites `public/l2/catalog.json` in place. The live terrain does not even descend from the migration output: it was built by a hand-typed command from a research raw map (`research/audio-world-20261106/map-correction-first`). The AUTHORED scene adds one-shot capture, a hand-retried import, Editor UI saves, hand restores of files the Editor deleted, and four append scripts.
2. **Every link above the bottom layer failed on 20_21.** 18 scripts failed, on hard-coded `maps/20_20.unr` paths, the pinned map hash 1beddad2, pinned base-bundle hashes, or pinned actor, brush and sector names. When the probe renamed 20_21's file to `20_20.unr`, the hash pin failed next. 9 scripts ran and 1 ran partly, but only with hand-written recipes and a hand-built input lock (section 7).
3. **Even the "generic" bottom layer is format-qualified on 20_20.** The map, heightmap and terrain readers accept only UE123/licensee 28 (`scripts/native_map.py:94-95, :209-210, :306-307`; `scripts/native_map_geometry.py:115-116`). On the fleet client 67 of 153 tile maps are licensee 28. 39 tiles also have a licensee-28 `T_<tile>.utx` (inference: assumes the heightmap is in that package, as on 20_20 and 20_21). The static-mesh material reader accepts a hand-grown licensee list, which rejects 56 of 212 `.usx` packages; on 20_21, 599 of 3,205 placements use rejected layouts.
4. **Not even 20_20 can be rebuilt from committed code.** The retained receipts record implementation hashes (raw 6a397219/e9b3216d, geometry 27b34b7d/8224bce2, converter d878a532) that match no commit; today's code hashes to 67ff8811, b28fb11d and 8035c080. The one recorded procedure says not to run `pnpm assets:migrate` (`terrain-uv-migration-20261106/implementation/COMMANDS.md:25-27`). In the repo, 31 script files, 15 runtime source files, 14 recipes and 56 test files contain a `20_20`/`20-20` literal. 10 scripts and 4 runtime files pin the 20_20 map hash.

What is already generic: the package reader, the raw extractor and terrain section maths (for licensee 28), the indexed-triangle overlap test, the BSP node reader, the migration orchestrator and the fleet stager. On 20_21, `native_migration.py --prove-rebuild` rebuilt all 52 products identically. That layer is a good base for the generic pipeline. It does not build the world today.

## 2. Counts: steps by provenance and genericity

| provenance \ genericity | G generic | P hand recipe | T tile-specific | Q hand-qualified | total |
|---|---|---|---|---|---|
| A script, no human values | 9 | 3 | 2 | 6 | 20 |
| B script + human values | 7 | 7 | 18 | 6 | 38 |
| C correction of earlier output | 3 | 0 | 16 | 0 | 19 |
| D hand / interactive | 12 | 4 | 8 | 9 | 33 |
| U undetermined | 0 | 1 | 1 | 3 | 5 |
| total | 31 | 15 | 45 | 24 | 115 |

How to read it. Each row of `INVENTORY.json` is one canonical step after merging duplicates across areas; every area's own class is kept under `areaClasses`. Synthesis rules:

- **P vs T** answers the probe question: does the step run for another tile once a person writes a new recipe (P), or does it need code edits (T)?
- **Q** means the step runs, but its acceptance pins or its admitted file format were hand-qualified on 20_20. `+Q` in the tables marks T steps that also carry such pins.
- **Runtime gates.** Code constants that only decide what loads are B. Constants that become content or behaviour (positions, speeds, offsets) are D.
- **Rewrites.** A script that rewrites earlier output (catalog, saved scene, bundle) is C, even when its selection was algorithmic.

The 31 G steps are mostly not world extraction: 12 are hand presentation values (camera, lights, speeds, Editor serialization) and 7 are human-chosen policy constants. The area inventories held 217 items before deduplication (map 31, models 38, terrain 32, probe 33, runtime 53, editor 30).

## 3. Tile-specific steps (T, 45)

These would not run for 20_21 without code edits. Most of them are the correction and append chain that produced the live section and the authored scene.

| ID | Step | Class | 20_21 probe | Evidence |
|---|---|---|---|---|
| D05 | scripts/migrate-native-terrain-runtime.py (062218e6 -> 9841a8fa, 735 V scalars, models not reconverted) | C/T | failed: "Geometry is outside the pinned 20_20 source" (16) | scripts/migrate-native-terrain-runtime.py:18-24,90-91,116-122; derivation scriptSha256 609daba8 = current file |
| D06 | TerrainSector247 choice (research audit-adjacent-terrain.py projecting Actor3703; make-candidate-native-xyz.py) | B/T | n/a (research scripts) | research/terrain-extension-20261106/source-audit/audit-adjacent-terrain.py:118-149 asserts [112,240]; make-candidate-native-xyz.py hard-codes sector 247 / export 2516 |
| D07 | scripts/extract-native-terrain-patch.py (ordinary + conditional-corrected candidates) | B/T | failed: missing maps/20_20.unr (15); with 20_21 renamed: "Offline terrain source hash differs" (15b) | scripts/extract-native-terrain-patch.py:20-25,172-208; pins RAW_TERRAIN 86521817, REFERENCE_GLB 39417edb |
| D09 | scripts/derive-native-map-terrain.py (append TerrainSector247: e006306d -> cbddefef) | C/T +Q | failed: output overlap (20), then missing qualification CHECKPOINT-MANIFEST.json (20b) | scripts/derive-native-map-terrain.py:21-40 (pins e006306d, 47fb7020, sector 247), :130 hand-copied 240/4096 |
| D11 | scripts/audit-terrain-uv-branches.mjs (mask-UV sensitivity evidence) | B/T +Q | not run | scripts/audit-terrain-uv-branches.mjs:11-15 audit cd6e8fb6, catalog badd513d, bounds 64/112/208/255; :96 240/4096; :156 mask sizes by index |
| D12 | Runtime terrain-patch acceptance src/scene/world/nativeTerrainPatch.ts (also gates the AUTHORED route) | B/T +Q | not run; 20_21 grid row 0 is at world Y 98304, not the hard-coded 65536 | nativeTerrainPatch.ts:15-16,34-41 (one patch, sector 247), :58-67 (47fb7020/daacf96c), :80-89 (Y 65536, UV formula); loadAuthoredNativeSection.ts:85 |
| D13 | Runtime terrain material builder src/scene/world/nativeTerrainPreview.ts (9 layers, mask sizes by index, packing groups) | B/T | not run; 20_21 alpha maps are 256 at index 6 and 512 at index 8, which fail :187 (inference) | nativeTerrainPreview.ts:109,142,184-209; failure falls back to neutral terrain (loadNativeSection.ts:283-286) |
| D14 | Authored terrain ShaderMaterial frozen in the Editor scene (native-0bb65c1200d37a186ca6fdc0) | B/T | n/a | assets/native-world.scene/meshes/native-34fc990641dc04014d49e47c.json materials[0]: inlined 20_20 matrices, packing, textures under assets/native-generated/062218e6…; identical to 2026-11-05 capture except baseSize metadata |
| D15 | Editor terrain-patch capture (capture-native-editor-terrain.mjs + captureNativeTerrain.ts) | A/T | not run (browser) | capture-native-editor-terrain.mjs:19 exactly one patch; captureNativeTerrain.ts:77-78 GPU renderer string hashed into snapshot 1e3780c2, which seeds the Editor mesh id |
| D16 | scripts/append-native-editor-terrain.mjs (append sector-247 mesh into saved scene) | C/T | plan failed: "explicit distinct manifest and fresh baseline hashes required" (25d) | append-native-editor-terrain.mjs:12,160-170 (PATCH_ID, MAP_HASH), :224 Y origin 65536, :250-257 reuses authored material, :312-317 no longer idempotent on 2e73654e |
| D18 | Visible terrain decorations (DecoLayers grass meshes) | U/T | n/a | no product; only research native-terrain-decorations-20261107/collect.py:38-42 (hard-codes 20_20); DXT3 unsupported (texture_mips.py:16) |
| E03 | Dion tree conversion from hand-written request.json | B/T | n/a | research/map-overlap-expansion-20261106/new-tree-conversion/request.json (one object) |
| E04 | scripts/restore-native-static-normals.py + native_assets_lib/static_normals.py | C/T +Q | failed: "Asset/native normal source differs" (32) | static_normals.py:16,30-34 TREE_PROOF 56fa4c10, version [123,22]; its presence in native_assets_lib changed the converter hash |
| E05 | scripts/derive-native-map-model.py (Actor3703: 93139ab0 -> e006306d, 62/157) | C/T | failed: "Wrong model archive" (19) | derive-native-map-model.py:25-33,66,98,105,111,114,177 |
| E06 | Editor model capture + append for Actor3703 (capture-native-editor-model.mjs, append-native-editor-model.mjs) | C/T | append plan failed: "input identity mismatch" (25b); capture not run (browser) | append-native-editor-model.mjs:11 BASE 93139ab0, API override at :279 not exposed by CLI (:433-437) |
| E08 | scripts/derive-native-map-overlap.py (9841a8fa -> fdee1286, +5 placements) | C/T | failed: "Missing retained input ... maps/20_20.unr" (11) | derive-native-map-overlap.py:19-22 (BASE, BASE_BUNDLE eeec3f15, SECTION), :62 939 files, :140-175 in-place catalog text replace, :183 research class evidence |
| E09 | scripts/append-native-editor-placements.mjs (+5 overlap placements into saved scene) | C/T | plan failed: ENOENT captured-world.json (25a) | append-native-editor-placements.mjs:11-14 (snapshot 230873f5, terrain dac7dd01 -> 39417edb), :122-139 only reuses existing models |
| F02 | scripts/native_bsp_floor.py (Brush397; 10 nodes chosen from screenshot points) | B/T +Q | failed: missing maps/20_20.unr (12); with 20_21 renamed: "Pinned input changed" (13) | native_bsp_floor.py:24-39 (MAP_SHA, SELECTED_NODES 612..668, GLB c0a585fb), :147-170 texture borrowed from GLB slot 11, :299 own hash in content; research inspect_bsp_floor.py:59 screenshot points |
| F03 | scripts/derive-native-map-bsp.py (fdee1286 -> 93139ab0) | C/T | failed: "BSP manifest identity/file set differs" (17) | derive-native-map-bsp.py:19-31 (BASE, 940 files, BSP_ID, SUPPORT_ID), :220,269 shared catalog helpers |
| F04 | BSP floor Editor append + repair-editor-signed-zero.py + material-reference.json | D/T | n/a | research/native-building-floor-20261106/repair-editor-signed-zero.py (asserts d8be7c35, a7fd49e2, 56 normals); material-reference.json has no generator |
| F05 | scripts/native_bsp_building.py (Brush610 walls/floor/ceiling) | B/T | failed like F02 (12, 13) | native_bsp_building.py:20-37 (BRUSH, SUPPORT, part hashes), :169, :176 own hash in content; brush chosen from screenshot point (native-building-walls REPORT.md:9) |
| F06 | scripts/derive-native-map-building.py (cbddefef -> 2e73654e, live section) | C/T | failed: "Unsupported/already-appended base" (18) | derive-native-map-building.py:28-32,51,56-65 (refuses unless 3 Editor-saved materials exist in assets/native-world.scene) |
| F07 | scripts/append-native-editor-bsp.mjs (Brush397 and Brush610 into saved scene) | C/T | plan failed: "invalid BSP snapshot identity" (25c) | append-native-editor-bsp.mjs:13-17 BSP_SOURCES, :273 refuses if Editor-saved material records (87397088, 05f4964e, c6c88a1b) change |
| F08 | Runtime section + BSP validation (loadNativeSection parse caps, nativeBspResources whitelist; also AUTHORED route) | B/T | not run; any other BSP or a whole tile (285 meshes on 20_20) is rejected | loadNativeSection.ts:73 (<=128 models), :92 (no materialOverrides), :97-108 (<=4 BSP, Model798, file stems); nativeBspResources.ts:1-8; loadAuthoredNativeSection.ts:65 |
| G01 | Mover extraction (native_map_movers.py, derive-native-map-movers.py) | A/T +Q | failed: missing maps/20_20.unr (21); renamed: "Mover extraction requires the pinned original 20_20 map" (21b); 20_21 has 3 movers vs 8 pinned | native_map_movers.py:25-35 (MAP_PATH, MAP_SHA, MESH, 8 ACTORS), :202 NumKeys==2; derive script takes no map argument |
| G02 | scripts/stage-native-movers.py (catalog append map-20-20-movers) | C/T | not run (writes public/l2) | stage-native-movers.py:45 "map-20-20-section", :53 binds terrainSha256, :56 "map-20-20-movers", :56-63 refuses changed record |
| G03 | Mover runtime validation and catalog join (nativeMoverManifest.ts, loadNativeMovers.ts) | B/T | not run | loadNativeMovers.ts:59 throws if sourceMapSha256 is not the 20_20 hash, :62-64 doors silently vanish on terrain-hash mismatch; nativeMoverManifest.ts:3,39,48 |
| H01 | Sky extraction scripts/native_sky.py (+ native_batch "sky" adapter) | B/T +Q | failed: missing maps/20_20.unr (29) | native_sky.py:2,25-35,151-157,198-202,257 (exports[389], reference 9184 Model798, zone 28, SKY_ORIGIN); native_batch_adapters.py:308 |
| H02 | scripts/stage-native-sky.mjs (sky nodes into saved scene; public/l2/skies/f7a0b5ef) | C/T +Q | not run | stage-native-sky.mjs:11-14 (f7a0b5ef, SkyZoneInfo0, MAP_SHA), :142,153 exactly 21 files / 3 parts; no world-manifest pin |
| H03 | Sky runtime presentation src/scene/world/nativeSkyPresentation.ts | B/T +Q | not run | nativeSkyPresentation.ts:13-19,32-35,63 (manifest f7a0b5ef, SkyZoneInfo0, 3 meshes); catalog has no skies key |
| I02 | Flame placement list (12 StaticMeshActor ids in nativeFlamePresentation.ts) | B/T +Q | n/a | nativeFlamePresentation.ts:37-39,146,152-153 |
| I03 | Flame billboard audited coordinate table (nativeFlameBillboards.ts) | B/T +Q | n/a | nativeFlameBillboards.ts:46-53 per-actor XYZ+scale, :95 regex ^interlude:20_20\.StaticMeshActor, :128 <=12 |
| J05 | Music ID join (Join-MusicIds.ps1 / Decode-MusicTables.ps1 -> MUSIC_ID_JOIN.json 9dbb003c) | D/T | n/a | research/.../music-id-evidence/Join-MusicIds.ps1:1-6,36-41 (hard-coded export indices, scratch-note path, ran on IMPORTA-PC) |
| K03 | Catalog pointer chain and manifest chain (062218e6 -> 9841a8fa -> fdee1286 -> 93139ab0 -> e006306d -> cbddefef -> 2e73654e) | C/T | every link failed on 20_21 (see derive steps) | public/l2/catalog.json sections[0] map-20-20-section -> 2e73654e; derive scripts rewrite the hash in place (derive-native-map-overlap.py:140-175; derive-native-map-bsp.py:220,269); orphans 67a9ba81, 770c4026 |
| K04 | Staged public state is local, git-ignored and order-dependent (public/l2, public/scene) | D/T | n/a | .gitignore:42 public/l2/, :28 public/scene/; stagers need hand --id and --expected-catalog-sha256 and refuse changed records; catalog.json changed during this audit (2026-11-08 02:06:39, sha 55c12147; inventories cite e19989ad) |
| K06 | Legacy route helpers (sourceColliderPolicy.ts, foliageCutout.ts, worldAssets.ts, terrainSurfaces.ts) | D/T | n/a | sourceColliderPolicy.ts:13-32 hand collider overrides for 17_25 objects; terrainSurfaces.ts:17,189,255 |
| L02 | Editor capture (pnpm assets:editor: native_editor_import.mjs + captureNativeWorld.ts) | B/T | not run (browser) | captureNativeWorld.ts:45 default section map-20-20-section, :64-69 ids from manifest hash + sibling index, :117 material ids by name+index, :145 spawnCandidate!; receipt capture hash baec89b5 vs committed 0ddd4036 |
| L03 | 2026-11-05 import retry: failed write, writer patch, first import moved aside by hand, capture code edit, re-import | D/T | n/a | artifacts/native-parity/editor/world-import-capture.log, write-first.log, write-corrected-orientation.log, first-import-orientation/ |
| L05 | Channel sidecar assets/native-world.scene.native-editor-channels.json (seeded by one-off seed-channel-recovery.mjs, then edited in place) | D/T | n/a | artifacts/native-parity/editor/world-import/seed-channel-recovery.mjs ("wx", one-time); migrate-native-terrain-uv.mjs:131-133 rewrote uv hash; appenders rewrote manifestSha256 to 2e73654e; external copy creation untraced |
| L06 | Editor UI edit: interlude:20_20.StaticMeshActor1771 moved +0.75 m X | D/T | n/a | assets/native-world.scene/nodes/native-1601d53f5ccd4772a5aadab6.json position [0.75,0,0]; docs/NATIVE_EDITOR_WORLD.md:144 |
| L11 | scripts/migrate-native-terrain-uv.mjs (735-value byte patch of the saved terrain binary bc541071 -> 549a7fef) | C/T +Q | not run (assets/) | migrate-native-terrain-uv.mjs:7-33,112-119 (manifest 062218e6; now throws on 2e73654e, inference); input bc541071 exists only because of hand restores |
| L13 | AUTHORED route validators reuse the 20_20 gates (parseNativeSection, validateAuthoredTerrainPatches, sky marker) | B/T | n/a | loadAuthoredNativeSection.ts:65,85; nativeSkyPresentation.ts:32-35 |
| L17 | scripts/share-native-terrain-export-materials.mjs (post-pack dedupe) | C/T | not run | share-native-terrain-export-materials.mjs:13-14 "interlude:20_20.TerrainInfo0.TerrainSector247" |
| M01 | Runtime section selection (loadNativeSection default identity "map-20-20-section"; no ?map=) | B/T | n/a | loadNativeSection.ts:221; createNativeSliceRuntime.ts:188; loadEnvironment.ts:48-56 |
| M09 | Hard-coded "20_20" UI and diagnostic text | D/T | n/a | createNativeSliceRuntime.ts:366,662,819; nativeSliceDebug.ts:56; worldAudioControls.ts:192,256,277,301 |

## 4. Hand-qualified steps (Q, 24 primary + 13 other steps with qualified pins)

A new tile would need the same manual qualification: someone inspects its output and pins counts, hashes or a newly reviewed file format.

| ID | Step | Class | 20_21 probe | Evidence |
|---|---|---|---|---|
| B01 | Raw map extraction logic (native_map.build_map: exports, actors, terrain G16, bitmaps, ambient objects) | A/Q | ran on 20_21 (123/28): partial with map only (01), raw-data-extracted after hand closure (02) | scripts/native_map.py:94-95,209-210,306-307 raise unless UE123/licensee28; census: 67/153 tile maps are 123/28, 39 tiles pass map + T_<tile>.utx gates |
| B03 | Retained base products vs current code (raw 6a397219/e9b3216d, geometry 27b34b7d/8224bce2, converter d878a532) | D/Q | n/a | current hashes raw 67ff8811, geometry b28fb11d, converter 8035c080; verify_map/verify_geometry would demand rebuild (native_map.py:426-427, native_map_geometry.py:564-565); same geometry receipt c993ea81 produced 062218e6/67a9ba81/770c4026 under three converters; git has 2 commits for these files |
| B04 | Live terrain lineage: research raw map map-correction-first + hand-typed native_map_geometry command | D/Q | n/a | public/l2/maps/2e73654e…/map-section/receipt.json rawMapReceiptSha256 4b8c3a7c = research/audio-world-20261106/map-correction-first/receipt.json; terrain-uv-migration-20261106/implementation/COMMANDS.md:10-27 ("Do not substitute full pnpm assets:migrate") |
| C01 | Start-location choice 20_20.PlayerStart10 (GameInfo NavigationPointList rule read by hand) | D/Q | probe picked PlayerStart4 by hand | research/native-location/README.md:8-41; research/native-location/extract.py:38 "20_20.LevelInfo0"; no script implements the rule |
| D01 | Terrain section geometry builder (native_map_geometry / native_terrain / sector_oracle / layer_records) | A/Q | ran on 20_21: 2401 vertices / 4608 triangles, 9 layers; 238/256 sectors with cached-Z mismatch (03) | scripts/native_map_geometry.py:115-119 (UE123/28, one TerrainInfo), :408-411 (no rotation/pan), :618 terrain.json[0], :680-681 (no Inverted), :760/:891 20_20 prose |
| D03 | Texture mip converter format gate (texture_mips.py) | A/Q | not run | scripts/native_assets_lib/texture_mips.py:16 P8/DXT1/DXT5 only, :190 UE123 licensee 20/28/30 only; census: 56 of 152 tile T_<tile>.utx packages pass |
| D04 | Mask-UV correction rule baked into native_map_geometry (20_20 hash, offset [64,208], quads [48,47], layer names) | D/Q | on 20_21 the rule silently does not fire; UVs stay "inspection-candidate" | scripts/native_map_geometry.py:41-54,325-361,641-647; evidence is one capture handoff fe2e05c2 covering X64..112/Y224..255; U term for x>240 has no evidence |
| D08 | Native REA qualification of sector 247 (join_source.py against retained apitrace capture) | D/Q | n/a | research/terrain-mask-native-rea-followup/.../adjacent-terrain-source-join-20261106/join_source.py:13,161-163,186-187; CHECKPOINT-MANIFEST 47fb7020 |
| D10 | scripts/compare-native-terrain-patch.mjs (browser comparison of patch candidates) | B/Q | not run (browser) | scripts/compare-native-terrain-patch.mjs:12-39 hand --ordinary-sha256/--candidate-sha256; imports research browser-probe.ts |
| D17 | Deco-grass footstep bundle and staging (recipes/native-stepsound-surfaces-deco-grass.json, stage_native_stepsound_deco_grass.py) | B/Q | not run | recipe :6-38 T_20_20 alpha maps, expectedCoverage {4,255,255,256,64997,13712}; staging id stepsound-deco-grass-20-20 and single-bundle refusal (:22,:55-56); runtime throws on >1 entry |
| E01 | Section model conversion (Converter; static material reader REVIEWED_VERSIONS; duplicate-leaf guard; blocking failure paths) | A/Q | section A 1/7 models (cruma_s licensee 12, duplicate leaf Dion_swamp_tree01) (04,05); B 11/12 (08); C 20/20 (09); 599/3205 20_21 placements use rejected layouts | static_materials.py:16,68 {16,19,20,22,23,25,28,30,31} hand-grown for 20_20; census 56/212 usx outside; native_assets.py:200-203; one failed mesh blocks the tile (native_migration.py:177-178, stage_native_runtime.py:291-293) |
| E02 | Missing-model bounds scout (missing-model-bound-screen.json, candidate-native-triangle-check.json 56fa4c10) | D/Q | n/a | research/map-overlap-expansion-20261106/bounds-scout/; producer not retained; proof feeds derive-native-map-model.py:31-32, static_normals.py:16, audit-adjacent-terrain.py:116 |
| H04 | Sky environment colour comparison (hand SKYBOX/HAZERING/CLOUD1 bindings, COLOR13, copied Env/timeenv inputs) | B/Q | n/a | nativeEnvironmentTables.ts:6-16; nativeSkyLiteralComparison.ts:12; recipes/native-environment.inputs.json ("Five copied original Env/timeenv inputs") |
| I04 | Flame material graph evaluator (nativeMaterialGraph.ts, client-wide hash pins) | A/Q | n/a | nativeMaterialGraph.ts:30-46,76-81 (FX_E_S 259ed78d, 9 class hashes); "not a generic UE evaluator" |
| J01 | Ambient sound export scripts/export-native-map-audio.py | A/Q | failed with real lock (22a); with hand lock all 132 sounds exported but success=false (22b); success only after copying expectedInventory from its own output (22c, 22d) | recipes/native-ambient-20_20.json expectedInventory 2622/2620/106/2; export-native-map-audio.py:169-171,255,310 |
| J04 | Music bundle (recipes/native-music-20_20.json + export-native-music.py / world_music.py) | B/Q | --plan failed: hard-coded snapshot root, "No such file ... inputs/IMPORTA-PC/maps/20_21.unr" (24a) | world_music.py:231 snapshot root, no --client; expectedVolumes 335/202001 and 1329/202002; asserts 2 ch / 44.1 kHz |
| J09 | Placement StepSound bundle (recipes/native-20-20-placement-audio.json; bundle-native-placement-audio.py) | B/Q | --plan failed: "Qualification source identity differs" (30) | recipe: section 2e73654e, absenceControls StaticMeshActor1914/1913/940, expectedCoverage 157/8/149/24/447/3, SOURCE_TABLE eabffba7 |
| J10 | Stepsound package bundle (recipes/native-stepsound-surfaces.json surface counts + placement part) | B/Q | not run | surfaces[].expected walk/run counts (Stone 2/2, others 3/3); runtime uses sectionManifestSha256 only for display |
| K05 | Legacy Talking Island staging (scripts/stage-world-assets.mjs, world:stage) | U/Q | n/a | stage-world-assets.mjs:6-22 copies pinned outputs from C:/laragon/www/lineagen/.assets/talking-island |
| L09 | Post-save hand restorations (sky-save preserve-save-inputs.py, original-retention, editor-intermediate-retention) | D/Q | n/a | artifacts/native-parity/editor/sky-save-20261106/preserve-save-inputs.py (asserts 20 overlays, 7 binaries); terrain-uv-migration-20261106/implementation/original-retention.json |
| L19 | Script-version provenance of scene-mutating steps (scripts committed after use; append receipts lack hashes) | U/Q | n/a | first commits b6fba2e / b47dc95 / 6138111 on 2026-11-07 after all steps ran; capture baec89b5 vs 0ddd4036 (see L02) |
| L20 | Rebuild of the authored scene from scratch by scripts alone (never attempted) | U/Q | n/a | blocked by native_editor_scene.mjs:262-264 sidecar conflict, docs "do not reimport", loss of L06/L07 |
| N01 | Acceptance tests pinned to 20_20 counts and hashes (pipeline, unit, browser) | D/Q | the same code gave 11424 exports, 3205 StaticMeshActors, 2875 ambient objects on 20_21 (02) | tests/pipeline/test_native_map.py:329-364; test_native_map_geometry.py:449-529; tests/browser/nativeEditor.spec.ts:13-19,159-172,223-226,267-270,343; nativeBsp.spec.ts:29-38; tests/unit/nativeFootstepStepSounds.test.ts:132 |
| N02 | Preservation baselines and receipts (BASELINE.json 2,311 protected paths) | D/Q | n/a | artifacts/native-parity/research/native-ffighter-world-20261107/BASELINE.json; completion-receipt.md, final-preservation-receipt.md |

Other steps that also carry hand-qualified pins: D09 scripts/derive-native-map-terrain.py [C/T], D11 scripts/audit-terrain-uv-branches.mjs [B/T], D12 Runtime terrain-patch acceptance src/scene/world/nativeTerrainPatch.ts [B/T], E04 scripts/restore-native-static-normals.py + native_assets_lib/static_normals.py [C/T], F02 scripts/native_bsp_floor.py [B/T], G01 Mover extraction [A/T], H01 Sky extraction scripts/native_sky.py [B/T], H02 scripts/stage-native-sky.mjs [C/T], H03 Sky runtime presentation src/scene/world/nativeSkyPresentation.ts [B/T], I02 Flame placement list [B/T], I03 Flame billboard audited coordinate table [B/T], L11 scripts/migrate-native-terrain-uv.mjs [C/T], M05 Greater Musveren placement [D/G].

## 5. Hand and interactive changes (D, 33)

These break the owner's rule ("everything must come from our extraction/conversion scripts"). The ones that change world content today: the live terrain lineage (B04), the PlayerStart10 choice (C01), the mask-UV rule (D04), the bounds scout (E02), the BSP floor signed-zero repair (F04), the Editor move of StaticMeshActor1771 (L06), the flame presets (L07), the import retry and sidecar (L03, L05) and the post-save restores (L09). The rest are hand presentation values or hand-pinned acceptance.

| ID | Step | Class | Evidence |
|---|---|---|---|
| A01 | Map choice: which tile is extracted (20_20) | D/P | recipes/native-migration.json:36-48 job ids map-20-20/-textures/-section; LocalMap=20_20.unr decoded by hand from protected l2.ini (research/native-location/README.md:8-14); no script reads LocalMap |
| A06 | Input closure lock recipes/native-inputs.lock.json (143 files, one map: maps/20_20.unr) | D/P | recipes/native-inputs.lock.json (scope "four-case raw migration milestone"); grown by hand 140->143 (docs/NATIVE_MIGRATION.md:168-180); no lock writer (remote_hashes only checks, native_source_stage.py:156,198); native_migration.py:79-84 refuses outputs reading files outside the lock |
| B03 | Retained base products vs current code (raw 6a397219/e9b3216d, geometry 27b34b7d/8224bce2, converter d878a532) | D/Q | current hashes raw 67ff8811, geometry b28fb11d, converter 8035c080; verify_map/verify_geometry would demand rebuild (native_map.py:426-427, native_map_geometry.py:564-565); same geometry receipt c993ea81 produced 062218e6/67a9ba81/770c4026 under three converters; git has 2 commits for these files |
| B04 | Live terrain lineage: research raw map map-correction-first + hand-typed native_map_geometry command | D/Q | public/l2/maps/2e73654e…/map-section/receipt.json rawMapReceiptSha256 4b8c3a7c = research/audio-world-20261106/map-correction-first/receipt.json; terrain-uv-migration-20261106/implementation/COMMANDS.md:10-27 ("Do not substitute full pnpm assets:migrate") |
| C01 | Start-location choice 20_20.PlayerStart10 (GameInfo NavigationPointList rule read by hand) | D/Q | research/native-location/README.md:8-41; research/native-location/extract.py:38 "20_20.LevelInfo0"; no script implements the rule |
| D04 | Mask-UV correction rule baked into native_map_geometry (20_20 hash, offset [64,208], quads [48,47], layer names) | D/Q | scripts/native_map_geometry.py:41-54,325-361,641-647; evidence is one capture handoff fe2e05c2 covering X64..112/Y224..255; U term for x>240 has no evidence |
| D08 | Native REA qualification of sector 247 (join_source.py against retained apitrace capture) | D/Q | research/terrain-mask-native-rea-followup/.../adjacent-terrain-source-join-20261106/join_source.py:13,161-163,186-187; CHECKPOINT-MANIFEST 47fb7020 |
| E02 | Missing-model bounds scout (missing-model-bound-screen.json, candidate-native-triangle-check.json 56fa4c10) | D/Q | research/map-overlap-expansion-20261106/bounds-scout/; producer not retained; proof feeds derive-native-map-model.py:31-32, static_normals.py:16, audit-adjacent-terrain.py:116 |
| F04 | BSP floor Editor append + repair-editor-signed-zero.py + material-reference.json | D/T | research/native-building-floor-20261106/repair-editor-signed-zero.py (asserts d8be7c35, a7fd49e2, 56 normals); material-reference.json has no generator |
| H05 | Fog, lights, clear colour (template Editor values; fogMode 0 = inert) | D/G | assets/native-parity.scene/config.json; lights Sky light 0.65, Sunlight [-0.5,-1,0.6] 0.65; copied by native_editor_scene.mjs:276-286 |
| J03 | Ambient runtime defaults (Random 100, Radius 64, Volume 190, Pitch 64, 16 slots) | D/G | src/audio/worldAmbience.ts:5-40; src/assets/native/loadNativeWorldAudio.ts:127-133 |
| J05 | Music ID join (Join-MusicIds.ps1 / Decode-MusicTables.ps1 -> MUSIC_ID_JOIN.json 9dbb003c) | D/T | research/.../music-id-evidence/Join-MusicIds.ps1:1-6,36-41 (hard-coded export indices, scratch-note path, ran on IMPORTA-PC) |
| J06 | Music input lock recipes/native-music.inputs.json (nine files copied by hand) | D/P | scope text: "Nine original 20_20 music files … copied over the read-only fleet route" |
| J07 | Music playback rules (musicVolume 0.1 from owner l2.ini, gap 30 s, fade 2.5 s) | D/G | src/audio/worldMusic.ts:5-38 |
| J11 | Water and foot-volume footsteps (not extracted; footVolume always null) | D/G | src/audio/footstepSurfaceAuto.ts:21-25,121; worldAmbience.ts:26-29 |
| K04 | Staged public state is local, git-ignored and order-dependent (public/l2, public/scene) | D/T | .gitignore:42 public/l2/, :28 public/scene/; stagers need hand --id and --expected-catalog-sha256 and refuse changed records; catalog.json changed during this audit (2026-11-08 02:06:39, sha 55c12147; inventories cite e19989ad) |
| K06 | Legacy route helpers (sourceColliderPolicy.ts, foliageCutout.ts, worldAssets.ts, terrainSurfaces.ts) | D/T | sourceColliderPolicy.ts:13-32 hand collider overrides for 17_25 objects; terrainSurfaces.ts:17,189,255 |
| L01 | Template scene assets/native-parity.scene (also the SOURCE route scene via public/scene/native-parity.babylon) | D/G | src/scene/loadEnvironment.ts:56; template carries fighterIdle Wait_1HS_MFighter, leatherShirt true, materialTint [0.45,1,0.6]; no 20_20 values |
| L03 | 2026-11-05 import retry: failed write, writer patch, first import moved aside by hand, capture code edit, re-import | D/T | artifacts/native-parity/editor/world-import-capture.log, write-first.log, write-corrected-orientation.log, first-import-orientation/ |
| L05 | Channel sidecar assets/native-world.scene.native-editor-channels.json (seeded by one-off seed-channel-recovery.mjs, then edited in place) | D/T | artifacts/native-parity/editor/world-import/seed-channel-recovery.mjs ("wx", one-time); migrate-native-terrain-uv.mjs:131-133 rewrote uv hash; appenders rewrote manifestSha256 to 2e73654e; external copy creation untraced |
| L06 | Editor UI edit: interlude:20_20.StaticMeshActor1771 moved +0.75 m X | D/T | assets/native-world.scene/nodes/native-1601d53f5ccd4772a5aadab6.json position [0.75,0,0]; docs/NATIVE_EDITOR_WORLD.md:144 |
| L07 | Flame replay values stored only in native-world config (0.25 / 0.75 / 0.5 / 1.5) | D/P | assets/native-world.scene/config.json metadata.scripts[0].values.flame*; code defaults 0/0/1/1 (nativeParity.ts:25-30) |
| L08 | Editor save serialization rewrites (maxSimultaneousLights 4->8 on 413/835 materials, geometry renames, deleted binaries) | D/G | world-import/before-world-edit vs after-world-edit (835 PBR at 4 vs 8); last full save 2026-11-06 18:22 |
| L09 | Post-save hand restorations (sky-save preserve-save-inputs.py, original-retention, editor-intermediate-retention) | D/Q | artifacts/native-parity/editor/sky-save-20261106/preserve-save-inputs.py (asserts 20 overlays, 7 binaries); terrain-uv-migration-20261106/implementation/original-retention.json |
| L10 | Raw Editor Play export overwriting public/scene/native-world.babylon and dist | D/G | terrain-uv-migration-20261106/implementation/editor-play-public-overwrite.json (efe04822, no UV2); repaired by pnpm generate |
| L12 | AUTHORED route attach keeps Editor edits; embedded manifest never hash-checked against marker or catalog | D/G | src/scene/world/loadAuthoredNativeSection.ts:53-118,144-156 |
| M04 | Player movement speed: aCis humanFighter walk 80 / run 115 for every profile | D/G | src/world/NativeSliceAdapter.ts:19-30 |
| M05 | Greater Musveren placement (+1.4 m X) and pinned NPC profile | D/G +Q | NativeSliceAdapter.ts:59-61; nativePowerStrikeSource.ts:138-143 (radius 18, height 36, drawScale 1.2) |
| M07 | World camera authoring and follow (Editor round-trip values) | D/G | assets/native-world.scene/cameras/World camera.json; captureNativeWorld.ts:141-151 |
| M08 | Editor-saved script values (fighterIdle Wait_1HS_MFighter, leatherShirt, materialTint) | D/G | assets/native-parity.scene/config.json; src/scripts/nativeParity.ts:10-30 |
| M09 | Hard-coded "20_20" UI and diagnostic text | D/T | createNativeSliceRuntime.ts:366,662,819; nativeSliceDebug.ts:56; worldAudioControls.ts:192,256,277,301 |
| N01 | Acceptance tests pinned to 20_20 counts and hashes (pipeline, unit, browser) | D/Q | tests/pipeline/test_native_map.py:329-364; test_native_map_geometry.py:449-529; tests/browser/nativeEditor.spec.ts:13-19,159-172,223-226,267-270,343; nativeBsp.spec.ts:29-38; tests/unit/nativeFootstepStepSounds.test.ts:132 |
| N02 | Preservation baselines and receipts (BASELINE.json 2,311 protected paths) | D/Q | artifacts/native-parity/research/native-ffighter-world-20261107/BASELINE.json; completion-receipt.md, final-preservation-receipt.md |

## 6. What is already generic

Script-only and generic (A/G, 9): A03 Package unwrap and table parsing (ue2.unwrap/summary/Package); A04 Whole-client catalog (scripts/native_catalog.py); A05 External converters outside the repo (UModel, UELib) at absolute paths; A08 Class-default evidence (native_catalog/effects.read_class_defaults); E07 Boundary-overlap core (native_map_overlap.select_overlaps / audit_overlap); F01 BSP reader core (vendored scripts/vendor/lineage2elbera_bsp); F09 Walk-support admission (nativeBspSupport.ts; EnableCollision on statics); L14 pnpm generate pack chain (ensure-webgpu-project, stage-webgpu-compilers, validate-editor-materials, babylonjs-editor-cli pack); M10 Spatial placement index (worldPlacementIndex.ts).

Generic but driven by hand values or hand state (22): C04 Surface spawn candidate [B/G]; F10 Movement policy constants and collision inputs [B/G]; G04 Door interaction policy [B/G]; H05 Fog, lights, clear colour [D/G]; J03 Ambient runtime defaults [D/G]; J07 Music playback rules [D/G]; J11 Water and foot-volume footsteps [D/G]; L01 Template scene assets/native-parity.scene [D/G]; L04 Scene writer writeNativeEditorScene [B/G]; L08 Editor save serialization rewrites [D/G]; L10 Raw Editor Play export overwriting public/scene/native-world.babylon and dist [D/G]; L12 AUTHORED route attach keeps Editor edits; embedded manifest never hash-checked against marker or catalog [D/G]; L15 scripts/preserve-native-editor-uv2.mjs [C/G]; L16 scripts/preserve-native-editor-fog.mjs [C/G]; L18 src/editor/restoreEditorAuthoredMaterials.ts [C/G]; M02 Spawn origin offset [B/G]; M03 Actor facing / spawn yaw [B/G]; M04 Player movement speed: aCis humanFighter walk 80 / run 115 for every profile [D/G]; M05 Greater Musveren placement [D/G]; M06 Ground clearance and actor capsule [B/G]; M07 World camera authoring and follow [D/G]; M08 Editor-saved script values [D/G].

Parameterised but needing a hand-written per-tile recipe or selection (P, 15): A01 Map choice: which tile is extracted; A02 Fleet file inventory and 20_20 dependency plans; A06 Input closure lock recipes/native-inputs.lock.json; A07 Fleet staging from a lock; B02 Raw-map recipe recipes/native-map-20_20.json incl. mandatory "section" box around PlayerStart0; C02 Section recipe recipes/native-map-debug-location.json; C03 Legacy/candidate section recipes; D02 Terrain texture request list recipes/native-terrain-textures.json; I01 Flame model policy in the section recipe; J02 Ambience bundle recipe + bundle-native-ambience.py; J06 Music input lock recipes/native-music.inputs.json; J08 World-audio staging and runtime selection; K01 Migration orchestrators; K02 scripts/stage_native_runtime.py; L07 Flame replay values stored only in native-world config.

Proven on 20_21 without code changes: `native_map.py` (A/Q), the terrain builder in `native_map_geometry.py` (A/Q), class-default extraction (A/G), `native_map_overlap.py` (A/G), the BSP reader core (A/G), `export-native-map-audio.py` (A/Q), `bundle-native-ambience.py --plan` (B/P), `native_migration.py` with `--prove-rebuild` (A/P) and `native_source_stage.py` (A/P).

## 7. Second-tile probe (20_21) per script

The probe used scratch root `artifacts/native-parity/research/genericity-audit-20261108/probe`. It fetched `maps/20_21.unr` (sha e123be27…f93), `T_20_21.utx` and four `.usx` over scp, verified every hash against IMPORTA-PC, and wrote nothing to `inputs/`, `recipes/`, `public/`, `assets/` or `dist/`. Counts: 9 ran, 1 partial, 18 failed. Not run, because they need a browser or write to `public/` or `assets/`: stage-native-movers.py, stage_native_runtime.py, stage_native_world_audio.py, stage-native-sky.mjs, native_editor_import.mjs, capture-native-editor-model.mjs, capture-native-editor-terrain.mjs, compare-native-terrain-patch.mjs, measure-native-world.mjs, migrate-native-terrain-uv.mjs, share-native-terrain-export-materials.mjs, preserve-native-editor-uv2.mjs, preserve-native-editor-fog.mjs, stage-world-assets.mjs, all --stage/--apply modes.

| Script | Outcome | Detail | Log (probe/logs/) |
|---|---|---|---|
| scripts/native_map.py | ran | partial with the map alone (165 unresolved packages); raw-data-extracted, 0 unsupported after hand-staging T_20_21.utx and 5 usx | 01, 02 |
| scripts/native_map_geometry.py (terrain) | ran | 3 hand rectangles; 2401 vertices / 4608 triangles / 9 layers each; mask-UV rule silently off | 03 |
| scripts/native_map_geometry.py (section runtime) | partial | A: 1/7 models (cruma_s licensee 12; duplicate leaf); B: 11/12; C: 20/20, the only error-free 3x3 rectangle | 04, 05, 08, 09 |
| native_catalog/effects.read_class_defaults | ran | identical to retained research copy (36/13/6 properties) | 06 |
| scripts/native_map_overlap.py | ran (C only) | refused section A runtime with errors; section C ran, 0 additions | 07, 10 |
| vendored lineage2elbera_bsp reader core | ran | 20_21.Model327: 4493 nodes, 495 brushes, 0 unreachable | 14 |
| scripts/export-native-map-audio.py | ran after hand pin | real lock: "Recipe map identity differs from source lock"; hand lock: 132 sounds exported but success=false until expectedInventory was copied from its own output | 22a-22d |
| scripts/bundle-native-ambience.py --plan | ran | with a hand recipe pinning the probe export hashes; 2875 emitters, 132 sounds | 23 |
| scripts/native_migration.py | ran | hand recipe + hand 15-file lock; passed; --prove-rebuild 52/52 identical; --verify-only passed | 26-28 |
| scripts/native_source_stage.py | ran | 15-file hand lock staged after remote hash proof | 31 |
| scripts/derive-native-map-overlap.py | failed | Missing retained input ... maps/20_20.unr | 11 |
| scripts/native_bsp_floor.py | failed | no maps/20_20.unr; with 20_21 renamed: "Pinned input changed" | 12, 13 |
| scripts/native_bsp_building.py | failed | same as native_bsp_floor | 12, 13 |
| scripts/extract-native-terrain-patch.py | failed | no maps/20_20.unr; renamed: "Offline terrain source hash differs" | 15, 15b |
| scripts/migrate-native-terrain-runtime.py | failed | Geometry is outside the pinned 20_20 source | 16 |
| scripts/derive-native-map-bsp.py | failed | BSP manifest identity/file set differs | 17 |
| scripts/derive-native-map-building.py | failed | Unsupported/already-appended base | 18 |
| scripts/derive-native-map-model.py | failed | Wrong model archive | 19 |
| scripts/derive-native-map-terrain.py | failed | output overlap, then missing qualification CHECKPOINT-MANIFEST.json | 20, 20b |
| scripts/derive-native-map-movers.py + native_map_movers.py | failed | no maps/20_20.unr; renamed: "Mover extraction requires the pinned original 20_20 map" | 21, 21b |
| scripts/export-native-music.py --plan | failed | hard-coded snapshot root: no inputs/IMPORTA-PC/maps/20_21.unr (no --client option) | 24a |
| scripts/append-native-editor-placements.mjs (plan) | failed | ENOENT captured-world.json | 25a |
| scripts/append-native-editor-model.mjs (plan) | failed | input identity mismatch | 25b |
| scripts/append-native-editor-bsp.mjs (plan) | failed | invalid BSP snapshot identity | 25c |
| scripts/append-native-editor-terrain.mjs (plan) | failed | explicit distinct manifest and fresh baseline hashes required | 25d |
| scripts/native_sky.py | failed | no maps/20_20.unr (pinned path and hash) | 29 |
| scripts/bundle-native-placement-audio.py --plan | failed | Qualification source identity differs | 30 |
| scripts/restore-native-static-normals.py | failed | Asset/native normal source differs | 32 |

Data differences the probe found on 20_21, which a generic pipeline must handle rather than pin:

- 3 movers (20_20 has 8).
- 3 MusicVolumes (20_20 has 2).
- 4 PlayerStarts.
- 238 of 256 sectors whose cached Z bounds differ from the computed ones.
- Alpha-map sizes 256 at layer 6 and 512 at layer 8 (`nativeTerrainPreview.ts:187` expects other sizes at those layers).
- A TerrainInfo frame whose grid row 0 is at world Y 98304 (`nativeTerrainPatch.ts:82` hard-codes 65536).
- `cruma_s.usx` at licensee 12 and `dion_curumadungeon_boss_s.usx` at licensee 14.

## 8. Proposed generic design: `pnpm world:build` (short)

**One command, one orchestrator.** `pnpm world:build --map <tile> [--section all|start:auto|sectors:…|chunks:…] [--all|--eligible] [--stage] [--scene] [--verify-only] [--prove-rebuild]`, backed by `scripts/world_build.py`. It replaces `native_migration.py`, `native_batch.py` and the whole derive/append/migrate chain.

**Inputs.** Only the map name, a client snapshot id and a small tile-independent config (`config/world-build.json`, `config/tools.lock.json`). Everything per tile is computed from map data: input closure, start anchor (the GameInfo rule on the startup map, a declared policy elsewhere), section cut, placements and overlap, terrain sectors, BSP, movers, sky, zones and audio.

**Stages.**
1. tools (hash-locked UModel, UELib, ffmpeg, Editor CLI)
2. census (fleet listing, hashes and format versions; tile list; LocalMap)
3. closure (import-table walk, generated lock)
4. raw (whole level through a format registry)
5. client-wide products
6. plan (tile frame, 4x4-sector chunks, anchor, cut)
7. terrain (whole TerrainInfo per sector, with one mask-UV rule keyed on sector layout)
8. select (ownership and bounds candidates, no Z window)
9. convert (shared content-addressed model and texture store)
10. overlap (triangle-confirmed)
11. bsp (whole level by PolyFlags, BlockingVolumes)
12. movers
13. zones and sky
14. audio
15. assemble (chunk and tile manifests, `world.json`, one catalog writer)
16. scene (generated Editor scenes for both routes)
17. overrides-pull
18. pack and qualify

**Corrections move upstream.** Mask UV, TerrainSector247, normals, the Dion tree, overlap, Brush397 and Brush610 become extractor or converter behaviour. The scripts in section 3 retire.

**Content and provenance are separate.** Content keys = sha(input hashes + stage algorithmVersion + config subset). Implementation hashes and the git commit go only into receipts. Today scripts embed their own hash in content (`native_bsp_floor.py:299`, `native_bsp_building.py:176`, `native_map_overlap.py:422-433`), so editing a comment rehashes the chain.

**Unsupported formats never block a tile.** They become per-object gap records. A format registry grows one licensee at a time, each with a committed fixture and a UELib cross-check. Census order of coverage: map licensee 23 (38 tiles), 25 (17), 30 (15), 18, 31, 16, 19, 20; usx 12 (42 packages), 14, 15, 18; texture licensees beyond 20/28/30.

**Acceptance is automatic.** It rests on invariants instead of pins:
- conservation against an independent export-table census
- terrain, seam and BSP geometry invariants
- reference and hash closure
- a deterministic rebuild that includes the catalog and the scene
- a headless smoke render
Today's 20_20 numbers and hashes move into a frozen `oracle/20_20/expected.json`, compared semantically (per grid vertex, placement id and BSP node).

**The authored layer becomes data.** scene = generate(manifest, `recipes/presentation/world.json`, `recipes/overrides/<tile>.json`).
- Overrides are keyed by stable source id and carry a source fingerprint, so a stale entry is reported rather than silently applied.
- `pnpm world:overrides:pull --map <tile>` diffs an Editor save back into the override file for git review. Geometry edits are refused.
- Editor ids derive from source identity, not from the manifest hash, sibling index or GPU renderer.
- This replaces the UV2 sidecar, the post-save restores, the append scripts and the 2,311-file preservation baseline.

**Multi-tile.**
- A shared store deduplicates model conversion across tiles.
- A union lock, with per-tile subsets.
- A `world.json` tile grid built from TerrainInfo Location/TerrainScale.
- 4x4-sector chunks (16 per tile) streamed in a ring, which removes the 128-model cap at `loadNativeSection.ts:73`.

## 9. First concrete steps

While the browser verifier runs, every new build writes to `build/world/...` and is served on its own port. Nothing touches `public/l2` or `assets/` until a single, reversible cutover.

1. **M0 Freeze the oracle.** Add `scripts/world/freeze_oracle.py --map 20_20`. It copies the git-ignored live state (`public/l2/catalog.json`, `public/l2/maps/2e73654e…`, movers, audio, sky f7a0b5ef, `public/scene/*.babylon`, `assets/native-world.scene` and its sidecar) into `artifacts/native-parity/oracle/20_20-2e73654e/`, with a hash manifest and `expected.json` semantic summaries. Commit `expected.json` and the hash manifest.
2. **M1 Provenance hygiene.** Commit all generator code. Add `config/tools.lock.json` (UModel 13502e5a, UELib 64ebfa8b, ffmpeg) with a bootstrap. Give each stage an `algorithmVersion`. Move script self-hashes out of content. Refuse `--publish` from an uncommitted tree.
3. **M2 Census and closure.** Promote `map-extraction-refuter/fleet_map_headers.py` and `fleet_package_headers.py`, plus `remote_hashes`, into `scripts/world/census.py`, and add the l2.ini LocalMap decoder. Add the closure walker and lock writer. Generate the 20_20 closure and explain every difference from the hand 143-file `recipes/native-inputs.lock.json`.
4. **M3 Raw stage.** Make the raw-recipe `section` box optional (`native_map.py:256-263`) and drive jobs from `--map`. Rebuild 20_20 raw under the current implementation into `build/world/20_20/raw` and compare it with `migration/maps/map-20-20` (terrain.json 86521817). Then turn the licensee-28 raises into gap records behind a format registry.
5. **M5 Plan stage.** Implement the GameInfo start rule and the section generator. Acceptance: `start:auto` on 20_20 must give PlayerStart10 and sectors [64,208]..[96,240], which proves the generator reproduces today's hand choice.
6. **M6-M9 in order:**
   - M6 whole-TerrainInfo terrain, compared per grid vertex with 39417edb and terrain247 cee7f0f6
   - M7 select, convert and overlap, which must contain the 157 oracle placements
   - M8 generic BSP (Brush397 10/48/28 and Brush610 10/52/32 appear as subsets), movers (8), sky (f7a0b5ef) and audio
   - M9 the single catalog writer, building a complete parallel `public/l2` tree
   Retire each one-off only after its oracle diff is clean.
7. **Pilot gate M12.** Run `pnpm world:build --map 20_21 --section all` with zero hand-written files. Expected gaps: licensee 12 and 14 meshes.

The full sequence (M0-M15, including runtime de-pinning, the overrides layer, fleet rollout and streaming) is in the design input this report was built from. INVENTORY.json maps every canonical step to its design stage (`designStage`).

## 10. Decisions the owner must make

1. **Oracle, not byte equality.** The current 20_20 state matches no commit. Do you accept freezing it as a regression oracle, replacing it with a generic rebuild compared semantically, and classifying the first diffs once?
2. **Shipping scope and gaps.** Which tiles ship first: 20_20 only, 20_20 + 20_21, the 39 eligible tiles, or all 153? Do tiles with unsupported formats ship with visible gap records under a gap budget, or wait for readers?
3. **Reader order.** Confirm the order by tile coverage: map licensee 23 (38 tiles), then 25 (17), 30 (15), then the rest; usx licensee 12 (42 packages, incl. `cruma_s`) early, because 20_21 needs it.
4. **Section policy.** Whole tiles with chunk streaming, or keep an automatic start-area cut until streaming is qualified? Which anchor policy applies to tiles that are not the client's startup map (first enabled PlayerStart, or tile centre)?
5. **Z window.** Dropping the hand window [-4000,-2500] will probably add placements beyond the current 157 (inference). Accept the change as a generic policy?
6. **Mask UV.** The rule is natively evidenced only for 20_20 grid X64..112 / Y224..255. Ship other tiles with UVs marked "extrapolated", or first fund a second native capture or an Engine.dll analysis?
7. **Authored layer.** Do you agree that the Editor scene becomes a generated output plus `recipes/overrides/<tile>.json`, that Editor ids change once, and that geometry edits in the Editor are refused? Which current hand edits are deliberate and should carry over: StaticMeshActor1771 +0.75 m X, the flame presets 0.25/0.75/0.5/1.5, the camera?
8. **Values that are not client data.** The aCis walk/run speeds 80/115, your l2.ini musicVolume 0.1, the door policy 2 / 1.5 / 0.8 m and the Greater Musveren +1.4 m offset: keep them as labelled presentation config, or replace or remove them?
9. **External tools.** Vendor UModel, UELib and ffmpeg under a hash lock (licensing not checked), or keep them outside the repo with a hash check?
10. **Cleanup and cutover.** May research-scratch products that fed published bundles, the `BASELINE.json` protection and the per-tile recipes be archived once the oracle diff is clean? When may the cutover happen relative to the running browser verifier?

## 11. Method and limits

- **Inputs.** Six refuted area inventories (map extraction, terrain, models-bsp-movers, editor-scene-staging, runtime-content, second-tile probe) and a design draft. The synthesizer re-checked these facts itself: the fleet census recount (67/153 licensee-28 tile maps; 39 tiles passing both gates; 56/212 usx outside the reviewed list; 52 `T_*.utx` at 123/28), the probe log outcomes, the gate lines in `native_map.py` and `native_map_geometry.py`, the job ids in `recipes/native-migration.json`, the catalog keys and section, the staged bundles and the literal counts.
- **Corrections to area claims.** The census gives 52, not 49, `T_*.utx` at 123/28, and 56 of 152, not 55, tile texture packages at licensee 20/28/30.
- **Catalog changed during the audit.** `public/l2/catalog.json` was rewritten at 2026-11-08 02:06:39 (sha 55c12147…; the area inventories cite e19989ad…). The section entry still points at 2e73654e. This is itself evidence that the published world is mutable local state (K04).
- **Not verified.**
  - No 20_20 rebuild was run, so whether current code reproduces the live bytes is undetermined.
  - The probe's 20_21 rectangles were hand-chosen; section C was picked to avoid converter gaps.
  - The browser, Editor and staging steps were classified from code.
  - The generalisation of the mask-UV rule and the tile-grid formula are inferences.
  - Open gaps are listed in `INVENTORY.json` under `openGaps`.
- **Regenerating.** `python -I synthesis/build_inventory.py` then `python -I synthesis/build_report.py` from this folder.
