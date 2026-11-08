# Genericity audit: is the 20_20 world built by one generic pipeline?

Date: 2026-11-08. Scope: every step that produces the 20_20 world on the SOURCE route (`/?world=interlude`) and the optional AUTHORED route (`/?world=interlude&authored=1`, DEC-OWN-8, see [EDITOR_VIEWER.md](../EDITOR_VIEWER.md)). Inputs: six refuted area audits and a run of the scripts on a second tile, 20_21. The audit is read-only.

This doc is the starting input for the L1 world lane (Warning 7, DEC-OWN-7). Scope: [PORT_SCOPE.md](../PORT_SCOPE.md). Status and order: [STATE.md](../../.planning/STATE.md), [ROADMAP.md](../../.planning/ROADMAP.md).

Evidence lives in `artifacts/native-parity/research/genericity-audit-20261108/`:

- `INVENTORY.json`: the 115 steps by ID, each with `evidence` (files, lines, pinned hashes), `probe20_21`, `areaClasses`, `designStage` and `genericFix`, plus `openGaps`.
- `REPORT.md`: the unabridged report with every evidence line.
- `probe/` (logs in `probe/logs/`) and `synthesis/`.

This doc keeps every step and finding with its main pointer. Look up an ID in `INVENTORY.json` for the full evidence line. Paths `research/...` resolve under `artifacts/native-parity/research/`.

## 1. Answer

**Warning 7 is true.** The 20_20 world comes from a chain of per-tile, hand-pinned steps, not one generic pipeline. Of 115 steps, only 9 are both script-only (A) and generic (G).

- 45 are tile-specific: they need code edits to run for another tile.
- 24 more are hand-qualified on 20_20. 13 other steps also carry hand-qualified pins (12 tile-specific), so 37 are hand-qualified in total.
- 15 need a per-tile recipe or selection that a person writes.
- 33 are hand or interactive changes that no script reproduces.

Four facts carry the verdict:

1. **The visible world ends a seven-link correction chain.** Catalog section `map-20-20-section` points at manifest 2e73654e. It comes from 062218e6 through `migrate-native-terrain-runtime.py` (9841a8fa), `derive-native-map-overlap.py` (fdee1286), `derive-native-map-bsp.py` (93139ab0), `derive-native-map-model.py` (e006306d), `derive-native-map-terrain.py` (cbddefef) and `derive-native-map-building.py` (2e73654e). Each step pins its predecessor's hash and rewrites `public/l2/catalog.json` in place. The live terrain does not descend from the migration output: it comes from a hand-typed command on a research raw map (`research/audio-world-20261106/map-correction-first`). The AUTHORED scene adds one-shot capture, a hand-retried import, Editor UI saves, hand restores of files the Editor deleted, and four append scripts.
2. **Every link above the bottom layer fails on 20_21.** 18 scripts fail on hard-coded `maps/20_20.unr` paths, the pinned map hash 1beddad2, pinned base-bundle hashes, or pinned actor, brush and sector names. With 20_21 renamed to `20_20.unr`, the hash pin fails next. 9 scripts ran and 1 ran partly, only with hand-written recipes and a hand-built input lock.
3. **The "generic" bottom layer is format-qualified on 20_20.** Map, heightmap and terrain readers accept only UE123/licensee 28 (`scripts/native_map.py:94-95, :209-210, :306-307`; `scripts/native_map_geometry.py:115-116`). 67 of 153 fleet tile maps are licensee 28. 39 tiles also have a licensee-28 `T_<tile>.utx` (inference: the heightmap sits there, as on 20_20 and 20_21). The static-mesh material reader's hand-grown licensee list rejects 56 of 212 `.usx` packages; on 20_21, 599 of 3,205 placements use rejected layouts.
4. **20_20 cannot be rebuilt from committed code.** Retained receipts record implementation hashes (raw 6a397219/e9b3216d, geometry 27b34b7d/8224bce2, converter d878a532) that match no commit; today's code hashes to 67ff8811, b28fb11d and 8035c080. The one recorded procedure says not to run `pnpm assets:migrate` (`research/terrain-uv-migration-20261106/implementation/COMMANDS.md:25-27`). 31 script files, 15 runtime files, 14 recipes and 56 test files contain a `20_20`/`20-20` literal; 10 scripts and 4 runtime files pin the 20_20 map hash.

Already generic: the package reader, the raw extractor and terrain section maths (for licensee 28), the indexed-triangle overlap test, the BSP node reader, the migration orchestrator and the fleet stager. On 20_21, `native_migration.py --prove-rebuild` rebuilt all 52 products identically. That layer is a good base. It does not build the world today.

## 2. Counts

| provenance \ genericity | G generic | P hand recipe | T tile-specific | Q hand-qualified | total |
|---|---|---|---|---|---|
| A script, no human values | 9 | 3 | 2 | 6 | 20 |
| B script + human values | 7 | 7 | 18 | 6 | 38 |
| C correction of earlier output | 3 | 0 | 16 | 0 | 19 |
| D hand / interactive | 12 | 4 | 8 | 9 | 33 |
| U undetermined | 0 | 1 | 1 | 3 | 5 |
| total | 31 | 15 | 45 | 24 | 115 |

- **P vs T**: does the step run for another tile with a new hand recipe (P), or does it need code edits (T)?
- **Q**: the step runs, but its acceptance pins or admitted format are hand-qualified on 20_20. `+Q` marks T steps with such pins.
- **Runtime gates**: constants that only decide what loads are B; constants that become content or behaviour (positions, speeds, offsets) are D.
- **Rewrites**: a script that rewrites earlier output (catalog, saved scene, bundle) is C.

The 31 G steps are mostly not world extraction: 12 are hand presentation values and 7 are human-chosen policy constants. The area inventories held 217 items before deduplication (map 31, models 38, terrain 32, probe 33, runtime 53, editor 30).

## 3. Tile-specific steps (T, 45)

They do not run for 20_21 without code edits. Most are the correction and append chain. "Probe N" is a log in section 7.

Terrain:
- **D05** `migrate-native-terrain-runtime.py` [C/T]: 062218e6 -> 9841a8fa, 735 V scalars, models not reconverted. Probe 16.
- **D06** TerrainSector247 choice [B/T]: research `audit-adjacent-terrain.py:118-149` asserts [112,240]; `make-candidate-native-xyz.py` hard-codes sector 247.
- **D07** `extract-native-terrain-patch.py` [B/T]: pins RAW_TERRAIN 86521817, REFERENCE_GLB 39417edb. Probe 15, 15b.
- **D09** `derive-native-map-terrain.py` [C/T +Q]: appends sector 247, e006306d -> cbddefef; pins 47fb7020. Probe 20, 20b.
- **D11** `audit-terrain-uv-branches.mjs` [B/T +Q]: pins audit cd6e8fb6, catalog badd513d, bounds 64/112/208/255.
- **D12** `nativeTerrainPatch.ts` runtime acceptance [B/T +Q]: one patch, sector 247, Y origin 65536 (`:80-89`); also gates AUTHORED. 20_21 row 0 is at Y 98304.
- **D13** `nativeTerrainPreview.ts` [B/T]: 9 layers, mask sizes by index (`:184-209`); failure falls back to neutral terrain. 20_21 alpha maps fail `:187` (inference).
- **D14** Authored terrain ShaderMaterial [B/T]: frozen in `assets/native-world.scene/meshes/native-34fc990641dc04014d49e47c.json` with inlined 20_20 matrices and 062218e6 textures.
- **D15** Editor terrain capture (`capture-native-editor-terrain.mjs`, `captureNativeTerrain.ts`) [A/T]: exactly one patch; the GPU renderer string seeds the Editor mesh id (snapshot 1e3780c2).
- **D16** `append-native-editor-terrain.mjs` [C/T]: PATCH_ID, MAP_HASH, Y origin 65536; not idempotent on 2e73654e. Probe 25d.
- **D18** Terrain decorations (DecoLayers grass) [U/T]: no product; research `collect.py` hard-codes 20_20; DXT3 unsupported (`texture_mips.py:16`).

Models and overlap:
- **E03** Dion tree conversion [B/T]: one hand-written `research/map-overlap-expansion-20261106/new-tree-conversion/request.json`.
- **E04** `restore-native-static-normals.py` + `static_normals.py` [C/T +Q]: TREE_PROOF 56fa4c10; its presence changes the converter hash. Probe 32.
- **E05** `derive-native-map-model.py` [C/T]: Actor3703, 93139ab0 -> e006306d, 62/157. Probe 19.
- **E06** Editor model capture + append for Actor3703 [C/T]: BASE 93139ab0; an API override not exposed by the CLI. Probe 25b.
- **E08** `derive-native-map-overlap.py` [C/T]: 9841a8fa -> fdee1286, +5 placements; in-place catalog text replace (`:140-175`). Probe 11.
- **E09** `append-native-editor-placements.mjs` [C/T]: snapshot 230873f5; only reuses existing models. Probe 25a.

BSP and movers:
- **F02** `native_bsp_floor.py` [B/T +Q]: Brush397, 10 nodes picked from screenshot points; texture borrowed from GLB slot 11; own hash in content (`:299`). Probe 12, 13.
- **F03** `derive-native-map-bsp.py` [C/T]: fdee1286 -> 93139ab0; pins 940 files. Probe 17.
- **F04** BSP floor Editor append + `repair-editor-signed-zero.py` [D/T]: asserts 56 normals; `material-reference.json` has no generator.
- **F05** `native_bsp_building.py` [B/T]: Brush610 picked from a screenshot point; own hash in content (`:176`). Probe 12, 13.
- **F06** `derive-native-map-building.py` [C/T]: cbddefef -> 2e73654e; refuses unless 3 Editor-saved materials exist. Probe 18.
- **F07** `append-native-editor-bsp.mjs` [C/T]: refuses if Editor-saved materials 87397088, 05f4964e, c6c88a1b change. Probe 25c.
- **F08** Runtime section and BSP validation [B/T]: `loadNativeSection.ts:73` caps 128 models, `:97-108` 4 BSP; rejects a whole tile (285 meshes on 20_20); also AUTHORED.
- **G01** Mover extraction (`native_map_movers.py`) [A/T +Q]: pins MAP_PATH, MAP_SHA and 8 actors; no map argument. Probe 21, 21b.
- **G02** `stage-native-movers.py` [C/T]: hard-codes "map-20-20-section" and "map-20-20-movers".
- **G03** `loadNativeMovers.ts`, `nativeMoverManifest.ts` [B/T]: throws unless the 20_20 map hash (`:59`); doors silently vanish on terrain-hash mismatch.

Sky, flames, music:
- **H01** `native_sky.py` [B/T +Q]: exports[389], zone 28, SKY_ORIGIN. Probe 29.
- **H02** `stage-native-sky.mjs` [C/T +Q]: f7a0b5ef, SkyZoneInfo0, exactly 21 files / 3 parts.
- **H03** `nativeSkyPresentation.ts` [B/T +Q]: manifest f7a0b5ef, 3 meshes; the catalog has no skies key.
- **I02** `nativeFlamePresentation.ts` [B/T +Q]: 12 hard-coded StaticMeshActor ids.
- **I03** `nativeFlameBillboards.ts` [B/T +Q]: per-actor XYZ table, regex `^interlude:20_20\.StaticMeshActor`.
- **J05** Music ID join (`Join-MusicIds.ps1` -> MUSIC_ID_JOIN.json 9dbb003c) [D/T]: hard-coded export indices, run on IMPORTA-PC.

Catalog, staging, Editor, runtime:
- **K03** Catalog pointer chain 062218e6 -> 2e73654e [C/T]: derive scripts rewrite the hash in place; orphans 67a9ba81, 770c4026.
- **K04** Staged public state [D/T]: `public/l2` and `public/scene` are local, git-ignored and order-dependent; stagers need hand --id and --expected-catalog-sha256.
- **K06** Legacy route helpers [D/T]: `sourceColliderPolicy.ts:13-32` hand collider overrides for 17_25.
- **L02** Editor capture, `pnpm assets:editor` [B/T]: default map-20-20-section; ids from manifest hash and sibling index; capture hash baec89b5 vs committed 0ddd4036.
- **L03** 2026-11-05 import retry by hand [D/T]: `artifacts/native-parity/editor/world-import-capture.log` and siblings.
- **L05** Channel sidecar `assets/native-world.scene.native-editor-channels.json` [D/T]: seeded by one-off `artifacts/native-parity/editor/world-import/seed-channel-recovery.mjs`, then edited in place.
- **L06** Editor UI move of StaticMeshActor1771 +0.75 m X [D/T]: `assets/native-world.scene/nodes/native-1601d53f5ccd4772a5aadab6.json`; see [VERIFICATION.md](../VERIFICATION.md).
- **L11** `migrate-native-terrain-uv.mjs` [C/T +Q]: 735-value byte patch bc541071 -> 549a7fef; pins 062218e6.
- **L13** AUTHORED validators [B/T]: reuse the 20_20 gates (`loadAuthoredNativeSection.ts:65,85`).
- **L17** `share-native-terrain-export-materials.mjs` [C/T]: hard-codes TerrainSector247.
- **M01** Runtime section selection [B/T]: default "map-20-20-section", no `?map=` (`loadNativeSection.ts:221`).
- **M09** Hard-coded "20_20" UI text [D/T]: `createNativeSliceRuntime.ts`, `nativeSliceDebug.ts`, `worldAudioControls.ts`.

## 4. Hand-qualified steps (Q, 24)

A new tile needs the same manual qualification: someone inspects its output and pins counts, hashes or a reviewed format.

- **B01** Raw map extraction, `native_map.build_map` [A/Q]: raises unless UE123/licensee 28. Probe 01, 02.
- **B03** Retained products vs current code [D/Q]: receipt hashes match no commit; one geometry receipt c993ea81 produces 062218e6/67a9ba81/770c4026 under three converters.
- **B04** Live terrain lineage [D/Q]: receipt 4b8c3a7c = research map-correction-first; `COMMANDS.md:10-27` "Do not substitute full pnpm assets:migrate".
- **C01** Start location PlayerStart10 [D/Q]: GameInfo rule read by hand (`research/native-location/README.md:8-41`); no script. The probe picked PlayerStart4 by hand.
- **D01** Terrain section builder (`native_map_geometry`) [A/Q]: UE123/28, one TerrainInfo, no rotation/pan, no Inverted. Probe 03.
- **D03** Texture mip gate `texture_mips.py` [A/Q]: P8/DXT1/DXT5, licensee 20/28/30 only; 56 of 152 tile textures pass.
- **D04** Mask-UV correction rule [D/Q]: 20_20 hash, offset [64,208], quads [48,47]; one capture fe2e05c2 covers X64..112/Y224..255; no evidence for x>240. On 20_21 it silently does not fire.
- **D08** Native REA qualification of sector 247 [D/Q]: `join_source.py` against a retained apitrace capture; CHECKPOINT-MANIFEST 47fb7020.
- **D10** `compare-native-terrain-patch.mjs` [B/Q]: hand candidate hashes; imports research browser-probe.ts.
- **D17** Deco-grass footstep bundle [B/Q]: T_20_20 alpha maps, expectedCoverage pinned; single-bundle refusal.
- **E01** Section model conversion [A/Q]: hand-grown REVIEWED_VERSIONS {16,19,20,22,23,25,28,30,31}; one failed mesh blocks the tile. Probe 04, 05, 08, 09.
- **E02** Missing-model bounds scout [D/Q]: proof 56fa4c10 feeds three scripts; producer not retained.
- **H04** Sky colour comparison [B/Q]: hand SKYBOX/HAZERING/CLOUD1 bindings, COLOR13, five copied Env/timeenv inputs.
- **I04** Flame material graph `nativeMaterialGraph.ts` [A/Q]: FX_E_S 259ed78d and 9 class hashes; "not a generic UE evaluator".
- **J01** `export-native-map-audio.py` [A/Q]: expectedInventory 2622/2620/106/2. Probe 22a-22d.
- **J04** Music bundle `world_music.py` [B/Q]: hard-coded snapshot root, no --client; expectedVolumes pinned. Probe 24a.
- **J09** Placement StepSound bundle [B/Q]: section 2e73654e, expectedCoverage 157/8/149/24/447/3. Probe 30.
- **J10** Stepsound package bundle [B/Q]: hand walk/run counts (Stone 2/2, others 3/3).
- **K05** Legacy Talking Island staging `stage-world-assets.mjs` [U/Q]: copies pinned outputs from `C:/laragon/www/lineagen/.assets/talking-island`.
- **L09** Post-save hand restores [D/Q]: `artifacts/native-parity/editor/sky-save-20261106/preserve-save-inputs.py` asserts 20 overlays, 7 binaries.
- **L19** Script provenance [U/Q]: scene scripts first committed (b6fba2e, b47dc95, 6138111) after they ran; append receipts lack hashes.
- **L20** Rebuild of the authored scene by scripts alone [U/Q]: never attempted; blocked by a sidecar conflict and loss of L06/L07.
- **N01** Tests pinned to 20_20 counts and hashes [D/Q]: pipeline, unit and browser; 20_21 gives 11424 exports, 3205 StaticMeshActors, 2875 ambient objects (probe 02).
- **N02** Preservation baseline [D/Q]: `artifacts/native-parity/research/native-ffighter-world-20261107/BASELINE.json`, 2,311 protected paths.

Also carrying hand-qualified pins (13): D09, D11, D12, E04, F02, G01, H01, H02, H03, I02, I03, L11 and M05.

## 5. Hand and interactive changes (D, 33)

These break the owner rule that everything comes from our scripts. The ones that change world content: B04, C01, D04, E02, F04, L03, L05, L06, L07, L09. Listed above: B03, B04, C01, D04, D08, E02, F04, J05, K04, K06, L03, L05, L06, L09, M09, N01, N02. The other 16:

- **A01** Map choice 20_20 [D/P]: job ids in `recipes/native-migration.json:36-48`; LocalMap decoded by hand from l2.ini.
- **A06** Input lock `recipes/native-inputs.lock.json` [D/P]: 143 files, one map, grown by hand 140->143; no lock writer.
- **H05** Fog, lights, clear colour [D/G]: template Editor values; fogMode 0 = inert.
- **J03** Ambient runtime defaults [D/G]: Random 100, Radius 64, Volume 190, Pitch 64, 16 slots.
- **J06** Music input lock [D/P]: nine 20_20 music files copied by hand.
- **J07** Music playback rules [D/G]: musicVolume 0.1 from the owner l2.ini, gap 30 s, fade 2.5 s.
- **J11** Water and foot-volume footsteps [D/G]: not extracted; footVolume always null.
- **L01** Template scene `assets/native-parity.scene` [D/G]: also the SOURCE route scene; no 20_20 values.
- **L07** Flame replay values [D/P]: 0.25 / 0.75 / 0.5 / 1.5 only in native-world config; code defaults 0/0/1/1.
- **L08** Editor save rewrites [D/G]: maxSimultaneousLights 4->8 on 413/835 materials, renames, deleted binaries.
- **L10** Editor Play export overwrites `public/scene/native-world.babylon` and dist [D/G]: no UV2; `pnpm generate` repairs it.
- **L12** AUTHORED attach keeps Editor edits [D/G]: embedded manifest never hash-checked.
- **M04** Movement speed [D/G]: aCis humanFighter walk 80 / run 115 for every profile.
- **M05** Greater Musveren [D/G +Q]: +1.4 m X and a pinned NPC profile.
- **M07** World camera [D/G]: Editor round-trip values.
- **M08** Editor-saved script values [D/G]: fighterIdle, leatherShirt, materialTint.

## 6. What is already generic

- **A/G (9)**: A03 package unwrap and tables; A04 whole-client catalog; A05 UModel and UELib at absolute paths; A08 class defaults; E07 overlap core; F01 BSP reader core (vendored `lineage2elbera_bsp`); F09 walk-support admission; L14 `pnpm generate` pack chain (DEC-OWN-8 moves its Editor part to optional `pnpm generate:editor`); M10 placement index.
- **G with hand values (22)**: the 12 D/G steps in section 5, plus C04 spawn candidate, F10 movement policy, G04 door policy, L04 scene writer, M02 spawn offset, M03 spawn yaw, M06 ground clearance [B/G], and L15 UV2 preserve, L16 fog preserve, L18 material restore [C/G].
- **P, hand per-tile recipe (15)**: A01, A06, J06, L07 (section 5); A02 fleet inventory; A07 fleet staging; B02 raw-map recipe with a mandatory section box around PlayerStart0; C02 and C03 section recipes; D02 terrain texture list; I01 flame model policy; J02 ambience recipe; J08 world-audio staging; K01 migration orchestrators; K02 `stage_native_runtime.py`.

## 7. Second-tile probe (20_21)

Scratch root `artifacts/native-parity/research/genericity-audit-20261108/probe`. It fetched `maps/20_21.unr` (sha e123be27...f93), `T_20_21.utx` and four `.usx`, verified every hash against IMPORTA-PC, and wrote nothing to `inputs/`, `recipes/`, `public/`, `assets/` or `dist/`. Result: 9 ran, 1 partial, 18 failed.

Ran, without code changes:
- `native_map.py` (01, 02): 165 unresolved packages with the map alone; 0 unsupported after hand-staging T_20_21.utx and 5 usx.
- `native_map_geometry.py` terrain (03): 2401 vertices / 4608 triangles / 9 layers per hand rectangle; 238/256 sectors with cached-Z mismatch.
- `native_map_geometry.py` section, partial (04, 05, 08, 09): A 1/7 models, B 11/12, C 20/20 (the only error-free 3x3 rectangle).
- `read_class_defaults` (06): identical to the research copy.
- `native_map_overlap.py` (07, 10): section C only, 0 additions.
- BSP reader core (14): Model327, 4493 nodes, 495 brushes, 0 unreachable.
- `export-native-map-audio.py` (22a-22d): 132 sounds, success only after copying expectedInventory from its own output.
- `bundle-native-ambience.py --plan` (23): hand recipe; 2875 emitters, 132 sounds.
- `native_migration.py` (26-28): hand recipe + 15-file hand lock; --prove-rebuild 52/52 identical.
- `native_source_stage.py` (31): staged the hand lock after remote hash proof.

Failed (log): derive-native-map-overlap (11), native_bsp_floor and native_bsp_building (12, 13), extract-native-terrain-patch (15, 15b), migrate-native-terrain-runtime (16), derive-native-map-bsp (17), derive-native-map-building (18), derive-native-map-model (19), derive-native-map-terrain (20, 20b), derive-native-map-movers (21, 21b), export-native-music --plan (24a), the four append plans (25a-25d), native_sky (29), bundle-native-placement-audio --plan (30), restore-native-static-normals (32). Messages: `INVENTORY.json` `probe20_21`.

Not run (browser, or writes to `public/` or `assets/`): the stagers, Editor import and capture, compare and measure scripts, migrate-native-terrain-uv, the share and preserve scripts, stage-world-assets, all --stage/--apply modes. Runtime gates are classified from code.

20_21 data a generic pipeline must handle: 3 movers (20_20 has 8); 3 MusicVolumes (20_20 has 2); 4 PlayerStarts; alpha maps 256 at layer 6 and 512 at layer 8; grid row 0 at Y 98304 (`nativeTerrainPatch.ts:82` hard-codes 65536); `cruma_s.usx` at licensee 12 and `dion_curumadungeon_boss_s.usx` at licensee 14.

## 8. Proposed design: `pnpm world:build`

**One command.** `pnpm world:build --map <tile> [--section all|start:auto|sectors:...|chunks:...] [--all|--eligible] [--stage] [--scene] [--verify-only] [--prove-rebuild]`, backed by `scripts/world_build.py`. It replaces `native_migration.py`, `native_batch.py` and the derive/append/migrate chain.

**Inputs.** The map name, a client snapshot id (IMPORTA-PC reference, or E: only after the hash lock, DEC-OWN-2) and a tile-independent config (`config/world-build.json`, `config/tools.lock.json`). Everything per tile is computed from map data: closure, start anchor (the GameInfo rule on the startup map, a declared policy elsewhere), section cut, placements and overlap, terrain, BSP, movers, sky, zones and audio.

**Stages.** 1 tools (hash-locked UModel, UELib, ffmpeg; Editor CLI only for the optional viewer). 2 census (hashes, format versions, tile list, LocalMap). 3 closure (import-table walk, generated input lock). 4 raw (whole level, format registry). 5 client-wide products. 6 plan (tile frame, 4x4-sector chunks, anchor, cut). 7 terrain (whole TerrainInfo, one mask-UV rule keyed on sector layout). 8 select (no Z window). 9 convert (shared content-addressed store). 10 overlap (triangle-confirmed). 11 bsp (whole level by PolyFlags, BlockingVolumes). 12 movers. 13 zones and sky. 14 audio. 15 assemble (`.l2asset` packages, one catalog writer, DEC-OWN-5). 16 scene (optional Editor viewer scene, DEC-OWN-8). 17 overrides-pull. 18 pack and qualify.

**Corrections move upstream.** Mask UV, TerrainSector247, normals, the Dion tree, overlap, Brush397 and Brush610 become extractor or converter behaviour. The section 3 scripts retire.

**Content and provenance are separate.** Content key = sha(input hashes + stage algorithmVersion + config subset). Implementation hashes and the git commit go only into receipts. Today scripts embed their own hash in content (`native_bsp_floor.py:299`, `native_bsp_building.py:176`, `native_map_overlap.py:422-433`), so editing a comment rehashes the chain.

**Unsupported formats never block a tile.** They become per-object gap records. A format registry grows one licensee at a time, each with a fixture and a UELib cross-check. Census order: map licensee 23 (38 tiles), 25 (17), 30 (15), 18, 31, 16, 19, 20; usx 12 (42 packages), 14, 15, 18; texture licensees beyond 20/28/30.

**Acceptance rests on invariants**: conservation against an export-table census; terrain, seam and BSP invariants; reference and hash closure; a deterministic rebuild including the catalog; a headless smoke render. Today's 20_20 numbers move into a frozen `oracle/20_20/expected.json`, compared semantically.

**Presentation is data** in `recipes/presentation/world.json` and `recipes/overrides/<tile>.json`, keyed by stable source id with a fingerprint, so a stale entry is reported. `pnpm world:overrides:pull --map <tile>` diffs an optional Editor viewer save into the override file; geometry edits are refused. This replaces the UV2 sidecar, the post-save restores, the append scripts and the 2,311-file baseline.

**Multi-tile**: a shared model store; a union input lock with per-tile subsets; a tile grid from TerrainInfo Location/TerrainScale; 4x4-sector chunks (16 per tile) streamed in a ring, removing the 128-model cap at `loadNativeSection.ts:73`.

## 9. First concrete steps

New builds write to `build/world/...` on their own port while the browser verifier runs. Nothing touches `public/l2` or `assets/` until one reversible cutover.

1. **M0 Freeze the oracle.** `scripts/world/freeze_oracle.py --map 20_20` copies the live state (catalog, map 2e73654e, movers, audio, sky f7a0b5ef, scenes, sidecar) into `artifacts/native-parity/oracle/20_20-2e73654e/` with a hash manifest and `expected.json`, both committed.
2. **M1 Provenance.** Commit all generator code. Add `config/tools.lock.json` (UModel 13502e5a, UELib 64ebfa8b, ffmpeg). Give each stage an `algorithmVersion`. Move self-hashes out of content. Refuse `--publish` from an uncommitted tree.
3. **M2 Census and closure.** Promote the research fleet header scripts and `remote_hashes` into `scripts/world/census.py` with a LocalMap decoder. Add a closure walker and lock writer; explain every difference from the 143-file `recipes/native-inputs.lock.json` (input-only, DEC-OWN-5).
4. **M3 Raw.** Make the raw-recipe section box optional (`native_map.py:256-263`), drive jobs from `--map`, rebuild 20_20 raw and compare with terrain.json 86521817. Then turn licensee-28 raises into gap records.
5. **M5 Plan.** `start:auto` on 20_20 must give PlayerStart10 and sectors [64,208]..[96,240].
6. **M6-M9.** M6 terrain, per grid vertex against 39417edb and terrain247 cee7f0f6. M7 select, convert and overlap, containing the 157 oracle placements. M8 BSP (Brush397 10/48/28 and Brush610 10/52/32 as subsets), movers (8), sky, audio. M9 the single catalog writer. Retire each one-off after its oracle diff is clean.
7. **Pilot gate M12.** `pnpm world:build --map 20_21 --section all` with zero hand-written files. Expected gaps: licensee 12 and 14 meshes.

The full M0-M15 sequence is in the design input; `INVENTORY.json` maps each step to `designStage`.

## 10. Owner decisions

- **Shipping scope and gaps**: DEC-OWN-7, all 153 tiles; a failing tile or step is a gap, not hand-fixed.
- **Authored layer**: DEC-OWN-8, the Editor is an optional viewer; no per-tile Editor scenes.

## Open

No requirement covers these. Status: [STATE.md](../../.planning/STATE.md).

1. **Oracle.** The 20_20 state matches no commit. Freeze it as a regression oracle, compare a generic rebuild semantically, classify the first diffs once?
2. **Gap budget and first tiles.** Ship unsupported formats as gap records under a budget, or wait for readers? First 20_20, 20_20 + 20_21, or the 39 eligible tiles?
3. **Reader order.** Map licensee 23, 25, 30, then the rest; usx licensee 12 (incl. `cruma_s`) early for 20_21?
4. **Section policy.** Whole tiles with streaming, or an automatic start-area cut until streaming is qualified? Anchor for non-startup tiles: first enabled PlayerStart, or tile centre?
5. **Z window.** Dropping the hand window [-4000,-2500] probably adds placements beyond 157 (inference). Accept?
6. **Mask UV.** Ship other tiles with UVs marked "extrapolated", or first fund a second native capture or an Engine.dll analysis?
7. **Hand edits to keep** as overrides: StaticMeshActor1771 +0.75 m, flame presets, the camera? Editor ids change once.
8. **Non-client values**: aCis 80/115, musicVolume 0.1, door policy 2 / 1.5 / 0.8 m, Musveren +1.4 m: labelled presentation config, replace, or remove?
9. **External tools.** Vendor UModel, UELib and ffmpeg under a hash lock (licensing not checked), or keep them outside with a hash check?
10. **Cleanup and cutover.** Archive research products that feed bundles, `BASELINE.json` and the per-tile recipes after a clean oracle diff? When is the cutover relative to the browser verifier?

## 11. Method and limits

- **Re-checked**: the fleet census (67/153 licensee-28 maps; 39 tiles pass both gates; 56/212 usx outside the list; 52, not 49, `T_*.utx` at 123/28; 56 of 152, not 55, tile textures at licensee 20/28/30), probe outcomes, gate lines, job ids, catalog keys, staged bundles and literal counts.
- **Catalog changed during the audit**: `public/l2/catalog.json` at 2026-11-08 02:06:39 (sha 55c12147...; inventories cite e19989ad...). The section still points at 2e73654e (K04).
- **Not verified**: no 20_20 rebuild ran; the 20_21 rectangles are hand-chosen and section C avoids converter gaps; browser, Editor and staging steps are classified from code; the mask-UV generalisation and tile-grid formula are inferences.
- **Regenerate**: from the audit folder, `python -I synthesis/build_inventory.py`, then `python -I synthesis/build_report.py`.
