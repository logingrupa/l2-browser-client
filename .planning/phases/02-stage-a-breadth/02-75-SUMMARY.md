---
phase: 02-stage-a-breadth
plan: 75
subsystem: world terrain step
tags: [terrain, layers, gap-rows, gltf, world-lane, gap-closure]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-55 phase tail; the terrain chunk step of 02-47 and 02-54"
provides:
  - "terrain_layers.terrain_layer_gap_reasons: terrain-layer-incomplete:<index> and terrain-layer-uv-unverified:<index> per serialized layer"
  - "terrain_chunk_step.terrain_layer_gap_rows and the terrain index field layerGapRows; the seal gapRows carry the layer rows before the chunk rows"
  - "build_terrain_rectangle_gltf with an empty layer list: TEXCOORD_0 only, extras baseLayerUvSet null and nativeLayers [] (decision row P802)"
  - "TERRAIN_CHUNK_STEP_ALGORITHM_VERSION 2; world gap reason listVersion 20"
affects: [02-88, 02-89, 02-90]

actuals:
  tokens: 9100
  tasks: 2
  commits: 2
plan_head_before: b54e9b814e4db850a001ae5e2b389b0eda7dc739
plan_head_after: 5421d3e945495d3cdd281ccdcd0b6f18cd38b89a

tech-stack:
  added: []
  patterns:
    - "A terrain layer the reader cannot place is a per-layer gap row on the terrain object; geometry, mask UVs and collision never depend on layer support"
    - "A layer-less terrain.glb writes no base layer UV set instead of borrowing one"

key-files:
  created: []
  modified:
    - scripts/world/terrain_layers.py
    - scripts/world/terrain_chunk_step.py
    - scripts/world/terrain_rectangle_mesh.py
    - recipes/world/gap-reasons.json
    - tests/pipeline/test_terrain_chunk_step.py
    - tests/pipeline/synthetic_terrain_fixture.py
    - tests/pipeline/test_tile_manifest_step.py

key-decisions:
  - "P829: per-layer gap rows live in the terrain index layerGapRows and the terrain seal gapRows; the one tile row that write_gap_rows takes is derived from the seal as object-gaps:<count>"
  - "P830: Task 2 keeps the terrain step algorithm version at 2"

requirements-completed: []

duration: 9min
completed: 2026-11-11
---

# Phase 2 Plan 75: Terrain layer gaps Summary

Terrain layers the reader cannot place now become per-layer gap rows instead of failing the tile. A layer that names only one of Texture and AlphaMap becomes `terrain-layer-incomplete:<index>`. A layer with a non-XY axis, a rotation, a pan or an invalid scale becomes `terrain-layer-uv-unverified:<index>`. A terrain with no placeable layer still writes its height mesh as a layer-less terrain.glb. All six terrain failures of the eligible batch are now sealed with named layer gaps.

## Performance

- Duration: about 9 min
- Started: 2026-11-11T12:22Z
- Completed: 2026-11-11T12:31Z
- Tasks: 2 of 2
- Files modified: 7

## Accomplishments

- `terrain_layer_gap_reasons` in `scripts/world/terrain_layers.py` is the single owner of layer support. It returns a gap reason per serialized layer index:
  - incomplete when exactly one of Texture and AlphaMap is named
  - UV-unverified when a filled layer has a TextureMapAxis other than 0, a TextureRotation or LayerRotation other than zero, a nonzero UPan or VPan, or a missing or non-positive scale
  
  `is_empty_layer_slot` moved here from the chunk step and lost its raise. `layer_records` and `tile_layer_summaries` take the gap reasons, leave gapped layers out and keep their index checks. `layer_records` no longer raises "No supported native terrain layers".
- An XY layer whose serialized TerrainMatrix differs from the native calculation still raises. A real mismatch stays a defect, not a gap (test `test_an_xy_layer_whose_serialized_matrix_differs_from_the_native_calculation_still_raises`).
- `terrain_layer_gap_rows` writes one gap row per gapped layer: key `tile:XX_YY`, step `terrain`, status `gap`, sourceIdentity object the terrain export (for example `16_25.TerrainInfo0`). The rows are stored in the terrain index field `layerGapRows`. They lead the seal `gapRows` and the tile terrain row.
- When no layer remains, `build_terrain_rectangle_gltf` writes POSITION, NORMAL and TEXCOORD_0 only, with extras `maskUvSet 0`, `baseLayerUvSet null` and `nativeLayers []`. It takes no base layer UV from anything else (rule G7, decision row P802).
- A terrain with a placeable layer is byte for byte unchanged. The test pins the synthetic chunk GLB SHA-256 `73680f73...5306` from before the change and shows that a gapped extra layer gives the same bytes.
- Terrain step algorithm version 2. World gap reasons listVersion 18 to 20.
- Runtime readers checked. Only `src/scene/world/nativeTerrainPatch.ts` checks `baseLayerUvSet 1`, and it validates the authored 20_20 patch only. `nativeTerrainPreview.ts` already refuses a terrain without nine layers. The streamed tile route reads neither field. No runtime change and nothing recorded for 02-89.

## Tile results (world lane store, `--step terrain`, E:/Lineage2-client)

| Tile | Terrain row | Layer gap rows | Placeable layers converted | Chunks with terrain.glb |
|------|-------------|----------------|----------------------------|-------------------------|
| 16_25 | gap object-gaps:1 | terrain-layer-incomplete:10 | 0-9 (10) | 16 of 16 |
| 18_23 | gap object-gaps:2 | terrain-layer-uv-unverified:9 (axis 1), :10 (axis 2) | 0-8 (9) | 16 of 16 |
| 19_23 | gap object-gaps:2 | terrain-layer-uv-unverified:7 (axis 1), :8 (axis 2) | 0-6 (7) | 16 of 16 |
| 19_24 | gap object-gaps:1 | terrain-layer-uv-unverified:9 (axis 2) | 0-8 (9) | 16 of 16 |
| 20_16 | gap object-gaps:2 | terrain-layer-uv-unverified:6 (axis 1), :7 (axis 2) | 0-5 (6, plus empty slots 8 and 9) | 16 of 16 |
| 20_17 | gap object-gaps:1 | terrain-layer-uv-unverified:11 (axis 2) | 0-10 (11) | 16 of 16 |

No chunk decode gap rows. None of the six tiles has every layer gapped, so none carries the P802 layer-less terrain.glb. Only the synthetic test exercises that shape. The plan's six-tile check over `artifacts/lane-store/world/gap-rows/terrain.json` prints `[]`, so no failed rows remain.

The downstream steps of these six tiles (meshes, bsp, collision, manifest) and every other terrain seal (version 1, now stale) re-run in the 02-88 batch, and 02-90 makes that batch treat stale or missing seals as work.

## Task commits

1. Task 1 (tracer): tile 16_25 terrain converts with a per-layer gap for layer 10 - `e4607a4`
2. Task 2: rotated or non-XY layers become per-layer gaps and the five tiles re-run - `5421d3e`

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_terrain_chunk_step.py" -v`: 21 tests OK (7 new).
- Related suites green: `test_tile_manifest_step.py` (18), `test_world_terrain_numerics.py` (12), `test_gap_rows.py` (12), `test_world_tile_general_steps.py` (3).
- Tracer gate: Task 1 verify re-ran end to end (tests, schedule check, the 16_25 run) before Task 2.
- `node scripts/check-lane-ownership.mjs --base b54e9b8 --part world`: 0 foreign paths.
- `node scripts/check-machine-schedule.mjs` passed before every tile run (DATABASE-PC, no active window).
- Reference overlap: no area in `tools/reference-overlap/overlapAreas.json` covers `scripts/world/**` Python, so there was no run.

## Decisions made

Both rows are appended to `C:/laragon/l2b-orchestration/autonomous-roadmap/pending-decision-rows.md` (rule G2).

- P829: `write_gap_rows` refuses a repeated key, and every layer row is keyed `tile:XX_YY` on step `terrain`. So the per-layer rows live in the terrain index and the seal. The tile row that `convert_tile` writes through `write_gap_rows` is the seal-derived `object-gaps:<count>`, the same route chunk decode gaps and collision object gaps take.
- P830: Task 2 does not bump the algorithm version again. Between the two commits only 16_25 was sealed at version 2, and its layers are all XY.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Updated the manifest test caller of `tile_layer_summaries`**
- Found during: Task 1
- Issue: `tests/pipeline/test_tile_manifest_step.py` called `tile_layer_summaries` with the old two-argument signature.
- Fix: it now passes an empty gap reason map. That file is not in the plan's file list.
- Commit: `e4607a4`

**2. [Interpretation] Where the per-layer gap rows are written** (decision row P829)
- The plan's key link names `write_gap_rows`. The rows reach the lane gap row file through the seal-derived tile row (`object-gaps:<count>`), not as separate rows.

**3. [Interpretation] "TerrainMatrix preserved in the layer sampling source"**
- A gapped layer is left out of the layer records, so it gets no `nativeSamplingSource`. Its serialized TerrainMatrix (and every other layer property, with payload hashes) stays in the sealed raw terrain record (`raw/products/terrain.json`), which is where a later reader can take it. This plan infers no UV mapping from it.

## Known stubs

None.

## Needs Human

None.

## Open follow-ups

- The 02-88 batch re-runs meshes, bsp, collision and manifest for the six tiles, and terrain for every tile whose version 1 terrain seal is now stale.
- World EVIDENCE line 58 still lists the six terrain failures. 02-88 rewrites world EVIDENCE once (rule G8).

## Process cleanup

The only processes started were Python unit test runs and six `convert_tile.py` runs under `run_below_normal.py`. All ran in the foreground and exited. `list_worktree_processes.py` shows no python, node or browser process with this worktree path or ports 5173 and 5175 (only the checker itself), and nothing listens on 5173 or 5175.

## Self-Check: PASSED

- FOUND: scripts/world/terrain_layers.py, scripts/world/terrain_chunk_step.py, scripts/world/terrain_rectangle_mesh.py, recipes/world/gap-reasons.json, tests/pipeline/test_terrain_chunk_step.py, tests/pipeline/synthetic_terrain_fixture.py
- FOUND: e4607a4, 5421d3e (ancestors of HEAD)
