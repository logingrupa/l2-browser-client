---
phase: 02-stage-a-breadth
plan: 51
subsystem: ui
tags: [world-06, minimap, native-windows, minimapctrl, dec-own-10, dec-own-9]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-20 window renderer and harness; 02-38 window registry, control type recipe, controls gap rows and style-source scan; 02-50 native-tile-minimap v1, loadNativeTileMinimap and minimapTexturePosition, minimap join census"
provides:
  - "src/ui/nativeWindows/minimapControl.ts: renderMinimapControl, minimapControlType"
  - "src/ui/nativeWindows/worldMapView.ts: planWorldMapView, tileHoldingScenePosition, WorldMapViewPlan, WorldMapCell"
  - "src/ui/nativeWindows/nativeWindowManifestLoader.ts: nativeWindowMinimapTileSource (catalog tiles slice, tile minimap loader, pinned radar archive image)"
  - "src/ui/nativeWindows/nativeWindowPlacement.ts: placeNativeWindowElement (the one inline px placement owner)"
  - "tests/browser/support/twoLaneStoreRoutes.ts: routeTwoLaneStores (read-only data-ui and world overlay)"
  - "harness query playerScenePosition=x,y,z"
  - "MinimapCtrl as the fifth rendered control type; no control-type-unsupported:MinimapCtrl gap row"
affects: [02-55, integration-restage, phase-3-side-by-side]

estimate:
  tokens: 80000
  tasks: 3
actuals:
  tokens: 27000
  tasks: 3
  commits: 4
plan_head_before: 8826cb353c01034fde6e4f0662be5417e6256172
plan_head_after: 946a4e6aee92f4bec030c369e6310738c3bb8050

tech-stack:
  added: []
  patterns:
    - "A pure planner returns cells, marker and gap as data; the DOM control only places what the plan says and reuses elements by tile id"
    - "A spec overlays two lane stores read-only through page.route instead of writing a merged store"

key-files:
  created:
    - src/ui/nativeWindows/minimapControl.ts
    - src/ui/nativeWindows/worldMapView.ts
    - src/ui/nativeWindows/nativeWindowPlacement.ts
    - tests/unit/minimapControl.test.ts
    - tests/unit/worldMapView.test.ts
    - tests/unit/support/tileMinimapFixtures.ts
    - tests/fixtures/tileMinimapManifestFixture.ts
    - tests/browser/world-minimap.spec.ts
    - tests/browser/support/twoLaneStoreRoutes.ts
    - tests/browser/support/syntheticMinimapTiles.ts
  modified:
    - recipes/data/native-window-control-types.json
    - src/ui/nativeWindows/nativeWindowRenderer.ts
    - src/ui/nativeWindows/nativeWindowLayer.ts
    - src/ui/nativeWindows/nativeWindowManifestLoader.ts
    - tests/browser/harness/nativeWindowHarness.ts
    - tests/unit/nativeWindowRenderer.test.ts
    - tests/pipeline/test_window_control_gaps.py
    - docs/parts/ui/EVIDENCE.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "Tile grid by XX_YY tile id around the player's tile, labelled tile-grid, unverified (row 745)"
  - "One texture pixel per CSS pixel with the player's texture position at the control centre, labelled presentation (row 746)"
  - "Half-open frames [minimum, maximum): a shared edge belongs to the tile whose frame minimum equals it (row 747)"
  - "routeTwoLaneStores overlays data-ui windows and world tiles read-only in the spec until the 02-55 union (row 748)"
  - "MinimapCtrl literal lives once in minimapControl.ts and the projection call in the pure planner; literal-name greps count 0 by design (row 749)"
  - "The pipeline test pins five rendered types; the controls step, not layout, owns control gap rows (row 750)"
  - "WORLD-06 stays Pending: no real tile shows a radar texture, marker texture and zone name unresolved (row 751)"

metrics:
  duration: 50min
  started: 2026-11-11T01:59:00+02:00
  completed: 2026-11-11T02:49:00+02:00
---

# Phase 2 Plan 51: MinimapCtrl and world map view Summary

**MinimapCtrl now renders in the native window registry (MinimapWnd and NewRadarWnd from the decoded tree). It draws the tile grid around the adapter local player from 02-50 tile minimaps at one texture pixel per CSS pixel, with half-open tile frames and sourced gap cells. The marker is labelled unverified, and the marker texture and zone name stay unresolved elements. No real tile shows a radar texture yet, because 02-50 joins none, so the real-data view shows its sourced state gap.**

## Tasks and commits

1. Task 1 (tracer): `3191c0d` Render MinimapCtrl controls with the tile minimap of the player's tile or its sourced gap (02-51 task 1). First executor.
2. Task 2: `a6e8204` Draw the tile grid around the player in MinimapCtrl with gap cells, and check it at the phone and desktop viewports (02-51 task 2). First executor.
3. Task 3: `6ce8f70` Pin MinimapCtrl as the fifth rendered control type in the window control gap test (02-51 task 3).
4. Task 3, docs: `946a4e6` Record the 02-51 MinimapCtrl evidence, the ui and minimap status lines and decision rows 745 to 750 (02-51 task 3).

A T3 server restart stopped the first executor after the Task 2 commit, leaving a clean tree. This resume reran the Task 1 and Task 2 checks before it started Task 3.

## Verification

- Resume check of Tasks 1 and 2 (2026-11-11 02:35 Riga): `pnpm typecheck` clean; `pnpm vitest run tests/unit/minimapControl.test.ts tests/unit/worldMapView.test.ts tests/unit/nativeWindowRenderer.test.ts tests/unit/nativeWindowStyleSources.test.ts` gave 4 files and 46 tests passed, including the DEC-OWN-10 style-source scan over the new files.
- Task 2 acceptance greps: `createElement|HTMLElement` in worldMapView.ts 0; `writeFile|mkdir` in twoLaneStoreRoutes.ts 0; `public/assets|world=interlude` in the three new files 0 each; both new files exist.
- Browser check passed (headless SwiftShader, no FPS claim), 02:36 Riga: `NATIVE_STORE_ROOT=data-ui pnpm test:e2e tests/browser/world-minimap.spec.ts`, 5 passed and 1 skipped, with nothing listening on 5173 before the run.
  - MinimapWnd renders the control, not the unsupported-type gap, and shows the state gap `no converted tile at the player position` with no marker when the served catalog has no tile.
  - Synthetic tiles: at 932 x 430 (`isMobile`, `hasTouch`) and 1440 x 900, the 20_21 radar cell draws an image, 21_21 carries `minimap-join-unresolved:radar-texture`, cells outside the catalog carry `tile minimap resource not in catalog`, and the marker sits inside the control. At 430 x 932 there is no horizontal scroll.
  - Real two-lane data at 932 x 430 and 1440 x 900: the 20_21 state gap shows with no marker, and there is no scroll in portrait.
  - Skipped: "shows the 20_21 radar texture cell and the marker". Its reason is that the 20_21 minimap has no radar projection (`minimap-join-unresolved:zone-grid`, `minimap-join-unresolved:radar-texture`). This case stays unverified, not passed.
  - Screenshots are in `artifacts/ui-evidence/minimap-*.png`. Their SHA-256 hashes are in `docs/parts/ui/EVIDENCE.md`.
- Gap rows: `python -B scripts/data/convert_ui.py --step controls --client E:/Lineage2-client --batch windows --limit 400` skipped all 248 sealed units. The seals were already written under the five-type fingerprint at 02:14. No file under `artifacts/lane-store/data-ui/gap-rows/` contains `control-type-unsupported:MinimapCtrl`. 110 windows hold 460 controls of 25 unsupported types (before: 111, 462, 26).
- Full suites at nice 10: `pnpm test:unit` 205 files passed and 3 skipped, 2,587 tests passed and 59 skipped, 0 failed. `pnpm test:pipeline` ran 1,848 tests, OK, 56 skipped. The red baseline was empty, and the suites match it.
- Ownership: `node scripts/check-lane-ownership.mjs --base 8826cb3 --part ui`, run after the last code commit `6ce8f70` and before the docs commit, printed `lane data-ui: 0 foreign paths`, exit 0. After the docs commit it lists only the shared `STATUS.md` and `.planning/OVERNIGHT-DECISIONS.md`, as in earlier plans.
- Reference overlap: no DEC-OWN-12 area in `tools/reference-overlap/overlapAreas.json` covers `src/ui/nativeWindows/**`, so there are no runs to report.
- The self-contained repo name check (DEC-OWN-11) is empty for everything this plan wrote.

## Requirements

- WORLD-06: Pending (row 751). The view side is built and tested. No real tile shows a radar texture, though, because the 02-50 radar join has no source. The marker texture and zone name text are unresolved, since both decoded MinimapCtrl records have an empty `textures` list. Hunting zones are carried as data only.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] The pipeline test still pinned four rendered control types**
- Found during: the Task 3 resume check. Task 1 had added MinimapCtrl to `recipes/data/native-window-control-types.json`, and `test_the_committed_recipe_lists_the_four_rendered_types` failed.
- Fix: the test now pins five types (`test_the_committed_recipe_lists_the_five_rendered_types`), and the no-rows case includes a MinimapCtrl control.
- Files: `tests/pipeline/test_window_control_gaps.py`. Commit `6ce8f70`.

### Plan text adjusted to the code as built

- The plan names `convert_ui.py --step layout` for regenerating gap rows. Control gap rows come from `--step controls`, so that step ran (row 750).
- Two acceptance greps count 0 by design (row 749): `MinimapCtrl` in the registry or renderer, and `minimapTexturePosition` in minimapControl.ts. The renderer dispatches on the imported `minimapControlType`, and the projection call lives in the pure planner `worldMapView.ts`, which the control calls. The key links hold through those imports.
- `nativeWindowRegistry.ts` and `convert_ui.py` needed no change. The dispatch lives in `nativeWindowRenderer.ts`, and the rendered type list lives in the recipe that `convert_ui.py` reads.
- Task 1 extracted `placeNativeWindowElement` into `nativeWindowPlacement.ts`, so the renderer and the minimap control share one placement owner. It also added `nativeWindowMinimapTileSource` to the manifest loader and wired it through `nativeWindowLayer.ts`. Neither file is in the plan's list.
- Screenshots go to `artifacts/ui-evidence/`, beside the other ui evidence screenshots, not `test-results/`.

## Known Stubs

None. The marker texture, the zone name text and the cells without a radar texture are explicit gap elements with reasons, as the plan requires. They are not stubs.

## Needs Human

None new. The data-ui and world lane restages already listed in STATE.md cover this plan's data.

## Open follow-ups

- The real-data radar case in `world-minimap.spec.ts` stays skipped until a radar texture joins a tile. That waits on the 02-50 radar source follow-up (no `L2_RadarMap.utx` export is named by tile, and the package is 118/0).

## Process cleanup

No process this plan started still runs. Playwright, its web server and the Vitest workers exited with their commands. A `Get-CimInstance Win32_Process` query for command lines with `autonomous-roadmap` and `vitest`, `vite`, `playwright`, `chrome`, `python` or `--port` returned nothing. Nothing listens on 5173 or 5175.

## Self-Check: PASSED

- Files: `src/ui/nativeWindows/minimapControl.ts`, `src/ui/nativeWindows/worldMapView.ts`, `tests/browser/support/twoLaneStoreRoutes.ts`, `tests/browser/world-minimap.spec.ts`, `tests/unit/minimapControl.test.ts` and `tests/unit/worldMapView.test.ts` exist.
- Commits `3191c0d`, `a6e8204`, `6ce8f70` and `946a4e6` are ancestors of HEAD.
