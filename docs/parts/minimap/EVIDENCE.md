# Minimap and world map evidence

Part `minimap`, lane `world`. What passes now, what is open, and where the proof lives. Keep this file under about 30 KB.

## Passes now

- Exact-name join (02-50, WORLD-06 data side): `scripts/world/minimap_join.py` joins texture exports, `zonename` rows and `huntingzone` rows to tiles by exact equality under Unreal casefolding only. Rules: `tile-id`, `tile-id-map` (name cited from Elbera `tools/maps/build_minimap.py` at 12c9656, never loaded), `zonename-map`, `zonename-name`, `huntingzone-name`, plus `zonename-grid` (MapX and MapY equal to the tile grid numbers) and `huntingzone-start-in-frame` (start location inside the closed TerrainInfo frame extent). Every joined item records its rule and source.
- Tile step: `convert_tile.py --step minimap` runs after `lighting` and before `manifest`. It reads `systextures/L2_RadarMap.utx`, `town_map.utx`, `l2zonename.utx`, `system/zonename-e.dat` and `system/huntingzone-e.dat` only through `require_equal_file` and the 02-27 table decoder. It writes one `native-tile-minimap` v1 manifest at `maps/<sha>/native-tile-minimap/manifest.json`, sealed on the unit ledger (`minimap` step, version 1).
- Tile manifests list one `minimap` resource. The vocabulary is at listVersion 9 and the world gap reasons at listVersion 14 (`minimap-join-unresolved:<what>`).
- All 11 converted tiles carry a minimap resource: 17_12, 18_10, 18_11, 18_12, 18_17, 18_20, 18_22, 19_10, 19_16, 20_20 and 20_21. Each has 2 manifest gaps, `minimap-join-unresolved:radar-texture` and `minimap-join-unresolved:zone-grid`, and 1 zone name texture joined by `tile-id`. Hunting zones joined: 18_20 3, 18_22 2, 20_20 1, 20_21 2 (Cruma Marshlands and Cruma Tower).
- Gap rows: `artifacts/lane-store/world/gap-rows/minimap.json` holds one row for each of the 39 eligible tiles (11 gap `minimap-join-unresolved:radar-texture`, 28 `batch-pending`).
- Committed census `docs/parts/minimap/minimap-join-census.json` (`python -B scripts/world/minimap_join_census.py --client E:/Lineage2-client`, 66,916 bytes, SHA-256 `26bf8426...e37f6`, byte-identical on rerun). It has 153 tile rows, all `gap`:
  - Gap reasons: `radar-texture` 153, `zone-grid` 153, `projection` 141 (the tiles with no extracted frame).
  - Rule matches: `tile-id` 153 (zone name textures `l2zonename.<tile id>`) and `huntingzone-start-in-frame` 11. Every other rule matches 0.
  - Packages: L2_RadarMap 118/0 (not reviewed, 18 textures, all town names), town_map 123/23 (not reviewed, 6 textures), l2zonename 123/28 (reviewed, 204 textures).
  - Tables: zonename 369 rows, 21 of them with MapX or MapY outside the locked grid 15..26 by 10..26. huntingzone 220 rows.
  - World map pieces `L2Font-e.Minimap.int_worldmap1` to `int_worldmap6` are present. They are evidence only and no join uses them.
  - `MinimapCtrl` controls: `MinimapWnd.Minimap` and `NewRadarWnd.specialHiddenMap`.
- Browser parser `src/scene/world/minimapJoin.ts`: `parseNativeTileMinimapManifest`, `loadNativeTileMinimap` (SHA-256 verified before parse) and `minimapTexturePosition` (scene metres times 100 into the native frame, labelled `unverified`, or null with the gap reason).
- Tests: `tests/pipeline/test_minimap_join.py` (20), `tests/pipeline/test_minimap_step.py` (10, including the real-client 20_21 join) and `tests/unit/minimapJoin.test.ts` (7). `pnpm test:pipeline` passes 1,848 tests and `pnpm test:unit` passes 2,565.

## Open

- WORLD-06 stays open. No radar export carries a tile name, so every tile is a `radar-texture` gap and no radar texture is converted. The radar package is also 118/0, outside the reviewed texture reader versions.
- Zone joins stay a `zone-grid` gap until the meaning of the 21 out-of-grid MapX and MapY rows is settled.
- The 02-51 view that renders the minimap and world map.
- The `tile-frame-extent` projection and the schema field meanings (`MapX`, `MapY`, `start_npc_x`, `start_npc_y`) are labelled unverified until the Phase 3 side-by-side check.
- The world lane restage is owned by the integration thread.

## Evidence

- Plan summary: `.planning/phases/02-stage-a-breadth/02-50-SUMMARY.md`.
- Census: `docs/parts/minimap/minimap-join-census.json`.
- Lane store (ignored): `artifacts/lane-store/world/work/tile__<id>/minimap/receipt.json` and the manifests under `artifacts/lane-store/world/l2/maps/<sha>/native-tile-minimap/`. World lane catalog `7c9dae88...` (11 tile records).
