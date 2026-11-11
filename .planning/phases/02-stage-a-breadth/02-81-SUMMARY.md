---
phase: 02-stage-a-breadth
plan: 81
subsystem: world terrain step
tags: [terrain, tile-seam, engine-dll, world-lane, gap-closure]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-75 terrain chunk step (layer gap rows, algorithm version 2) and 02-77 collision step (VOLS)"
provides:
  - "scripts/world/terrain_seam_facts.py and docs/parts/world/terrain-seam-facts.json: strip width and facing edge equality for every sealed adjacent eligible pair"
  - "recipes/world/terrain-seam-rules.json: six confirmed-interlude rows read from Engine.dll 4dd2f63c"
  - "scripts/world/terrain_seam_strip.py: the seam strip (far vertex heights, normals, neighbour states) for the terrain step"
  - "TERRAIN_CHUNK_STEP_ALGORITHM_VERSION 3; terrain index fields seamStrip and seamGapRows; chunk record field seamStripQuads"
  - "World gap reason terrain-seam-neighbour-unavailable:<tileId>; listVersion 21"
  - "scripts/world/eligible_tiles.py owns read_tile_census and select_eligible_tiles"
affects: [02-88, 02-89, 02-91, MOVE-01 runtime]

actuals:
  tokens: 54600
  tasks: 3
  commits: 3
plan_head_before: 0f43e8fd6814c42e581f1c78a5333ec908905a73
plan_head_after: 35c51a4acf26b9721ba87f8f5d615c41a846bf68

tech-stack:
  added: []
  patterns:
    - "A seam is owned by the lower tile; its far vertices sit on the owner's heightmap-to-world grid and take the neighbour's facing vertex Z"
    - "Static Engine.dll reading through the export table, thunk following and capstone, with addresses recorded in the rule rows"

key-files:
  created:
    - scripts/world/terrain_seam_facts.py
    - scripts/world/terrain_seam_strip.py
    - scripts/world/eligible_tiles.py
    - docs/parts/world/terrain-seam-facts.json
    - recipes/world/terrain-seam-rules.json
    - tests/pipeline/test_terrain_seam_facts.py
    - tests/pipeline/test_terrain_seam_strip.py
  modified:
    - scripts/world/terrain_chunk_step.py
    - scripts/world/terrain_rectangle_mesh.py
    - scripts/world/eligible_tile_selection.py
    - scripts/world/convert_tile_batch.py
    - recipes/world/gap-reasons.json
    - tests/pipeline/test_terrain_chunk_step.py
    - tests/pipeline/test_tile_manifest_step.py
    - tests/pipeline/test_convert_tile_batch.py
    - tests/pipeline/synthetic_terrain_fixture.py

key-decisions:
  - "969: seam rule rows read from Engine.dll carry confirmed-interlude, not the plan's ue2-data"
  - "970: the strip draws but is not collided, because ATerrainInfo::LineCheck clamps to HeightmapX - 2; TERR and the residency ring stay unchanged"
  - "971: a seam uses the tile-grid neighbour only when both Location map indices equal the tile ids; a missing client map keeps the own clamped sample"
  - "972: terrain-seam-neighbour-unavailable:<tileId> replaces the planned terrain-seam-rule-unresolved; collision-volume-class-unadmitted:<class> is dropped"
  - "973: read_tile_census and select_eligible_tiles move to scripts/world/eligible_tiles.py to break an import cycle"
  - "974: seam rows are object rows on the owner's terrain export, deduplicated"
  - "975: the border spec now walks 15_20 to 15_21 and is recorded unverified for 17_12 to 18_12"

requirements-completed: []

duration: 35min
completed: 2026-11-11
---

# Phase 2 Plan 81: Tile seam rule and strip Summary

Engine.dll 4dd2f63c decides the 128-unit tile seam. In seamless mode each terrain renders (HeightmapX + 1) x (HeightmapY + 1) vertices. UGameEngine::AdjustTerrain copies the facing vertex heights of the next terrain in X, in Y and on the diagonal into that extra column, row and corner. The terrain line and point checks still stop at quad HeightmapX - 2, so no strip quad has terrain collision in the reference client. The converter now draws the strip in the owning tile's edge chunks from the neighbour's facing heights. Collision is unchanged.

## Performance

- Duration: about 35 min
- Started: 2026-11-11T14:53Z
- Completed: 2026-11-11T15:28Z
- Tasks: 3 of 3
- Files: 16 changed

## Accomplishments

- **Seam facts.** `docs/parts/world/terrain-seam-facts.json` covers 148 eligible tiles, 69 measured terrains and 254 adjacent pairs. 108 pairs are measured and 146 wait for a raw step (`step-pending:raw`). Every pair records:
  - Location, TerrainScale, heightmap size and covered extent of each terrain
  - the strip width and the across-axis offset
  - facing edge equality: equal count, largest difference, and the SHA-256 of the edge samples
  
  106 measured pairs have a strip width of 128. One pair has -32640 and one has 32896: the 15_21 TerrainInfo has the same Location as 15_20 (-147456, 81920, map index 15_20). The facing edges are equal on only 11 of 108 pairs, so the facts alone could not decide the rule. 17_12 to 18_12 is equal on all 256 samples (both tiles are flat).
- **Seam rule from Engine.dll.** `recipes/world/terrain-seam-rules.json` holds six rows, each confirmed-interlude with addresses. The binary was read through its export table and capstone and never run.
  - `terrain.seam.render-grid`: heightmap-plus-one. PostLoad 0x1072E20A-0x1072E2EC grows the vertex colour array, the sector vertex rows hold 17 vertices, and GetHeightmap 0x1071BF00 clamps to the last sample.
  - `terrain.seam.neighbour-map-index`: trunc((Location + 360448 or 294912) / 32768 + 9), from PostLoad 0x1072E2F2-0x1072E330.
  - `terrain.seam.far-vertex-height`: the neighbour's facing vertex Z, written by SetVertiEdge 0x10727580, SetHoriEdge 0x10727950 and SetEndVertexZ 0x10727D70, which AdjustTerrain 0x1059BE70 calls.
  - `terrain.seam.far-vertex-normal`: the own edge vertex normal, from UTerrainSector::GetVertexNormal 0x1071D7A8.
  - `terrain.seam.strip-quad-visibility`: true. PostLoad 0x1072E378-0x1072E3D3 forces column 255 and row 255 visible.
  - `terrain.seam.strip-collision`: false, from ATerrainInfo::LineCheck 0x10722973-0x10722A49 and PointCheck 0x107231EC.
- **Strip in the terrain mesh.** Terrain step algorithm version 3. The last-column and last-row chunks gain one quad column, one quad row and the corner quad.
  - Far vertices sit on the owner's own grid at index HeightmapX or HeightmapY and take the neighbour's facing Z.
  - When the client has no neighbour map, the far vertex keeps the owner's clamped sample.
  - Far vertices take the normal of the owner's edge vertex. Mask UVs and layer UVs follow the existing formulas.
  - Strip quads are always visible and use the serialized EdgeTurn bit.
  
  The neighbour raw fingerprints, map hashes and eligibility, plus the seam rule recipe hash, join the terrain unit config. A neighbour raw seal therefore makes the owner stale.
- **Gap rows.** An eligible neighbour whose raw step is unsealed leaves its strip out with pending `step-pending:raw`. An ineligible, unreadable or misplaced neighbour leaves it out with `terrain-seam-neighbour-unavailable:<tileId>`. These are object rows on the owner's terrain export. World gap reasons go to listVersion 21: `terrain-seam-neighbour-unavailable:<tileId>` is added and `collision-volume-class-unadmitted:<class>` is removed, because no world step writes it since 02-77.
- **Lane store.** 17_12 and 18_12 were re-sealed through every step in the world lane store and the world lane catalog was rewritten as `2bca1ebd915c9e15476634444c77aadbf567a7f985aff0d2431911ebf8c6fa05` (62 tiles). Each tile has 7 chunks with strip quads: 64 in each edge chunk and 127 in the corner chunk. The neighbour states:

  | Tile | Column (X + 1) | Row (Y + 1) | Corner |
  |------|----------------|-------------|--------|
  | 17_12 | 18_12 converted | 17_13 absent from the client, clamped | 18_13 converted |
  | 18_12 | 19_12 absent, clamped | 18_13 converted | 19_13 converted |

## Task commits

1. Task 1 (tracer): seam facts, 17_12 to 18_12 first, then every sealed pair - `445b6a8`
2. Task 2: the seam rule from Engine.dll, gap reasons listVersion 21 - `4a7d4f4`
3. Task 3: the strip in edge chunks, the gap rows and the eligible tiles move - `35c51a4`

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_terrain_seam_facts.py" -v`: 6 tests OK. The plan's 17_12 / 18_12 check exits 0 with strip width 128.
- The Task 2 row shape check prints all six rows confirmed-interlude and no bad rows.
- `python -B -m unittest discover -s tests/pipeline -p "test_terrain_chunk_step.py" -v`: OK. The 02-75 golden chunk GLB SHA-256 `73680f73...5306` is unchanged for a chunk without a strip.
- `test_terrain_seam_strip.py`: 11 tests OK. They cover:
  - the map index formula on 17_12
  - converted, pending, absent and unavailable neighbours
  - the column, row and corner strip geometry
  - far vertex normals
  - unchanged inner chunks
  - refusal of an unknown rule
- Related suites green: `test_tile_step_current_seals`, `test_convert_tile_batch`, `test_tile_manifest_step`, `test_world_collision_step` and `test_gap_rows` (131 tests), and every `test_world_*.py` (300 tests, 8 skipped).
- `pnpm vitest run tests/unit/worldResidencyRing.test.ts`: 8 passed (file unchanged). `pnpm typecheck`: clean.
- Tracer gate: Task 1 verify re-ran end to end before Task 2.
- `node scripts/check-machine-schedule.mjs` passed before every client run (DATABASE-PC, no active window).
- `node scripts/check-lane-ownership.mjs --base 0f43e8f --part world`: 0 foreign paths.
- Reference overlap: no area in `tools/reference-overlap/overlapAreas.json` covers `terrain_seam_*.py`, `terrain_rectangle_mesh.py`, `terrain_chunk_step.py` or `eligible_tiles.py`, so there was no run. The reference clone (Lineage2JS stitching and PostLoad notes) was read only to learn what to look for. Every value comes from the binary.
- **Border run, unverified for the 17_12 seam.** `NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-border.spec.ts` failed after 4.3 min with "Native tile 15_20 pins no native-tile-collision resource". The spec walks the first adjacent pair of the lane catalog, which is now 15_20 to 15_21, not 17_12 to 18_12. 15_20's steps wait for the 02-88 batch. Port 5173 was free.

## Decisions made

Decision rows 969 to 975 are appended to `.planning/OVERNIGHT-DECISIONS.md` (see key-decisions).

## Deviations from plan

### Auto-fixed issues

**1. [Rule 1 - Fidelity] The strip is drawn but not collided** (row 970)
- Found during: Task 2
- Issue: The plan's third and fifth truths assume a rule writes the strip into TERR and that the border spec then passes. The binary's terrain line and point checks never test a strip quad.
- Fix: The strip goes into the terrain mesh only. TERR, the collision step and `worldResidencyRing.ts` are unchanged. The collision row is false with its addresses.
- Commits: `4a7d4f4`, `35c51a4`

**2. [Interpretation] Rule row status confirmed-interlude instead of ue2-data** (row 969)

**3. [Interpretation] Gap reason** (row 972)
- `terrain-seam-neighbour-unavailable:<tileId>` was added. The planned `terrain-seam-rule-unresolved` was not added, because the rule is decided and no step would write that reason.

**4. [Rule 3 - Blocking] Import cycle** (row 973)
- `read_tile_census` and `select_eligible_tiles` moved to `scripts/world/eligible_tiles.py`.
- `convert_tile_batch.py` and `test_convert_tile_batch.py` (Phase 3 shared files, clean before the edit) only changed their imports.

**5. [Rule 3 - Blocking] Files outside the plan list**
- New: `scripts/world/terrain_seam_strip.py`, `scripts/world/eligible_tiles.py` and `tests/pipeline/test_terrain_seam_strip.py` (the strip tests sit in their own file to keep `test_terrain_chunk_step.py` under 400 lines).
- Updated callers: `terrain_rectangle_mesh.py`, `test_tile_manifest_step.py` and `synthetic_terrain_fixture.py`. The fixture now carries `toWorld`.

**6. [Process] Test order**
- In Task 3 the implementation was written before the new strip cases, not after. Every case was then run against the final code.

**7. [Rule 3 - Blocking] Steps outside terrain and collision were re-run**
- The manifest coverage refresh required 17_12 and 18_12 to be current in every step. meshes, bsp, movers, collision, emitters, bsp-visibility, audio, lighting, minimap and manifest were re-run for both tiles in the world lane store.

## Known stubs

None.

## Needs Human

None. The rule is decided from the binary, so 02-89 needs no IMPORTA-PC step for the seam rule. The open question below is a movement code check, not an owner decision.

## Open follow-ups

- **MOVE-01, how the reference pawn crosses the strip.** The binary draws the 128-unit strip but its terrain collision ends at quad HeightmapX - 2. Our walking pawn finds no floor there and falls. That is what the 02-49 border run measured, and it still holds after this plan. The movement owner should read the walking floor loss in Engine.dll (APawn physWalking and the ULevel floor traces), find what keeps the reference pawn up, and port it. The border spec turns green only with that.
- **The border spec pair.** `world-tile-border.spec.ts` picks the first adjacent pair of the lane catalog. After 02-88 re-seals every tile, that pair is 15_20 to 15_21. 15_21's terrain sits at map index 15_20, so its seams are `terrain-seam-neighbour-unavailable` rows.
- **02-88.** The terrain version 3 bump makes every other terrain seal and every manifest stale, and 02-88 re-runs the batch. Seam rows for a neighbour whose raw step is unsealed clear once that neighbour seals.

## Process cleanup

These processes were started: Python unit test runs, the facts run, `convert_tile.py` and `write_lane_catalog.py` runs under `run_below_normal.py`, one Vitest file run, `pnpm typecheck`, and one Playwright run (`pnpm test:e2e` on its own port-5173 server). All ran in the foreground and exited. A command-line search for this worktree path shows only the checking shell, and nothing listens on 5173 or 5175.

## Self-Check: PASSED

- FOUND: scripts/world/terrain_seam_facts.py, scripts/world/terrain_seam_strip.py, scripts/world/eligible_tiles.py, docs/parts/world/terrain-seam-facts.json, recipes/world/terrain-seam-rules.json, tests/pipeline/test_terrain_seam_facts.py, tests/pipeline/test_terrain_seam_strip.py
- FOUND: 445b6a8, 4a7d4f4, 35c51a4 (ancestors of HEAD)
