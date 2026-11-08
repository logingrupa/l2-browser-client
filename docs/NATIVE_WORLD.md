# Native world converter

Terrain, static meshes, section loader. One hand-built `20_20` section loads today; the target is all 153 tiles through tile-general steps (DEC-OWN-7). Decisions and order: [PROJECT.md](../.planning/PROJECT.md), [ROADMAP.md](../.planning/ROADMAP.md).

## Now

- `/` loads catalog section `map-20-20-section` via `src/scene/world/loadNativeSection.ts`: hash and identity checks, visible failure, no stand-in. Limits: 128 models, 4,096 placements. No `?map=`, streaming or LOD.
- Two checkpoints, never mixed in a baseline: `recipes/native-map-debug-location.json` (nine sectors around `PlayerStart10`, 61 models, 151 placements) and the live section (62 models, 157 placements, BSP, sky).
- The live section ends a seven-link `migrate-*` / `derive-*` chain (each pins its predecessor's hash) on terrain from research map `audio-world-20261106/map-correction-first`; no commit rebuilds it. Only 9 of 115 steps are scripted and tile-general (audit).
- `scripts/native_map.py` and `native_map_geometry.py` accept only UE123 / licensee 28: 67 of 153 tiles.
- `scripts/native_map_overlap.py` selects a static actor by a positive-area indexed triangle inside the section, not by origin; meshes are never clipped or moved.
- Mask UV: `(grid + 0.5)/H` if `(GIsL2Seamless == 0 || GIsEditor != 0) && gbStretchTerrainMask == 0`, else minus `max(grid - 240, 0)/4096`. 20_20 uses the latter, baked behind its map hash.
- Units and handedness: [OUTPUT_CONTRACT.md](OUTPUT_CONTRACT.md). Native scene fog is off (mode 0 in `src/scene/presentationConfiguration.ts`).
- **Source textures** (World sheet) is a labelled candidate material (`nativeTerrainPreview.ts`), not native blending; its 9-layer and mask-size pins fail on 20_21.

## Open

- Whole-tile converter, pass or gap per tile and step (WORLD-01, WORLD-03). The audit's `pnpm world:build` is unbuilt.
- DecoLayers grass: missing on every tile, DXT3 materials fail `texture_mips.py`. No requirement.
- 784 final terrain COLOR0 colors missing (WORLD-01, CHECK-01). Terrain packet review: WORLD-07.
- Static mesh and BSP collision from source declarations (WORLD-08). Walking any tile: WORLD-05.
- Audit open questions: Z window, mask UV extrapolation.

## Pointers

- Audit: `artifacts/native-parity/research/genericity-audit-20261108/`, rated in the [research index](research/INDEX.md).
- Related: [BSP](NATIVE_BSP_FLOOR.md), [sky](NATIVE_SKY.md), [doors](NATIVE_DOOR_MOVERS.md), [rendering](RENDERING.md), [world evidence](parts/world/EVIDENCE.md).
