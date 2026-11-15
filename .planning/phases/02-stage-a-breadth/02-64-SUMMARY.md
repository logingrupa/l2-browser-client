---
phase: 02-stage-a-breadth
plan: 64
subsystem: world
tags: [mat-02, mat-01, fx-01, lighting, lightmaps, environment-clock, camera-environment, fog, ue2-material-library, dec-own-12]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-58 environment event type; 02-60 createNativeMaterial and the fog model; 02-62 the native-tile-lighting payload; 02-63 TileVisibilityFrame and memberVisible; 02-65 volumesContaining; 02-69 drawNativeSessionSeed and playTileMapEmitters"
provides:
  - "src/scene/world/lighting/decodeTileLighting.ts: decodeTileLighting, TileLightingModel, lightmapTextureNone"
  - "src/scene/world/lighting/loadTileLighting.ts, attachTileLighting.ts (AttachedTileLighting, TileLightingRuntimeInspection, lightingResourceAbsentReason)"
  - "src/scene/world/lighting/bindTileLighting.ts: bindTileLighting, TileLightingBinding, TileLightingInspection"
  - "src/scene/world/lighting/worldEnvironmentClock.ts: createWorldEnvironmentClock, WorldEnvironmentClock (applyEnvironmentEvent, sample)"
  - "src/scene/world/lighting/lightmapPages.ts (lightmapSlotAtHour, lightmapPageAtHour, decodeDxt1Texels), tileLightmapSections.ts, tileLightingRecords.ts, surfaceMaterialProgram.ts"
  - "src/scene/world/cameraEnvironment.ts: computeCameraEnvironment, CameraEnvironment, cameraEnvironmentGaps"
  - "src/scene/world/tileMapEmitterPlacements.ts: loadTileMapEmitterPlacements, parseTileMapEmitterPlacements"
  - "UE2 material library lightmap input: NativeMaterialOptions.lighting, NativeMaterial.setLightmap, light.modulate2x row, applyModulate2xLighting"
  - "NativeSection.environmentClock and the tile inspection fields lighting and mapEmitterPlacements"
affects: [02-67, POL-04]

estimate:
  tokens: 95000
  tasks: 3
actuals:
  tokens: 52000
  tasks: 3
  commits: 5
plan_head_before: 1f593283d9a2b582e98ac8abb03bc9895009eb2a
plan_head_after: 75a39762439756c07d1c9fc1de8895b57d2edf85

tech-stack:
  added: []
  patterns:
    - "A Babylon-free planner maps typed payload node ranges onto GLB vertices; the Babylon binding only assigns materials, vertex data and textures"
    - "A surface whose program is a library diagnostic keeps its converted material and reports its status (02-69 row 652 rule)"

key-files:
  created:
    - src/scene/world/lighting/decodeTileLighting.ts
    - src/scene/world/lighting/loadTileLighting.ts
    - src/scene/world/lighting/bindTileLighting.ts
    - src/scene/world/lighting/attachTileLighting.ts
    - src/scene/world/lighting/worldEnvironmentClock.ts
    - src/scene/world/lighting/lightmapPages.ts
    - src/scene/world/lighting/tileLightmapSections.ts
    - src/scene/world/lighting/tileLightingRecords.ts
    - src/scene/world/lighting/tileLightingDecodeError.ts
    - src/scene/world/lighting/surfaceMaterialProgram.ts
    - src/scene/world/cameraEnvironment.ts
    - src/scene/world/tileMapEmitterPlacements.ts
    - src/materials/ue2/model/lighting.ts
    - src/materials/ue2/model/constants/lightingConstants.ts
    - tests/unit/decodeTileLighting.test.ts
    - tests/unit/worldEnvironmentClock.test.ts
    - tests/unit/cameraEnvironment.test.ts
    - tests/unit/ue2Lighting.test.ts
    - tests/unit/tileMapEmitterPlacements.test.ts
    - tests/support/tileLightingFixture.ts
    - tests/browser/world-tile-lighting.spec.ts
  modified:
    - src/materials/ue2/babylon/material.ts
    - src/materials/ue2/babylon/fragmentChain.ts
    - src/materials/ue2/model/constants/materialConstants.ts
    - src/assets/native/nativeSkeletalMaterials.ts
    - src/scene/world/loadNativeTileChunks.ts
    - src/scene/world/loadNativeSection.ts
    - src/scene/world/nativeSkyPresentation.ts
    - tests/browser/harness/materialSwatchHarness.ts
    - tests/unit/materialProgram.test.ts
    - docs/parts/world/EVIDENCE.md
    - STATUS.md
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "The environment clock starts at the program StartTime with type 0, labelled environment-program-fallback, and takes adapter environment events (row 691)"
  - "The UE2 material library gained a lightmap input (uv2, ue2Lightmap, Modulate2X row) as a lane-confirmed change outside the world lane (row 692)"
  - "A BSP section whose program is a library diagnostic keeps its converted material; 0 of 89 BSP programs compile (texture-image-absent) (row 693)"
  - "Sky, static mesh slots and terrain layers report program-unconverted; vertex lighting and layer blending are not drawn (rows 694, 695)"
  - "Map emitter placements are listed with memberVisible and their reasons; none plays (row 696)"
  - "The camera-environment record names the Env.int preset, L2FogInfo, water and volume-query gaps instead of inventing fog (row 697)"
  - "MAT-02, MAT-01 and FX-01 stay Pending (row 701); materials overlap recorded for the orchestrator review (row 702)"

requirements-completed: []

coverage:
  - id: D1
    description: "Lighting payload decoder with page, mip, slot, coordinate, texture index and units guards; page by hour; DXT1 decode; node range coordinates on GLB vertices; library material per BSP section whose page follows the hour"
    requirement: MAT-02
    verification:
      - kind: unit
        ref: "tests/unit/decodeTileLighting.test.ts (9 tests)"
        status: pass
      - kind: e2e
        ref: "NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-lighting.spec.ts (2 passed, 1440 x 900, 932 x 430 touch, 430 x 932 no scroll)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Library lightmap input with Modulate2X in the byte domain"
    requirement: MAT-01
    verification:
      - kind: unit
        ref: "tests/unit/ue2Lighting.test.ts (3 tests), tests/unit/materialProgram.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Camera-environment record: camera zone from the frame, containing volume from volumesContaining, library fog with fogEnd"
    requirement: MAT-02
    verification:
      - kind: unit
        ref: "tests/unit/cameraEnvironment.test.ts (3 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Environment clock from the event or the StartTime fallback, TimeRatio advance, wrap and guards"
    requirement: MAT-02
    verification:
      - kind: unit
        ref: "tests/unit/worldEnvironmentClock.test.ts (4 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Map emitter placements with the memberVisible gate and named reasons"
    requirement: FX-01
    verification:
      - kind: unit
        ref: "tests/unit/tileMapEmitterPlacements.test.ts (2 tests)"
        status: pass
    human_judgment: true
    rationale: "No placement plays until struct decoding, class-default merge and resource conversion land (row 696)"
  - id: D6
    description: "Clean-room overlap of the materials area"
    requirement: MAT-01
    verification:
      - kind: other
        ref: "node tools/reference-overlap/referenceOverlap.mjs --area materials --reference-root C:/laragon/www/l2-browser-client"
        status: fail
    human_judgment: true
    rationale: "35 blocking and 313 unreviewed runs, mostly generic object-literal shapes shifted by one new table entry; the orchestrator's independent review runs after the wave"

duration: 40min
completed: 2026-11-10
---

# Phase 2 Plan 64: Tile lighting, fog and environment runtime Summary

**Tile 20_21 now decodes its 02-62 lighting payload at runtime, places the lightmap coordinates of all 110 lit BSP sections on their own vertices, picks each section's lightmap page by hour from an environment clock (program StartTime fallback, TimeRatio advance, adapter events), and feeds library fog from one camera-environment record (camera zone fog with fogEnd); the UE2 material library gained a lightmap input with Modulate2X, but every 20_21 BSP program still compiles to `texture-image-absent`, so the sections keep their converted material and the lightmaps do not draw yet.**

## Performance

- Duration: about 40 min (13:23 to 14:03 Riga), including three browser runs (2.3, 7.4 min) and one full `pnpm test:unit`.
- Tasks: 3 of 3. Files: 34 changed (21 created, 13 modified).

## Accomplishments

- `decodeTileLighting` reads LMSC, LMTX, LMPG, LMNR, LMUV and the RECS records through `readTypedPayload`, and refuses page counts, mip sizes, slot numbering, coordinate counts and texture indices that disagree, and any units other than source. The real 20_21 payload decodes: 9 textures, 30 pages, 4,222 node ranges, 38 resolved zones, StartTime 12, TimeRatio 6.
- `planLightmapSections` (Babylon-free) checks each lighting node range against the chunk BSP GLB node range and places its coordinates on the vertices its indices use; on 20_21 all 110 lightmapped sections map with 0 gaps.
- `bindTileLighting` gives a section with a compiled program a `createNativeMaterial` material built `lightmap`, its `uv2` coordinates and the page for the hour (DXT1 decoded on the client, lazily); each frame it switches the page when the hour crosses a slot and updates the library uniforms with the hour, environment type and camera fog.
- The library: `NativeMaterialOptions.lighting`, `NativeMaterial.setLightmap`, the `ue2Lightmap` sampler and Modulate2X from the unconfirmed `light.modulate2x` row, with the CPU twin `applyModulate2xLighting`; `material.ts` re-exports the fog evaluator and `loadNativeMaterial`.
- `createWorldEnvironmentClock` and `computeCameraEnvironment` as specified; the tile inspection carries `lighting` (environment, sections, pages, status counts, camera environment, static mesh and terrain counts) and `mapEmitterPlacements`; `NativeSection.environmentClock` is the handle 02-67 calls.

## Task commits

1. Task 1 (tracer): `f1dba4e` feat(02-64): bind tile BSP lightmap pages by hour through the UE2 material library
2. Task 2: `3c36b30` feat(02-64): feed tile fog from one camera-environment record and report every surface owner the library cannot light yet
3. Task 3: `75a3976` docs(02-64): record the tile lighting runtime evidence, the world status line, the open follow-ups and decision rows 691 to 702

Tracer gate: typecheck, `decodeTileLighting.test.ts` and the browser spec passed before Task 2. The commit count 5 measured from the ledger includes two commits of another session on this branch (`41870bd`, `cd5d26e`, ribbon work).

## Verification

- `pnpm typecheck` clean.
- Targeted Vitest: decodeTileLighting 9, worldEnvironmentClock 4, cameraEnvironment 3, ue2Lighting 3, tileMapEmitterPlacements 2, plus materialProgram, ue2BlendTable, importBoundaries.materials, nativeSkeletalMaterials, particleMaterialBinding, loadNativeTileChunks and nativeSkyPresentation, all pass.
- `pnpm test:unit` (14:00 Riga): 197 files passed, 3 skipped, 1 failed; 2,557 tests passed, 59 skipped, 1 failed: `laneOwnership.test.ts` movement-geodata evidence size (31,126 bytes), caused by another session's uncommitted edit of `docs/parts/movement-geodata/EVIDENCE.md` (29,177 bytes at HEAD); this plan did not touch it.
- Browser, 5173 free: `NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-lighting.spec.ts tests/browser/world-tile-sky.spec.ts tests/browser/world-bsp-visibility.spec.ts` 6 passed (headless SwiftShader, no FPS claim). Inspection and screenshots copied to `artifacts/world-evidence/02-64/`.
- Acceptance: `grep -c "createNativeMaterial" src/scene/world/lighting/bindTileLighting.ts` prints 2; `grep -rn -E "HemisphericLight|scene\.fogMode *= *[1-3]" src/scene/world/lighting src/scene/world/cameraEnvironment.ts` prints nothing; `grep -c "Tile lighting runtime (02-64)" docs/parts/world/EVIDENCE.md` prints 1 (world evidence 27,385 bytes).
- Lane ownership `--base 1f59328 --part world`: this plan's foreign paths are the library files and `nativeSkeletalMaterials.ts` (row 692) and the process files; the skills-effects, particles and reference-overlap paths come from the other session's commits.
- Reference overlap `--area materials`: exit 1, 35 blocking runs, 313 unreviewed reviewer runs, 34 stale sign-offs, 172 stale reviewed runs; report `artifacts/reference-overlap/02-64-materials.json` (row 702). No sign-off rows added.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] The library had no lightmap input**
- Found during: Task 1. `createNativeMaterial` draws `position` and `uv` only, so a lightmap could not reach the fragment stage.
- Fix: an additive `lighting` option and `setLightmap` in `src/materials/**`, against the plan's "never edit src/materials"; lane confirmation row 692. Commit `f1dba4e`.

**2. [Rule 2 - Correctness] No converted program compiles**
- Found during: Task 1. All 89 world lane programs are `texture-image-absent`; binding them would turn the tile magenta while hiding no less. Sections keep their converted material and report `library-diagnostic` (row 693).

**3. [Rule 3 - Blocking] Order and extra modules**
- The clock and its test landed in Task 1 (the binding needs an hour source); seven extra single-purpose modules and three extra test files (row 699).

### Not done as written

- Static mesh vertex lighting and terrain layer blending are not drawn: no slot or layer program pins and no library input (row 695).
- Sky surfaces are not on the library: the sky GLB carries no program pin (row 694).
- Map emitters do not start through `playTileMapEmitters`: unparsed structs, unmerged class defaults and unconverted resources (row 696); the inspection lists them with the gate.
- The browser cannot set two hours; the spec checks the page against each hour set, and the switch is unit tested (row 698).
- MAT-02, MAT-01 and FX-01 stay Pending (row 701).

**Total deviations:** 3 auto-fixed (1 correctness, 2 blocking) and 5 scope notes, each with a decision row. Tests were written in the same pass as each module, so there are no separate RED commits.

## Known stubs

None that hide a value. Named gaps instead of stand-ins: `library-diagnostic` (texture-image-absent), `program-unconverted`, `environment-fog-preset-unselected`, `fog-info-range-unparsed`, `lighting-water-volume-unlinked`, `camera-volume-query-unbound`, `map-emitter-*`. Open follow-ups in STATE: texture image pins and program file pins, library vertex and layer inputs, map emitter playback, materials overlap review.

## Threat flags

None beyond the register. T-02-64-01: count, index, mip size, slot and units guards; a refused payload is `lighting-payload-invalid:<error>` and the tile still draws. T-02-64-02: finite, non-negative minutes and a program-listed environment type.

## Needs Human

None.

## Process cleanup

Started by this plan: tsc, Vitest runs, three Playwright runs whose `pnpm dev` server on 5173 Playwright stopped at exit, the overlap tool and the lane and schedule scripts. `netstat -ano` shows no listener on 5173 or 5175, and `ps -W` shows no node, Vite, Playwright or browser process started today (only node from Oct 29 and Edge from Nov 4 to 8, not started here).

## Self-Check: PASSED

- Files: every created file listed above exists.
- Commits: `f1dba4e`, `3c36b30`, `75a3976` are ancestors of HEAD.
