---
phase: 02-stage-a-breadth
plan: 62
subsystem: world
tags: [mat-02, lighting, bsp-lightmaps, environment-program, typed-payload, dec-own-12]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-30 read_level_model, bsp node ranges and collision VOLS; 02-45 tile step and manifest patterns; 02-59 class-default reader; 02-61 level_zones and bsp_leaf_membership"
provides:
  - "scripts/world/bsp_lightmaps.py: read_bsp_lightmaps, node_lightmap_texture, lightmap_texture_of_record, node_lightmap_uvs"
  - "scripts/world/lighting_step.py: run_lighting_step, LIGHTING_STEP_ALGORITHM_VERSION 1, sealed_lighting, water_volume_links"
  - "scripts/world/lighting_payload.py: LMSC, LMTX, LMRC, LMPG, LMNR, LMUV, SMLL, SMSC, SMEN, TSEC, TLIT, TSHM and RECS arrays"
  - "scripts/world/light_actors.py: read_lighting_actors, read_static_mesh_light_lists, ClassChains"
  - "scripts/world/terrain_lighting.py: read_terrain_lighting, read_terrain_sector_lighting"
  - "scripts/world/environment_program.py: read_environment_program, ENVIRONMENT_TYPES, environment_lock_input_records"
  - "recipes/world/lighting-rules.json (16 unconfirmed rows)"
  - "tile resource kind lighting (/l2/maps/<sha>/native-tile-lighting/asset.json)"
affects: [02-47, 02-64, 02-67]

estimate:
  tokens: 90000
  tasks: 3
actuals:
  tokens: 38800
  tasks: 3
  commits: 3
plan_head_before: b6e8af5bb79bc5d3e8b259ba3670a9a007d9335d
plan_head_after: 6f00e9d26a99b307c211f23d8dd2483d790a5bd0

tech-stack:
  added: []
  patterns:
    - "Structured field records ride inside a typed payload as one RECS.canonicalJson uint8 array; bytes, bits, UVs and texels stay typed arrays"
    - "Class chains compare qualified class names casefolded (GamePlay.WaterVolume against Gameplay.WaterVolume)"

key-files:
  created:
    - scripts/world/bsp_lightmaps.py
    - scripts/world/lighting_payload.py
    - scripts/world/lighting_step.py
    - scripts/world/light_actors.py
    - scripts/world/terrain_lighting.py
    - scripts/world/environment_program.py
    - recipes/world/lighting-rules.json
    - tests/pipeline/test_world_lighting_step.py
    - tests/pipeline/test_environment_program.py
    - tests/pipeline/support/lightmap_tail_fixture.py
    - tests/pipeline/support/lighting_actor_fixture.py
    - tests/fixtures/lane-store/l2/tiles/30add30cd5d82f190dc4fa64b8adb284cb4292d236a860e0acc27d626ff7735e/tile.json
  modified:
    - scripts/world/bsp_step.py
    - scripts/world/convert_tile.py
    - scripts/world/tile_manifest_step.py
    - scripts/native_store/gap_census.py
    - src/scene/world/nativeTileManifest.ts
    - recipes/world/gap-reasons.json
    - recipes/world/tile-manifest-vocabulary.json
    - tests/pipeline/test_tile_manifest_step.py
    - tests/pipeline/test_world_bsp_step.py
    - tests/pipeline/test_gap_census.py
    - tests/unit/nativeTileManifestResources.test.ts
    - docs/parts/world/EVIDENCE.md
    - STATUS.md
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "BSP lightmaps convert now (D2) through our own reader of the Level.Model tail, built from the measured grammar of the pinned Elbera bsplight.py and lightmap.py; texels as stored, hour sets by the unconfirmed slot row (row 661)"
  - "The bsp step keys sections by the render section lightmap texture (BSP algorithm 2; 20_21 125 sections, 20_20 103, triangles unchanged) (row 662)"
  - "Structured records travel as one RECS.canonicalJson array in the lighting .l2asset (row 664)"
  - "Zone ambient and fog come from read_level_zones by zone index; no second zone reader (row 665)"
  - "WaterVolumes are not in VOLS; they export with their fog fields and an unlinked gap reason (row 666)"
  - "MAT-02 stays Pending: 02-64 and 02-67 also declare it (row 669)"

requirements-completed: []

coverage:
  - id: D1
    description: "BSP lightmap pages with texels as stored, hour sets and one UV set per 02-30 node range in the per-tile lighting resource"
    requirement: MAT-02
    verification:
      - kind: unit
        ref: "tests/pipeline/test_world_lighting_step.py#BspLightmapPayloadTests (4 tests)"
        status: pass
      - kind: integration
        ref: "tests/pipeline/test_world_lighting_step.py#RealClientLightmapTests (20_21: 43 sections, 1,888 records, 9 textures, 30 pages, 18,599 UVs inside their rectangles)"
        status: pass
      - kind: integration
        ref: "python -B scripts/world/convert_tile.py --client E:/Lineage2-client --map 20_21|20_20 --step lighting (complete.json present)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Light, L2FogInfo, LevelInfo and water volume fields with provenance, StaticMeshInstance light lists, terrain shadow maps and light bits"
    requirement: MAT-02
    verification:
      - kind: unit
        ref: "tests/pipeline/test_world_lighting_step.py#LightingActorTests (6 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Typed Env.int and timeenv0..3 program for all four environment types, unresolved files named"
    requirement: MAT-02
    verification:
      - kind: unit
        ref: "tests/pipeline/test_environment_program.py (5 tests, 1 on the conversion client)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Tile manifests pin the lighting resource and the browser parser accepts it"
    requirement: MAT-02
    verification:
      - kind: unit
        ref: "pnpm exec vitest run tests/unit/nativeTileManifestResources.test.ts tests/unit/nativeTileMoverManifest.test.ts tests/unit/loadNativeTileChunks.test.ts (28 tests)"
        status: pass
      - kind: e2e
        ref: "NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-meshes.spec.ts tests/browser/world-bsp-visibility.spec.ts (4 passed)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Lighting rule rows"
    requirement: MAT-02
    verification:
      - kind: unit
        ref: "tests/pipeline/test_world_lighting_step.py#LightingRegistrationTests"
        status: pass
    human_judgment: true
    rationale: "Every row is an unconfirmed reference default until POL-04 re-derives it against the Interlude binaries"

duration: 60min
completed: 2026-11-10
---

# Phase 2 Plan 62: BSP lightmaps and tile lighting export Summary

**`convert_tile.py --step lighting` writes one `native-tile-lighting` typed payload per tile: the BSP lightmap pages decoded from the Level.Model tail with texels as stored, their hour sets and one UV set per 02-30 node range (20_21: 9 textures, 30 pages, 18,599 UVs all inside their record rectangles), Light, L2FogInfo, LevelInfo and water volume fields with provenance, StaticMeshInstance light lists with visibility bits, terrain shadow maps and light bits, and the typed Env.int and timeenv0..3 program; the bsp step now keys sections by lightmap texture.**

## Performance

- Duration: about 60 min (07:52 to 08:52 UTC), including stale-unit reruns of meshes, movers, collision and bsp-visibility for both tiles (about 30 min in the background), a 4.6 min browser run and a 7.8 min `python scripts/test_pipeline.py`.
- Tasks: 3 of 3. Files: 27 changed (12 created, 15 modified).

## Accomplishments

- `bsp_lightmaps.py`: render sections (vertex block, polygon count, poly flags, lightmap texture), lightmap records (surface, atlas field, rectangle, 25 projection floats, shadow masks walked and checked) and per texture 1 to 8 DXT1 pages (mips 512 and 256 with their skip positions, header, footer), walked to the export's last byte; record and page tags must agree. A section texture past the page list, a record past the record list or a record outside its section's texture is `lighting-lightmap-index-invalid:<index>` and gets no UVs.
- `lighting_step.py` (ledger step `lighting`, algorithm 1): fingerprint over the map lock record, the lock records of Env.int and timeenv0..3, the chunk, bsp and collision fingerprints and the rules hash; refuses a payload above `MAX_PAYLOAD` (96 MiB) with `lighting-payload-too-large`. 20_21: 11.9 MB payload; 20_20: 5.8 MB.
- `light_actors.py`: every field declared from the actor class down to Engine.Light, Engine.L2FogInfo or Gameplay.WaterVolume plus named Actor fields, resolved serialized first, else the class chain (authored, class-default, ue-zero); zone by `leaf_for_point`; LevelInfo Brightness as declared. StaticMeshInstance tails decode to the byte on both tiles.
- `terrain_lighting.py`: sector light bits and 8 shadow maps of 289 bytes per sector, then the sector visibility words and texture info consumed by length; exact end.
- `environment_program.py`: Env.int and the four files Env.int names, read through `require_equal_file`, typed by written form (boolean, integer, number, tuple, text), sections and duplicate sections kept in order; a missing or unlocked file is `environment-program-unresolved:<file>` and never a default. Real client: TimeRatio 6, StartTime 12, EnvType 0 to 3.
- Tile manifest algorithm 10 pins `lighting`; vocabulary listVersion 8; world gap reasons listVersion 12; the browser parser accepts the kind at its own path; the gap census orders `lighting` after `audio`.

## Task commits

1. Task 1 (tracer): `fb8ba2d` feat(02-62): convert the BSP lightmap pages and lightmap UVs of a tile into its lighting resource
2. Task 2: `d56b7d7` feat(02-62): add lights, fog actors, light lists, terrain shadow maps and the environment program to the lighting resource
3. Task 3: `6f00e9d` docs(02-62): record the tile lighting evidence, the world status line, the restage handoff and decision rows 661 to 670

Tracer gate: the Task 1 verify (`test_world_lighting_step.py`, 7 tests) and `tile__20_21/lighting/complete.json` passed again before Task 2.

## Verification

- `test_world_lighting_step.py` 13 OK; `test_environment_program.py` 5 OK; `test_tile_manifest_step.py`, `test_world_bsp_step.py`, `test_gap_census.py`, `test_gap_rows.py`, `test_world_bsp_visibility_step.py`, `test_level_zones.py`, `test_native_environment.py`, `test_world_collision_step.py` OK.
- `python scripts/test_pipeline.py`: 1,800 tests, 56 skipped, OK (baseline 1,782 OK).
- `pnpm typecheck` clean; Vitest manifest and chunk tests 28 passed.
- Browser, 5173 free: `NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-meshes.spec.ts tests/browser/world-bsp-visibility.spec.ts` 4 passed with the 20_21 lighting resource pinned (headless SwiftShader, no FPS claim).
- Acceptance: `tile__20_21/lighting/complete.json` present; `grep -c lighting recipes/world/tile-manifest-vocabulary.json` prints 1; all 16 rule rows have provenance and status `unconfirmed`; `grep -c "Tile lighting (02-62)" docs/parts/world/EVIDENCE.md` prints 1.
- Lane ownership: `check-lane-ownership.mjs --base b6e8af5 --part world` lists one foreign path, `scripts/native_store/gap_census.py` (row 670).
- Reference overlap `--area materials`: 0 blocking runs, 0 unreviewed runs (4,442 reviewer runs, 4,265 reviewed, 177 signed off); its globs cover `src/materials/**` only, none of the Python this plan wrote. Report `artifacts/plan-checks/02-62/materials-overlap.json`.
- Restage: `write_lane_catalog.py --lane world --plan` prints the merge command recorded as `Needs Human (plan 02-62)`; world lane catalog `af47f330...`.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 2 - Correctness] The bsp step keyed lit sections by nothing**
- Found during: Task 1. `bsp_step.py` passed an empty record-to-texture map, so every lit section had lightmap `null` and mixed textures.
- Fix: the render section lightmap texture keys sections (BSP algorithm 2), the placeholder map is deleted. Commit `fb8ba2d`, row 662.

**2. [Rule 3 - Blocking] Stale input units**
- The converter implementation hash changed after 02-45, so meshes, bsp and collision of both tiles were no longer sealed; meshes, movers, collision and bsp-visibility were rerun in the world lane (20_20 collision for the first time). Row 663.

**3. [Rule 3 - Blocking] Gap census step order** - `lighting` added to `scripts/native_store/gap_census.py`, the one foreign path (row 670).

**4. [Rule 1 - Bug] Class chain case** - the decompiled chain names `GamePlay.WaterVolume`; subclass tests compare casefolded. Test added.

**5. [Rule 2 - Correctness] Water volumes are not in VOLS** - the plan assumed VOLS holds them; they export as actors with their fog fields and `lighting-water-volume-unlinked:<class>` (row 666, Open follow-up).

**6. Extra files** - `lighting_payload.py` keeps `lighting_step.py` under 400 lines; the test support files `lightmap_tail_fixture.py` and `lighting_actor_fixture.py` build synthetic tails and packages; the fixture tile manifest was regenerated for the new pending step.

**7. Structured records** - fields with references, strings and structs travel as one `RECS.canonicalJson` array instead of numeric columns (row 664).

**Total deviations:** 7 (1 bug, 2 correctness, 2 blocking, 2 scope notes). **Impact:** BSP GLBs of 20_21 and 20_20 split by lightmap texture with unchanged triangles; one shared file outside `scripts/world` (the census order).

Tests were written with the code inside each task commit, not as separate RED commits.

## Known stubs

None. Open follow-ups in STATE: water volumes in VOLS (row 666), struct tag decoding in the shared actor field reader (row 668), and the native-materials pin re-pointed to 02-64.

## Threat flags

None beyond the register. T-02-62-01: record, section, texture and node indices are range-checked with named gap rows. T-02-62-02: the payload size is checked against `MAX_PAYLOAD` before writing.

## Process cleanup

The background reruns and `test_pipeline.py` exited 0; Playwright stopped its own dev server and browser. `ps -W` lists no python, node, chrome or Vite process started today, and nothing listens on 5173 or 5175.

## Next

Ready for the next plan; 02-64 binds the lighting resource at runtime.

## Self-Check: PASSED

- Files: all created files above exist on disk.
- Commits: `fb8ba2d`, `d56b7d7`, `6f00e9d` are ancestors of HEAD.
