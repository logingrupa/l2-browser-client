---
phase: 02-stage-a-breadth
plan: 13
subsystem: world
tags: [world-03, world-01, tile-census, terrain-info, a11]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-12 tile census (read_package_header, map_reader_gate, by-name terrain gate, census gap rows), recipes/world/gap-reasons.json"
provides:
  - "scripts/world/tile_census.py: declared_terrain_map_package, terrain_height_gate_from_declared_package, terrain_height_gate_of_readable_tile, terrain_map_package_record, TileCensusError"
  - "docs/parts/world/tile-census.json: terrainMapPackage {basis, object, path, packageVersion, licensee} on every tile row, null on non-tile rows"
  - "docs/parts/world/EVIDENCE.md: Tile census section with the A11 verdict"
affects: [02-14, 02-15, 02-16, 02-47, 02-52]

actuals:
  tokens: 30000
  tasks: 2
  commits: 2
plan_head_before: ecd8bd26ba7fb3e736e9b4c04d279fc66de2c849
plan_head_after: da65057c3811c8949dc322599f20b7d8b1f68f0c

tech-stack:
  added: []
  patterns:
    - "A census gate records its basis next to its result, so a source-declared gate and a by-name gate are never confused"
    - "Synthetic UE 123/28 map packages with a TerrainInfo export built in the test from material_graph_fixture table helpers, no client bytes"

key-files:
  created: []
  modified:
    - scripts/world/tile_census.py
    - tests/pipeline/test_tile_census.py
    - docs/parts/world/tile-census.json
    - docs/parts/world/EVIDENCE.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "terrainMapPackage is an object with a basis field (TerrainInfo.TerrainMap or package-name), null on non-tile rows (row 304)"
  - "Map-gate-fail tiles keep the by-name terrain gate until their map reader exists, 02-52 (row 305)"
  - "The regenerated census is committed with the code in Task 1 so no commit holds a census its validator refuses (row 306)"
  - "WORLD-03 and WORLD-01 stay Pending (row 307)"

requirements-completed: []

duration: 17min
completed: 2026-11-09
---

# Phase 2 Plan 13: Declared TerrainMap package per tile summary

**Every map-readable licensee-28 tile now takes its terrain-height gate from the `TerrainMap` of its single `Engine.TerrainInfo` export, read through the lock guard, and every tile row says which basis its gate came from. A11 is settled: none of the 67 tiles declares a package other than its own `T_XX_YY`, and the eligible set stays the same 39 tiles.**

## Performance

- Duration: about 17 min (2026-11-09 03:36 to 03:53 Riga)
- Tasks: 2 of 2
- Files: 0 created, 6 modified

## Accomplishments

- `declared_terrain_map_package(client_access, lock_records, map_relative_path)` reads the map through `require_equal_file`, builds `native_catalog.ue2.Package`, selects `Engine.TerrainInfo` exports, decodes the one `TerrainMap` tag with `actor_properties`, `decode_property` and `property_value` from `native_map`, and resolves the package stem casefolded against the lock's `.utx` paths. Zero TerrainInfo, no TerrainMap or a null reference gives `None`; two or more TerrainInfo exports raise `TileCensusError` naming the map and the exports.
- `terrain_height_gate_from_declared_package(client_access, declaration)` reads the declared package header through the guard: 123/28 passes, another licensee is `terrain-height-licensee-unsupported:123/<licensee>`, another version is `terrain-height-version-unsupported:<version>` (listed by 02-12), and an unresolved package is `terrain-height-package-missing`.
- A map-gate-pass map whose package tables do not decode becomes a `decode-failed:<error>` gap row instead of stopping the census (threat T-02-1301). None occurs in the client.
- `validate_tile_census` now needs `terrainMapPackage` with exactly `{basis, object, path, packageVersion, licensee}` on every tile row, basis `TerrainInfo.TerrainMap` on map-gate-pass rows and `package-name` on map-gate-fail rows, a gate of `pass` only for a resolved 123/28 package, and null on non-tile rows.
- Census run: `python -B scripts/world/tile_census.py --client E:/Lineage2-client`, about 17 s at BelowNormal (the 67 licensee-28 maps are read whole, about 1 GB hashed by the guard and `Package`).

## Tracer (Task 1)

`maps/20_21.unr` through `require_reference_client('E:/Lineage2-client')`: declaration `{'object': 'T_20_21.Height.20_21', 'path': 'textures/T_20_21.utx'}`, gate `('pass', None, {basis TerrainInfo.TerrainMap, object T_20_21.Height.20_21, path textures/T_20_21.utx, packageVersion 123, licensee 28})`. This matches research's probe. The plan's verify one-liner passed the `ReferenceClientLock` object as `lock_records`; the function takes the `records_by_path` mapping like the rest of the module, so the tracer passed `.records_by_path`.

## A11 verdict and the census beside the research cross-check

| Figure | Measured (02-13 census) | By name (02-12) | Research | Finding |
| --- | --- | --- | --- | --- |
| Licensee-28 map-gate-pass tiles | 67, all with basis `TerrainInfo.TerrainMap` | 67 | 67 | match |
| Tiles declaring a package other than `textures/T_XX_YY.utx` | 0 | not measured | A11 assumed 0 | A11 holds |
| Eligible tiles | 39 | 39, the same set | 39 (5.1) | no tile changed status, gate or reason |
| Failing licensee-28 tiles by declared licensee | 25: 13, 23: 8, 12: 2, 20, 22, 19: 1 each, package missing: 2 (19_11, 20_11) | the same | 11.6, the same | match |

Findings recorded in EVIDENCE: `19_11` and `20_11` declare `T_19_11.Height.19_11` and `T_20_11.Height.20_11`, packages absent from the lock; `21_16` declares `T_21_16.21_16` (no group); `21_25` declares `T_21_25.Height.21_17` (package `t_21_25.utx`, 123/12). Every map holds exactly one TerrainInfo, so the multiple-TerrainInfo stop never fired and no gap reason was added. Research values are printed only here and in EVIDENCE; the census holds measured values.

Acceptance one-liner: `67 67 39`. `grep -c "## Tile census" docs/parts/world/EVIDENCE.md` prints 1, the section contains A11, EVIDENCE is 27,126 bytes.

## World-lane coverage

`python -B scripts/native_store/build_coverage_report.py --store-root artifacts/lane-store/world/l2 --lane world` (no `--markdown`): world 163 rows, 124 gap, 39 pending, 0 converted. Every gap row's reason equals its census reason, including the 28 declared terrain reasons (123/25: 13, 123/23: 8, 123/12: 2, 123/19, 123/20, 123/22: 1 each, package missing: 2). `docs/coverage.md` is integration-owned and was not rewritten.

## Task commits

1. Task 1, tracer: `2485f2a` feat(02-13): gate map-readable tiles on their declared TerrainInfo.TerrainMap package
2. Task 2: `da65057` test(02-13): check the committed census gate basis and record the A11 verdict

Docs commit: this summary, STATUS.md world line, OVERNIGHT-DECISIONS rows 304 to 307, STATE.md and ROADMAP.md.

## Verification

- Tracer gate: Task 1's `<verify>` (schedule check, unittest, 20_21 call) passed before the full census ran.
- `python -B -m unittest discover -s tests/pipeline -p test_tile_census.py`: 33 OK (31 at the Task 1 commit). New cases: declared package resolves and passes, licensee 25 unsupported, casefolded stem, no TerrainInfo, no TerrainMap, null TerrainMap and an unlocked package are missing, two TerrainInfo exports stop the census naming the map, a declared package wins over the tile name, two tiles declaring `T_99_99` each record it, an undecodable map-gate-pass package is `decode-failed`, every gate records its basis, committed-census basis and 123/28 checks, and two validator refusals.
- `test_gap_rows.py`, `test_coverage_report.py` and `test_native_map.py` pass.
- Full pipeline suite at BelowNormal (`python -B scripts/test_pipeline.py` under `run_at_below_normal_priority`): 1382 OK, 104 skipped, exit 0.
- `node scripts/check-lane-ownership.mjs --base ecd8bd2 --part world`: "lane world: 0 foreign paths", exit 0.
- 0 comment lines in `tile_census.py` and `test_tile_census.py`; no en or em dash in the files written; the self-contained wording grep has nothing new.
- `pnpm test:e2e` was not run: this plan has no browser check.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] The regenerated census moved into the Task 1 commit**
- Found during: Task 1
- Issue: the stricter validator refuses the 02-12 census (null `terrainMapPackage`), so a Task 1 commit without the regenerated census would hold a committed file its own test rejects.
- Fix: the full census ran after the tracer passed and was committed with the code; Task 2 added the committed-census basis tests and EVIDENCE (row 306).
- Files: docs/parts/world/tile-census.json
- Commit: 2485f2a

**2. [Rule 2 - Missing critical] Undecodable map tables become a decode-failed gap row**
- Found during: Task 1
- Issue: the plan's action has `Package` and `actor_properties` raise on malformed bytes, which would stop the whole census; the threat register (T-02-1301) requires a `decode-failed` gap row.
- Fix: `terrain_height_gate_of_readable_tile` turns `FormatError` and `UnicodeError` into `decode-failed:<error>` with basis `TerrainInfo.TerrainMap`; tested.
- Commit: 2485f2a

**3. Test file at 407 lines**
- `tests/pipeline/test_tile_census.py` is slightly over the about-400-line guide after the synthetic map builder was added; it holds one concern (the tile census) and was not split.

## Needs Human

None.

## Known Stubs

None.

## Process cleanup

All commands ran in the foreground and returned. No dev server, Vite preview, Playwright or browser was started. After the last run: `netstat -ano` shows no listener on 5173 or 5175; `ps -W` shows one python.exe started on Nov 7, before this run, and no node, Vitest, Playwright or headless browser process. The planned `Get-CimInstance Win32_Process` command-line listing was refused by the session's worktree guard, so the check used `ps -W` and `netstat` instead. No process started by this plan remains.

## Self-Check: PASSED

- FOUND: scripts/world/tile_census.py, tests/pipeline/test_tile_census.py, docs/parts/world/tile-census.json, docs/parts/world/EVIDENCE.md
- FOUND: 2485f2a, da65057
