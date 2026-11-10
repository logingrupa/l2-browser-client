---
phase: 02-stage-a-breadth
plan: 63
subsystem: world
tags: [vis-01, bsp-visibility, zones, portals, translucent-order, map-emitters, culling, dec-own-12, babylon]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-56 readTypedPayload, src/shared/math, src/world/sourceFrame.ts; 02-57 reference overlap check; 02-61 the per-tile bsp-visibility typed payload (NODE, BNDS, LEAF, ZONE, PORT, RNGE, MEMB) and recipes/world/bsp-visibility.json"
provides:
  - "src/scene/world/bspVisibility/core: decodeBspVisibility, locateZone, portalWalk, viewFrustum, translucentOrder, tileVisibilityFrame (computeTileVisibilityFrame, TileVisibilityFrame, createTileVisibilityFrameSource), visibleSectionWalk, memberVisibility, zoneSet"
  - "src/scene/world/bspVisibility/bindTileVisibility.ts: bindTileVisibility, TileVisibilityBinding (memberVisible by export index, setCulling, describe row world.visibility.culling, inspection)"
  - "src/scene/world/bspVisibility/attachTileVisibility.ts, babylonTileVisibilityTargets.ts, loadBspVisibility.ts, bspVisibilityRules.ts"
  - "src/scene/world/fetchNativeTypedPayload.ts: the one asset.json plus pinned payload.bin fetch (collision and visibility)"
  - "NativeSection.tileVisibility and the tile inspection field bspVisibility"
affects: [02-64, 02-67, 02-69]

estimate:
  tokens: 95000
  tasks: 3
actuals:
  tokens: 37000
  tasks: 3
  commits: 4
plan_head_before: ffe605c4989429c8aa7245dc36bec02cd453e867
plan_head_after: 5f670c0609c77fced6cd66b1d931861c3312fc3f

tech-stack:
  added: []
  patterns:
    - "A Babylon-free core computes a cached per-frame result from a source-unit ViewPose; the binding applies only deltas through plain {setVisible} and {reorderIndexBlocks} targets, so unit tests use plain objects"
    - "Typed payload tile resources load through fetchNativeTypedPayloadFiles, then an area decoder adds count, index and tree guards"

key-files:
  created:
    - src/scene/world/bspVisibility/core/decodeBspVisibility.ts
    - src/scene/world/bspVisibility/core/locateZone.ts
    - src/scene/world/bspVisibility/core/portalWalk.ts
    - src/scene/world/bspVisibility/core/viewFrustum.ts
    - src/scene/world/bspVisibility/core/translucentOrder.ts
    - src/scene/world/bspVisibility/core/tileVisibilityFrame.ts
    - src/scene/world/bspVisibility/core/visibleSectionWalk.ts
    - src/scene/world/bspVisibility/core/memberVisibility.ts
    - src/scene/world/bspVisibility/core/zoneSet.ts
    - src/scene/world/bspVisibility/loadBspVisibility.ts
    - src/scene/world/bspVisibility/bindTileVisibility.ts
    - src/scene/world/bspVisibility/babylonTileVisibilityTargets.ts
    - src/scene/world/bspVisibility/attachTileVisibility.ts
    - src/scene/world/bspVisibility/bspVisibilityRules.ts
    - src/scene/world/fetchNativeTypedPayload.ts
    - tests/support/bspVisibilityFixture.ts
    - tests/unit/bspTranslucentOrder.test.ts
    - tests/unit/bspVisibilityWalk.test.ts
    - tests/unit/bindTileVisibility.test.ts
    - tests/unit/importBoundaries.bspVisibility.test.ts
    - tests/browser/world-bsp-visibility.spec.ts
  modified:
    - src/scene/world/loadNativeTileChunks.ts
    - src/scene/world/loadNativeSection.ts
    - src/scene/world/movement/loadCollisionCells.ts
    - src/scene/world/nativeFlameBillboards.ts
    - docs/parts/world/EVIDENCE.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "Map-emitter and member gating follow the culling variable: off (default) every member answers visible, on the walk gates by zone and range (row 625)"
  - "memberVisible is keyed by the placement's package export index; an unlisted index answers visible (row 626)"
  - "A section is a (chunk ordinal, primitive) pair of RNGE checked against the chunk BSP GLB node ranges; a mismatch is bsp-visibility-section-unmapped and the tile draws everything (row 627)"
  - "Extra modules: zoneSet, visibleSectionWalk, memberVisibility in the core; Babylon targets, attach and recipe rules outside it; one shared typed payload fetch (row 628)"
  - "The one loaded tile is the camera tile until WORLD-04 residency (row 629)"
  - "The binding is returned as NativeSection.tileVisibility for the 02-67 sheet switch (row 630)"
  - "Overlap report recorded for the orchestrator's independent review (row 631)"

requirements-completed: []

coverage:
  - id: D1
    description: "Decoder with count, index, zone and tree guards; zone locate with the PlaneDot >= 0 front tie; translucent back-to-front rank order on either side of a plane; float32 pose frame cache"
    requirement: VIS-01
    verification:
      - kind: unit
        ref: "tests/unit/bspTranslucentOrder.test.ts (9 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Portal walk by depth with recipe depth and range rows at infinity, frustum on src/shared/math, front-to-back section walk, outdoor view in solid space, static mesh and map emitter gating"
    requirement: VIS-01
    verification:
      - kind: unit
        ref: "tests/unit/bspVisibilityWalk.test.ts (12 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Binding: deltas only, culling variable off by default, memberVisible by export index, translucent index rewrite on an unshared Mesh, unmapped-section gap, equal door and targeting picks with culling on and off"
    requirement: VIS-01
    verification:
      - kind: unit
        ref: "tests/unit/bindTileVisibility.test.ts (7 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Core import boundary: only the core and src/shared, no package, ES2022 library alone"
    requirement: VIS-01
    verification:
      - kind: unit
        ref: "tests/unit/importBoundaries.bspVisibility.test.ts (12 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Tile 20_21 on the native route reports its camera zone, 97 of 97 sections visible, 0 translucent sections and culling off"
    requirement: VIS-01
    verification:
      - kind: e2e
        ref: "NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-bsp-visibility.spec.ts (2 passed, 1440 x 900, 932 x 430 touch, 430 x 932 no scroll)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Every visibility rule runs as an unconfirmed or unknown reference default"
    requirement: VIS-01
    verification:
      - kind: unit
        ref: "tests/unit/bspVisibilityWalk.test.ts#bounds the walk by the depth and range rows"
        status: pass
    human_judgment: true
    rationale: "The C4-derived rules stay unconfirmed until POL-04 re-derives them against the Interlude binaries, and the culling default flips only after PERF-02 measures it on the GTX 1060"

duration: 25min
completed: 2026-11-10
---

# Phase 2 Plan 63: BSP visibility walk and binding Summary

**A Babylon-free walk in `src/scene/world/bspVisibility/core` turns the 02-61 tile resource and a source-unit camera pose into a cached `TileVisibilityFrame` (camera zone and leaf, portal-expanded zone set, visible sections, gated static meshes and map emitters, terrain, translucent back-to-front block order), and `bindTileVisibility` applies it to the tile's chunk BSP meshes through `isVisible` deltas and index rewrites, with culling a presentation variable that stays off until PERF-02.**

## Performance

- Duration: about 25 min (04:25 to 04:50 UTC), including two 2 min browser runs and one full `pnpm test:unit`.
- Tasks: 3 of 3. Files: 28 changed (21 created, 7 modified).

## Accomplishments

- Decoder: `readTypedPayload` plus area guards (every array count against the node, bound, leaf, zone and member counts; child, coplanar, leaf, render bound and portal indices in range; zones below 64; a tree from node 0 with no node reached twice; one index range per node; CSR order of member leaves).
- Walk: zone locate (PlaneDot >= 0 front, empty slot falls back to the other slot), seed from the leaf PVS and connectivity, portal expansion by depth giving each zone its smallest depth, front-to-back descend and emit stack with zone-mask and render-bound pruning, outdoor view for a camera in solid space, member gating, translucent rank order. All limits come from `recipes/world/bsp-visibility.json` at their runtimeDefault (infinity).
- Binding: the tile loader loads the resource, maps each section to its chunk BSP mesh after checking the ranges against the GLB node ranges, registers a per-frame observer, and reports `bspVisibility` in the tile inspection or its gap reason. `world.visibility.culling` is a `describe()` row (presentation, off | on); `memberVisible(exportIndex)` serves FX-01.
- `nativeFlameBillboards.ts` converts through `src/world/sourceFrame.ts` (no `* 100` left), with every comment removed and its names spelled out.

## Task commits

1. Task 1 (tracer): `d649edf` feat(02-63): decode the tile BSP visibility resource, locate the camera zone and order translucent BSP back to front
2. Task 2: `254df65` feat(02-63): walk portals and the BSP front to back, gate map emitters by zone and add the off-by-default culling variable
3. Task 3: `4704fd8` test(02-63): keep the BSP visibility core inside itself and src/shared with no package or browser global; `5f670c0` docs(02-63): record the BSP visibility walk evidence, the world status line and decision rows 625 to 631

Tracer gate: typecheck, `bspTranslucentOrder.test.ts` and the browser spec passed before Task 2.

## Verification

- `pnpm typecheck` clean. `pnpm test:unit`: 182 files passed, 3 skipped; 2,508 tests passed, 59 skipped (no red).
- Targeted: `bspTranslucentOrder` 9, `bspVisibilityWalk` 12, `bindTileVisibility` 7, `importBoundaries.bspVisibility` 12, `nativeFlameBillboards`, `loadCollisionCells`, `loadNativeTileChunks`, `nativeSection` and the runtime, flame and world audio suites pass.
- Browser, 5173 free: `NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-bsp-visibility.spec.ts` 2 passed (lane catalog f60ce2d8, 2026-11-10 06:37 Riga, headless SwiftShader, no FPS claim).
- Acceptance: `grep -rc "@babylonjs" src/scene/world/bspVisibility/core` prints 0 for all nine files; `grep -c -E "\* 100\b" src/scene/world/nativeFlameBillboards.ts` prints 0; `grep -rn -i "occlusionQuery\|octree" src/scene/world/bspVisibility` prints nothing; `grep -c "BSP visibility walk (02-63)" docs/parts/world/EVIDENCE.md` prints 1.
- Lane ownership: `check-lane-ownership.mjs --base ffe605c --part world` lists 0 foreign paths.
- Reference overlap, area bsp-visibility: 290 blocking and 3,521 unreviewed runs (4,128 reviewer runs, 599 reviewed, 8 signed off), report `artifacts/reference-overlap/02-63-bsp-visibility.json`. The tokenizer replaces identifiers and strings, so the runs are generic TypeScript shapes (161 of the blocking runs are the decoder's guard lines and interfaces). Left for the orchestrator's independent review (run rules, row 631).

## Deviations from plan

### Auto-fixed issues

**1. [Rule 2 - DRY] One typed payload fetch**
- Found during: Task 1. The collision cell loader already fetched asset.json and its pinned payload.bin; `fetchNativeTypedPayload.ts` now serves both, with the same error wording (`loadCollisionCells.test.ts` passes unchanged).

**2. [Rule 3 - Blocking] Binding signature and extra modules**
- The plan named `bindTileVisibility(scene, chunks, frameSource)`. The binding takes `{tileId, model, view, targets, frameSource, limitRules}` so its logic is testable with plain objects; `babylonTileVisibilityTargets.ts` builds the Babylon view and targets and `attachTileVisibility.ts` joins them for the tile loader. Core gained `zoneSet.ts`, `visibleSectionWalk.ts` and `memberVisibility.ts` (one mechanism each); `bspVisibilityRules.ts` reads the recipe outside the core. Row 628.

**3. [Rule 2 - Missing critical] Range check against the chunk BSP**
- The resource has no section table, so each RNGE row is checked against the chunk GLB node ranges and each section's ranges must cover its mesh indices before any index rewrite; otherwise the tile reports `bsp-visibility-section-unmapped` and draws everything (row 627).

**4. Culling switch reach**
- The sheet lives in `src/runtime` (integration). The binding is returned as `NativeSection.tileVisibility` and the 02-67 wiring adds the sheet row (row 630).

**Total deviations:** 4 (1 DRY, 1 blocking structure, 1 correctness guard, 1 scope note). **Impact:** no change to collision, navigation or picking with culling off; the collision loader keeps its behaviour.

## Known stubs

None. Real tiles 20_21 and 20_20 hold 0 translucent sections, so translucent index rewriting is proven only on the unit fixture (Open follow-ups).

## Open follow-ups

- 02-67: the sheet switch for `world.visibility.culling` and the between-mesh transparent comparator; navigation invariance against collision world queries once MOVE-01 is wired.
- 02-64 reads `cameraZone` for fog; 02-69 reads `memberVisible` for map emitters.
- PERF-02 measures culling on and off on the GTX 1060 before the default changes; POL-04 re-derives the C4-derived rules.
- Door portal occlusion and the camera tile choice among resident tiles (WORLD-04) are later steps.

## Process cleanup

Playwright and its 5173 dev server exited with each run; no dev server on 5175 was started. After the last run nothing listens on 5173 or 5175, and no node, vite or browser process started by this plan remains (only node processes from Oct 29 run).

## Next

Ready for the next plan in wave 12; 02-64, 02-67 and 02-69 consume the walk.

## Self-Check: PASSED

- Files: every created file above exists on disk.
- Commits: `d649edf`, `254df65`, `4704fd8`, `5f670c0` are ancestors of HEAD.
