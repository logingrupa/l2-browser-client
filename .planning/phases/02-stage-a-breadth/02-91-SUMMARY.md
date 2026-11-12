---
phase: 02-stage-a-breadth
plan: 91
subsystem: world streamed tile route
tags: [world-lane, world-04, vis-01, mat-02, gap-closure, chunk-residency, tile-systems, bsp-visibility, lightmaps, draw-limit]
status: complete
requires:
  - phase: 02-stage-a-breadth
    provides: 02-49 chunk residency rings, 02-63 BSP visibility binding, 02-64 tile lighting binding, 02-81 seam strip on worldResidencyRing
provides:
  - NativeTileChunkResidency.subscribeChunkEvents with chunkLoaded and chunkDisposed (ResidencyChunkEventListener)
  - per-chunk addChunk and removeChunk on bindTileLighting, attachTileLighting, attachTileVisibility, bindTileVisibility (addChunkTargets, removeChunkTargets) and attachNativeTileSystems
  - chunkVisibilityTargets in babylonTileVisibilityTargets.ts (replaces tileVisibilityTargets); a non-resident chunk is absent, an unmappable resident chunk is listed in unmappedChunks
  - TileVisibilityFrameSource.setTranslucentSections, driven by the bound chunk targets
  - src/scene/world/streamedTileSystems.ts, one systems record per streamed tile with a per-tile inspection and a culling switch for every tile
  - residencyDrawLimitRules in worldResidencyRing.ts and the TileVisibilityLimitRow union in the visibility inspection
  - tests/browser/world-tile-streamed-systems.spec.ts
affects: [02-88 world evidence, 02-89 Needs Human on the draw limit value, PERF-02 culling measurement, 03 world checks]
tech-stack:
  added: []
  patterns: [residency chunk events drive per-chunk system binding, per-tile systems keyed by tile id and released on the last disposed chunk, limit rows carry status and provenance]
key-files:
  created:
    - src/scene/world/streamedTileSystems.ts
    - tests/unit/attachNativeTileSystems.test.ts
    - tests/browser/world-tile-streamed-systems.spec.ts
  modified:
    - src/scene/world/nativeTileChunkResidency.ts
    - src/scene/world/streamNativeTileChunks.ts
    - src/scene/world/attachNativeTileSystems.ts
    - src/scene/world/loadNativeTileChunks.ts
    - src/scene/world/loadNativeSection.ts
    - src/scene/world/lighting/bindTileLighting.ts
    - src/scene/world/lighting/attachTileLighting.ts
    - src/scene/world/bspVisibility/attachTileVisibility.ts
    - src/scene/world/bspVisibility/bindTileVisibility.ts
    - src/scene/world/bspVisibility/babylonTileVisibilityTargets.ts
    - src/scene/world/bspVisibility/core/tileVisibilityFrame.ts
    - src/scene/world/worldResidencyRing.ts
    - tests/unit/streamNativeTileChunks.test.ts
    - tests/unit/attachTileLighting.test.ts
    - tests/unit/decodeTileLighting.test.ts
    - tests/unit/bindTileVisibility.test.ts
    - tests/unit/bspTranslucentOrder.test.ts
    - tests/unit/collisionInputsFromCellsOnly.test.ts
    - tests/unit/worldResidencyRing.test.ts
decisions:
  - "P1062: the residency announces chunk loads and disposals through subscribeChunkEvents; a disposal is announced before its container is disposed, a failed load never"
  - "P1063: neighbour tile systems attach on the first resident chunk and release on the last; the selected tile keeps its systems for the section lifetime because the section hands them to its callers"
  - "P1064: map emitter placements and movers attach per tile, since their resources carry no chunk key; memberVisible follows the per-chunk visibility members"
  - "P1065: NativeSection.tileVisibility.setCulling reaches every streamed tile's binding, including tiles attached later"
  - "P1066: residency-visual-ring-radius and residency-null-lod-cull-distance (presentation, row 735, metres) follow committedBspVisibilityRules.limitRules in the tile visibility inspection"
requirements-completed: []
coverage:
  - id: D1
    description: "The residency announces chunk loads and disposals in order to listeners added after ready, never a failed load"
    requirement: WORLD-04
    verification:
      - kind: unit
        ref: "tests/unit/collisionInputsFromCellsOnly.test.ts#announces each settled load and each disposal before its container goes, to a listener added after ready, and never a failed chunk"
        status: pass
    human_judgment: false
  - id: D2
    description: "A chunk loaded after startup gets lightmap plans, loses them on dispose and gets them again on reload"
    requirement: MAT-02
    verification:
      - kind: unit
        ref: "tests/unit/attachTileLighting.test.ts#plans the lightmaps of a chunk added after attach, drops them when it is removed and plans them again when it returns"
        status: pass
      - kind: unit
        ref: "tests/unit/streamNativeTileChunks.test.ts#binds a selected-tile chunk that loads after startup, unbinds it when it is disposed and binds it again when it reloads"
        status: pass
    human_judgment: false
  - id: D3
    description: "Visibility targets per resident chunk; a non-resident chunk is absent from the walk, an unmappable resident chunk is reported as bsp-visibility-section-unmapped"
    requirement: VIS-01
    verification:
      - kind: unit
        ref: "tests/unit/bindTileVisibility.test.ts#culls the resident chunks of a tile, keeps a non-resident chunk out of the walk and lists an unmapped resident chunk"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every streamed tile with resident chunks gets its own systems, released on its last disposed chunk; culling reaches every tile"
    requirement: WORLD-04
    verification:
      - kind: unit
        ref: "tests/unit/streamNativeTileChunks.test.ts#gives a neighbour tile its own systems on its first resident chunk and releases them on its last disposed chunk"
        status: pass
      - kind: e2e
        ref: "tests/browser/world-tile-streamed-systems.spec.ts (desktop 1440 x 900, phone 932 x 430 landscape)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The row 735 ring and cull are listed as presentation limit rows next to the committed visibility limit rows"
    requirement: VIS-01
    verification:
      - kind: unit
        ref: "tests/unit/bindTileVisibility.test.ts#lists the residency draw limit rows next to the committed visibility limit rows"
        status: pass
    human_judgment: true
    rationale: "The value itself (keep 81.92 m, fog end or far plane) is an owner decision (STATE Needs Human, rows 926, 940 and 1066)"
metrics:
  duration: 72min
  completed: 2026-11-12
actuals:
  tokens: 36900
  tasks: 3
  commits: 3
plan_head_before: 6b7e3dcfb85ed818a1f806ad551dd1488c7de0c8
plan_head_after: cda6e15ffe7521afab07202f84527376ec63364b
---

# Phase 2 Plan 91: Chunk-incremental tile systems on the streamed route summary

**The streamed tile route now binds visibility and lightmaps per resident chunk on every streamed tile, driven by residency chunk-loaded and chunk-disposed events. A chunk that is not resident is left out of the walk instead of making the tile report `bsp-visibility-section-unmapped`. The row 735 ring and cull (81.92 m) appear in the tile visibility inspection as presentation limit rows.**

## Performance

- **Duration:** 72 min (2026-11-12T18:17:42Z to 19:29:03Z)
- **Tasks:** 3 of 3
- **Files:** 3 created, 19 modified

## Accomplishments

- `createNativeTileChunkResidency` announces each settled load after its collision cell is added. It announces each disposal after the cell is released and before the container is disposed. Listeners subscribe with `subscribeChunkEvents` at any time, and a failed load is never announced.
- `bindTileLighting` plans, binds and releases one chunk at a time with the same `planLightmapSections`. A chunk removed while its program loads binds nothing, and mesh materials change only after every section of the chunk is prepared.
- `bindTileVisibility` takes per-chunk targets. A chunk added after frames ran gets the current shown state at once, and the frame source's translucent section set follows the bound chunks. `chunkVisibilityTargets` maps one resident chunk. A non-resident chunk is never named, and a resident chunk whose ranges are missing from its BSP is listed in `unmappedChunks` with `bsp-visibility-section-unmapped: ...`.
- `streamedTileSystems.ts` keeps one systems record per streamed tile. A tile attaches from its own manifest on its first resident chunk and releases on its last. The selected tile keeps its systems for the section's callers. Each chunk event goes to its own tile, and `streamedTiles[].systems` lists the resident, bound, culled and lightmapped chunk ids per tile.
- The startup-only pin in `tests/unit/streamNativeTileChunks.test.ts` is gone. In its place are cases for late, disposed and reloaded chunks, neighbour tiles, the culling switch, attach failure and the draw limit rows.
- `residencyDrawLimitRules` reports `residency-visual-ring-radius` and `residency-null-lod-cull-distance` with status `presentation`, provenance `OVERNIGHT-DECISIONS row 735` and unit metres. They appear after `portal-range`, `portal-depth-cap`, `static-mesh-range` (infinity) and `emitter-clipping-range`.

## Task commits

1. **Task 1 (tracer): lightmaps for chunks streamed in after startup through residency chunk events** - `0c3a964`
2. **Task 2: visibility per chunk and systems for every streamed tile** - `92d6cf3`
3. **Task 3: draw limit rows and the streamed-route browser check** - `cda6e15`

## Verification

- `pnpm vitest run` on streamNativeTileChunks, attachTileLighting, bindTileVisibility, worldResidencyRing, importBoundaries.bspVisibility, attachNativeTileSystems, collisionInputsFromCellsOnly, decodeTileLighting, bspTranslucentOrder and loadNativeTileChunks: 10 files, 96 tests pass. `pnpm typecheck` is clean.
- Full `pnpm test:unit` (one suite on the machine, BelowNormal): 231 files pass, 3 skipped; 2,836 tests pass, 59 skipped.
- `NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-streamed-systems.spec.ts` (port 5173 free beforehand, BelowNormal): 2 passed in 14.9 min. Both viewports skip 18_24, 18_10, 20_10, 18_22 and 19_16 with the recorded load error (see Deviations). They start on 20_21 and walk 26 MOVE-01 hops into `20_20/chunk-0-3`, which was not resident at startup. There the chunk reads resident, bound to the 20_20 systems, lightmapped (20_20 lighting: 56 sections, 42 lightmapped) and a visibility target with no unmapped chunks. The limit rows read the committed four plus the two residency rows at 81.92 m, and portrait 430 x 932 has no horizontal scroll. Screenshots (headless SwiftShader, no FPS claim): desktop 1440 x 900 sha256 `0d99bb89461b15b520db8fd6e8d57ae80d198a835b46d5602f0d08d1fe46113f`, phone 932 x 430 sha256 `f1f7acdc2cbd52c42f4b1e531a8c9a38739bba915a0ebdc127b9b5485af2314c`. Both were written by the spec to `test-results/world-tile-streamed-systems-*.png` with the JSON next to them, and they are regenerated by rerunning the command.
- `node scripts/check-lane-ownership.mjs --base 6b7e3dc --part world`: 0 foreign paths.
- Reference overlap, area `bsp-visibility` (`node tools/reference-overlap/referenceOverlap.mjs --area bsp-visibility --reference-root C:/laragon/www/l2-browser-client`): 23 blocking runs (attachTileVisibility.ts 7, babylonTileVisibilityTargets.ts 9, bindTileVisibility.ts 6, core/tileVisibilityFrame.ts 1), 406 unreviewed reviewer runs, 17 stale sign-offs and 286 stale reviewed runs. The report is at `artifacts/reference-overlap/02-91-bsp-visibility.json`. The independent overlap review after the wave covers it, and no sign-off rows were added.

## Deviations from plan

### Auto-fixed and scoped adjustments

**1. [Rule 3 - Blocking] The browser check's candidate tiles do not load on the world lane store**
- **Found during:** Task 3
- **Issue:** 18_24, 18_10, 20_10, 18_22 and 19_16 stop at "Typed payload: array VOLS.water is not in the payload." because their chunk collision payloads predate the 02-77 VOLS fields. Only 17_12, 18_12, 20_20 and 20_21 carry them, and those four leave none of their own chunks outside the startup ring.
- **Fix:** The spec tries the five tiles in plan order, records each load error in its evidence JSON, and then starts on 20_21. There it walks into the nearest lit BSP chunk, of the start tile or a loadable neighbour, that was not resident at startup (`20_20/chunk-0-3`). The selected tile's own late chunk is proven by the unit tests. Restaging that collision is batch work, listed in STATE Open follow-ups.
- **Files:** tests/browser/world-tile-streamed-systems.spec.ts

**2. [Rule 2 - Correctness] The culling switch reaches every streamed tile**
- **Found during:** Task 2
- **Issue:** Neighbour tile bindings were out of reach of the developer sheet's culling switch, so their sections would never be culled.
- **Fix:** `NativeSection.tileVisibility` keeps the selected binding but routes `setCulling` through `streamedTileSystems`, which applies it to every tile and to tiles attached later (row 1065).

**3. Files outside the plan list**
- `src/scene/world/streamedTileSystems.ts` is new, split out of `streamNativeTileChunks.ts` as the plan allows.
- `src/scene/world/bspVisibility/core/tileVisibilityFrame.ts` gained `setTranslucentSections`, because a chunk's translucent sections are known only from its GLB. Its test is in `tests/unit/bspTranslucentOrder.test.ts`.
- `src/scene/world/loadNativeTileChunks.ts` builds per-chunk contents on the eager route.
- `src/scene/world/loadNativeSection.ts` types `bspVisibility` as the runtime inspection.
- The residency event test is in `tests/unit/collisionInputsFromCellsOnly.test.ts`, which owns the real residency harness.
- `tests/unit/decodeTileLighting.test.ts` covers the per-chunk binding.
- `tests/unit/attachNativeTileSystems.test.ts` is new and covers the visibility plus lighting glue and the rollback.

**4. Map emitter placements and movers attach per tile, not per chunk** (row 1064)
- The `map-emitters` and `movers` resources are tile records with no chunk key. `tileMapEmitterPlacements.ts` is unchanged. Each placement's `memberVisible` follows the tile binding, whose static mesh members now map per resident chunk.

## Requirement status

- WORLD-04: the slice-11 and slice-12 findings this plan names are closed. REQUIREMENTS.md keeps WORLD-04 pending, because the phase verification lists it BLOCKED (partial) on the seam collision, the LOD derivatives and the GTX 1060 run. `requirements.mark-complete` set it complete, and that mark was reverted.
- VIS-01: already complete (provisional, owner review). This plan adds culling for every resident chunk of every streamed tile, plus the draw limit rows.
- MAT-02: lightmaps are bound on every drawn chunk. REQUIREMENTS.md keeps MAT-02 pending, since the requirement also covers converter export work outside this plan, and the tool did not find its provisional row.

## Decisions

- OVERNIGHT-DECISIONS rows 1062 to 1066 (see frontmatter).

## Needs Human

- STATE Needs Human (rows 926, 940 and 1066): the value of the streamed tile draw limit. Either keep the row 735 81.92 m ring and cull, or derive it from fog end or the far plane.

## Open follow-ups

- Stale chunk collision on 18_24, 18_10, 20_10, 18_22 and 19_16 (STATE Open follow-ups): the world batch reconverts their collision. After that, the spec proves an own-tile late chunk on the first of them.
- BSP visibility overlap review for this plan's runs (STATE Open follow-ups): 23 blocking, 406 unreviewed, 17 stale sign-offs.
- Row 740's open follow-up "Chunk-incremental tile systems" is closed and removed from STATE.

## Threat flags

None beyond the plan's register. Neighbour systems read their manifest through the same `readResidencyTile` verified reader (T-02-91-02). Chunk add and remove are idempotent per chunk, and systems are released on the last disposed chunk and on dispose (T-02-91-01). The draw limit is reported, not hidden (T-02-91-03).

## Process cleanup

- Two Playwright runs ended on their own. One run was stopped by its PowerShell PID tree with `taskkill /PID <pid> /T /F` once its failure was known.
- After the last run, no listener remains on 5173 or 5175. No node, chrome, chrome-headless-shell or msedge process holds this worktree path in its command line, and no Vitest worker remains after the full suite exited.

## Self-Check: PASSED

- Found: src/scene/world/streamedTileSystems.ts, tests/unit/attachNativeTileSystems.test.ts, tests/browser/world-tile-streamed-systems.spec.ts
- Found commits: 0c3a964, 92d6cf3, cda6e15
