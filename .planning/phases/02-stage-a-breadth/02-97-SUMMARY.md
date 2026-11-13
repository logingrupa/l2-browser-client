---
phase: 02-stage-a-breadth
plan: 97
subsystem: world
status: complete
tags: [minimap, radar-route, world-map, zone-sampler, format5, tile-minimap-schema-2, census, tile-batch]

requires:
  - phase: 02-88
    provides: the world lane batch, the tile minimap step and lane catalog b4d451dc
  - phase: 02-96
    provides: convert_tile_batch.py --retry-tiles, lane catalog 420deb2f and the pinned recipe reader pattern
provides:
  - recipes/world/minimap-radar-route.json, the pinned verified radar route, world map and zone key rules
  - scripts/world/minimap_radar_route_recipe.py (read_minimap_radar_route_recipe), scripts/world/zone_name_keys.py (zone_name_key, zone_key_table)
  - scripts/world/minimap_route_step.py (run_minimap_route_step, current_minimap_route), the one minimap-route:interlude lane unit and its native-minimap-route v1 manifest
  - scripts/world/format5_texture_pixels.py and scripts/world/pinned_image_decoder.py
  - native-tile-minimap schema 2 on 146 tiles and its browser parser, lane catalog 43a5132d
  - census docs/parts/minimap/minimap-join-census.json schema 2
affects: [02-89, 02-51 view (data-ui), world lane restage]

actuals:
  tokens: 99538
  tasks: 3
  commits: 6
plan_head_before: 28e5b82beaa52036e05ca13a660e3857ddfe71a4
plan_head_after: 0fec5655d289db0de08c375d44243f7a9bea140f

tech-stack:
  added: []
  patterns:
    - "A route shared by every tile converts once in its own lane unit; each tile unit pins the route manifest by path and SHA-256 and holds the route fingerprint in its config"
    - "A texture the shared library refuses converts through the UModel Converter only after its PNG equals the recipe decode of mip 0 pixel for pixel"

key-files:
  created:
    - recipes/world/minimap-radar-route.json
    - scripts/world/minimap_radar_route_recipe.py
    - scripts/world/minimap_route_step.py
    - scripts/world/minimap_textures.py
    - scripts/world/zone_name_keys.py
    - scripts/world/format5_texture_pixels.py
    - scripts/world/pinned_image_decoder.py
    - tests/pipeline/test_minimap_radar_route_recipe.py
    - tests/pipeline/test_minimap_route_step.py
    - tests/pipeline/test_zone_name_keys.py
    - tests/pipeline/minimap_route_fixture.py
  modified:
    - .gitattributes
    - scripts/world/minimap_join.py
    - scripts/world/minimap_join_census.py
    - scripts/world/minimap_sources.py
    - scripts/world/minimap_step.py
    - scripts/world/tile_step_current_seals.py
    - scripts/world/sky_materials.py
    - scripts/world/bsp_model_licensee_rules.py
    - src/scene/world/minimapJoin.ts
    - tests/pipeline/test_minimap_join.py
    - tests/pipeline/test_minimap_step.py
    - tests/pipeline/test_gap_census_derived_parts.py
    - tests/pipeline/test_world_seal_inspection_reuse.py
    - tests/pipeline/test_tile_step_current_seals.py
    - tests/pipeline/test_world_sky_materials.py
    - tests/pipeline/test_store_file_publish.py
    - tests/pipeline/test_world_converter_request_locks.py
    - tests/unit/minimapJoin.test.ts
    - tests/fixtures/tileMinimapManifestFixture.ts
    - tests/browser/world-minimap.spec.ts
    - docs/parts/minimap/minimap-join-census.json
    - docs/parts/minimap/EVIDENCE.md
    - docs/parts/world/EVIDENCE.md
    - .planning/OVERNIGHT-DECISIONS.md
    - .planning/phases/02-stage-a-breadth/deferred-items.md

key-decisions:
  - "The 17 format 5 town maps convert through the existing minimap texture Converter, each PNG equal pixel for pixel to the recipe's B,G,R,A decode of mip 0 (row 1082)"
  - "Tile minimap schema 2 keeps radarTexture and projection, always null, as the 02-51 view contract until that view moves to the route (row 1083)"
  - "town_map.utx leaves the minimap sources; L2_RadarMap.utx moves to the one route unit (row 1084)"
  - "The route open items become tile gaps: zone-title-source and radar-anchor on every tile, zone-key-run on 20_14, 21_25 and 25_19 (row 1085)"
  - "One pinned image decoder module shared by sky and minimap (row 1086)"
  - "The census lists the route gaps once and one compact row per tile, 27,556 bytes (row 1089)"
  - "The Task 3 gap row sub-check stays red: a step row names its first reason in sort order, radar-anchor; the sealed products prove zone-title-source on 146 of 146 gapped tiles (row 1090)"

requirements-completed: []

duration: 95min
completed: 2026-11-13
---

# Phase 2 Plan 97: The verified minimap route Summary

**The minimap now follows the verified client route. One pinned recipe holds the 17 zone-name radar cases, the Global default, the six world map pieces with the global projection, and the zone sampler and key rules. One lane unit converts the 24 route textures once, and the 17 format 5 maps pass the pixel check. All 146 tile minimaps are schema 2 and pin that unit. The gap rows now name what is still unknown, not a guessed per-tile radar texture.**

## Performance

- **Duration:** about 95 min on resume (22:05 to 23:50 Riga), after the first executor's 21:07 to 21:40 run
- **Started:** 2026-11-13T21:07:00+02:00 (plan start commit 28e5b82)
- **Completed:** 2026-11-13T23:50:00+02:00
- **Tasks:** 3 of 3
- **Files modified:** 36

## Accomplishments

- Route recipe `recipes/world/minimap-radar-route.json` (SHA-256 `7ef3dd50...`): it pins interface.u, nwindow.u, Core.dll, engine.dll, nwindow.dll and Localization.ini at their lock entries, and holds every address, case and constant from the three facts files. It is read strictly. The real-client test (12 tests, the 6 client cases run on E:/Lineage2-client) checks the exports, the GetLocInfo case literals, the format 5 maps, the six pieces, the zone key textures and the zonename facts again.
- Route unit `minimap-route:interlude`: 24 archives in the world lane store. The 17 RGBA8 town maps report `pixelCheck` equal (1024 x 1024). The manifest is `maps/cde3726a.../native-minimap-route/manifest.json` (120,535 bytes). A rerun prints `sealed`, converted 0. The command guards its client and holds the world lane lock.
- Tile minimap schema 2 on all 146 tiles with a minimap: each pins the route and carries its `l2zonename.<tile id>` zone key texture and its hunting zones (214 in all). Gaps: `zone-title-source` 146, `radar-anchor` 146, `zone-key-run` 3. No radar-texture, zone-grid or projection reason is left.
- The legacy per-tile join is deleted, with its town_map role, tile-id-map and name rules, zone grid refusal, frame projection writer and their tests. The census is schema 2, 27,556 bytes.
- Batch (one process, `--eligible --limit 145`, no workers, 22:36 to 22:56): exit 0 with 145 tiles attempted. Lane catalog `43a5132d...` and coverage were written, 7,238,865 bytes of identical files were shared, and `--plan` ran once. Free bytes went from 141,044,334,592 to 140,719,968,256. The projection was 3,628,851,200 bytes (145 x the 25,026,560-byte tracer drop), far above the 4 GiB floor.
- Tiles sweep on catalog `43a5132d...`: 143 of 143 tile records checked, 136 pass. 7 failed with `The tile anchor lies outside every chunk terrain` (17_22, 20_18, 21_16, 22_19, 22_22, 24_14, 24_16), the same anchor failures as before.
- `NATIVE_STORE_ROOT=data-ui pnpm test:e2e tests/browser/world-minimap.spec.ts` after the batch: 6 passed and 1 skipped (the radar cell test, because the projection is null). This includes the real-store route pin check and the 20_21 gap state at 932 x 430 and 1440 x 900.

## Task Commits

1. **Task 1: tracer (route recipe, route unit, schema 2, 20_21)**: `8043667` and `2799beb` (first executor), fixes `63d37db` (lock reader) and the route command guard in `038466f`.
2. **Task 2: legacy join deleted, census rewritten**: `038466f`.
3. **Task 3: batch, catalog, sweep, evidence**: `bdea4ab` (evidence), `0fec565` (decision rows and the deferred item).

## Gate results

- Task 1 gate: `True 14836`, exit 0.
- Task 2 gate: `True`. The legacy name grep is empty. The targeted pipeline tests, vitest (25) and typecheck pass.
- Task 3 gate: `False True 0 0 0 True`, exit 1. The batch exit code is 0, the fingerprint inputs are equal, no receipt outside tile minimap and manifest changed, no legacy reason is left, every tile record has a load check and the docs are under the limit. Only the `titled` sub-check is red: a step's gap row names its first reason in sort order, `radar-anchor`. On the sealed products, 146 of 146 gapped tiles list `zone-title-source` (row 1090). The frozen-file diff since 28e5b82 is empty, and `write_lane_catalog.py --lane world --plan` exits 0. Ports 5173 and 5175 are free.
- Receipts: 289 changed since the plan start, all tile minimap or manifest units. The only new receipt is the route unit. `print_fingerprint_inputs.py` prints the same JSON before and after.
- `node scripts/check-lane-ownership.mjs --base 28e5b82 --part minimap` exits 1 on 20 foreign paths. 19 come from the lane/speed merge c5807c9, and `.gitattributes` holds the `eol=lf` pin of the route recipe (row 1091).
- `python scripts/test_pipeline.py`: 2,647 tests, 2 failures. `test_client_entry_points` failed on the new route command and is fixed in 038466f (re-run passes). `test_world_tile_general_steps` fails on 02-96's `--retry-tiles` message in convert_tile_batch.py, which is logged in deferred-items.md.

## Decisions Made

OVERNIGHT-DECISIONS rows 1082 to 1091 (see key-decisions).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Two world readers parsed the lock themselves**
- **Found during:** Task 2 (pipeline suite)
- **Issue:** `test_world_seal_inspection_reuse` refused `minimap_radar_route_recipe` (this plan) and `bsp_model_licensee_rules` (02-96) for calling `read_reference_client_lock`. The lock test still named L2_RadarMap.utx as a tile minimap source.
- **Fix:** both readers use `process_reference_client_lock`, and the test names l2zonename.utx. The bsp reader is in no unit fingerprint.
- **Commit:** 63d37db

**2. [Rule 2 - Missing critical] The route command had no client guard and no lane lock**
- **Found during:** Task 2 (`test_client_entry_points`)
- **Fix:** `main` guards the parsed client and holds `lane_batch_lock` of the world lane. A new test checks that a held lane is refused and no work is done.
- **Commit:** 038466f

**3. [Resume] The tracer batch found 20_21 already current**
- The first executor's tracer had sealed 20_21 minimap and manifest at 21:36 before it was stopped. The resumed batch attempted nothing. The tracer free bytes therefore come from the ledger receipts of that run (row 1087).

**4. [Gate] Census shape and Task 3 row reason**
- The census lists the route gaps once instead of on every tile row (row 1089). The Task 3 summary row sub-check is recorded red (row 1090).

## Known Stubs

- `radarTexture` and `projection` in tile minimap schema 2 are always null, which is the 02-51 view contract (row 1083). They are deleted after the view moves to the route (02-89).

## Open follow-ups for 02-89

- Route open items: `radar-anchor` (the meaning of the GetLocInfo MapX and MapY values) and `zone-title-source` (the native caller chain of the ShowZoneTitle zone name) are open on every tile. `zone-key-run` (the order of an overlapping key run) is open on 20_14, 21_25 and 25_19. The live use of specialHiddenMap and the full MinimapWnd.Minimap binding are open without a tile gap. Unblocking step: an IMPORTA-PC REA trace of those handlers, recorded in the verified facts, then a recipe update.
- Route texture gaps: none. All 24 converted, and the 17 pixel checks are equal.
- The 02-51 view on the route (data-ui): NewRadarWnd.TexMap by zone name, the MinimapWnd world map from the six pieces and the projection, and the zone sampler for the zone name text boxes. Unblocking step: a data-ui plan that reads `native-minimap-route`.
- After that view (world): delete the null `radarTexture` and `projection` fields, the synthetic radar fixtures and the tile-grid arrangement.
- Walk records stay under the earlier catalogs: `measurements/tile-walks-b4d451dc....json` (02-88, 125 tiles) and `tile-walks-420deb2f....json` (02-96 tiles). No walk input changed.
- Out of scope: the 02-96 `--retry-tiles` message breaks the tile id scan (deferred-items.md).

## Process cleanup

The route step, the tracer batch, the 145-tile batch, the pipeline suite, the 7 Playwright slices and the two world-minimap runs all exited. No process with this worktree path in its command line is running, and ports 5173 and 5175 have no listener.

## Self-Check: PASSED

- Recipe, route step, census and evidence files exist; commits 8043667, 2799beb, 63d37db, 038466f, bdea4ab and 0fec565 are ancestors of HEAD.
