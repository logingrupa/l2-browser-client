---
phase: 02-stage-a-breadth
plan: 12
subsystem: world
tags: [world-03, world-01, tile-census, oracle, gap-rows, coverage]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-02 gap rows, seed reasons and the machine schedule check; 02-03 write_lane_catalog.py; 02-07 build_coverage_report.py and the world denominator from the lock"
provides:
  - "scripts/world/tile_census.py: map_census_keys, read_package_header, map_reader_gate, terrain_height_gate_by_package_name, build_tile_census, validate_tile_census, tile_census_bytes, tile_census_gap_rows, main (--client)"
  - "docs/parts/world/tile-census.json: 163 rows, 39 eligible, 124 gap, referenceTreeLockSha256 1957c968"
  - "artifacts/lane-store/world/gap-rows/census.json (ignored): world census gap rows read by coverage"
  - "scripts/world/freeze_world_oracle.py: freeze_world_oracle, validate_world_oracle, world_oracle_bytes, matrix_canonical_sha256, main (--store-root)"
  - "recipes/world/oracle/20_20/expected.json: 20_20 oracle pinned to catalog 55c12147"
  - "scripts/world/committed_world_data.py: require_committed_destination, write_committed_world_bytes"
  - "recipes/world/gap-reasons.json: terrain-height-version-unsupported:<version>"
affects: [02-13, 02-14, 02-26, 02-29, 02-30, 02-47, 02-49, 02-54, 02-55]

actuals:
  tokens: 47000
  tasks: 3
  commits: 4
plan_head_before: 27b6b3f6de4aae50ef69a704f221ece241f6922d
plan_head_after: 7ee97ad95744bc2016f0fe9f032918933f26efa0

tech-stack:
  added: []
  patterns:
    - "Committed-data writers have a fixed in-repo destination checked with refuse_reparse_points and refused under the realpath of public/l2; no --output flag"
    - "A census writes both the committed file and lane gap rows under step census, so coverage reads the census reasons through read_gap_rows"
    - "Junction JSON is hash-checked against its catalog or source pin before it is parsed, with a 32 MiB read bound"

key-files:
  created:
    - scripts/world/tile_census.py
    - scripts/world/freeze_world_oracle.py
    - scripts/world/committed_world_data.py
    - docs/parts/world/tile-census.json
    - recipes/world/oracle/20_20/expected.json
    - recipes/world/gap-reasons.json
    - tests/pipeline/test_tile_census.py
    - tests/pipeline/test_world_oracle.py
  modified:
    - docs/parts/world/EVIDENCE.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md
    - .planning/phases/02-stage-a-breadth/deferred-items.md

key-decisions:
  - "Terrain-height gate by T_XX_YY.utx name until 02-13, terrainMapPackage null (row 260)"
  - "Oracle placements pinned by the SHA-256 of their compact canonical matrix JSON (row 261)"
  - "Eligible tiles get census gap row pending step-pending:raw, never pass (row 262)"
  - "terrain-height-version-unsupported:<version> added to recipes/world/gap-reasons.json after t_17_23.utx read 118/11 (row 263)"
  - "World lane catalog created with write_lane_catalog.py --lane world so coverage runs (row 264)"
  - "Extra module committed_world_data.py; native_store canonical JSON for both files (row 265)"
  - "environment.manifestSha256 is the pinned conversion manifest SHA e10827c4 (row 266)"
  - "WORLD-03 and WORLD-01 stay Pending (row 267)"

requirements-completed: []

duration: 25min
completed: 2026-11-09
---

# Phase 2 Plan 12: World oracle and tile census summary

**A header-only census of all 163 maps through the lock guard (39 eligible tiles, 124 listed gaps, Lobby a map-licensee 123/30 gap), written as committed JSON and as world census gap rows that the coverage report reads, plus a read-only freeze of the 20_20 oracle pinned to the junction catalog SHA-256.**

## Performance

- Duration: about 25 min (2026-11-09 00:50 to 01:15 Riga)
- Tasks: 3 of 3
- Files: 8 created, 4 modified

## Accomplishments

- `python -B scripts/world/tile_census.py --client E:/Lineage2-client` reads the first 128 bytes of each `maps/*.unr` and `textures/T_XX_YY.utx` after `require_reference_client(client).require_equal_file`, at BelowNormal, in about 6 s. It writes `docs/parts/world/tile-census.json` and `artifacts/lane-store/world/gap-rows/census.json`.
- Census, `referenceTreeLockSha256` `1957c96800aa45cb10c984f3f2e6f8d1f5f0b1713f086f20560db01f4d1d2b52`: 163 maps, 153 `tile:XX_YY` and 10 `map:<name>`, sorted by key. 39 eligible, 124 gap. Tile gaps: 86 map licensee, 26 terrain-height licensee (123/25: 13, 123/23: 8, 123/12: 2, 123/19, 123/20, 123/22: 1 each), 2 `terrain-height-package-missing` (19_11, 20_11). No row keeps `census-pending`; `terrainMapPackage` is null on every row.
- Non-tile: Auto0 to Auto5 and skylevel 118/0 and ship_position (Lineage2Ver111) 118/6 are `map-version-unsupported:118`; entry (Lineage2Ver111) 123/0 is `map-licensee-unsupported:123/0`; Lobby 123/30 is `map-licensee-unsupported:123/30`.
- Oracle, `python -B scripts/world/freeze_world_oracle.py`: `catalogSha256` `55c12147db306264deb2be33f6b9cd661d1376d12dc2aa6473be3700322972fe`; section `map-20-20-section` manifest `2e73654e...8d8a`, 62 models, 157 placements, BSP Brush397 (28 triangles), Brush610 ceiling (6), floor (6), walls (20), 1 terrain patch (TerrainSector247), 1 unsupported runtime material (`interlude:FX_E_S.Flameset.Default_Flame01`); sky `f7a0b5ef...` with source `interlude:20_20.Model798.SkyZoneInfo0` and 20 listed files; environment `e10827c4...` with 3 files; movers `map-20-20-movers` `0de5d083...`, 8 movers, 2 models. Sky source id and environment SHA are read from `nativeSkyPresentation.ts` and `nativeEnvironmentTables.ts`. This section is the legacy hand-windowed 20_20 section, a subset reference for later diffs, never a whole-tile total.
- The junction was only read: `git status --porcelain public/l2` printed nothing after both freezes and the coverage runs.

## Census figures beside the research cross-check

| Figure | Measured (census) | Research 5.1 | Finding |
| --- | --- | --- | --- |
| Tile map licensees | 28: 67, 23: 38, 25: 17, 30: 15, 18: 6, 31: 6, 16: 2, 19: 1, 20: 1 | the same | match |
| Eligible tiles | 39 | 39 | the same list, no extra, no missing |
| Non-tile headers | Auto0..5 118/0, entry Ver111 123/0, Lobby 123/30, ship_position Ver111 118/6, skylevel 118/0 | the same | match |
| Licensee-28 tiles failing the terrain gate | 28 (T licensee 25: 13, 23: 8, 12: 2, none: 2, 20, 22, 19: 1 each) | research 11.6, the same | match |

Research values are printed here only; the census holds measured values.

## World-lane coverage

`python -B scripts/native_store/build_coverage_report.py --store-root artifacts/lane-store/world/l2 --lane world` (no `--markdown`): world 163 rows, 124 gap, 39 pending (`step-pending:raw`), 0 converted, 0 `census-pending`. Every row's reason equals its census reason. `docs/coverage.md` is integration-owned and was not rewritten.

## Task commits

1. Task 1, tracer: `6c6750a` feat(02-12): census every map header gate into the committed tile census
2. Task 2, RED: `9d3e077` test(02-12): add failing terrain-height gate by package name cases
3. Task 2, GREEN: `0a3b588` feat(02-12): gate tiles on the terrain-height package by name and commit the eligible census
4. Task 3: `7ee97ad` feat(02-12): freeze the 20_20 world oracle from the shared store, read only

Docs commit: this summary, STATUS.md world line, OVERNIGHT-DECISIONS rows 260 to 267, deferred-items.md, STATE.md and ROADMAP.md.

## Verification

- Tracer gate: the Task 1 `<verify>` chain (schedule check, census, unittest, coverage) passed end to end before Task 2.
- `python -B -m unittest discover -s tests/pipeline -p test_tile_census.py`: 20 OK. `-p test_world_oracle.py`: 11 OK, including the fresh freeze of `public/l2` equal to the committed oracle (the catalog SHA matched, so it was not skipped).
- `test_gap_rows.py`, `test_coverage_report.py` and `test_actor_census.py` still pass with the new world reason list.
- Acceptance one-liners: `163 153 10`; Lobby `map-licensee-unsupported:123/30`; `39 0 0`; `## Tile census` count 1, EVIDENCE 25,416 bytes; oracle `2e73654e 62 157 4 f7a0b5ef e10827c4 0de5d083 8`; 0 comment lines in every new Python file; no en or em dash.
- `node scripts/check-lane-ownership.mjs --base 27b6b3f --part world`: "lane world: 0 foreign paths", exit 0.
- The self-contained wording grep is empty.
- `pnpm test:pipeline`: baseline at 27b6b3f 1287 OK, 105 skipped; after this plan 1318 OK, 105 skipped (31 new tests, no new failure), both at BelowNormal.
- `pnpm vitest run tests/unit/laneOwnership.test.ts`: 35 of 36; the failing case is `docs/parts/adapter-dispatch/EVIDENCE.md` at 33,680 bytes, a file this plan did not touch (logged in deferred-items.md).
- `pnpm test:e2e` was not run: this plan has no browser check.

## TDD gate compliance

- Task 2: RED `9d3e077` failed on the missing `terrain_height_gate_by_package_name` import, GREEN `0a3b588` passes.
- Task 3: the freezer was written before its tests, inside one commit `7ee97ad`; there is no separate RED commit. The tests were checked against the synthetic store and the committed oracle.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Coverage reads gap rows, not the committed census**
- Found during: Task 1
- Issue: `build_coverage_report.py` (02-07) reads lane gap rows and never opens `docs/parts/world/tile-census.json` (the plan's flagged assumption). The world lane store also had no catalog.
- Fix: the census writes world gap rows under step `census` through `write_gap_rows`, like the actor census; `write_lane_catalog.py --lane world` created the lane catalog (rows 262, 264).
- Commit: 6c6750a

**2. [Rule 3 - Blocking] A T package of another UE version**
- Found during: Task 2
- Issue: `textures/t_17_23.utx` reads 118/11 and stopped the census.
- Fix: `terrain-height-version-unsupported:<version>` in a new `recipes/world/gap-reasons.json`, as the plan prescribes; an unreadable T header still stops the census (row 263).
- Commit: 0a3b588

**3. [Rule 2 - Missing critical functionality] A non-tile map that passes the map gate**
- Found during: Task 2
- Fix: the census stops and names the map, because no listed status covers it; tested synthetically. No real map hits it.
- Commit: 0a3b588

**4. [Rule 2] Shared destination guard**
- `scripts/world/committed_world_data.py` holds the destination check for both writers (row 265). Both files use `native_store.canonical_json` instead of the dat inventory encoder.

**5. [Rule 1 - Bug] The committed census test compared raw file bytes**
- With `core.autocrlf true`, a fresh checkout would turn the LF file into CRLF. The committed-file test compares parsed JSON; byte identity is tested on two synthetic builds.

**6. Oracle field shapes**
- `terrainPatches` rows are `{id, modelSha256, sourceSha256}`; `environment.manifestSha256` is the conversion manifest SHA and `manifest.json` is a file entry (row 266).

## Known stubs

None.

## Threat flags

None beyond the plan's register. T-02-1201 (require_equal_file before every read, 128-byte header, decode-failed rows), T-02-1202 (read-only junction, fixed destination with refuse_reparse_points, git status on public/l2), T-02-1203 (encoded-run test), T-02-1204 (lock and catalog SHA pins, EVIDENCE command) and T-02-1205 (hash check before parse, 32 MiB bound) are each covered by a test or a check above.

## Needs human

Nothing new.

## Process cleanup

This plan started no dev server, preview, browser or Playwright run. The census, freeze, coverage, unittest, pipeline and Vitest runs exited on their own. After the last run, `ps -W` showed no python, vitest, Playwright or browser process started on 2026-11-09 (only processes from 2026-10-29 to 2026-11-07 and the per-command hook node), and `netstat -ano` showed no listener on 5173 or 5175. The PowerShell `Get-CimInstance` listing is refused by this session's worktree guard, so the check used `ps -W` start times; nothing was stopped because nothing remained.

## Self-check: PASSED

- Created files exist: the three `scripts/world/` modules, both tests, the census, the oracle and the world reason list.
- Commits 6c6750a, 9d3e077, 0a3b588 and 7ee97ad are ancestors of HEAD.
