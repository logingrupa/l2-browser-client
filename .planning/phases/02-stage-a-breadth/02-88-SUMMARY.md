---
phase: 02-stage-a-breadth
plan: 88
subsystem: world
tags: [world-01, world-02, world-03, world-05, world-06, tile-batch, load-sweep, tile-walk, gap-closure]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-75 per-layer terrain gaps, 02-76 level model reader, 02-77 VOLS water volumes, 02-81 seam strip, 02-82 shared texture reader, 02-86 BSP material pins, 02-90 current-seal registry, 02-91 per-chunk tile systems, 02-92 diagnostic material slots"
provides:
  - "tests/browser/world-tile-walk.spec.ts walks every tile of WALK_TILE_IDS (default 20_21) and writes one walk record per tile to artifacts/lane-store/world/measurements/tile-walks-<catalogSha256>.json; requestedWalkTileIds in tests/browser/support/tileWalkRecords.ts"
  - "scripts/native_store/gap_census_derived_parts.py unpublished_tile_record_rows: a passing tile-derived key whose tile has no record takes its tile's non-pass manifest rows"
  - "scripts/world/convert_tile_batch.py seam_neighbours_first_order: tiles run in descending column then row, so every seam neighbour seals raw before the tile's terrain"
  - "World lane catalog b4d451dc...: 143 tile records, no batch-pending row, 143 load-check records (125 pass), 125 walk records (59 pass, 66 failed with reasons)"
affects: [02-89, 02-96, 03-16, 03-17]

actuals:
  tokens: 29000
  tasks: 3
  commits: 12

plan_head_before: 110d0378093ff9eb011bee87118326d10a381940
plan_head_after: 4f7a987

tech-stack:
  added: []
  patterns: ["walk records pinned to the served lane catalog SHA-256, written only by the walk spec", "batch order derived from the seam roles so no seal can go stale inside one process"]

key-files:
  created:
    - tests/browser/support/tileWalkRecords.ts
    - tests/unit/tileWalkRecords.test.ts
  modified:
    - tests/browser/world-tile-walk.spec.ts
    - scripts/native_store/gap_census_derived_parts.py
    - tests/pipeline/test_gap_census_derived_parts.py
    - scripts/world/convert_tile_batch.py
    - tests/pipeline/test_convert_tile_batch.py
    - docs/parts/world/EVIDENCE.md
    - docs/parts/minimap/EVIDENCE.md
    - docs/parts/movement-geodata/EVIDENCE.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "WALK_TILE_IDS: unset reads 20_21; an empty variable, empty entry, non XX_YY id or repeated id throws before any test (row 1067)"
  - "One serial describe per tile settles one walk record after the first failing walk or the second passing walk (row 1068)"
  - "Walk assertions that end a walk carry their values in the message (row 1069)"
  - "Tracer disk projection: 5,323,776 bytes per sealed tile, 766,623,744 for 144 tiles, far above the 4 GiB floor (row 1070)"
  - "A passing tile-derived key whose tile has no record counts as its tile's manifest gap (row 1071)"
  - "The batch attempts tiles in descending column then row so seam neighbours seal raw first (row 1072)"
  - "The remaining walks ran as four bounded background commands of at most 3 runs of 10 ids (row 1073)"
  - "9 walk records that name only the bspMeshes matcher are kept as recorded (row 1074)"

requirements-completed: []

duration: about 20 h wall clock over three executors (2026-11-12 21:44 to 2026-11-13 17:50 Riga), with a rate-limit stop and a T3 restart
completed: 2026-11-13
---

# Phase 2 Plan 88: Eligible tile batch, world lane sweep and walks Summary

**Every eligible tile is now converted or a listed gap on world lane catalog `b4d451dc...` (143 tile records, no `batch-pending` row), every tile record has a load check (125 pass), and every passing tile has a walk record (59 pass, 66 failed with named reasons); the border walk 15_20 to 15_21 still drops the pawn in the seam strip.**

## Performance

- Duration: about 20 h wall clock (first executor 2026-11-12 21:44 to an API rate-limit stop; second executor 2026-11-13 11:10 to a T3 restart at 15:25; this executor 15:30 to 17:50)
- Tasks: 3 of 3
- Files modified: 11 committed (plus ignored lane outputs)

## Task commits

1. Task 1 (tracer, walk spec reads `WALK_TILE_IDS`): `91532c1` test(02-88): walk every tile of WALK_TILE_IDS and record each walk under the served lane catalog; `277129e` test(02-88): name the failed walk check and its values in the walk record reason
2. Task 2 (batch, catalog, sweep, walks, border): `35a4362` fix(02-88): state a passing tile-derived key whose tile has no record by its tile's manifest gap; `d18a51d` fix(02-88): run every seam neighbour of a tile before the tile in the tile batch (the batch, sweep and walk outputs are ignored lane outputs)
3. Task 3 (evidence): `4f7a987` docs(02-88): state the world lane batch, sweep, walks and border in the world, minimap and movement-geodata evidence

The measured count since `110d037` is 12 commits; 7 of them are other agents' planning and follow-up commits in the same worktree (be3741c, 213ff1e, 952b776, 373de1a, 1904cf7, 23963fa, 0e81c6f).

## Tracer (Task 1)

- `--limit 4` sealed 15_20 to 15_23, exit 0 (`measurements/tile-batch-tracer-slice.json`, lane catalog `f807cfe4...`); all four load checks passed, all four walks failed; on the final catalog 15_20 and 15_21 fall through and 15_22 and 15_23 never come to idle.
- Free bytes (world lane store volume C:): 13,296,476,160 before, 13,275,181,056 after the tracer and `write_lane_catalog.py --plan`; drop 21,295,104 over 4 sealed tiles, 5,323,776 per tile; 144 pending tiles project 766,623,744, leaving 12,508,557,312 above the 4,294,967,296-byte floor, so the batch started (row 1070).
- Gate re-run on the final catalog `b4d451dc...`: exit 0 (tracer exitCode 0, the four tiles in the catalog with load records and walk records, walk file not empty), `pnpm typecheck` exit 0.

## Batch (Task 2)

- First batch (2026-11-12 22:12 to 2026-11-13 03:26, `--limit 149`): visited every eligible tile, then exited 1 inside `refresh_world_lane_outputs`: `tile-collision:20_25` and `tile-collision:24_13` had only a passing collision row while their tiles have no record (manifest gap `player-start-missing`). It had also sealed the terrain of 88 tiles before a seam neighbour had its raw seal, so those terrain seals went stale. Both root causes fixed with tests (deviations 1 and 2).
- Second batch (2026-11-13 11:18 to 12:40, `--limit 149`, one process, no workers): attempted exactly the 88 stale tiles, exit 0, `stop` null, wrote the lane catalog `b4d451dc...` and coverage once at its end (`measurements/tile-batch-02-88.json`). Preflight free bytes: first 26,727,051,264 (26_15 raw), last 26,424,434,688 (19_21 manifest), 1,175 preflights; no floor stop.
- `write_lane_catalog.py --lane world --plan`: exit 0, prints the main-checkout merge with expected base catalog `55c12147...`.
- Restage counts (before the first batch, then after the second; ignored helper outputs `02-88-restage-counts-before.json` and `-after-batch.json` in the orchestration folder):

| Count | Before | After |
|---|---|---|
| emitters rows with status pass | 21 (18 at algorithm 1, 3 at 3) | 76 (all at algorithm 3) |
| emitters pass rows whose records keep unparsed structs or unconverted references | 0 | 0 |
| meshes rows `decode-failed:ValueError:No diffuse material adapter for <class>` | 2,358 on 19 tiles | 0 |
| collision object gaps with evidence `field:nativeSlotProperties` | 1,062 on 9 tiles | 5,387 on 60 tiles |

  The collision count grew because collision now runs on 141 tiles (52 pass, 89 gap) instead of 9; the remaining `field:nativeSlotProperties` gaps belong to meshes that did not convert, mostly duplicate leaf names (3,403 meshes rows).
- Tiles sweep (`NATIVE_STORE_ROOT=world LOAD_CHECK_KIND=tiles LOAD_CHECK_LIMIT=143`, 1.0 h): 143 records under `b4d451dc...`, 125 pass, 18 failed: 12 `pins no native-tile-collision resource` (bsp licensee gaps and bsp failures) and 6 `The tile anchor lies outside every chunk terrain` (17_22, 20_18, 21_16, 22_19, 22_22, 24_16).
- Walks (runs of at most 10 ids, only passing tiles without a record): 125 walk records, 59 pass, 66 failed: 38 `the local player did not walk more than 1 m and come to idle within 90000 ms` (run animation at the start position), 19 `the walk ended at height <h> m, below the terrain minimum` (14 at -163.8 m), 9 `expect(received).toBeGreaterThan(expected)` from `expect(world.bspMeshes).toBeGreaterThan(0)` in openTile (16_11, 17_10, 17_11, 18_26, 19_13, 19_22, 22_21, 24_17, 25_16; row 1074).
- Border (`world-tile-border.spec.ts`, once): failed. 15_20 to 15_21; both hops end at -163.55 m, 113.57 m below the walked collision surface at -50.24 m, `startChunksBeyondRetain` empty and 0 disposed chunks. This is the open seam strip crossing (MOVE-01 read of APawn physWalking and the ULevel floor traces).
- Task 2 gate: exit 0 (pending 0, unswept 0, passing 125, unwalked 0, walk file not empty) and `write_lane_catalog.py --lane world --plan` exit 0.

## Per-tile results

Steps: 14 registered rows per tile (census excluded). The `minimap-join-unresolved:radar-texture` gap, held by every tile with a sealed minimap step, is left out of the reasons column. Walk "no walk and idle in 90 s" is the poll timeout above; "fell to <h> m" is the fall-through; "bspMeshes 0" is the openTile check. Tiles without a catalog record show "no record".

| Tile | Sealed pass | Gap and failed rows | Load | Walk |
|---|---|---|---|---|
| 15_20 | 11/14 | bsp object-gaps:3; terrain object-gaps:1 | pass | failed: fell to -162.5 m |
| 15_21 | 11/14 | bsp object-gaps:3; terrain object-gaps:3 | pass | failed: fell to -163.8 m |
| 15_22 | 12/14 | bsp object-gaps:3 | pass | failed: no walk and idle in 90 s |
| 15_23 | 12/14 | bsp object-gaps:3 | pass | failed: no walk and idle in 90 s |
| 15_24 | 12/14 | bsp object-gaps:3 | pass | failed: fell to -163.8 m |
| 15_25 | 12/14 | bsp object-gaps:3 | pass | failed: no walk and idle in 90 s |
| 15_26 | 12/14 | bsp object-gaps:3 | pass | failed: fell to -163.8 m |
| 16_10 | 12/14 | bsp object-gaps:1 | pass | failed: fell to -60.8 m |
| 16_11 | 12/14 | bsp object-gaps:1 | pass | failed: bspMeshes 0 |
| 16_12 | 11/14 | bsp object-gaps:3; emitters object-gaps:356 | pass | failed: no walk and idle in 90 s |
| 16_19 | 12/14 | bsp object-gaps:3 | pass | failed: fell to -161.1 m |
| 16_20 | 12/14 | bsp object-gaps:3 | pass | failed: fell to -163.8 m |
| 16_21 | 12/14 | bsp object-gaps:3 | pass | pass |
| 16_22 | 11/14 | bsp object-gaps:3; terrain object-gaps:1 | pass | failed: no walk and idle in 90 s |
| 16_23 | 11/14 | bsp object-gaps:3; terrain object-gaps:1 | pass | failed: no walk and idle in 90 s |
| 16_24 | 10/14 | bsp object-gaps:3; collision object-gaps:4; meshes object-gaps:4 | pass | failed: no walk and idle in 90 s |
| 16_25 | 7/14 | bsp object-gaps:3; collision object-gaps:29; emitters object-gaps:19; meshes object-gaps:29; raw object-gaps:5; terrain object-gaps:1 | pass | pass |
| 16_26 | 12/14 | bsp object-gaps:3 | pass | failed: fell to -161.8 m |
| 17_10 | 12/14 | bsp object-gaps:1 | pass | failed: bspMeshes 0 |
| 17_11 | 12/14 | bsp object-gaps:1 | pass | failed: bspMeshes 0 |
| 17_12 | 12/15 | bsp object-gaps:3; terrain-material step-pending:terrain-material | pass | failed: no walk and idle in 90 s |
| 17_18 | 7/14 | audio upstream-step-failed:bsp-visibility; bsp-visibility decode-failed:FormatError:bsp-visibility of tile:17_18 needs sealed bs; bsp map-licensee-unsupported:123/18; collision map-licensee-unsupported:123/18; lighting upstream-step-failed:bsp-visibility; minimap upstream-step-failed:bsp-visibility; sky upstream-step-failed:bsp-visibility | failed: no native-tile-collision | - |
| 17_19 | 7/14 | audio upstream-step-failed:bsp-visibility; bsp-visibility decode-failed:FormatError:bsp-visibility of tile:17_19 needs sealed bs; bsp map-licensee-unsupported:123/18; collision map-licensee-unsupported:123/18; lighting upstream-step-failed:bsp-visibility; minimap upstream-step-failed:bsp-visibility; sky upstream-step-failed:bsp-visibility | failed: no native-tile-collision | - |
| 17_20 | 9/14 | bsp object-gaps:4; collision object-gaps:21; emitters object-gaps:135; meshes object-gaps:21 | pass | pass |
| 17_21 | 9/14 | bsp object-gaps:4; collision object-gaps:23; emitters object-gaps:111; meshes object-gaps:23 | pass | pass |
| 17_22 | 7/14 | bsp object-gaps:3; collision object-gaps:65; emitters object-gaps:10; meshes object-gaps:58; movers object-gaps:14; terrain object-gaps:1 | failed: anchor outside every chunk terrain | - |
| 17_24 | 12/14 | bsp object-gaps:3 | pass | failed: no walk and idle in 90 s |
| 17_25 | 8/14 | bsp object-gaps:3; collision object-gaps:66; emitters object-gaps:18; meshes object-gaps:66; raw object-gaps:2 | pass | pass |
| 17_26 | 12/14 | bsp object-gaps:3 | pass | failed: no walk and idle in 90 s |
| 18_10 | 8/15 | bsp object-gaps:4; collision object-gaps:26; emitters object-gaps:138; meshes object-gaps:26; terrain-material step-pending:terrain-material; terrain object-gaps:1 | pass | failed: no walk and idle in 90 s |
| 18_11 | 11/15 | bsp object-gaps:3; terrain-material step-pending:terrain-material; terrain object-gaps:1 | pass | failed: no walk and idle in 90 s |
| 18_12 | 12/15 | bsp object-gaps:3; terrain-material step-pending:terrain-material | pass | failed: no walk and idle in 90 s |
| 18_13 | 12/14 | bsp object-gaps:3 | pass | failed: fell to -163.8 m |
| 18_14 | 9/14 | bsp object-gaps:3; collision object-gaps:13; emitters object-gaps:11; meshes object-gaps:1 | pass | failed: fell to -163.8 m |
| 18_15 | 6/14 | audio upstream-step-failed:bsp-visibility; bsp-visibility decode-failed:FormatError:bsp-visibility of tile:18_15 needs sealed bs; bsp map-licensee-unsupported:123/18; collision map-licensee-unsupported:123/18; lighting upstream-step-failed:bsp-visibility; manifest player-start-missing; minimap upstream-step-failed:bsp-visibility; sky upstream-step-failed:bsp-visibility | no record | - |
| 18_17 | 12/15 | bsp object-gaps:1; terrain-material step-pending:terrain-material | pass | failed: no walk and idle in 90 s |
| 18_18 | 7/14 | audio upstream-step-failed:bsp-visibility; bsp-visibility decode-failed:FormatError:bsp-visibility of tile:18_18 needs sealed bs; bsp map-licensee-unsupported:123/18; collision map-licensee-unsupported:123/18; lighting upstream-step-failed:bsp-visibility; minimap upstream-step-failed:bsp-visibility; sky upstream-step-failed:bsp-visibility | failed: no native-tile-collision | - |
| 18_19 | 12/14 | bsp object-gaps:4 | pass | pass |
| 18_20 | 9/15 | bsp object-gaps:4; collision object-gaps:67; emitters object-gaps:160; meshes object-gaps:55; terrain-material step-pending:terrain-material | pass | pass |
| 18_21 | 9/14 | bsp object-gaps:3; collision object-gaps:26; emitters object-gaps:22; meshes object-gaps:26 | pass | failed: fell to -163.8 m |
| 18_22 | 10/15 | bsp object-gaps:3; collision object-gaps:19; meshes object-gaps:11; terrain-material step-pending:terrain-material | pass | pass |
| 18_23 | 7/14 | bsp object-gaps:4; collision object-gaps:90; emitters object-gaps:121; meshes object-gaps:102; raw object-gaps:2; terrain object-gaps:2 | pass | pass |
| 18_24 | 8/14 | bsp object-gaps:4; collision object-gaps:64; emitters object-gaps:237; meshes object-gaps:64; raw object-gaps:2 | pass | pass |
| 18_25 | 12/14 | bsp object-gaps:3 | pass | failed: no walk and idle in 90 s |
| 18_26 | 12/14 | bsp object-gaps:3 | pass | failed: bspMeshes 0 |
| 19_10 | 8/15 | bsp object-gaps:4; collision object-gaps:35; emitters object-gaps:190; meshes object-gaps:35; terrain-material step-pending:terrain-material; terrain object-gaps:2 | pass | failed: no walk and idle in 90 s |
| 19_13 | 12/14 | bsp object-gaps:1 | pass | failed: bspMeshes 0 |
| 19_14 | 12/14 | bsp object-gaps:3 | pass | pass |
| 19_15 | 12/14 | bsp object-gaps:3 | pass | pass |
| 19_16 | 9/15 | bsp object-gaps:1; collision object-gaps:16; emitters object-gaps:9; movers object-gaps:1; terrain-material step-pending:terrain-material | pass | failed: no walk and idle in 90 s |
| 19_17 | 10/14 | bsp object-gaps:3; collision object-gaps:11; meshes object-gaps:11 | pass | pass |
| 19_18 | 9/14 | bsp object-gaps:4; collision object-gaps:27; emitters object-gaps:138; meshes object-gaps:27 | pass | pass |
| 19_19 | 11/14 | bsp object-gaps:4; emitters object-gaps:3 | pass | pass |
| 19_20 | 9/14 | bsp object-gaps:4; collision object-gaps:123; emitters object-gaps:226; meshes object-gaps:123 | pass | pass |
| 19_21 | 8/14 | bsp object-gaps:3; collision object-gaps:35; emitters object-gaps:28; meshes object-gaps:28; movers object-gaps:10 | pass | failed: no walk and idle in 90 s |
| 19_22 | 10/14 | bsp object-gaps:1; collision object-gaps:10; meshes object-gaps:10 | pass | failed: bspMeshes 0 |
| 19_23 | 11/14 | bsp object-gaps:3; terrain object-gaps:2 | pass | pass |
| 19_24 | 9/14 | bsp object-gaps:3; collision object-gaps:14; meshes object-gaps:2; terrain object-gaps:1 | pass | pass |
| 19_25 | 12/14 | bsp object-gaps:3 | pass | failed: no walk and idle in 90 s |
| 20_10 | 8/14 | bsp object-gaps:4; collision object-gaps:14; emitters object-gaps:82; meshes object-gaps:14; terrain object-gaps:1 | pass | failed: no walk and idle in 90 s |
| 20_13 | 12/14 | bsp object-gaps:1 | pass | pass |
| 20_14 | 11/14 | audio music-volume-unreadable; bsp object-gaps:1 | pass | pass |
| 20_15 | 12/14 | bsp object-gaps:3 | pass | pass |
| 20_16 | 3/14 | audio upstream-step-failed:bsp; bsp-visibility upstream-step-failed:bsp; bsp decode-failed:FormatError:render section 19 declares 21 and 20 polygon; collision upstream-step-failed:bsp; emitters upstream-step-failed:bsp; lighting upstream-step-failed:bsp; meshes object-gaps:3; minimap upstream-step-failed:bsp; movers upstream-step-failed:bsp; sky upstream-step-failed:bsp; terrain object-gaps:2 | failed: no native-tile-collision | - |
| 20_17 | 7/14 | audio object-gaps:1; bsp object-gaps:3; collision object-gaps:2; emitters object-gaps:80; meshes object-gaps:2; terrain object-gaps:1 | pass | pass |
| 20_18 | 9/14 | bsp object-gaps:3; collision object-gaps:34; emitters object-gaps:33; meshes object-gaps:1 | failed: anchor outside every chunk terrain | - |
| 20_19 | 10/14 | bsp object-gaps:3; collision object-gaps:274; meshes object-gaps:274 | pass | pass |
| 20_20 | 10/15 | bsp object-gaps:4; collision object-gaps:565; meshes object-gaps:557; terrain-material step-pending:terrain-material | pass | pass |
| 20_21 | 9/15 | bsp object-gaps:4; collision object-gaps:285; emitters object-gaps:9; meshes object-gaps:282; terrain-material step-pending:terrain-material | pass | pass |
| 20_22 | 7/14 | bsp object-gaps:3; collision object-gaps:82; emitters object-gaps:22; meshes object-gaps:57; movers object-gaps:2; raw object-gaps:2 | pass | pass |
| 20_23 | 8/14 | audio music-volume-unreadable; bsp object-gaps:2; collision object-gaps:177; emitters object-gaps:8; meshes object-gaps:162 | pass | pass |
| 20_24 | 12/14 | bsp object-gaps:3 | pass | failed: no walk and idle in 90 s |
| 20_25 | 11/14 | bsp object-gaps:1; manifest player-start-missing | no record | - |
| 21_13 | 12/14 | bsp object-gaps:3 | pass | failed: no walk and idle in 90 s |
| 21_14 | 8/14 | bsp object-gaps:3; collision object-gaps:88; emitters object-gaps:57; meshes object-gaps:88; raw object-gaps:2 | pass | pass |
| 21_15 | 8/14 | bsp object-gaps:3; collision object-gaps:65; emitters object-gaps:22; meshes object-gaps:58; movers object-gaps:2 | pass | pass |
| 21_16 | 8/14 | bsp object-gaps:5; collision object-gaps:129; emitters object-gaps:26; meshes object-gaps:121; movers object-gaps:7 | failed: anchor outside every chunk terrain | - |
| 21_17 | 9/14 | bsp object-gaps:3; collision object-gaps:5; meshes object-gaps:3; movers object-gaps:4 | pass | pass |
| 21_18 | 7/14 | audio object-gaps:1; bsp object-gaps:3; collision object-gaps:258; emitters object-gaps:126; meshes object-gaps:258; raw object-gaps:14 | pass | pass |
| 21_19 | 9/14 | bsp object-gaps:3; collision object-gaps:223; emitters object-gaps:52; meshes object-gaps:223 | pass | failed: no walk and idle in 90 s |
| 21_20 | 9/14 | bsp object-gaps:3; collision object-gaps:240; meshes object-gaps:240; terrain object-gaps:1 | pass | failed: fell to -163.8 m |
| 21_21 | 7/14 | bsp object-gaps:4; collision object-gaps:138; emitters object-gaps:155; meshes object-gaps:135; movers object-gaps:1; raw object-gaps:27 | pass | failed: no walk and idle in 90 s |
| 21_22 | 9/14 | bsp object-gaps:3; collision object-gaps:9; meshes object-gaps:1; terrain object-gaps:1 | pass | pass |
| 21_23 | 7/14 | bsp object-gaps:4; collision object-gaps:77; emitters object-gaps:165; meshes object-gaps:77; raw object-gaps:6; terrain object-gaps:1 | pass | pass |
| 21_24 | 7/14 | audio object-gaps:4; bsp object-gaps:3; collision object-gaps:10; emitters object-gaps:129; meshes object-gaps:4; movers object-gaps:1 | pass | pass |
| 21_25 | 8/14 | bsp object-gaps:3; collision object-gaps:393; emitters object-gaps:2; meshes object-gaps:393; raw object-gaps:16 | pass | failed: no walk and idle in 90 s |
| 22_13 | 9/14 | bsp object-gaps:3; collision object-gaps:128; emitters object-gaps:36; meshes object-gaps:93 | pass | failed: fell to -163.8 m |
| 22_14 | 9/14 | bsp object-gaps:3; collision object-gaps:177; emitters object-gaps:128; meshes object-gaps:165 | pass | failed: fell to -163.8 m |
| 22_15 | 8/14 | bsp object-gaps:1; collision object-gaps:59; emitters object-gaps:12; meshes object-gaps:51; terrain object-gaps:2 | pass | failed: fell to -163.8 m |
| 22_16 | 9/14 | bsp object-gaps:4; collision object-gaps:201; emitters object-gaps:48; meshes object-gaps:189 | pass | pass |
| 22_17 | 10/14 | bsp object-gaps:3; collision object-gaps:16; meshes object-gaps:12 | pass | failed: fell to -163.8 m |
| 22_18 | 8/14 | bsp object-gaps:3; collision object-gaps:14; emitters object-gaps:33; meshes object-gaps:6; raw object-gaps:2 | pass | pass |
| 22_19 | 7/14 | bsp object-gaps:3; collision object-gaps:49; emitters object-gaps:22; meshes object-gaps:42; movers object-gaps:2; raw object-gaps:30 | failed: anchor outside every chunk terrain | - |
| 22_20 | 10/14 | bsp object-gaps:4; collision object-gaps:22; meshes object-gaps:10 | pass | pass |
| 22_21 | 11/14 | bsp object-gaps:1; terrain object-gaps:2 | pass | failed: bspMeshes 0 |
| 22_22 | 6/14 | bsp object-gaps:13; collision object-gaps:185; emitters object-gaps:179; meshes object-gaps:80; movers object-gaps:10; raw object-gaps:7; terrain object-gaps:1 | failed: anchor outside every chunk terrain | - |
| 22_23 | 0/14 | audio upstream-step-failed:terrain; bsp-visibility upstream-step-failed:terrain; bsp upstream-step-failed:terrain; chunks terrain-height-package-missing; collision upstream-step-failed:terrain; emitters upstream-step-failed:terrain; lighting upstream-step-failed:terrain; manifest decode-failed:ChunkPlanStepError:chunk plan of tile:22_23 is not seale; meshes upstream-step-failed:terrain; minimap upstream-step-failed:terrain; movers upstream-step-failed:terrain; raw object-gaps:1; sky upstream-step-failed:terrain; terrain decode-failed:ChunkPlanStepError:chunk plan of tile:22_23 is not seale | no record | - |
| 22_24 | 9/14 | bsp object-gaps:5; collision object-gaps:54; emitters object-gaps:197; meshes object-gaps:54 | pass | pass |
| 22_25 | 10/14 | bsp object-gaps:4; collision object-gaps:29; emitters object-gaps:293 | pass | failed: no walk and idle in 90 s |
| 22_26 | 12/14 | bsp object-gaps:3 | pass | failed: no walk and idle in 90 s |
| 23_10 | 6/14 | audio upstream-step-failed:bsp-visibility; bsp-visibility decode-failed:FormatError:bsp-visibility of tile:23_10 needs sealed bs; bsp map-licensee-unsupported:123/18; collision map-licensee-unsupported:123/18; lighting upstream-step-failed:bsp-visibility; minimap upstream-step-failed:bsp-visibility; sky upstream-step-failed:bsp-visibility; terrain object-gaps:1 | failed: no native-tile-collision | - |
| 23_11 | 10/14 | bsp object-gaps:3; collision object-gaps:2; meshes object-gaps:2 | pass | pass |
| 23_12 | 9/14 | bsp object-gaps:3; collision object-gaps:47; emitters object-gaps:17; meshes object-gaps:47 | pass | pass |
| 23_13 | 8/14 | bsp object-gaps:3; collision object-gaps:44; emitters object-gaps:17; meshes object-gaps:39; movers object-gaps:3 | pass | pass |
| 23_14 | 8/14 | bsp object-gaps:3; collision object-gaps:84; emitters object-gaps:113; meshes object-gaps:82; terrain object-gaps:2 | pass | pass |
| 23_15 | 9/14 | bsp object-gaps:4; collision object-gaps:33; emitters object-gaps:47; meshes object-gaps:28 | pass | pass |
| 23_16 | 9/14 | bsp object-gaps:1; collision object-gaps:12; emitters object-gaps:5; meshes object-gaps:4 | pass | pass |
| 23_17 | 10/14 | bsp object-gaps:1; collision object-gaps:102; meshes object-gaps:90 | pass | pass |
| 23_18 | 9/14 | audio music-volume-unreadable; bsp object-gaps:3; collision object-gaps:132; meshes object-gaps:126 | pass | pass |
| 23_19 | 9/14 | bsp object-gaps:3; collision object-gaps:5; emitters object-gaps:158; terrain object-gaps:2 | pass | failed: no walk and idle in 90 s |
| 23_20 | 8/14 | bsp object-gaps:2; collision object-gaps:13; emitters object-gaps:6; meshes object-gaps:1; terrain object-gaps:2 | pass | pass |
| 23_21 | 10/14 | bsp object-gaps:3; collision object-gaps:12; terrain object-gaps:2 | pass | pass |
| 23_22 | 7/14 | bsp object-gaps:4; collision object-gaps:37; emitters object-gaps:112; meshes object-gaps:30; movers object-gaps:2; raw object-gaps:30 | pass | pass |
| 23_23 | 9/14 | bsp object-gaps:5; collision object-gaps:44; emitters object-gaps:160; meshes object-gaps:44 | pass | failed: no walk and idle in 90 s |
| 23_24 | 9/14 | bsp object-gaps:3; collision object-gaps:47; emitters object-gaps:446; meshes object-gaps:35 | pass | failed: no walk and idle in 90 s |
| 23_25 | 4/14 | audio upstream-step-failed:bsp; bsp-visibility upstream-step-failed:bsp; bsp decode-failed:FormatError:render section 17 declares 51 and 50 polygon; collision upstream-step-failed:bsp; emitters upstream-step-failed:bsp; lighting upstream-step-failed:bsp; minimap upstream-step-failed:bsp; movers upstream-step-failed:bsp; sky upstream-step-failed:bsp; terrain object-gaps:2 | failed: no native-tile-collision | - |
| 23_26 | 12/14 | bsp object-gaps:3 | pass | failed: no walk and idle in 90 s |
| 24_11 | 12/14 | bsp object-gaps:3 | pass | failed: no walk and idle in 90 s |
| 24_12 | 10/14 | bsp object-gaps:3; collision object-gaps:28; meshes object-gaps:27 | pass | failed: fell to -163.8 m |
| 24_13 | 11/14 | bsp object-gaps:1; manifest player-start-missing | no record | - |
| 24_14 | 4/14 | audio upstream-step-failed:bsp; bsp-visibility upstream-step-failed:bsp; bsp decode-failed:FormatError:render section 4 declares 3 and 2 polygons f; collision upstream-step-failed:bsp; emitters upstream-step-failed:bsp; lighting upstream-step-failed:bsp; meshes object-gaps:34; minimap upstream-step-failed:bsp; movers upstream-step-failed:bsp; sky upstream-step-failed:bsp | failed: no native-tile-collision | - |
| 24_15 | 10/14 | bsp object-gaps:2; collision object-gaps:12; emitters object-gaps:51 | pass | pass |
| 24_16 | 8/14 | bsp object-gaps:2; collision object-gaps:35; emitters object-gaps:22; meshes object-gaps:12; movers object-gaps:1 | failed: anchor outside every chunk terrain | - |
| 24_17 | 10/14 | bsp object-gaps:1; collision object-gaps:1; emitters object-gaps:419 | pass | failed: bspMeshes 0 |
| 24_18 | 2/14 | audio upstream-step-failed:meshes; bsp-visibility upstream-step-failed:meshes; bsp upstream-step-failed:meshes; collision upstream-step-failed:meshes; emitters upstream-step-failed:meshes; lighting upstream-step-failed:meshes; manifest decode-failed:StaticMeshStepError:static mesh package census docs/part; meshes decode-failed:StaticMeshStepError:static mesh package census docs/part; minimap upstream-step-failed:meshes; movers upstream-step-failed:meshes; raw object-gaps:1; sky upstream-step-failed:meshes | no record | - |
| 24_19 | 10/14 | bsp object-gaps:3; collision object-gaps:324; meshes object-gaps:312 | pass | pass |
| 24_20 | 3/14 | audio upstream-step-failed:bsp; bsp-visibility upstream-step-failed:bsp; bsp decode-failed:FormatError:render section 4 declares 119 and 118 polygo; collision upstream-step-failed:bsp; emitters upstream-step-failed:bsp; lighting upstream-step-failed:bsp; meshes object-gaps:82; minimap upstream-step-failed:bsp; movers upstream-step-failed:bsp; sky upstream-step-failed:bsp; terrain object-gaps:2 | failed: no native-tile-collision | - |
| 24_21 | 9/14 | bsp object-gaps:3; collision object-gaps:1; emitters object-gaps:4; terrain object-gaps:2 | pass | failed: fell to -163.8 m |
| 24_22 | 11/14 | bsp object-gaps:3; emitters object-gaps:2 | pass | failed: no walk and idle in 90 s |
| 24_23 | 10/14 | bsp object-gaps:3; collision object-gaps:2; meshes object-gaps:2 | pass | failed: no walk and idle in 90 s |
| 24_24 | 12/14 | bsp object-gaps:3 | pass | failed: no walk and idle in 90 s |
| 24_25 | 12/14 | bsp object-gaps:3 | pass | pass |
| 24_26 | 7/14 | audio upstream-step-failed:bsp-visibility; bsp-visibility decode-failed:FormatError:bsp-visibility of tile:24_26 needs sealed bs; bsp map-licensee-unsupported:123/20; collision map-licensee-unsupported:123/20; lighting upstream-step-failed:bsp-visibility; minimap upstream-step-failed:bsp-visibility; sky upstream-step-failed:bsp-visibility | failed: no native-tile-collision | - |
| 25_11 | 10/14 | bsp object-gaps:3; collision object-gaps:14; meshes object-gaps:14 | pass | failed: no walk and idle in 90 s |
| 25_12 | 9/14 | audio object-gaps:1; bsp object-gaps:3; collision object-gaps:103; meshes object-gaps:104 | pass | pass |
| 25_14 | 9/14 | bsp object-gaps:5; collision object-gaps:33; emitters object-gaps:586; meshes object-gaps:30 | pass | pass |
| 25_15 | 8/14 | bsp object-gaps:7; collision object-gaps:126; emitters object-gaps:398; meshes object-gaps:82; movers object-gaps:2 | pass | pass |
| 25_16 | 8/14 | bsp object-gaps:1; collision object-gaps:267; emitters object-gaps:1; meshes object-gaps:267; terrain object-gaps:2 | pass | failed: bspMeshes 0 |
| 25_17 | 8/14 | bsp object-gaps:2; collision object-gaps:372; emitters object-gaps:182; meshes object-gaps:370; movers object-gaps:4 | pass | pass |
| 25_18 | 10/14 | bsp object-gaps:2; emitters object-gaps:28; terrain object-gaps:2 | pass | pass |
| 25_19 | 9/14 | bsp object-gaps:1; collision object-gaps:12; emitters object-gaps:8; terrain object-gaps:2 | pass | pass |
| 25_20 | 4/14 | audio upstream-step-failed:bsp; bsp-visibility upstream-step-failed:bsp; bsp decode-failed:FormatError:render section 7 declares 2 and 1 polygons f; collision upstream-step-failed:bsp; emitters upstream-step-failed:bsp; lighting upstream-step-failed:bsp; minimap upstream-step-failed:bsp; movers upstream-step-failed:bsp; sky upstream-step-failed:bsp; terrain object-gaps:2 | failed: no native-tile-collision | - |
| 25_21 | 11/14 | bsp object-gaps:1; emitters object-gaps:92 | pass | failed: fell to -41.6 m |
| 26_11 | 7/14 | audio upstream-step-failed:bsp-visibility; bsp-visibility decode-failed:FormatError:bsp-visibility of tile:26_11 needs sealed bs; bsp map-licensee-unsupported:123/19; collision map-licensee-unsupported:123/19; lighting upstream-step-failed:bsp-visibility; minimap upstream-step-failed:bsp-visibility; sky upstream-step-failed:bsp-visibility | failed: no native-tile-collision | - |
| 26_12 | 6/14 | audio upstream-step-failed:bsp-visibility; bsp-visibility decode-failed:FormatError:bsp-visibility of tile:26_12 needs sealed bs; bsp map-licensee-unsupported:123/18; collision map-licensee-unsupported:123/18; lighting upstream-step-failed:bsp-visibility; minimap upstream-step-failed:bsp-visibility; sky upstream-step-failed:bsp-visibility; terrain object-gaps:1 | failed: no native-tile-collision | - |
| 26_14 | 8/14 | bsp object-gaps:2; collision object-gaps:25; emitters object-gaps:35; meshes object-gaps:25; terrain object-gaps:2 | pass | pass |
| 26_15 | 12/14 | bsp object-gaps:3 | pass | failed: no walk and idle in 90 s |
| 26_16 | 12/14 | bsp object-gaps:3 | pass | failed: no walk and idle in 90 s |

## Deviations from plan

### Auto-fixed issues

**1. [Rule 1 - Bug] Coverage refused two tile-derived keys of a manifest-gap tile**
- Found during: Task 2 (first batch exit 1 in `refresh_world_lane_outputs`)
- Issue: `tile-collision:20_25` and `tile-collision:24_13` had a passing collision row while their tiles hold no record (manifest `player-start-missing`), so the movement-geodata part found no failed, gap or pending row and no converted entry.
- Fix: such a key takes its tile's non-pass manifest rows (`unpublished_tile_record_rows`); a passing step whose manifest also passed but has no record still refuses. Test in `tests/pipeline/test_gap_census_derived_parts.py`.
- Files: `scripts/native_store/gap_census_derived_parts.py` (a native_store path outside the world globs; `check-lane-ownership --part world` lists it as foreign), test file.
- Commit: 35a4362

**2. [Rule 1 - Bug] One batch process left 88 terrain seals stale**
- Found during: Task 2 (after the first batch)
- Issue: the terrain receipt pins each seam neighbour's rawFingerprint (02-81); in census order a tile sealed terrain while its column, row or corner neighbour still had no raw seal, and sealing the neighbour later made the terrain seal stale.
- Fix: `seam_neighbours_first_order` attempts tiles in descending column then row, so every seam neighbour (roles (1,0), (0,1), (1,1)) runs all its steps first under any limit. Test in `tests/pipeline/test_convert_tile_batch.py`.
- Files: `scripts/world/convert_tile_batch.py` (not a frozen converter source), test file.
- Commit: d18a51d

**3. [Rule 3 - Blocking] Bounded walk commands**
- The 83 remaining walks needed about 2 h 10 min; one background command may run at most 2 h, so the orchestration walk driver gained a maximum run count and ran as four bounded commands (row 1073). No code in the repo changed.

### Plan text against facts

- The plan expected at most 148 tiles and an exit 3 risk; disk stayed far above the floor (26.4 GB free at the last preflight), so no floor stop happened.
- `check-lane-ownership --base 110d037 --part world` exits 1 with 13 foreign paths: 12 are planning and decision files of other agents' commits and the shared `.planning/OVERNIGHT-DECISIONS.md`; the one code path is deviation 1.

## Reference overlap

The overlap tool has no area for this plan's paths (areas: materials, bsp-visibility, movement, particles, network); `--area world` answers "unknown area world". Nothing to record.

## Open follow-ups recorded

- STATE Open follow-ups: "World lane walks (02-88)" replaces the landed "Eligible tile batch" and "WORLD-05 tile sweep" items: 66 of 125 passing tiles fail their walk and the border drops the pawn in the seam strip. "World evidence size" left the list: the world EVIDENCE is 21,967 bytes.
- Needs Human: nothing new. The main-checkout restage that `write_lane_catalog.py --plan` prints stays the integration thread's step (02-89).
- Requirements WORLD-01, WORLD-02, WORLD-03, WORLD-05 and WORLD-06 stay pending: the 13 bsp licensee and failure tiles, 22_23, 24_18 and the census gaps remain listed gaps, 66 walks fail and the minimap radar join is unresolved.

## Process cleanup

Every Playwright run this plan started ended with its command (walk driver PIDs 3096, 22204 and 8064 exited, the border run in the foreground). After the last run: no listener on 5173 or 5175, and no process whose command line holds `autonomous-roadmap` besides the checking shell.

## Verification

- Task 1 gate: exit 0; `pnpm typecheck` exit 0.
- Task 2 gate: exit 0; `write_lane_catalog.py --lane world --plan` exit 0.
- Task 3 gate: world EVIDENCE 21,967 bytes (under 30,720); `pnpm vitest run tests/unit/laneOwnership.test.ts` 36 of 36 pass; no listener on 5173 or 5175.

## Self-Check: PASSED

PASSED: `tests/browser/support/tileWalkRecords.ts`, `tests/unit/tileWalkRecords.test.ts`, `tests/browser/world-tile-walk.spec.ts`, `scripts/world/convert_tile_batch.py`, `scripts/native_store/gap_census_derived_parts.py`, `docs/parts/world/EVIDENCE.md`, `artifacts/lane-store/world/measurements/tile-batch-tracer-slice.json`, `artifacts/lane-store/world/measurements/tile-batch-02-88.json`, `artifacts/lane-store/world/load-checks/b4d451dc0e838c6461288176cd3e4c04033db0746c9ac558dd350fef33eb2f61.json`, `artifacts/lane-store/world/measurements/tile-walks-b4d451dc0e838c6461288176cd3e4c04033db0746c9ac558dd350fef33eb2f61.json` exist; commits 91532c1, 277129e, 35a4362, d18a51d and 4f7a987 are ancestors of HEAD.
