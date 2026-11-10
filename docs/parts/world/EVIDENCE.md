# World: terrain, buildings, props evidence

Part `world`, lane `world`. What passes now, what is open, and where the proof lives. Keep this file under about 30 KB.

Shorthand below: `convert_tile.py` is `python -B scripts/world/convert_tile.py --client E:/Lineage2-client`, and `write_lane_catalog.py` is `python -B scripts/native_store/write_lane_catalog.py`. A browser check marked "three viewports" ran at desktop 1440 x 900 and phone 932 x 430 with touch, with no horizontal scroll at 430 x 932. Every browser check ran headless on SwiftShader, so none makes an FPS claim.

## Passes now

Nothing has passed the stage A check yet (DEC-OWN-3). Working on 2026-11-07, per PORT_SCOPE section 5: the 20_20 section. The Talking Island reference route was removed on 2026-11-08 (DEC-OWN-11).

## Open

All 153 tiles by tile-general converter steps (WORLD-01), sky, ambient and placement audio for every tile (WORLD-02), a per-tile coverage manifest and non-tile map classification (WORLD-03), one persistent scene with bounded cells and LOD (WORLD-04), walking any converted tile (WORLD-05). Provisional, owner review: the owner's check of the WORLD-07 verdicts below and the converter steps for the adopted findings (layer ordering in plan 02-15, the music join in plan 02-45), and source-declared collision for static meshes and BSP (WORLD-08).

## WORLD-07 review

Provisional, owner review (plan 02-11). The adopted statements below are the reviewer's words without change. `.planning/phases/02-stage-a-breadth/02-11-SUMMARY.md` holds every row in full (the packet sections each statement cites, the reason for each rejected and polish verdict) and the reviewer session record.

- Reviewer: a fresh-context headless Claude Code session (`claude -p`, general-purpose prompt, model `claude-opus-5-5`, Read, Glob, Grep and `python -B -I` one-liners only, `dontAsk`, only the packet directory added), neither the packet author (a Codex session, `review/REVIEW_STATUS.json`) nor the executing agent. Spawned 2026-11-08T14:54:04+02:00, returned 15:01:40 (Riga); a 14:52:04 start read nothing (its secret-read hook could not find Git Bash) and returned no findings.
- Re-hash: 74/74 matched, 0 mismatched; `SHA256_MANIFEST.json` SHA-256 `08ff99a814f892a827cf969f2f29712d9fbf4d89a8df49bff6a9987558ceba17` equals `packetManifestSha256` in `tests/fixtures/world-07/fixtures.json` and `manifestSha256` in the packet's DELIVERY_VERIFICATION.json. Read-only proof: the 76-file packet listing `dba82e14bad003571ab86a6f389b00dc44fe5dda8fcc549d4c13ae4a1d4b1702` was unchanged, and `verify_world07_packet_manifest` then matched 74 of 74 rows with 76 files on disk.
- Totals: 12 adopted, 21 rejected, 14 polish. Path-free fixtures and tests for the adopted facts: `tests/pipeline/test_terrain_layer_order_fixtures.py` and `tests/pipeline/test_music_volume_join.py`.
- Reviewer notes: the packet tells readers to run `map-composition.mjs` and `Verify-Composition.ps1`; neither was run. It never says every sequence ascends by layer index, so 02-15 asserts the observed per-triangle order and adds no sort rule. REPORT.md says the music ids "resolve" to track files, but the `MUSIC_ID_JOIN.json` limits support only unique basename candidates. The join counts 250 music files where REPORT.md cites 295 Ogg inputs, unexplained.

Adopted, terrain layer ordering (plan 02-15):

- W07-01: The 21 first-device draws at calls 142120 to 142268 submit 10,896 fully mapped occurrences of 2,976 distinct source triangles in 1,488 cells (X64..111, Y224..254) through 39 ordered authored-layer sequences.
- W07-02: Every included triangle begins with authored layer 0, which draw 142120 submits once for all 2,976 triangles.
- W07-03: No included triangle receives the same authored layer twice, and no triangle changes winding across passes.
- W07-04: Draw groups for one layer cover disjoint selected triangles (layer 2 splits 1,572 and 460, layer 6 splits 900 and 300, zero overlap), so draw count is not a per-triangle contribution count and native batching need not be reproduced.
- W07-05: At shared edge X88/Y227..228 triangle 955,1004,1005 gets [0] and 954,955,1004 gets [0,6], and at X65/Y246..247 (inside the corrected band) 1863,1912,1913 gets [0,1,2] and 1862,1863,1912 gets [0,1,2,6], so neighbours differ by one layer while keeping the order of their shared layers.
- W07-06: Triangle 1831,1832,1881 gets [0,7] and triangle 926,927,976 gets [0,2,3,4,5,6,7] at native indices [1202,1220,1203] in every pass, so a later layer can follow skipped middle layers and the observed per-triangle order must be kept.

Adopted, MusicVolume to musicinfo join, per-tile music step (plan 02-45):

- W07-34: The installed Interlude codec and schemas decoded musicinfo.dat and entereventgrp.dat into an outside-client folder with byte-identical schema round trips and unchanged source, tool and schema hashes, but with no client execution or encryption round trip.
- W07-35: 20_20.MusicVolume0 (export 335) with nMusicID 202001 joins musicinfo line 96, with cnt 3 and ordered strings D03_F, D03_S01, D03_S02.
- W07-36: 20_20.MusicVolume1 (export 1329) with nMusicID 202002 joins musicinfo line 339, with cnt 6 and ordered strings F09_F, F09_S01, F10_F, F10_S01, F04_F, F04_S01.
- W07-37: Each of the nine stored strings matches exactly one local Ogg file by case-insensitive basename, which names a unique local candidate but is not observed file loading or playback.
- W07-38: Array order, count, spelling and map-object identity are source facts that the join must keep unchanged.
- W07-39: MusicVolume1 carries bForcePlayMusic=true while MusicVolume0 has no serialized force flag, and absent must stay distinct from false because it is not a resolved default.

Rejected (21): W07-07 to W07-12, W07-14, W07-25, W07-29 to W07-33, W07-40 to W07-47.

Polish, open under POL-01 (14): W07-13 (bUseAlpha), W07-15, W07-16 to W07-24 (Y>240 visibility), W07-26 (alpha-test precision), W07-27, W07-28.

## Tile census

Committed in `docs/parts/world/tile-census.json` (plans 02-12 and 02-13, WORLD-03). Every file is read through `require_equal_file`; the file holds names, header integers, declared object names and gate results, no Lineage II bytes.

- Command: `node scripts/check-machine-schedule.mjs && python -B scripts/world/tile_census.py --client E:/Lineage2-client` (about 17 s at BelowNormal; reads the 67 licensee-28 maps whole, every other package header only). It also writes the world census gap rows the coverage report reads, `artifacts/lane-store/world/gap-rows/census.json`.
- `referenceTreeLockSha256` `1957c96800aa45cb10c984f3f2e6f8d1f5f0b1713f086f20560db01f4d1d2b52`.
- 163 maps: 153 tiles, 10 non-tile. Status: 39 eligible, 124 gap. Tile gaps: 86 map licensee, 26 terrain-height licensee (123/25: 13, 123/23: 8, 123/12: 2, 123/19, 123/20 and 123/22: 1 each), 2 terrain-height package missing (`19_11`, `20_11`).
- A11 verdict (plan 02-13), settled: each of the 67 map-gate-pass tiles holds exactly one `Engine.TerrainInfo` export whose `TerrainMap` names a texture in its own `textures/T_XX_YY.utx` (0 declare another package). 65 resolve to a lock path by casefolded package stem; `19_11` and `20_11` declare `T_19_11.Height.19_11` and `T_20_11.Height.20_11`, not in the lock, so `terrain-height-package-missing`. Unusual object names: `21_16` declares `T_21_16.21_16` (no group), `21_25` declares `T_21_25.Height.21_17` (`t_21_25.utx`, 123/12).
- Eligible by name (02-12) and by declaration (02-13): the same 39 tiles; research 11.6 lists the same failure figures.
- Gate basis: each tile row records `terrainMapPackage` `{basis, object, path, packageVersion, licensee}`: basis `TerrainInfo.TerrainMap` for map-gate-pass tiles, the by-name basis `package-name` with `object` null for the 86 map-gate-fail tiles, null for non-tile rows. More than one TerrainInfo stops the census with the map name; a map-gate-pass map whose tables do not decode is `decode-failed:<error>` (none in the client).
- Map gate: pass only for UE 123 licensee 28. Tile map licensees: 28: 67, 23: 38, 25: 17, 30: 15, 18: 6, 31: 6, 16: 2, 19: 1, 20: 1.
- Eligible: 16_25, 17_12, 18_10, 18_11, 18_12, 18_17, 18_20, 18_22, 19_10, 19_16, 19_17, 19_22, 19_24, 20_10, 20_14, 20_17, 20_20, 20_21, 20_23, 21_15, 21_16, 21_22, 21_24, 22_14, 22_15, 22_16, 22_18, 22_20, 22_23, 23_13, 23_14, 23_16, 23_17, 23_21, 23_22, 24_15, 24_19, 24_22, 25_19.
- Non-tile: `Auto0` to `Auto5` and `skylevel` 118/0 and `ship_position` (Lineage2Ver111) 118/6 are `map-version-unsupported:118`; `entry` (Lineage2Ver111) 123/0 is `map-licensee-unsupported:123/0`; `Lobby` 123/30 is `map-licensee-unsupported:123/30`. Lobby is a gap in this census; the map readers have reviewed licensee 30 since 02-52, and the 02-54 census update decides it.
- A height package of another UE version is `terrain-height-version-unsupported:<version>` (`recipes/world/gap-reasons.json`); `t_17_23.utx` is 118/11, behind a failing map gate.
- Coverage: `python -B scripts/native_store/build_coverage_report.py --store-root artifacts/lane-store/world/l2 --lane world` gives world 163 rows, 124 gap, 39 pending; every tile row's reason equals its census reason, including the 28 declared terrain reasons.
- Open: the 86 map-gate-fail tiles keep by-name terrain gates in this census; the readers grew in 02-52 and the census follows in 02-54.
- Tests: `python -B -m unittest discover -s tests/pipeline -p test_tile_census.py`.

## Tile chunks and terrain

Plan 02-15, WORLD-01. `convert_tile.py --map <XX_YY> --step chunks`, then `--step terrain`, on a sealed raw unit. Units: `artifacts/lane-store/world/work/tile__<XX_YY>/{chunks,terrain}` (ignored).
- 20_21: 16x16 sectors, 16 chunks `chunk-<column>-<row>` of 4x4 sectors. Frame `20_21.TerrainInfo0`, location [16384, 114688, 160.65], scale [128, 128, 76], 256x256 samples. Anchor `20_21.PlayerStart2` [18160, 112972, -6527], the first PlayerStart in export order (bEnabled True from the `Engine.PlayerStart` UELib default). Cross-checks only: the probe's `(x-20)*32768` gives X 0, the west edge (location X minus half of 256 x 128); the probe picked PlayerStart4.
- 16 GLBs, 129,966 triangles, 42 hidden quads. 238 of 256 cached sector Z bounds differ, kept under `require-xy-preserve-z-discrepancies`. 9 layers in serialized index order.
- Every chunk, 20_20 included, is `maskUvRule` `extrapolated` (source `interlude-20_20-submitted-mask-uv-20261106`): no chunk equals the capture rectangle.
- 20_20 (census eligible): 16 chunks, all written, 221 Z mismatches, 11 layers (9 filled, slots 9 and 10 empty), anchor `20_20.PlayerStart0` [19172.80, 79583.47, -4295.06].
- Removing both 20_21 seals and rerunning gave 18 byte-identical products.
- Hand-chosen windows replaced: `scripts/world/tile_chunk_plan.py` reads only the TerrainInfo sector grid and anchors on PlayerStart0; the old 20_20 section window falls in `chunk-1-3`. Plan 02-71 deleted the four 20_20 section recipes holding hand-chosen windows and the chain reading them.
- Open: terrain materials not converted, visible parity unverified, sky and audio not run (meshes and BSP: 02-29, 02-30).
- Tests: `test_tile_chunk_plan.py`, `test_terrain_chunk_step.py`.

## Tile 20_21 tracer

Plan 02-16, WORLD-05 and WORLD-01. `convert_tile.py --map 20_21 --step raw|chunks|terrain|manifest`, then `write_lane_catalog.py --lane world`. Outputs only in `artifacts/lane-store/world/l2` (ignored).
- One tile manifest at `/l2/tiles/<sha256>/tile.json` and 16 chunk manifests at `/l2/maps/<sha256>/native-tile-chunk-runtime/manifest.json`, each naming its terrain at `/l2/maps/<GLB sha256>/native-tile-chunk-terrain/terrain.glb`; the lane catalog pins them to base catalog `55c12147...972fe`.
- `/?map=20_21` on the native root route loads the chunk terrain with its neutral inspection material through `loadNativeSection`; navigation uses those terrain meshes only. Inspection `sectionWindow` is `{basis: terrain-info-chunk-plan, status: source-derived}`; the default route reports `{basis: hand-chosen-presentation-window, status: unresolved}`. The pinned 20_20 sky is not presented on another tile.
- A step not yet sealed is a `step-pending:<step>` row in the tile manifest, the chunk manifests and the gap rows.
- Spawn: `20_21.PlayerStart2` lies about 29 m below the nearest terrain vertex at its XY (20_20 `PlayerStart0` about 11 m), so the route spawns at the anchor XY on the chunk terrain surface and keeps the authored Z as the `tileAnchor` diagnostic (the legacy reference surface candidate rule).
- Known limit: merged into the shared store, the 20_20 world audio can still load on `?map=20_21` until the tile audio runtime (02-46) selects by tile.
- Tests: `test_tile_manifest_step.py`, `nativeTileChunkManifest.test.ts`, `loadNativeTileChunks.test.ts`, `selectedNativeTile.test.ts`, `nativeSection.test.ts`; browser: `NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-walk.spec.ts`.
- Served catalog: `NATIVE_STORE_ROOT=world` serves `public/l2` with the world lane records merged by the restage rule (`print_lane_union_catalog.py`); the load-check stays keyed on the lane catalog SHA-256.
- tile:20_21 browser walk: pass (2026-11-09 12:51 Riga, three viewports, heading `20_21 · native world tile`; lane catalog `ccaaf62b...e6c1`, load-check `pass`; screenshots `artifacts/world-evidence/union-world-tile-walk-20_21-*.png`).

## Static meshes per chunk (02-29)

Plan 02-29, WORLD-01. `convert_tile.py --map 20_21 --step meshes`, then `--step manifest`, then `write_lane_catalog.py --lane world`.
- Passes: every StaticMeshActor with a StaticMesh reference goes to the 4x4-sector chunk whose half-open native rectangle holds its serialized origin (no Z window), or is one gap row. 20_21: 3,205 actors, 160 converted models, 2,324 placements in 16 chunk manifests (largest `chunk-2-1`, 122 models), 881 gap rows. A second meshes run is a ledger skip.
- Model archives at `/l2/<archiveSha256>/asset.l2asset` with `model.glb` beside them.
- 20_20 oracle subset: the generic plan holds all 157 oracle placements (of 4,183 planned) with the same sourceMesh and identical 3x3 columns, one common translation difference (0, 0, 0), and requests all 62 oracle models (`OracleSectionSubsetTests`, run on DATABASE-PC).
- Browser: `/?map=20_21` instantiates each placement at its source matrix through `instantiateNativeModelPlacements`; the inspection adds `modelCount`, `placementCount` and `meshGapCount`. tile:20_21 static mesh check: pass (2026-11-09 16:02 Riga, desktop and phone landscape, lane catalog `34b83e83`).
- Open, per object (receipt `gapRows`; 02-31 rebuild counts under Movers): the tile row in `gap-rows/meshes.json` is `gap` with the first reason in export order. Material parity stays open (MAT-01).
- Retired: the 20_20 model append chain (overlap selection, model append, static normal restore) and its tests.
- Evidence: `artifacts/lane-store/world/work/tile__20_21/meshes/receipt.json` and `products/static-meshes.json` (ignored); tests `test_world_static_mesh_step.py`, `test_world_tile_general_steps.py`, `test_tile_manifest_step.py`, `nativeTileChunkManifest.test.ts`, `nativeModelPlacements.test.ts`, `loadNativeTileChunks.test.ts`, `tests/browser/world-tile-meshes.spec.ts`; screenshots `test-results/world-tile-meshes-20_21-desktop.png` and `-phone-landscape.png`.

## BSP and collision (02-30)

Plan 02-30, WORLD-01, WORLD-08, VIS-01 and MOVE-01 inputs. `convert_tile.py --map 20_21 --step bsp`, `--step collision`, then `--step manifest` and `write_lane_catalog.py --lane world`.
- BSP passes: `scripts/world/level_model.py` reads the serialized Level.Model through the vendored reader (123/28 only; other layouts are `map-version-unsupported` or `map-licensee-unsupported` gaps), range-checking iRenderBound, iCollisionBound and every LeafHulls run. 20_21: 4,493 nodes, 4,242 drawn after the sky zone (zone 5) and the `visual: skip` flags of `recipes/world/bsp-poly-flags.json`; 4,222 nodes in 16 chunk GLBs at `/l2/maps/<sha>/native-tile-chunk-bsp/bsp.glb`, 97 D5 sections, 4,222 node ranges, 11,595 triangles. 20 nodes of `20_21.Brush335` lie outside the chunk grid (one `bsp-node-outside-chunk-grid` row).
- Sections: material, PF_UNLIT, lightmap texture and front-zone outdoor class (zone 0 or bSunAffect; outdoor zones 0, 1 and 5). 82 sections have a lightmap record whose page stays `null` until 02-62 decodes the FLightmapIndex records (MAT-02); 15 have none (`-1`). 39 sections are outdoor.
- Materials: 22 surface roots go through the 02-59 graph and program (`native-materials/<sha>/`); 20 are textured from the converter's diffuse chain. Magenta with a named gap: `FX_E_T.WaterSurfaceShaderSet.WaterShader01` (`material-class-unported:Engine.TexOscillatorTriggered`, `decode-failed:ValueError:No diffuse material adapter for Combiner`) and `T_oren.Swamp_Shader` (`decode-failed:ValueError:No diffuse material adapter for TexPanner`). No section is translucent by the program blend rule.
- 20_20 oracle subset: the generic step (4,675 nodes, 14 of 16 chunks with BSP, 103 sections, 11,653 triangles) draws all 20 Brush397 and Brush610 oracle nodes at identical native positions (`OracleBrushSubsetTests`, run on DATABASE-PC against the served sources pinned by `recipes/world/oracle/20_20/expected.json`).
- Collision passes: one tile resource `native-tile-collision` (BSPT, 4,493 nodes, 20,987 LeafHulls words, bRootOutside 0, `/l2/maps/dd2a075b2718e74bbf04a04036677d9db791b315c38de2b5e53a219b3774746f/native-tile-collision/asset.json`) and one chunk resource per chunk with VOLS, SMSH, PLAC and TERR, in source units with axes UE2 Z up, written by `scripts/world/typed_payload.py` (byte-equal to the 02-56 golden payload; `asset.json` pins `payload.bin`).
- 3,205 StaticMeshActors: 2,272 `slots` (LOD0 triangles of the EnableCollision slots), 52 `declared-none`, 881 `collision-unreadable` (no converted model, the meshes-step gaps). Volumes: 7 BlockingVolumes blocking (chunk-2-1, chunk-2-2, five in chunk-3-0), `20_21.PhysicsVolume4` declared-none (no Brush). Flags resolve through the 02-59 class-default reader with authored, class-default or ue-zero provenance. Per-chunk VOLS, SMSH, PLAC and TERR counts are in the collision product `chunks` records.
- Browser: `/?map=20_21` loads each chunk BSP GLB pinned by SHA-256 (128 MiB cap), keeps sections and node ranges on the tile view for the 02-63 visibility binding, and reports `bspMeshes`, `bspSections` and `bspResources`. tile:20_21 check: pass (2026-11-09 21:43 Riga, lane catalog `89e27bd5...`, three viewports).
- Scope: the collision resource is the input of the client's MOVE-01 port (02-48, 02-65), not native geodata (GEO-01) and not movement authority, which stays with the server (MOVE-02). The browser route does not bind it yet.
- Open: WORLD-08 is provisional, owner review. The IsCsg outside-bit, brush transform order, blocking flag, static mesh triangle and translucent blend rows run as `unconfirmed` defaults and the static mesh selector row as `unknown` (Engine.StaticMesh is intrinsic in the Interlude Engine.u) until POL-04. BSP lightmap pages and UVs convert through the world lighting step (02-62, MAT-02). 20_20 collision is not run yet (its meshes unit is sealed since 02-61). The `native-materials` files are written but no manifest pins them yet, so a restage does not carry them.
- Retired by this plan: the 20_20 BSP floor and building converters and their tests; the BSP floor helper module that the legacy sky converter imported went with it in 02-45.
- Evidence: `artifacts/lane-store/world/work/tile__20_21/bsp/` and `collision/` receipts and products (ignored); tests `test_world_bsp_step.py`, `test_typed_payload_writer.py`, `test_world_collision_step.py`, `nativeBspResources.test.ts`, and the 02-29 manifest, loader and browser tests.

## Movers (02-31)

Plan 02-31, WORLD-01 and MOVE-01 inputs. `convert_tile.py --map <XX_YY> --step movers`, then `--step manifest` and `write_lane_catalog.py --lane world`.
- Passes: `read_mover_actor` (`scripts/world/mover_records.py`) reads every export of class exactly `Engine.Mover` with the class evidence of the shared unit `class:Engine.Mover` step `class-defaults` (UELib decompile, `qualified_classes` checks unchanged); each converts or is one `mover-unsupported:<token>` gap. Converted movers go to `/l2/movers/<sha>/tile-movers.json` (kind `native-tile-movers`), the tile resource `movers`.
- 20_20 oracle: 8 of 8 movers with closed and open matrices, keys, MoveTime and server ids equal to the served `map-20-20-movers` manifest `0de5d083...` and the same two model GLBs (`OracleMoverSubsetTests`, run). A forced rebuild wrote a byte-identical product; a second run is a ledger skip.
- 20_21: 3 Engine.Mover exports, 3 converted (two share `oren_curumadungeon_npc1`), 0 gaps.
- 20_21 rebuilt under the current converter (its meshes and bsp units were stale): meshes 194 models, 2,923 placements, 282 gap rows (279 duplicate leaf name, 3 single payload); collision version 2 with 2,871 slot placements, 285 `collision-unreadable` (3 movers); tile:20_21 static mesh check pass on the same lane catalog.
- Collision: each mover keeps its 02-30 `decide_placement_collision` decision; the collision step writes one MOVR record per listed slot (closed and open matrices in source units). All 11 movers are `gap` (`rule-disagreement:bStatic`: Engine.Mover is not bStatic, which the cross-check rule needs), so each adds no MOVR record and one `collision-unreadable` row; tile mover meshes carry no `worldCollision`.
- Browser: `/?map=20_20` places the 8 movers closed at their closedMatrix; inspection `moverCount` 8, `moverCollisionMeshCount` 0. tile:20_20 check: pass (2026-11-10 00:28 Riga, lane catalog `dee3ceb0...`, three viewports). The screenshots show the tile at the anchor, not the movers.
- Open: door interaction on tile movers (open and close through the runtime) is wired by integration; the bStatic cross-check for movers is a WORLD-08 owner-review row.
- Retired: `native_map_movers.py`, the 20_20 derive and stage scripts and their tests. Tests: `test_world_mover_step.py`, `nativeTileMoverManifest.test.ts`, `nativeMoverLoader.test.ts`, `tests/browser/world-tile-movers.spec.ts`.

## BSP visibility resource (02-61)

VIS-01, WORLD-01 and FX-01 inputs. `convert_tile.py --map <XX_YY> --step emitters`, then `--step bsp-visibility` (needs sealed meshes, bsp and emitters), then `--step manifest`.
- `scripts/world/level_zones.py` is the one zone table (bSunAffect, ambient, distance fog with provenance; outdoor, sky, unresolved), also read by the bsp step. `scripts/world/bsp_leaf_membership.py` holds zone locate (PlaneDot >= 0 front), box leaf and zone queries and a separate PointCheck outside-bit walk.
- Emitters: each `Engine.Emitter` goes to `/l2/map-emitters/<sha>/tile-emitters.json` (`native-tile-map-emitters` v1) with transform, actor rules and the actors bundle writer's emitter records. 20_21: 6 placements, 9 emitters (6 Mesh, 3 Sprite), 0 gaps; 20_20: none, pass, no resource.
- Visibility: one typed payload per tile at `/l2/maps/<sha>/native-tile-bsp-visibility/asset.json` (NODE, BNDS, LEAF, ZONE, PORT, RNGE, MEMB); rules are rows of `recipes/world/bsp-visibility.json`, unsourced limits at their most-visible value until POL-04.
- Census `docs/parts/world/bsp-visibility-census.json` (16 x 16 x 8 samples): 20_21 4,493 nodes, 1,532 leaves, 39 zones, 62 portals, 2,923 mesh members, 6 emitters (2 in solid space), 0 disagreements; 20_20 4,675 nodes, 30 zones, 3,439 members, 12 leaf and PointCheck disagreements (`bsp-visibility-solidity-disagreement`).
- Browser: tile:20_21 with both new resources passes `world-tile-meshes.spec.ts` (2026-11-10 03:33 Riga). Open: emitter textures and meshes convert with 02-69 playback; the walk is 02-63. Tests: `test_level_zones.py`, `test_world_bsp_visibility_step.py`, `test_world_map_emitter_step.py`, `nativeTileManifestResources.test.ts`.

## Reader licensee growth (WORLD-01, 02-52)

One gate, `require_reviewed_reader_layout(reader, summary)` in `scripts/world/reader_licensee_layouts.py`, serves `read_g16` (`g16-heightmap`), `actor_properties` (`map-actor`), `native_terrain` (`terrain-info`) and `build_map` (`raw-map`); an unlisted (version, licensee) raises the census gap reason. Each reviewed pair has cited evidence, a synthetic fixture in `tests/fixtures/world-readers/` and a `cross-checks.json` row with `equal: true` against the SHA-pinned Elbera `tools/l2lib/ue2package.py` (commit 12c9656), on lock-equal files only.

| Reader | Reviewed licensees (123/x) | Evidence | Cross-check, tile |
|---|---|---|---|
| g16-heightmap | 12, 15 (no reserved int32); 16, 18, 19, 20, 22, 23, 25, 28 (reserved int32) | Elbera `tools/l2lib/README.md` "Lineage2 UMaterial extra fields", UEViewer `UnMaterial2.h` secondary | mip0 SHA-256 equals Elbera `parse_texture` plus `mip_bytes`: 12 16_24, 15 23_10, 16 17_25, 18 18_13, 19 24_11, 20 16_21, 22 19_21, 23 18_24, 25 20_15, 28 20_21 |
| map-actor, raw-map | 16, 18, 19, 20, 23, 25, 28, 30, 31 | Elbera README "Property tags", `ue2package.py` state frame and packed tags; 30 and 31 also the material fields (shader block kept raw) | property projection of every actor `build_map` reads equals Elbera `read_properties`: 16 24_10, 18 17_18, 19 26_11, 20 24_26, 23 17_20, 25 15_20, 28 20_21, 30 17_22, 31 19_23 |
| terrain-info | 18, 19, 20, 23, 25, 28, 30, 31 | as map-actor, plus Elbera `docs/native-terrain-collision-inputs.md` (TerrainInfo serializer for licensee 17 or later) | TerrainInfo property end and the TerrainSector set equal Elbera's export table, same tiles |

- Still refused: `terrain-info` 123/16 (the cited serializer covers licensee 17 or later, and the 123/28 payload reader does not consume 24_10; nothing fitted); terrain height 118/11 of `t_17_23.utx` (`terrain-height-version-unsupported:118`); `entry` 123/0 and the version 118 maps (outside this plan); `19_11` and `20_11` stay `terrain-height-package-missing`.
- The T-15 and T-18 heightmaps hold one constant sample on every tile, so their rows rest on the exact byte range both readers consume.
- Plan 02-71 moved `build_map` to `scripts/world/raw_map_extraction.py` without the section branch, raised `RAW_MAP_STEP_ALGORITHM_VERSION` to 2 (the raw manifest loses the section-selection gap line) and resealed every world unit. The census, Lobby's status and the sealed raw steps of the newly readable tiles follow in 02-54.
- Record a row: `python -B scripts/world/reader_cross_check_rows.py --client E:/Lineage2-client --reader <reader> --licensee <x>`. Tests: `test_world_reader_licensees.py` (the real-client classes re-derive every row and run `build_map` for each heightmap row tile).

## Sky and world audio (02-45)

WORLD-02 and MAT-01 input. `convert_tile.py --map <XX_YY> --step sky`, `--step audio` (both need the sealed raw step), then `--step manifest`.
- Sky: the tile's one `Engine.SkyZoneInfo` zone of the serialized Level.Model; roots in first-node order, read through the 02-59 material graph and program (written to `native-materials/`), every original mip kept, mip 0 decoded with the pinned Pillow 12.3.0. Bundle `skies/<sha>/` (`native-sky-source-bundle`), tile resource kind `sky`. 20_20: the `sky.glb` BIN chunk equals the served `skies/f7a0b5ef.../sky.glb` (SHA `b8c5a64f...` checked first), the JSON chunk differs only in `asset.generator`; 53 nodes, 182 vertices, 76 triangles, 3 roots, 3 textures. 20_21: `interlude:20_21.Model327.SkyZoneInfo0`, zone 5, the same 3 roots and counts.
- Audio: exact references only (one lock-equal `.uax` by casefold stem, one export by casefold full name with class Sound), WAV kept only when the converter records `encodedAudioUnchanged` and the bytes equal the native payload. Ambience (`native-map-ambience`, radius from the lock-equal `system/Core.dll`, symbols in `recipes/world/ambience-radius-symbols.json`), placement audio (`native-tile-placement-audio` v1, StepSound_1..3 per StaticMeshActor) and music (`native-map-music`, MusicVolume nMusicID to `musicinfo` to `music/<string>.ogg`, AAC derivative from the ffmpeg pin in `recipes/world/music-derivative-encoder.json`) are `world-audio` tile resources.
- 20_20: 2,622 emitters (2,620 with sound, 2 omitted references), 106 sounds, types 1: 876, 2: 999, omitted: 747, equal to the staged ambience `e2fe18be...` including emitter rows and WAV hashes; 543 placements, 15 step sounds; 2 volumes, 9 tracks, restored Ogg and AAC hashes equal to the staged music `d4fca6b8...`; the join equals `tests/fixtures/world-07/music-id-join.json`.
- 20_21: 2,875 emitters (2,864 with sound, 11 omitted), 132 sounds; 2 placements, 3 step sounds; 3 volumes, 13 tracks.
- Gap rows by reason: none on either tile for sky or audio. Vocabulary `listVersion` 7 adds `sky` and `world-audio`; gap reasons `listVersion` 10.
- Deleted (owner rule, OVERNIGHT-DECISIONS rows 373 and 380): the 20_20 sky converter, sky stager and BSP floor helpers, the map ambient exporter, the music and ambience bundlers, the world audio stager, the four 20_20 audio recipes, the batch `sky` and `ambient` adapters, `assets:ambient`, and their tests.
- Browser: tile:20_21 sky check passes in three viewports (`world-tile-sky.spec.ts`, lane catalog f60ce2d8, 2026-11-10 06:15 Riga); the desktop frame looks down at the ground, the inspection proves the sky (3 meshes, textures ready, tile source id). Open: playback of tile audio is 02-46. Tests: `test_world_sky_step.py`, `test_world_audio_step.py`, `nativeSkyPresentation.test.ts`, `nativeTileManifestResources.test.ts`.

## Evidence

World docs: `docs/NATIVE_WORLD.md`. Raw extraction: `scripts/world/raw_map_extraction.py`; oracle: `recipes/world/oracle/20_20/expected.json`.
