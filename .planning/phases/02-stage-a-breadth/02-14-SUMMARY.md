---
phase: 02-stage-a-breadth
plan: 14
subsystem: world
tags: [world-01, raw-map-step, unit-ledger, native-map-split, hand-chosen-windows]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-01 lane store paths; 02-02 UnitLedger, require_batch_preflight, gap rows; 02-12 and 02-13 tile census with declared TerrainMap gates"
provides:
  - "scripts/world/convert_tile.py: main (--client, --map XX_YY, --step raw), record_tile_step_gap_row(project_root, row)"
  - "scripts/world/raw_map_step.py: RAW_MAP_STEP_ALGORITHM_VERSION 1, raw_map_recipe, run_raw_map_step"
  - "scripts/world/map_actor_properties.py, map_sources.py, terrain_height_texture.py split from native_map.py (298 lines)"
  - "native_map.build_map without a section: whole-tile requests, coverage staticMeshActorsWithMesh and uniqueStaticMeshes"
  - "Sealed unit artifacts/lane-store/world/work/tile__20_21/raw (ignored) and raw gap rows artifacts/lane-store/world/gap-rows/raw.json"
  - "Top-level unresolved labels in recipes/native-map-20_20.json and recipes/native-map-debug-location.json; tests/pipeline/test_unresolved_section_windows.py with HAND_CHOSEN_WINDOW_POINTERS"
affects: [02-15, 02-16, 02-29, 02-30, 02-31, 02-45, 02-47, 02-50]

actuals:
  tokens: 19000
  tasks: 3
  commits: 4
plan_head_before: 2d76140282ab1df1fdfb3552d29a987433261bf3
plan_head_after: cf22abaea1567cbc7c887b5add2d26499032fb56

tech-stack:
  added: []
  patterns:
    - "A tile step returns one step-level row; convert_tile records it with record_tile_step_gap_row, which keeps other tiles' rows of the step file; per-object decode failures live only in the receipt gapRows"
    - "Raw step fingerprint = lock eSha256 of the map + the generated recipe; other packages read are a hashed product (source-dependencies.json)"
    - "Hand-chosen recipe values carry a top-level unresolved list of RFC 6901 pointers with a reason, a statement and the replacement"

key-files:
  created:
    - scripts/world/convert_tile.py
    - scripts/world/raw_map_step.py
    - scripts/world/map_actor_properties.py
    - scripts/world/map_sources.py
    - scripts/world/terrain_height_texture.py
    - tests/pipeline/test_world_raw_step.py
    - tests/pipeline/test_unresolved_section_windows.py
  modified:
    - scripts/native_map.py
    - scripts/extract-native-terrain-patch.py
    - tests/pipeline/test_native_map.py
    - tests/pipeline/test_native_terrain_patch.py
    - tests/pipeline/test_native_map_lock.py
    - recipes/native-map-20_20.json
    - recipes/native-map-debug-location.json
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md
    - .planning/STATE.md

key-decisions:
  - "Raw products in the world lane work root under products/, never the served tree (row 308)"
  - "--output waits for the first served-product step, 02-16 (row 309)"
  - "Importers outside the world lane keep from native_map import ...; repointing is integration work (row 310)"
  - "Hand-chosen windows labelled with a top-level unresolved list, reason hand-chosen-presentation-window; the Z window too; the two other section recipes listed, not labelled (row 311)"
  - "Receipt inputs hold only the map; every package read is listed in products/source-dependencies.json (row 312)"
  - "Real-client 20_21 case skips when the unit is unsealed (row 313)"
  - "WORLD-01 stays Pending (row 314)"

patterns-established:
  - "World tile step contract: run_<step>(project_root, client, tile_id) -> one gap-row-shaped step row"

requirements-completed: []

coverage:
  - id: D1
    description: "Whole-tile raw step for any eligible tile, sealed and resumable on the unit ledger, with census gap, failed and per-object gap handling"
    requirement: WORLD-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_world_raw_step.py (13 tests)"
        status: pass
      - kind: integration
        ref: "python -B scripts/world/convert_tile.py --client E:/Lineage2-client --map 20_21 --step raw"
        status: pass
    human_judgment: false
  - id: D2
    description: "native_map.py split under 400 lines with every outside importer resolving and the section output byte-identical"
    verification:
      - kind: unit
        ref: "python -B -m unittest discover -s tests/pipeline -p test_native_*.py (669 OK, 94 skipped)"
        status: pass
      - kind: other
        ref: "build_map before and after on recipes/native-map-20_20.json over E: (15 files, identical)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Hand-chosen 20_20 window values labelled unresolved, values unchanged"
    verification:
      - kind: unit
        ref: "tests/pipeline/test_unresolved_section_windows.py"
        status: pass
    human_judgment: true
    rationale: "Changing two migration-pinned recipes makes the main checkout's migration verify refuse; the integration thread decides re-migrate or retire (Needs Human)"

duration: 19min
completed: 2026-11-09
---

# Phase 2 Plan 14: World raw step Summary

**`convert_tile.py --map XX_YY --step raw` now extracts any eligible tile whole (no section box) into a sealed, resumable unit of the world lane work root. 20_21 is the first sealed unit and its counts match research 5.1 exactly. `native_map.py` is split into three world modules (298 lines left), and the 20_20 section recipes label their hand-chosen windows as unresolved.**

## Performance

- **Duration:** about 19 min
- **Started:** 2026-11-09T01:55:39Z
- **Completed:** 2026-11-09T02:14:37Z
- **Tasks:** 3
- **Files modified:** 14 code and recipe files, plus 4 docs files

## Accomplishments

- `validate_recipe` treats `section` as optional. Without a section, `build_map` requests the mesh of every StaticMeshActor, leaves out `sectionOriginSelected` and reports `staticMeshActorsWithMesh` and `uniqueStaticMeshes`. A declared section still produces exactly the same bytes: the pre-plan and post-plan `build_map` on `recipes/native-map-20_20.json` over E: wrote the same 15 files with the same SHA-256, both after Task 1 and after the split.
- `run_raw_map_step` checks the tile id. It reads the census row, then the lock record. It returns early for a census gap without reading the client, and returns early for a sealed unit. Otherwise it runs `begin`, `build_map` (writes go through `safe_path` under `products/`) and `seal`. A `FormatError` gives `failed` `decode-failed:<message>` with no seal. Each manifest `unsupported` entry becomes a receipt gap row with `sourceIdentity.object`.
- `convert_tile.py` calls `require_reference_client`, `require_batch_preflight(ROOT, 'world', BATCH_MINIMUM_FREE_BYTES)` and `run_at_below_normal_priority`, then the step. It records the row with `record_tile_step_gap_row`, prints it, and exits 1 on `failed`.
- The real 20_21 unit, run against research 5.1:

| Measure | 20_21 raw manifest | Research 5.1 |
|---|---|---|
| exports | 11,424 | 11,424 |
| StaticMeshActor | 3,205 | 3,205 |
| Model | 518 | 518 |
| TerrainSector | 256 | 256 |
| BlockingVolume | 7 | 7 |
| PlayerStart | 4 | 4 |
| ambientSoundObjectsDecoded | 2,875 | 2,875 |
| terrainHeightsDecoded | 1 | - |

  Other coverage: 4,483 actors decoded out of 4,483 stack actors, 3,205 StaticMeshActors with a mesh, 196 unique static meshes and 196 requests, support `raw-data-extracted`, 0 unsupported entries, 0 receipt gap rows. 9 source packages were read (map, height texture, 7 static mesh packages). The receipt holds `config`, `inputs` (only `maps/20_21.unr` at `e123be27...`), `outputs` (16 products), `gapRows` and the ledger fields. No field is a script self-hash. The first run took about 4 s.
- Rerun proof: a snapshot of `tile__20_21/raw` (19 files, 63,059,520 bytes, paths, sizes and mtimes) was taken before and after a second `convert_tile.py --map 20_21 --step raw`. The two snapshots are byte-identical (`cmp` clean), and the rerun printed `pass work/tile__20_21/raw/receipt.json`.
- Split: `scripts/world/map_actor_properties.py` (127 lines), `map_sources.py` (73 lines, which also takes `require_lock_equal_client_path` because `MapSources` uses it) and `terrain_height_texture.py` (57 lines). `native_map.py` dropped from 512 to 298 lines. The import check finds every name the outside importers need. All 14 importers of `native_map` load. `implementation()` and the terrain patch extractor now hash the moved modules.
- Labels: `grep -c '"hand-chosen-presentation-window"'` gives 2 for each recipe. Removing `unresolved`, both recipes equal their 2d76140 content with the same key order (`True True` for both).

## Task commits

1. **Task 1: raw step through the ledger, real 20_21 unit**: `68a486e` (test, RED), `e593aef` (feat, GREEN)
2. **Task 2: split native_map.py into world modules**: `0f67c33` (refactor)
3. **Task 3: label the hand-chosen windows, real-tile test**: `cf22aba` (feat)

**Plan metadata:** the docs commit that holds this SUMMARY.

## Verification

- `python -B -m unittest discover -s tests/pipeline -p test_world_raw_step.py`: 13 OK. This includes the real-client 20_21 class, which runs because E: is present and the unit is sealed.
- `python -B -m unittest discover -s tests/pipeline -p test_unresolved_section_windows.py`: 2 OK.
- `python -B -m unittest discover -s tests/pipeline -p "test_native_*.py"`: 669 OK, 94 skipped.
- Full pipeline (`scripts/test_pipeline.py` at BelowNormal): 1397 OK, 103 skipped, exit 0. The 02-13 baseline was 1382 OK and 104 skipped. This plan adds 15 tests and no failure.
- `pnpm exec vitest run tests/unit/sourceFrame.test.ts` (it reads the labelled debug recipe): 9 passed.
- `node scripts/check-lane-ownership.mjs --base 2d76140 --part world`: `lane world: 0 foreign paths`.
- `git diff --stat 2d76140..HEAD` over `scripts/export-native-map-audio.py`, `scripts/native_assets_lib`, `scripts/native_migration.py`, `scripts/stage-native-movers.py` and `scripts/derive-native-map-model.py`: empty.
- No `assets:*`, `world:stage`, `stage_*`, `derive-*`, `migrate-*` or preview command ran. `public/l2` was not touched. No whole-tree hash, `verify_lock` or `inventory()` ran.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 1 - Bug] The receipt inputs must reproduce the fingerprint**
- **Found during:** Task 1
- **Issue:** The plan puts all of `MapSources.dependencies` in the receipt `inputs`. `UnitLedger.seal` refuses inputs that do not reproduce the fingerprint, and the plan truth says the fingerprint holds only the map's lock eSha256 and the recipe.
- **Fix:** `inputs` holds only the map. Every package read is listed with sha256 and bytes in the sealed product `products/source-dependencies.json`. The step also refuses a map whose read bytes differ from its lock eSha256 (row 312).
- **Files modified:** scripts/world/raw_map_step.py
- **Committed in:** e593aef

**2. [Rule 3 - Blocking] `test_native_map_lock.py` patched `native_map.Package`**
- **Found during:** Task 2
- **Issue:** After the split, `MapSources` lives in `world.map_sources`, so `patch.object(native_map, 'Package', ...)` failed with AttributeError.
- **Fix:** The test now patches and constructs `world.map_sources`. The plan did not list this test file. It is a shared pipeline test, and the ownership check stays at 0 foreign paths.
- **Committed in:** 0f67c33

**3. [Rule 2 - Provenance] The terrain patch extractor's implementation file list**
- **Found during:** Task 2
- **Issue:** `extract-native-terrain-patch.py` hashes the code it runs. `bitmap_words`, `actor_properties` and `read_g16` now live in world modules.
- **Fix:** Its list now includes the three moved modules.
- **Committed in:** 0f67c33

**4. [Choice] The real-client case also skips when the unit is unsealed**
- It refuses any rebuild, so a test never writes 63 MB as a side effect (row 313).

**Total deviations:** 3 auto-fixed (1 bug, 1 blocking, 1 provenance), plus 1 recorded choice. None widens the scope.

## Flagged for the integration thread

- `scripts/native_batch_adapters.py:138` and `scripts/export-native-sounds.py:48` list `native_map.py` in their implementation file sets but not the moved modules. Recorded under Needs Human.
- `native_map.implementation()` now covers the moved modules, and the two recipes changed bytes. The main checkout's `pnpm assets:migrate --verify-only` is therefore expected to refuse until the integration thread re-migrates or retires the 20_20 chain. This is recorded under Needs Human, and no `assets:*` command ran here.
- `recipes/native-map-section.json` and `recipes/native-map-section-3x3-candidate.json` also hold hand-chosen windows. They are listed for the owner and not labelled (row 311).

## Known stubs

None. `section-bindings.json` keeps its file name for whole-tile builds. In those builds it lists every mesh binding.

## Process cleanup

- Processes started: unittest and pipeline runs, two `convert_tile.py` runs, two ad-hoc compare and snapshot scripts, and one vitest run. All were foreground and exited.
- Check: `Get-CimInstance Win32_Process` filtered on `*autonomous-roadmap*` shows only the bash and PowerShell processes of the check itself. Nothing matches `convert_tile`, `raw_map_step`, `unittest`, `vitest`, `test_pipeline`, `playwright` or `vite`. No listener on port 5175, and no dev server was started. Nothing started by this plan remains.

## Next phase readiness

- 02-15 reads `tile__20_21/raw/products/` (actors, terrain, height mips, bitmaps, `static-mesh-requests.json`) and records its rows through `record_tile_step_gap_row`.
- WORLD-01 stays Pending (row 314).

## Self-Check: PASSED

- FOUND: scripts/world/convert_tile.py, scripts/world/raw_map_step.py, scripts/world/map_actor_properties.py, scripts/world/map_sources.py, scripts/world/terrain_height_texture.py, tests/pipeline/test_world_raw_step.py, tests/pipeline/test_unresolved_section_windows.py, artifacts/lane-store/world/work/tile__20_21/raw/complete.json
- FOUND commits: 68a486e, e593aef, 0f67c33, cf22aba

---
*Phase: 02-stage-a-breadth*
*Completed: 2026-11-09*
