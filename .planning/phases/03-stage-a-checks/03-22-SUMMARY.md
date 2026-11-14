---
phase: 03-stage-a-checks
plan: 22
subsystem: ui
tags: [ui, minimap, radar, world-map, zone-sampler, gap-closure]
status: complete
gap_closure: true
requires:
  - phase: 02-stage-a-breadth
    provides: "02-97 minimap-route:interlude unit and the schema 2 tile minimaps that pin it"
provides:
  - "MinimapCtrl world map from the six route pieces with the GetMinimapPosition marker position"
  - "Zone sampler, zone key helper and zonename row lookup on the route manifest and the pinned zone key texture"
  - "NewRadarWnd.texMap GetLocInfo texture choice on every sampled zone change"
  - "Browser spec on the data-ui and world lane stores with 932 x 430 and 1440 x 900 screenshots"
affects: [03-23, 03-07, 03-08, 03-20, 03-32]
tech-stack:
  added: []
  patterns: ["route manifest parser at the trust boundary in src/ui", "window and control names read from the pinned recipe, never as source literals"]
key-files:
  created:
    - src/ui/nativeWindows/nativeMinimapRoute.ts
    - src/ui/nativeWindows/radarZoneName.ts
    - src/ui/nativeWindows/newRadarTextureChoice.ts
    - src/ui/nativeWindows/newRadarTextureMap.ts
    - src/ui/nativeWindows/minimapRadarRouteRecipe.ts
    - src/ui/nativeWindows/nativeTextureImageElement.ts
    - tests/unit/worldMapPieces.test.ts
    - tests/unit/radarZoneName.test.ts
    - tests/unit/support/radarZoneFixtures.ts
    - tests/fixtures/minimapRouteManifestFixture.ts
  modified:
    - src/ui/nativeWindows/minimapControl.ts
    - src/ui/nativeWindows/worldMapView.ts
    - src/ui/nativeWindows/nativeWindowManifestLoader.ts
    - src/ui/nativeWindows/nativeWindowRenderer.ts
    - src/ui/nativeWindows/nativeWindowLayer.ts
    - tests/browser/world-minimap.spec.ts
    - tests/unit/minimapControl.test.ts
    - tests/unit/worldMapView.test.ts
    - tests/unit/nativeWindowRenderer.test.ts
    - tests/unit/support/tileMinimapFixtures.ts
key-decisions:
  - "A zone key run returns minimap-join-unresolved:zone-key-run only when more than one of its rows holds Z (Bottom < Z < Top); one holding row is named whatever the run order"
  - "NewRadarWnd.texMap is driven by the MinimapCtrl of the same window; the window id and the control name come from the recipe radar.onLoad (interface.NewRadarWnd.OnLoad, TexMap = GetHandle(m_WindowName $ \".texMap\")); the texture fills the control as presentation while radar-anchor stays open"
  - "No zonename row holding Z gives the gap zone-name-row-absent and no texMap texture, since what the native does when GetZoneNameInfo returns NULL is not derived"
  - "A sampled tile whose minimap is not in the served catalog is the gap tile minimap resource not in catalog, not key 0; key 0 is used only when the served tile minimap pins no zone key texture"
  - "The zone key helper colour limit is read from the recipe zoneKey.helper, because the route manifest carries the computed row keys but not the helper"
requirements-completed: []
duration: 25 min
completed: 2026-11-14
metrics:
  tasks: 3
  files: 20
actuals:
  tokens: 34400
  tasks: 3
  commits: 3
plan_head_before: 474ab34521def4fdb154e45dd67d3bf60aea6f79
plan_head_after: 4b835d4c4bf91cf08ca15c9a260d7c2d9f2ff49f
coverage:
  - deliverable: "Six-piece world map and GetMinimapPosition marker"
    human_judgment: false
    verification:
      - { kind: unit, ref: "tests/unit/worldMapPieces.test.ts", status: pass }
      - { kind: unit, ref: "tests/unit/worldMapView.test.ts", status: pass }
      - { kind: unit, ref: "tests/unit/minimapControl.test.ts", status: pass }
      - { kind: browser, ref: "tests/browser/world-minimap.spec.ts#MinimapWnd draws the six world map pieces", status: pass }
  - deliverable: "Zone sampler, zone key helper, row lookup and texMap texture choice"
    human_judgment: false
    verification:
      - { kind: unit, ref: "tests/unit/radarZoneName.test.ts", status: pass }
      - { kind: browser, ref: "tests/browser/world-minimap.spec.ts#NewRadarWnd.texMap", status: pass }
---

# Phase 3 Plan 22: Minimap and radar views on the minimap-route unit Summary

The MinimapCtrl and NewRadarWnd views now read the `minimap-route:interlude` unit through the route pin every tile minimap shares. MinimapWnd draws the six world map pieces at map pixel (1024 column, 1024 row) and places the marker by GetMinimapPosition. The zone sampler gives the zone name, and NewRadarWnd.texMap shows the GetLocInfo texture for it: Giran Castle Town at the 22_22 anchor, RadarMaps.Global at the 20_21 anchor. No view reads the per-tile `radarTexture` or `projection` fields any more, and the tile-grid arrangement is deleted.

## What was built

- **Route manifest parser (task 1, d1a9b4b).** `parseNativeMinimapRoute` validates the served `native-minimap-route` manifest: radar cases and default with archive pins, world map pieces (refuses a piece whose map pixel is not column x width, row x height), the GetMinimapPosition projection, the zone sampler (clamp false), the zone key rows and the route gaps. The minimap source loads it through the tile minimap route pin and refuses tile minimaps that pin different routes.
- **World map view (task 1).** `planWorldMapView` places pieces 1 to 6 at (0,0), (1024,0), (0,1024), (1024,1024), (0,2048), (1024,2048) from the view origin. `worldMapPosition` computes mapX = trunc((X + 131072) * 41 / 8192) and mapY = trunc((Y + 262144) * 41 / 8192), truncating toward zero on both sides of the origin. The view origin centres on the marker and is listed as `presentation:view-origin-centred-on-marker`. The scale is one map pixel per CSS pixel, also presentation. An unconverted piece shows `world-map-piece-texture-absent`.
- **Zone sampler (task 2, a805fcd).** `radarZoneName.ts` follows verified-q7.md. The tile is T((x + 360448) / 32768 + 9), T((y + 294912) / 32768 + 9). The pixel is T(i32((x - originX) * width) / 32768), with no clamp: a pixel outside the mip is the gap `zone-sampler-pixel-outside-mip`. The key byte comes from `native/mip00.bin` of the converted L2ZoneName texture that the tile minimap pins; the archive keeps the P8 mip 0 bytes, so `zone-key-bytes` is not hit on the world lane. The key is 0 when the tile minimap pins no texture. The zone key helper is Color < 200 gives Color << 8, else ((((MapY << 8) | MapX) << 8) | Color) << 8. The row is the one with Bottom < float32(Z) < Top. More than one holding row returns `minimap-join-unresolved:zone-key-run`.
- **Texture choice (task 2).** `chooseNewRadarTexture` compares the whole name case-insensitively over the 17 route cases (ASCII fold, as appStricmp does in the C locale), else RadarMaps.Global. `Town  of Goddard` keeps its two spaces, so `Town of Goddard` with one space falls back to Global. `renderNewRadarTextureMap` draws the chosen texture in a child of texMap on every sampled zone change. That child carries `data-native-radar-texture`, `data-native-radar-zone-name` and `data-native-radar-is-global`. Its gaps always list `minimap-join-unresolved:zone-title-source`, the open source of the trigger, and `minimap-join-unresolved:radar-anchor`, the placement.
- **Control gap list.** The MinimapCtrl gaps (renderer `gaps` and `data-native-gap`) list the route gaps (zone-title-source, radar-anchor), the sampled tile minimap gaps (zone-key-run on 20_14, 21_25 and 25_19), any zone sample gap, `texture-reference-unresolved` for the marker, the view origin presentation, and `label-unresolved` for the zone name text. The zone name element carries the name in `data-native-zone-name` and keeps the text gap until 03-32.
- **Browser spec (task 3, 4b835d4).** It runs over the data-ui and world lane stores behind the port check with `NATIVE_STORE_ROOT=world`. The GetLocInfo case tile is 22_22, picked from the data: its anchor samples Giran Castle Town, row 43. All 8 tests passed (51.9 s), on SwiftShader, so no FPS claim. The screenshots are in `artifacts/ui-evidence/`:

| Screenshot | SHA-256 |
| --- | --- |
| minimap-route-22_22-1440x900.png | 97b2d2cb980951d80ebd242eb19fa678cf871e2242106bdc36b48dfbf8a9c693 |
| minimap-route-22_22-932x430.png | 109b99a7a792bfa761f2b116d4eca8c79fa38c351b441ca95695a1057915d22f |
| radar-texmap-22_22-1440x900.png | 57f5f8dfedbf4cf447e33429d185102b9552ec72d0cd2e185a28f611a1f37dc3 |
| radar-texmap-22_22-932x430.png | fcc5e7b8ae99984bdf072db35a35d9f7e742e60193e42059263d11cfb1b2599b |
| radar-texmap-20_21-1440x900.png | ea0698bdc24e82919146f6b002b3cde45e472efa677c45fccbfa3cf170be5c8f |
| radar-texmap-20_21-932x430.png | 6229f7697f7717bf2a748438bade7ded1bea885697ba5a0fce2ef2770e0b2780 |

A one-off read of the real world lane files (route cde3726a, zone key archives) gave these samples at the tile anchors: 22_22 Giran Castle Town, texture giran_castle_town; 20_21 Cruma Tower - Third floor, texture Global; 17_22 Gludin Village, texture gludin_village; 20_14 the zone-key-run gap.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Route manifest parser in a new file**
- Found during: task 1. The plan reads the route resource, but no parser for it existed in `src/ui`, and `src/scene/world` may not be edited.
- Fix: `src/ui/nativeWindows/nativeMinimapRoute.ts` validates the manifest at the trust boundary.
- Commit: d1a9b4b

**2. [Rule 3 - Blocking] Window and control names from the recipe**
- Found during: task 2. `nativeWindowRenderer.test.ts` forbids decoded window and control names as string literals in `src/ui/nativeWindows`, and the route manifest does not carry `radar.onLoad` or `zoneKey.helper`.
- Fix: `minimapRadarRouteRecipe.ts` reads `recipes/world/minimap-radar-route.json?raw`, with guards. It gives the texMap binding (NewRadarWnd, texMap) and the helper colour limit (200). The texMap child and the shared image helper are in `newRadarTextureMap.ts` and `nativeTextureImageElement.ts`, so `minimapControl.ts` stays at 230 lines. The renderer creates MinimapCtrl controls after the window tree, so the control can reach the texMap element.
- Commit: a805fcd

**3. [Rule 1 - Bug] Negative zero map position**
- Found during: task 1. `Math.trunc` returned -0 just below the map origin, while the native cvttsd2si gives the integer 0.
- Fix: `truncateToInt32` (`value | 0`).
- Commit: d1a9b4b

**4. Spec details**
- `?map=20_21` is read as the native-window harness at the 20_21 tile anchor, because the harness takes a player position, not a map.
- The spec names NewRadarWnd and texMap as literals. Playwright's loader cannot import the `?raw` recipe module.
- The source type is renamed `NativeWindowMinimapSource`, because it now loads the route, textures and zone key mips, not only tiles.

**Total deviations:** 3 auto-fixed (2 blocking, 1 bug) plus spec details. **Impact:** none on scope.

## Left for 03-23 (GP8)

- `tests/browser/support/syntheticMinimapTiles.ts` has no consumer now. 03-23 deletes it, and its gate `test ! -e` is unchanged.
- The radar and projection parts of `tests/fixtures/tileMinimapManifestFixture.ts` (`syntheticTileFrameCentreScene`, `syntheticZoneTitleGapReason`, `syntheticTileTextureSize`, the `radarArchive` parameter), and `minimapTexturePosition` with the `radarTexture` and `projection` fields in `src/scene/world/minimapJoin.ts`, are read by no view now. They are left for the 03-23 schema 3 change, because this plan may not edit `src/scene/world`. `tests/unit/support/tileMinimapFixtures.ts` passes `null` for the radar archive.

## Checks

- Task 1 gate `pnpm vitest run tests/unit/worldMapPieces.test.ts tests/unit/worldMapView.test.ts tests/unit/minimapControl.test.ts`: RED first (missing modules), then pass. The tracer gate was re-run, and the real route manifest cde3726a parses (6 pieces, 369 zone key rows).
- Task 2 gate `pnpm vitest run tests/unit/radarZoneName.test.ts tests/unit/minimapControl.test.ts`: RED first, then pass (119 tests across the minimap and native window files).
- Task 3 gate: the port check printed nothing; `NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-minimap.spec.ts` ran at BelowNormal and 8 tests passed.
- `pnpm typecheck` is clean. The full `pnpm test:unit` (BelowNormal, the only run on the machine) passed: 238 files and 2908 tests passed, 3 files and 59 tests skipped.
- `node scripts/check-lane-ownership.mjs --base 474ab34 --part ui`: lane data-ui, 0 foreign paths.
- Reference overlap: there is no `ui` area in `tools/reference-overlap` (areas: materials, bsp-visibility, movement, particles, network), so it was not run.

## Open questions (for the orchestrator, no new Needs Human)

- When `FL2GameData::GetZoneNameInfo` returns NULL (no row holds Z, or the key run probe stops), does the client still fire EV_BeginShowZoneTitleWnd, with what ZoneName, and does GetLocInfo run? The view shows the gap `zone-name-row-absent` and no texMap texture until this is answered. It belongs with the existing zone-title-source item.
- These stay open on the STATE Needs Human IMPORTA-PC minimap line, unchanged: radar-anchor (the meaning of MapX and MapY, which places the texMap texture), zone-title-source (the trigger), zone-key-run (row order where ranges overlap), specialHiddenMap, and the MinimapCtrl marker texture (both decoded MinimapCtrl records have an empty texture list).

## Decision rows for pending-decision-rows.md

This executor works only inside the worktree, so the orchestrator appends these rows (next P numbers after P1211) from the key-decisions above:
- 03-22: zone-key-run only when more than one row of a key run holds Z.
- 03-22: texMap is driven by the MinimapCtrl of NewRadarWnd, with names read from the recipe radar.onLoad. The texture fills the control as presentation.
- 03-22: no holding row gives zone-name-row-absent and no texMap texture.
- 03-22: a sampled tile that is not in the catalog is a gap, not key 0.
- 03-22: the helper colour limit is read from the recipe zoneKey.helper.

## Process cleanup

Playwright's `webServer` (pnpm dev on 5173) stopped when the spec exited. After the runs, `netstat` shows no listener on 5173 or 5175. No process has `autonomous-roadmap` in its command line apart from this executor's own shells. No Vitest worker is left.

## Self-Check: PASSED

- Created files exist: nativeMinimapRoute.ts, radarZoneName.ts, newRadarTextureChoice.ts, newRadarTextureMap.ts, minimapRadarRouteRecipe.ts, nativeTextureImageElement.ts, worldMapPieces.test.ts, radarZoneName.test.ts, radarZoneFixtures.ts, minimapRouteManifestFixture.ts.
- Commits d1a9b4b, a805fcd and 4b835d4 are on `plan/autonomous-roadmap`. `git rev-list --count 474ab34..HEAD` is 3 before this SUMMARY.
