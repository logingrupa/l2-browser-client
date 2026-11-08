# World: terrain, buildings, props evidence

Part `world`, lane `world`. What passes now, what is open, and where the proof lives. Keep this file under about 30 KB.

## Passes now

Nothing has passed the stage A check yet (DEC-OWN-3). Working on 2026-11-07, per PORT_SCOPE section 5: The 20_20 and Talking Island bundles.

## Open

All 153 tiles by tile-general converter steps (WORLD-01), sky, ambient and placement audio for every tile (WORLD-02), a per-tile coverage manifest and non-tile map classification (WORLD-03), one persistent scene with bounded cells and LOD (WORLD-04), walking any converted tile (WORLD-05). Provisional, owner review: the independent review of the 74-file post-migration terrain packet, with one verdict per finding recorded here (WORLD-07), and source-declared collision for static meshes and BSP (WORLD-08).

## Evidence

World docs: `docs/NATIVE_WORLD.md`, `docs/WORLD_ASSETS.md`. Recipes: `recipes/native-map-20_20.json`, `recipes/native-map-section.json`.
