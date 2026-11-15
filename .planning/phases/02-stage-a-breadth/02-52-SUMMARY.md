---
phase: 02-stage-a-breadth
plan: 52
subsystem: world
tags: [world, ue2, lineage2-licensee, g16-heightmap, elbera-l2lib, cross-check, WORLD-01]
requires:
  - phase: 02-13
    provides: declared TerrainInfo.TerrainMap package per tile in the committed census
  - phase: 02-14
    provides: read_g16, actor_properties and build_map in world modules, sectionless raw recipe, sealed 20_21 raw unit
  - phase: 02-15
    provides: native_terrain in scripts/world/native_terrain_sectors.py
  - phase: 02-19
    provides: load_pinned_elbera_module and ELBERA_ROOT in scripts/data/pinned_elbera_module.py
provides:
  - one reader licensee gate require_reviewed_reader_layout for read_g16, actor_properties, native_terrain and build_map
  - READER_LICENSEE_LAYOUTS with cited evidence, fixture and cross-check tile per reviewed pair, and reviewed_reader_pairs for the 02-54 census
  - pinned Elbera l2lib cross-check reads (elbera_texture_mip_bytes, elbera_actor_properties, elbera_terrain_sector_properties) on guarded lock-equal files
  - reader_cross_check_rows.py, which records one exact comparison row per reviewed licensee into tests/fixtures/world-readers/cross-checks.json
  - reviewed map licensees 16, 18, 19, 20, 23, 25, 28, 30, 31 (TerrainInfo of 16 refused) and terrain licensees 12, 15, 16, 18, 19, 20, 22, 23, 25, 28
affects: [02-53, 02-54, WORLD-01, WORLD-03]
actuals:
  tokens: 32000
  tasks: 3
  commits: 21
plan_head_before: f866cd37575d7aa624b8c3416f7111a33f7ad90b
plan_head_after: aad83e1ce2aa53c40a929da7d9397ff80e82e3ed
tech-stack:
  added: []
  patterns:
    - "Reader licensee records: {evidence[{source, commit, file, sha256, section}], differencesFrom123_28, fixture, crossCheck{tile}} plus materialPrefix for heightmaps; no licensee branch outside reader_licensee_layouts.py"
    - "Cross-check row: {reader, version, licensee, tile, package, lockSha256, ourDecodeSha256, crossCheckDecodeSha256, tool{name, commit, pins}, equal}, re-derived by the real-client test"
key-files:
  created:
    - scripts/world/reader_licensee_layouts.py
    - scripts/world/elbera_reader_cross_check.py
    - scripts/world/reader_cross_check_rows.py
    - tests/pipeline/test_world_reader_licensees.py
    - tests/pipeline/world_reader_fixture_packages.py
    - tests/fixtures/world-readers/cross-checks.json
    - tests/fixtures/world-readers/g16-heightmap-123-{12,15,16,18,19,20,22,23,25,28}.json
    - tests/fixtures/world-readers/map-123-{16,18,19,20,23,25,28,30,31}.json
  modified:
    - scripts/world/terrain_height_texture.py
    - scripts/world/map_actor_properties.py
    - scripts/world/native_terrain_sectors.py
    - scripts/native_map.py
    - scripts/native_map_geometry.py
    - scripts/extract-native-terrain-patch.py
    - tests/pipeline/test_world_raw_step.py
    - tests/pipeline/test_native_map.py
    - docs/parts/world/EVIDENCE.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md
key-decisions:
  - "Elbera l2lib ue2package.py (SHA-pinned, 12c9656) is the cross-check reader; only that file is pinned because parse_texture, mip_bytes, read_properties and qualified_ref live there and the other l2lib files need package-relative imports (row 409)"
  - "Heightmap rows compare raw 16-bit mip0 bytes from Elbera parse_texture plus mip_bytes, never the lossy decode_g16 (row 410)"
  - "The raw step algorithm version and fingerprint stay unchanged; the 20_21 rebuild matches every sealed product SHA-256 (row 411)"
  - "Map licensee 25 and terrain licensees 15, 16 and 18 were reviewed beyond the planned list; terrain 118/11 stays a version gap (row 413)"
  - "Cross-check tiles: the first census tile with a reviewed map, and for heightmaps the first with a non-constant mip0 when one exists; the tile lives in the layout record (row 414)"
  - "TerrainInfo of map licensee 16 stays refused: the cited serializer covers licensee 17 or later and the 123/28 payload reader does not consume 24_10 (row 415)"
  - "WORLD-01 stays Pending (row 417)"
patterns-established:
  - "Grow a reader licensee: cite, write the synthetic fixture, add the tile to REVIEWED_LICENSEE_CROSS_CHECK_TILES, record the row with reader_cross_check_rows.py, keep it only on equal true, one commit"
requirements-completed: []
coverage:
  - id: D1
    description: "Single gate: every reader asks require_reviewed_reader_layout and refuses an unreviewed licensee with the census gap reason; no scattered licensee check remains in the four gate files"
    requirement: WORLD-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_world_reader_licensees.py#ReaderGateTests"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every reviewed pair has cited evidence (Elbera file SHA-256 re-checked), a synthetic fixture and an equal cross-check row; removing any one is detected"
    requirement: WORLD-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_world_reader_licensees.py#LayoutEvidenceTests"
        status: pass
    human_judgment: false
  - id: D3
    description: "Synthetic heightmap and map fixtures decode exactly through our readers and the pinned Elbera reader; neighbouring licensees and other prefix rules are refused; empty TerrainInfo and Texture edges raise named errors"
    requirement: WORLD-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_world_reader_licensees.py#HeightmapFixtureTests, MapFixtureTests, EmptyExportEdgeTests, ElberaGuardTests"
        status: pass
    human_judgment: false
  - id: D4
    description: "36 real cross-check rows reproduce exactly on E:/Lineage2-client, build_map completes for every heightmap row tile, and the 20_21 raw products and fingerprint are unchanged"
    requirement: WORLD-01
    verification:
      - kind: integration
        ref: "tests/pipeline/test_world_reader_licensees.py#RealClientCrossCheckTests, BaselineRawOutputRegressionTests"
        status: pass
      - kind: integration
        ref: "pnpm test:pipeline (1594 OK, 103 skipped)"
        status: pass
    human_judgment: false
duration: 51min
completed: 2026-11-09
status: complete
---

# Phase 2 Plan 52: World reader licensee growth Summary

**The four world readers now pass one licensee gate whose records cite pinned sources. Map licensees 16, 18, 19, 20, 23, 25, 30 and 31 and terrain licensees 12, 15, 16, 18, 19, 20, 22, 23 and 25 joined 123/28. Each one decodes a real census tile exactly as the SHA-pinned Elbera l2lib reader does. The TerrainInfo payload of map licensee 16 and the version-118 height package stay refused, and no layout was fitted.**

## Performance

- **Duration:** 51 min
- **Started:** 2026-11-09T09:07:36Z
- **Completed:** 2026-11-09T09:58:12Z
- **Tasks:** 3 of 3
- **Files modified:** 36 (2,715 insertions, 21 deletions)

## Accomplishments

- `scripts/world/reader_licensee_layouts.py` (133 lines) holds `READER_LICENSEE_LAYOUTS`, `require_reviewed_reader_layout`, `reviewed_reader_pairs` and the cited `lineage_material_prefix` rule: a reserved int32 for licensees 16 to 36, plus the shader block for 30 to 36, from Elbera `tools/l2lib/README.md` at 12c9656 (SHA-256 `32b12d39...`), with UEViewer `UnMaterial2.h` at `a0bfb468` as a secondary reference. An unlisted pair raises `terrain-height-licensee-unsupported:123/<x>` or `map-licensee-unsupported:123/<x>`, and an unlisted version raises the census version reason.
- `read_g16`, `actor_properties`, `native_terrain` and `build_map` call the gate (`require_reviewed_reader_layout("g16-heightmap" | "map-actor" | "terrain-info" | "raw-map", ...)`). `read_g16` reads the material prefix from the record, so licensees 12 and 15 read no reserved int32.
- `scripts/world/elbera_reader_cross_check.py` (91 lines) loads only `tools/l2lib/ue2package.py` (pin `18fc5bf7...`) through `load_pinned_elbera_module`. It takes a `ReferenceClientAccess` and a relative path, resolves the path through `require_equal_file`, and runs no Elbera entry point.
- `scripts/world/reader_cross_check_rows.py` (199 lines) builds our projection and Elbera's: mip0 SHA-256 for heightmaps; for actors, the property-end offset and per-property payload digests of every export `build_map` reads; for TerrainInfo, the property end plus the owned TerrainSector set. The `raw-map` row is built from the files `build_map` writes into a temporary directory. The tool writes the row for the tile named in the layout record.
- Real rows: 36 rows, all `equal: true` (table in `docs/parts/world/EVIDENCE.md`, "Reader licensee growth"). A rebuild of 20_21 matches all sealed raw product SHA-256 values and the sealed fingerprint.

| Licensee (research 11.6 order) | Result | Tile |
|---|---|---|
| T 25 | reviewed, equal | 20_15 |
| T 23 | reviewed, equal | 18_24 |
| map 30 (actor, TerrainInfo, raw) | reviewed, equal; shader block kept raw | 17_22 |
| map 23 (actor, TerrainInfo, raw) | reviewed, equal | 17_20 |
| map 18, 31, 19, 20, 25 (all three readers) | reviewed, equal | 17_18, 19_23, 26_11, 24_26, 15_20 |
| map 16 | actor and raw reviewed, equal; TerrainInfo refused | 24_10 |
| T 12, 15 (no reserved int32) | reviewed, equal | 16_24, 23_10 |
| T 20, 22, 19, 16, 18 | reviewed, equal | 16_21, 19_21, 24_11, 17_25, 18_13 |
| T 11 | refused: `t_17_23.utx` is 118/11, `terrain-height-version-unsupported:118` | - |
| map 0 (`entry`), version 118 maps | outside this plan, unchanged | - |
| 19_11, 20_11 | `terrain-height-package-missing`, unchanged | - |

## Task commits

1. **Task 1: T-25 tracer** - `9e84fa9` (test, RED), `595034b` (feat)
2. **Task 2: T-23, map 30, map 23** - `3cc99f0`, `9d968c7`, `cf84b78` (feat)
3. **Task 3: remaining licensees, evidence** - `c1a9531` (map 18), `855c748` (map 31), `8851979` (map 16), `509ac7b` (map 19), `b079396` (map 20), `b0f952d` (map 25), `c775e93` (T 12), `5b50a71` (T 20), `d3897f6` (T 22), `20dc693` (T 19), `845b2b5` (T 15), `eb5a860` (T 16), `83117f2` (T 18), `1fc28f9` (fix: non-constant heightmap tiles for T 25 and T 12), `e79e4d1` (fix: test_native_map refusal case), `aad83e1` (docs)

**Plan metadata:** the docs commit that holds this SUMMARY.

## Verification

- Tracer gate: Task 1 `<verify>` re-ran green before expansion (Tracer verified end-to-end - expanding).
- `python -B -m unittest discover -s tests/pipeline -p "test_world_reader_licensees.py"`: 24 OK, including the real-client classes (about 25 s).
- `python -B -m unittest discover -s tests/pipeline -p "test_world_raw_step.py"`: 13 OK.
- `pnpm test:pipeline` at BelowNormal: 1594 OK, 103 skipped, exit 0. The 02-15 baseline was 1463 OK; 02-16 and later plans landed in between.
- `node scripts/check-lane-ownership.mjs --base "$(cat artifacts/plan-starts/02-52.sha)" --part world`: `lane world: 0 foreign paths`.
- Acceptance: `grep -c 'require_reviewed_reader_layout("g16-heightmap"' terrain_height_texture.py` prints 1. The node row check for T-25 exits 0. The fixture binary-run check exits 0. The absolute-path grep prints 0 for both new modules. The scattered-check grep over the four gate files prints 0. `git log -- reader_licensee_layouts.py` shows one commit per licensee. `grep -c 02-52 EVIDENCE.md` prints 3.
- No `assets:*`, `world:stage`, `stage_*`, `derive-*`, `migrate-*` or preview command ran. `public/l2` and `scripts/native_assets_lib/**` and `scripts/data/**` were not edited. Elbera `tools/l2lib/__pycache__` is unchanged since 2026-11-07.

## Decisions made

OVERNIGHT-DECISIONS rows 409 to 417, summarised in key-decisions above.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Only `ue2package.py` is pinned**
- **Found during:** Task 1
- **Issue:** The plan pins `textures.py`, `propertylayout.py` and `classdata.py` too. Those files use `from .ue2package import`, which `load_pinned_elbera_module` cannot run. Every function the cross-check needs lives in `ue2package.py`.
- **Fix:** `ELBERA_L2LIB_PINS` holds the one module that loads (row 409). `elbera_actor_properties(reference_access, relative_path)` selects the exports by Elbera's own rule instead of taking export names, which makes it a stronger independent check.
- **Commit:** 595034b

**2. [Rule 2 - Completeness] Licensees beyond the planned list**
- **Found during:** Task 3
- **Issue:** The census holds map licensee 25 (17 tiles) and terrain licensees 11, 15, 16 and 18, which the planned order leaves out.
- **Fix:** Map 25 and T 15, 16 and 18 were reviewed with the same procedure. T 11 is a version-118 package and stays a version gap (row 413).
- **Commits:** b0f952d, 845b2b5, eb5a860, 83117f2

**3. [Rule 1 - Bug] Cross-check tiles with a constant heightmap**
- **Found during:** Task 3
- **Issue:** 16_11 (T 25) and 15_22 (T 12) hold one constant sample.
- **Fix:** Their rows moved to 20_15 and 16_24. T 15 and T 18 have only constant tiles (row 414).
- **Commit:** 1fc28f9

**4. [Rule 1 - Bug] `test_native_map.py` expected licensee 30 to be refused**
- **Found during:** the Task 3 full pipeline run, after the map 30 commit
- **Fix:** The case now uses licensee 27 and asserts the exact reason. `test_world_raw_step.py` received the same change in the Task 1 RED commit.
- **Commit:** e79e4d1

**5. [Provenance] Implementation file lists**
- `native_map.implementation()`, `native_map_geometry.GEOMETRY_WORLD_MODULE_PATHS` and the terrain patch extractor list now name the two new gate modules. The main-checkout receipts already need the integration restage (02-14 Needs Human).

**6. [Choice] First census tile with a readable map**
- The first sorted T-25 tile, 15_20, has a licensee-25 map, which was not reviewed at Task 1. The row needs the map's declared TerrainMap, so every heightmap row uses the first tile whose map is already reviewed.

**Total deviations:** 4 auto-fixed (1 blocking, 1 completeness, 2 bugs), plus 1 provenance note and 1 recorded choice. **Impact:** more licensees reviewed than planned; nothing fitted, no 123/28 output changed.

## Issues encountered

- T 11 cross-check failed at the package table (`Package table adapter supports UE2 123/licensee0..31`). The package is 118/11. The change was reverted before any commit, and T 11 stays a version gap.

## Known stubs

None.

## Threat flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: repo-write | scripts/world/reader_cross_check_rows.py | The `--client` tool writes `tests/fixtures/world-readers/cross-checks.json` in the repository (evidence, not a converter product); it calls `require_reference_client`, `require_batch_preflight` and BelowNormal first |

## Process cleanup

- Processes started: foreground `python -B` unittest, probe and row runs, one `pnpm test:pipeline` (twice) under a BelowNormal wrapper, and `node` schedule and ownership checks. All exited. No dev server, Vite preview, Playwright or browser was started.
- Check: `Get-CimInstance Win32_Process` filtered on `*autonomous-roadmap*` shows only the check's own bash and PowerShell processes. Nothing listens on port 5175. Nothing started by this plan remains.

## Next phase readiness

- 02-54 reads `reviewed_reader_pairs` to rebuild the census, decide Lobby (map 123/30, now readable) and seal the raw steps of the newly readable tiles.
- WORLD-01 stays Pending (row 417).

## Self-Check: PASSED

- FOUND: scripts/world/reader_licensee_layouts.py, scripts/world/elbera_reader_cross_check.py, scripts/world/reader_cross_check_rows.py, tests/pipeline/test_world_reader_licensees.py, tests/pipeline/world_reader_fixture_packages.py, tests/fixtures/world-readers/cross-checks.json (36 rows) and 19 fixtures
- FOUND commits: all 21 from 9e84fa9 to aad83e1 are ancestors of HEAD

---
*Phase: 02-stage-a-breadth*
*Completed: 2026-11-09*
