---
phase: 02-stage-a-breadth
plan: 16
subsystem: world
tags: [world-05, world-01, tile-manifest, tile-route, section-window, load-check]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-15 sealed chunk plan and terrain chunks; 02-04 tile manifest validators and catalog record shapes; 02-03 catalog writer and write_lane_catalog; 02-05 catalog tiles slice; 02-06 NATIVE_STORE_ROOT switch and load-check records; 02-02 gap rows; 02-14 record_tile_step_gap_row"
provides:
  - "scripts/world/tile_manifest_step.py: TILE_MANIFEST_STEP_ALGORITHM_VERSION 1, TILE_CATALOG_CAPACITY 163, PENDING_TILE_STEPS, build_tile_chunk_manifest, build_tile_manifest, tile_store_files, run_tile_manifest_step"
  - "scripts/world/terrain_chunk_step.py: TerrainUnit, terrain_unit, sealed_terrain_chunks"
  - "convert_tile.py --step manifest and --output (world lane store only); every step prints its rows as a list"
  - "recipes/world/tile-manifest-vocabulary.json (listVersion 1, empty lists); world reasons terrain-quads-all-hidden and player-start-missing (listVersion 2)"
  - "src/scene/world: selectedNativeTileIdentity, parseNativeTileManifest, parseNativeTileChunkManifest, loadNativeTileChunks and NativeTileSectionView (with tileAnchor), loadNativeSection exports inspectNativeWorldScene, nativeMeshBounds, fetchVerifiedNativeResource, loadNativeGlbContainer, NativeSectionWindow, handChosenPresentationWindow, terrainInfoChunkPlanWindow"
  - "tests/browser/world-tile-walk.spec.ts with one tile:20_21 load-check record per run"
  - "Lane store (ignored): artifacts/lane-store/world/l2 tile 68e09206..., 16 chunk manifests, 16 terrain GLBs, catalog ccaaf62b... with one tiles record"
affects: [02-25, 02-29, 02-30, 02-31, 02-35, 02-45, 02-46, 02-50, 02-52, 02-70]

estimate:
  tokens: 140000
  tasks: 3
actuals:
  tokens: 23000
  tasks: 3
  commits: 5
plan_head_before: d655605323c032465f5beef7a81f59a44f723032
plan_head_after: c899e01

tech-stack:
  added: []
  patterns:
    - "A tile route is an additive branch of loadNativeSection behind ?map, returning a NativeSection view so integration-owned runtime code compiles unchanged"
    - "A step that writes the lane store seals its store files as lane-relative ledger outputs and refuses any other output root"

key-files:
  created:
    - scripts/world/tile_manifest_step.py
    - recipes/world/tile-manifest-vocabulary.json
    - src/scene/world/selectedNativeTile.ts
    - src/scene/world/nativeTileChunkManifest.ts
    - src/scene/world/nativeTileManifest.ts
    - src/scene/world/loadNativeTileChunks.ts
    - tests/pipeline/test_tile_manifest_step.py
    - tests/support/nativeTileFixtureStore.ts
    - tests/unit/nativeTileChunkManifest.test.ts
    - tests/unit/loadNativeTileChunks.test.ts
    - tests/unit/selectedNativeTile.test.ts
    - tests/browser/world-tile-walk.spec.ts
    - tests/fixtures/lane-store/l2/tiles/6cd64289e3cb57c6d3b8d2afd201dadc69ec7a43bf3dd562ca209771715c716e/tile.json
    - tests/fixtures/lane-store/l2/maps/5fe0af46259ebac9c28952c86190bba1e8c0bf36c6f5be62a4f2163ef83eaf38/native-tile-chunk-runtime/manifest.json
    - tests/fixtures/lane-store/l2/maps/36e26b87340df4ee7b227d48c1e9b20322c7874a81cf39d0a5ce6644b70d0ec7/native-tile-chunk-terrain/terrain.glb
  modified:
    - scripts/world/convert_tile.py
    - scripts/world/terrain_chunk_step.py
    - recipes/world/gap-reasons.json
    - src/scene/world/loadNativeSection.ts
    - src/scene/world/loadAuthoredNativeSection.ts
    - src/scene/world/nativeSkyPresentation.ts
    - tests/unit/nativeSection.test.ts
    - tests/pipeline/test_world_raw_step.py
    - tests/pipeline/test_gap_rows.py
    - docs/parts/world/EVIDENCE.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md
    - .planning/STATE.md

key-decisions:
  - "Tile route through loadNativeSection and ?map with a dynamic import on the native root route (row 380)"
  - "sectionWindow inspection field keyed on the manifest kind is the runtime diagnostic for the hand-chosen legacy window (row 381)"
  - "Portrait 430 x 932 no-scroll check inside the phone walk test (row 382)"
  - "NativeSection.manifest widened to a tile view whose terrain is the anchor chunk's resource (row 383)"
  - "Chunk terrain stored at maps/<GLB sha256>/native-tile-chunk-terrain/terrain.glb, named by that pinned path (row 384)"
  - "Pending steps use step-pending:<step>; world reasons terrain-quads-all-hidden and player-start-missing (row 385)"
  - "A null anchor gives no tile manifest, only a manifest-step gap row (row 386)"
  - "20_20 sky suppressed on other tiles (row 387)"
  - "One-chunk synthetic fixture tile 00_00, three files, under the 02-06 fixture lane store (row 388)"
  - "The tile spawns at the PlayerStart XY on the chunk terrain surface; the authored Z stays a diagnostic (row 391)"
  - "The failed lane-store walk is recorded as failed with an open follow-up for a served catalog holding base and lane records (row 392)"
  - "WORLD-05 and WORLD-01 stay Pending (row 396)"

requirements-completed: []

coverage:
  - id: D1
    description: "20_21 tile and chunk manifests plus the tiles catalog record in the world lane store, validated by the 02-04 validators"
    requirement: WORLD-01
    verification:
      - kind: unit
        ref: "python -B -m unittest discover -s tests/pipeline -p test_tile_manifest_step.py (18 tests)"
        status: pass
      - kind: integration
        ref: "python -B scripts/world/convert_tile.py --client E:/Lineage2-client --map 20_21 --step manifest; write_lane_catalog.py --lane world"
        status: pass
    human_judgment: false
  - id: D2
    description: "?map=20_21 route: guarded parsers, chunk terrain loader, sky gate, sectionWindow diagnostic"
    requirement: WORLD-01
    verification:
      - kind: unit
        ref: "pnpm vitest run tests/unit/nativeTileChunkManifest.test.ts tests/unit/loadNativeTileChunks.test.ts tests/unit/selectedNativeTile.test.ts tests/unit/nativeSection.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Walk tile 20_21 through NATIVE_STORE_ROOT=world with a recorded load-check"
    requirement: WORLD-05
    verification:
      - kind: e2e
        ref: "NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-walk.spec.ts (port 5173 free): 2 failed at startup, Native player body source identity mismatch"
        status: fail
    human_judgment: false
    rationale: "The world lane catalog holds only lane records, so the runtime finds no player body; the load-check records failed. Open follow-up in STATE.md."

duration: 50min
completed: 2026-11-09
---

# Phase 2 Plan 16: World tracer 20_21 walk Summary

**`convert_tile.py --step manifest` writes the 20_21 tile manifest, 16 chunk manifests and 16 pinned terrain GLBs into the world lane store with a validated `tiles` catalog record, and `/?map=20_21` loads that chunk terrain through `loadNativeSection` with navigation on the terrain, a terrain-surface spawn at the PlayerStart XY and the `sectionWindow` diagnostic. The recorded browser walk on the world lane store failed at startup, because the lane catalog holds no player body; with the base records overlaid (diagnostic, not recorded) both walks passed.**

## Performance

- Duration: about 50 min (09:26 to 10:16 Riga)
- Tasks: 3 of 3 (Task 3 outcome: failed walk, recorded)
- Files: 25 code, test, fixture and docs files in the task commits, plus the docs commit

## Accomplishments

- Store layout: tile `/l2/tiles/68e09206fba995c4025c3174440ff451eef10ec9aded9a565775576dc5716fec/tile.json`, chunk manifests at `/l2/maps/<sha256>/native-tile-chunk-runtime/manifest.json`, terrain at `/l2/maps/<GLB sha256>/native-tile-chunk-terrain/terrain.glb`. Lane catalog `ccaaf62b887cc2ab70f637b209a665371e9b6cc0eea6559ed3173b8f6f91e6c1`, one `tiles` record, pinned to base `55c12147...`.
- Tile manifest frame exactly `{terrainInfo, location, terrainScale}`, anchor `20_21.PlayerStart2`, chunks in `(column, row)` order. Pending rows (`step-pending:<step>`) for meshes, bsp, collision, movers, sky, audio, minimap and terrain-material in the tile manifest and the gap rows; every chunk manifest lists meshes, bsp, collision and terrain-material.
- Gap rows for `tile:20_21`: manifest pass; audio, bsp, collision, meshes, minimap, movers, sky and terrain-material pending; raw, chunks and terrain pass.
- A second manifest run is sealed and writes nothing; `write_lane_catalog.py --lane world` wrote 0 files.
- Runtime: `selectedNativeTileIdentity` is the only reader of `map`. The parsers accept exactly the 02-04 layouts. `loadNativeTileChunks` hash-checks the tile manifest, every chunk manifest and every terrain GLB (128 MiB cap), marks terrain meshes `worldTerrain`, `worldSupportsWalking` and `nativeTileChunk {tileId, chunkId}`, and disposes everything on abort or failure.
- `sectionWindow`: the default route reports `{hand-chosen-presentation-window, unresolved}`, the tile route `{terrain-info-chunk-plan, source-derived}`. The 20_20 sky returns null on any other selected tile.
- Spawn: `20_21.PlayerStart2` lies about 29 m under the nearest terrain vertex (20_20 `PlayerStart0` about 11 m), so the route spawns at the PlayerStart XY on the chunk terrain surface and reports the authored Z as `tileAnchor` (row 391).

## Task commits

1. Task 1 (tracer): `17b913c` feat(02-16): write the 20_21 tile and chunk manifests into the world lane store and load them by ?map=20_21
2. Task 2: `6c02d2a` feat(02-16): gate the 20_20 sky to its tile, report the section window and record the tile tracer evidence
3. Task 3: `b56fd8a` fix(02-16): spawn on the chunk terrain surface at the anchor PlayerStart XY; `a92a558` test(02-16): walk tile 20_21 through NATIVE_STORE_ROOT=world and record the load-check; `c899e01` fix(02-16): check the convert_tile --output folder with require_converter_output in the entry point

The tracer gate re-ran the Task 1 verify end to end (unittest OK, convert_tile exit 0, typecheck clean, 33 Vitest cases) before Task 2.

## Verification

- `python -B -m unittest discover -s tests/pipeline -p test_tile_manifest_step.py`: 18 OK, including the byte-for-byte fixture regeneration.
- `python -B scripts/test_pipeline.py` at BelowNormal: 1551 tests, 103 skipped; the one failure of the first run (`test_converter_output_guard`, convert_tile lacked the entry-point guard call) is fixed in `c899e01` and the guard test, raw step and manifest step suites pass after it.
- `pnpm typecheck`: clean. `pnpm test:unit`: 1977 passed, 82 skipped, 0 failed (154 files). Editor tests for the authored section: 49 passed.
- Browser, port 5173 free: `NATIVE_STORE_ROOT=world pnpm test:e2e tests/browser/world-tile-walk.spec.ts`: 2 failed, `tile:20_21 did not start on the native route: ... Native player body source identity mismatch.` Load-check `artifacts/lane-store/world/load-checks/ccaaf62b887cc2ab70f637b209a665371e9b6cc0eea6559ed3173b8f6f91e6c1.json`: `tile:20_21` `failed`. EVIDENCE: `tile:20_21 browser walk: failed (...)`.
- Coverage row (`build_coverage_report.py --store-root artifacts/lane-store/world/l2 --lane world`): `{'converted': True, 'key': 'tile:20_21', 'loads': 'failed', 'part': 'world', 'reason': None, 'status': 'pass'}`; world part 1/163 converted, 124 gap, 38 pending, loads failed 1.
- Diagnostic only, not recorded: with the base catalog records overlaid on the lane catalog both walks passed in 55 s (desktop 1440 x 900 and phone 932 x 430 with touch, portrait 430 x 932 without horizontal scroll); the overlay load-check file was deleted and the lane catalog restored to `ccaaf62b...`. Screenshots: `artifacts/world-evidence/diagnostic-base-overlay-world-tile-walk-20_21-desktop.png` and `...-phone-landscape.png`. Headless SwiftShader: no FPS claim.
- `node scripts/check-lane-ownership.mjs --base d655605 --part world`: `lane world: 0 foreign paths`. `git diff --stat d655605..HEAD` over `nativeResourceUrl.ts`, `src/runtime`, `src/world`, `src/entities`, `src/scene/navigation`, `package.json`, `vite.config.ts`, `playwright.config.ts`: empty. `git status --porcelain public/l2`: empty.
- Acceptance: catalog prints `/l2/tiles/68e09206.../tile.json true`; three fixture files; `loadNativeSection.ts` 361 lines, `loadNativeTileChunks.ts` 153; `nativeSkyPresentation.ts` 0 comment lines; only `selectedNativeTile.ts` reads `get("map")`; `nativeSection.test.ts` numstat `1 0`; EVIDENCE 18,450 bytes with one `## Tile 20_21 tracer` and one outcome line; STATE has the `Needs Human (plan 02-16):` restage line.

## Deviations from plan

### Auto-fixed issues

1. **[Rule 1 - Bug] The spawn candidate under the terrain.** Found in Task 3: a diagnostic walk stopped at "The staged native surface does not support the requested actor origin", because `20_21.PlayerStart2` is about 29 m under the terrain. The route now spawns at the PlayerStart XY on the chunk terrain surface (legacy reference surface rule) and reports the authored Z (row 391). Commit `b56fd8a`.
2. **[Rule 3 - Blocking] Tile manifest vocabulary file missing.** The 02-04 validators refuse to run without `recipes/world/tile-manifest-vocabulary.json`; the index names 02-16 as its creator. Created with empty lists (row 390). Commit `17b913c`.
3. **[Rule 3 - Blocking] Entry-point output guard.** `test_converter_output_guard` requires `convert_tile.py` itself to call `require_converter_output` for `--output`. Commit `c899e01`.
4. **[Rule 1 - Bug] `test_gap_rows.py` used `player-start-missing` as a reason absent from the real lists;** it is now a real world reason, so the test uses a synthetic lane-only reason (row 385). Commit `17b913c`.
5. **[Code rules] Touched files without comments.** `loadAuthoredNativeSection.ts` lost 8 comment lines (its `orientations` became `editorImportedFaceOrientations`) and reports `sectionWindow`; `nativeSkyPresentation.ts` lost 5, with the draw-order names spelled out.
6. **[DRY] Shared pieces.** `sealed_terrain_chunks` and `TerrainUnit` in `terrain_chunk_step.py` serve both the terrain step and the manifest step; `loadNativeGlbContainer` serves both section loaders; the tile parsers reuse `tileIdPattern` from `nativeCatalogRecords.ts`.
7. **[Signature] `build_tile_chunk_manifest(tile_id, chunk_record, chunk_plan_entry, source_identity, evidence)`** builds its own pending and terrain rows; `tile_store_files` is the pure builder the fixture test and the step share. `--output` accepts only the world lane store (row 393). Every step prints a row list (row 394).
8. **[Docs size] World EVIDENCE was 29,562 bytes before the new section;** the rejected and polish WORLD-07 rows are listed by id, their full rows stay in `02-11-SUMMARY.md` (row 395).

### Not done as planned

- The recorded walk failed: WORLD-05 is not proven. Cause: the world lane catalog has no player profile, model or NPC record, the plan's flagged assumption about 02-03. Recorded as an open follow-up (STATE.md, row 392), not as Needs Human, because it is integration work on the store switch and the coverage join.

## Known stubs

- `loadNativeTileChunks` returns `setTerrainPreview() {}`: a tile has no terrain material preview yet (`terrain-material` pending), so there is nothing to toggle.

## Threat flags

None beyond the plan's register: T-02-1601 (`?map` parse), T-02-1602 (hash-checked fetches with length and 128 MiB caps, guarded parsers), T-02-1603 (`require_converter_output`, world lane store only, `immutable_write`, catalog through `write_store`), T-02-1604 (load-check from `testInfo.status`, pinned to the served catalog SHA-256, a skipped test writes nothing).

## Needs Human

- `Needs Human (plan 02-16):` the restage command printed by `write_lane_catalog.py --lane world --plan` (STATE.md).

## Process cleanup

- Started: unittest and pipeline runs, `convert_tile.py` and `write_lane_catalog.py` runs, Vitest runs, three Playwright runs (each started `pnpm dev` on 5173 and stopped it at exit). All in the foreground.
- Check at 10:15 Riga: `netstat -ano | grep LISTENING | grep -E ':(5173|5175) '` empty; `ps -W` shows only node.exe from Oct 29 (WINPID 5700, 5704, 25728) and python.exe from Nov 7 (29876), none started by this plan; no chrome, headless shell, esbuild or Playwright process. PowerShell `Get-CimInstance` was refused by the session sandbox. Nothing started by this plan remains.

## Self-Check: PASSED

- FOUND: scripts/world/tile_manifest_step.py, src/scene/world/loadNativeTileChunks.ts, src/scene/world/nativeTileManifest.ts, src/scene/world/nativeTileChunkManifest.ts, src/scene/world/selectedNativeTile.ts, tests/browser/world-tile-walk.spec.ts, tests/pipeline/test_tile_manifest_step.py, recipes/world/tile-manifest-vocabulary.json
- FOUND commits: 17b913c, 6c02d2a, b56fd8a, a92a558, c899e01
