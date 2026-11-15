---
phase: 02-stage-a-breadth
plan: 54
subsystem: world
tags: [world, tile-census, reader-licensees, lobby, batch, static-mesh, WORLD-01, WORLD-03]
status: complete
requires:
  - phase: 02-47
    provides: eligible tile batch, step registry, per-step gap row files, tiles load sweep
  - phase: 02-50
    provides: minimap step in the tile step registry
  - phase: 02-52
    provides: reviewed_reader_pairs and reader_gap_reason in scripts/world/reader_licensee_layouts.py
  - phase: 02-53
    provides: REVIEWED_VERSIONS, static_material_layout_unreviewed_reason and the committed .usx package census
provides:
  - tile census gates from reviewed_reader_pairs (map gate = raw-map, map-actor and terrain-info; height gate = g16-heightmap) with reviewedReaderPairs recorded in the census
  - non-tile census maps eligible on the map gate alone, raw step only, keys map:<name> and units map__<name>
  - meshes fingerprint with staticMaterialReviewState
  - batch settle rule for an unsealed step-level gap
affects: [02-55, WORLD-01, WORLD-03, integration-restage]
key-files:
  created:
    - tests/pipeline/tile_census_fixture.py
    - tests/pipeline/test_world_static_mesh_review_state.py
  modified:
    - scripts/world/tile_census.py
    - scripts/world/tile_census_validation.py
    - scripts/world/raw_map_step.py
    - scripts/world/convert_tile.py
    - scripts/world/eligible_tile_selection.py
    - scripts/world/convert_tile_batch.py
    - scripts/world/static_mesh_step.py
    - docs/parts/world/tile-census.json
    - tests/pipeline/test_tile_census.py
    - tests/pipeline/test_world_raw_step.py
    - tests/pipeline/test_convert_tile_batch.py
    - docs/parts/world/EVIDENCE.md
    - STATUS.md
    - .planning/OVERNIGHT-DECISIONS.md
    - .planning/STATE.md
key-decisions:
  - "Census gates ask reviewed_reader_pairs: map gate = intersection of raw-map, map-actor and terrain-info; height gate (declared or by name) = g16-heightmap; reasons from reader_gap_reason (row 752)"
  - "A non-tile map whose map gate passes is eligible with terrainHeightGate not-applicable and runs only the raw step; landed with Task 1 because the regenerated census raised on Lobby (row 753)"
  - "Census schemaVersion stays 1 with the new required reviewedReaderPairs field (row 754)"
  - "The batch settles a tile whose first unsealed step holds a gap row, as for a failed row (row 755)"
  - "The census does not ask the 123/28-only level model reader; bsp gaps stay visible per step (row 756)"
  - "staticMaterialReviewState reads version and licensee from the committed .usx census, so sealed_static_meshes needs no client; every sealed meshes unit re-ran once (row 757)"
  - "The 11 tiles sealed by 02-47 re-ran through convert_tile.py because the batch treats any seal as sealed (row 758)"
  - "WORLD-01 and WORLD-03 stay Pending (row 761)"
requirements-completed: []
estimate:
  tokens: 80000
  tasks: 3
actuals:
  tokens: 55000
  tasks: 3
  commits: 5
plan_head_before: 62f684ebf4896c8c230f191c2dffca723fce23ee
plan_head_after: 5f5ebd5
metrics:
  duration: 191min
  started: 2026-11-11T02:51:00+02:00
  completed: 2026-11-11T06:02:00+02:00
---

# Phase 2 Plan 54: Census from the reviewed readers, Lobby and the new tiles Summary

**The tile census now gates on `reviewed_reader_pairs`. That moved 110 rows from gap to eligible: 149 of 163 are eligible now, against 39 before. Lobby (map 123/30) is eligible, and its raw step is sealed. Batch slices converted 11 more tiles through every step, for 22 in total, and all 22 pass the tiles load check. 41 newly eligible tiles stop at the level model reader, which reviews only 123/28: they get a `bsp` gap, a failed collision step and a failed load check. 6 tiles fail at terrain and 79 are still `batch-pending`. The meshes fingerprint now carries the static material review state, and no meshes gap is left for a reviewed version.**

## Task results

| Task | Result | Commits |
| --- | --- | --- |
| 1 Census gates from the reviewed pairs, one tile converted and load-checked (tracer) | gates and validation follow `reviewed_reader_pairs`; census regenerated (SHA-256 `1301d7f3...`, byte-identical on rerun); 15_20 converted by `--limit 1`; its load check `failed` (`pins no native-tile-collision resource`) | 0b15b2c, 704a71e |
| 2 Lobby and the other non-tile maps | `run_raw_map_step` takes a tile id or a census non-tile name; `convert_tile.py` refuses any step but raw for a non-tile name; Lobby raw sealed | a06d19e |
| 3 Meshes re-run, slices, evidence, cleanup | `staticMaterialReviewState` in the meshes fingerprint; 14 batch slices; 11 sealed tiles re-run; sweep of 62 tiles; evidence, STATUS, rows 752 to 761 | 316aa35, 5f5ebd5 |

Tracer gate: Task 1 `<verify>` passed end to end before expansion (census tests OK; the census check printed 149). Tracer verified end-to-end, expanding.

## Census (WORLD-03)

- Eligible went from 39 to 149 (148 tiles and Lobby). No row went from eligible to gap.
- The per-pair unlock lists are in `docs/parts/world/EVIDENCE.md` under "Tile census and batch". Counts per pair:
  - T 25: 13
  - T 23: 8
  - map 23 + T 12: 15
  - map 23 + T 23: 13
  - map 25 + T 25: 10
  - map 30: 8, plus Lobby
  - the rest are listed in that section
- 14 gaps remain:
  - the 8 version 118 non-tile maps
  - `entry` (`map-licensee-unsupported:123/0`)
  - 24_10 and 25_10 (`map-licensee-unsupported:123/16`, TerrainInfo 16 refused)
  - 17_23 (`terrain-height-version-unsupported:118`)
  - 19_11 and 20_11 (`terrain-height-package-missing`)
- Lobby: the census row is `eligible`, map gate `pass`, terrain gate `not-applicable`, reason null. `convert_tile.py --map Lobby --step raw` sealed `work/map__Lobby/raw`. It holds 1,843 exports, 793 actors, 199 StaticMeshActors and 93 unique meshes. The step row is `gap` `object-gaps:2`:
  - `terrain-height-licensee-unsupported:123/0` on `Lobby.TerrainInfo0`
  - one unresolved `L2_Lobby_Classic.Rewindmill_Grass_04a`

## Batch and load check (WORLD-01)

- The run was on 2026-11-11 on DATABASE-PC. No machine window was hit, and free disk stayed between 105 and 113 GB.
  - One `--limit 1` slice and 14 `--limit 4` slices ran from 03:11 to 04:52 Riga, all with exit 0. Together they attempted 57 tiles, 15_20 to 20_19.
  - The 11 tiles from 02-47 then ran every step through `convert_tile.py`.
- Every step file holds one row per eligible tile: 148 rows per file, and raw holds 149 with Lobby.
- Results by tile:
  - Converted through every step (22): 16_11, 16_12, 16_24, 17_10, 17_11, 17_12, 18_10, 18_11, 18_12, 18_17, 18_20, 18_22, 18_24, 19_10, 19_14, 19_16, 19_17, 19_22, 20_10, 20_14, 20_20, 20_21. Of these, 16_11, 16_12, 16_24, 17_10, 17_11, 18_24, 19_14, 19_17, 19_22, 20_10 and 20_14 are new in this run.
  - Stopped at the level model reader (41, map licensees 18, 23, 25 and 30): the `bsp` step gaps, collision fails, and the later steps read `upstream-step-failed:collision`. The tiles are listed in the evidence table.
  - Terrain failed (6): 16_25, plus 18_23, 19_23, 19_24, 20_16 and 20_17 with `Non-XY/rotated layer requires a separately verified UV adapter`.
  - Pending (79): 20_22 onward.
- Lane catalog and coverage: world lane catalog `0f5a15ca...` holds 62 tile records. 18_15 has a manifest gap, `player-start-missing`. Coverage for world: 62 of 163 converted, 22 gap, 79 pending.
- Tiles load sweep:
  - Tracer slice: `LOAD_CHECK_LIMIT=1` on catalog `45f5e12d...` recorded 15_20 `failed`.
  - Full slice: `LOAD_CHECK_LIMIT=62` on `0f5a15ca...` passed as a test (1 passed, 10.5 min). It recorded 22 `pass` (the 22 converted tiles) and 40 `failed` with `Native tile <id> pins no native-tile-collision resource`. Port 5173 was free before both runs.
  - These are headless SwiftShader runs, so they make no FPS claim.
- Meshes re-run:
  - No meshes product and no `gap-rows/meshes.json` row holds `static-material-layout-unreviewed` for a version in `REVIEWED_VERSIONS`.
  - 20_21 has 194 models, 2,923 placements and 282 gaps (279 duplicate leaf name, 3 single payload).
- Resume command: `node scripts/check-machine-schedule.mjs && python -B scripts/world/convert_tile_batch.py --eligible --limit 4`.

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_tile_census.py"`: 39 tests OK. The census check printed 149.
- `test_world_raw_step.py`, `test_convert_tile_batch.py`, `test_world_static_mesh_step.py` (22 tests) and `test_world_static_mesh_review_state.py` (6 tests) are all OK.
- `pnpm test:pipeline` at BelowNormal: 1,866 tests OK, 56 skipped, exit 0. It ran after the slices and the sweep.
- `pnpm vitest run tests/unit/laneOwnership.test.ts`: 36 passed. The world EVIDENCE file is 29,084 bytes.
- `node scripts/check-lane-ownership.mjs --base "$(cat artifacts/plan-starts/02-54.sha)" --part world` reports `lane world: 0 foreign paths`, exit 0.
- Acceptance checks:
  - The licensee-28 grep on `tile_census.py` prints 0.
  - `reviewed_reader_pairs(` appears 4 times in `tile_census.py`: 2 calls, plus the helper that holds the name.
  - `staticMaterialReviewState` appears in `static_mesh_step.py`.
  - `convert_tile.py --map ../maps/20_21 --step raw` exits 1 and names `'../maps/20_21'`.
  - `--map Lobby --step chunks` exits 2 and names the step.
- Reference overlap: no DEC-OWN-12 area covers `scripts/world/**` Python, so there are no runs to report.
- Every `check-machine-schedule` call printed `activeWindow: null`.
- No `assets:*`, `world:stage`, `stage_*`, `derive-*`, `migrate-*` or preview script ran, and `public/l2` was not written.
- The self-contained repo name check (DEC-OWN-11) is empty for everything this plan wrote.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Non-tile eligibility moved into Task 1**
- Found during: Task 1. With map 123/30 reviewed, the regenerated census raised on Lobby, because a non-tile map that passed the map gate stopped the census.
- Fix: a non-tile map that passes the map gate is eligible with `not-applicable`, and validation checks this rule. It landed in commit 0b15b2c (row 753). Task 2 added the raw step for these maps.

**2. [Rule 1 - Bug] A bsp gap kept a tile in every slice**
- Found during: Task 1. 15_20 recorded a `bsp` gap without a seal. `tile_has_work` treated it as work, so the tile would have taken a `--limit` slot on every slice.
- Fix: a tile whose first unsealed step holds a recorded `gap` row is now settled, the same way a `failed` row already settles a tile. Commit 704a71e has a test (row 755).

**3. [Rule 2 - Correctness] The census validation follows the recorded pairs**
- `tile_census_validation.py` is not in the plan's file list. It held the 123/28 literals, so it needed the change too.
- It now checks both gates against `reviewedReaderPairs`. The `SUPPORTED_PACKAGE_*` constants are deleted.

**4. [Rule 3 - Blocking] The seal-derived row is read by unit key**
- `seal_derived_step_row` in `eligible_tile_selection.py` assumed `tile:` keys. It now reads the ledger by unit key, so `map:Lobby` follows the tile rule.

**5. [Rule 3 - Blocking] The fingerprint reads the committed .usx census**
- `sealed_static_meshes` runs in steps that have no client, so the meshes fingerprint cannot read package headers there.
- Version and licensee now come from `docs/parts/adapter-dispatch/static-mesh-package-census.json`, which is validated and hash-matched to the lock (row 757).

**6. [Rule 3 - Blocking] The 11 earlier tiles re-ran outside the batch**
- The batch counts any receipt as sealed, so it skipped the stale meshes seals of the 11 tiles from 02-47.
- `convert_tile.py` ran every step on those tiles (row 758). The batch rule itself is left as an open follow-up.

**7. Test file splits.** `tests/pipeline/tile_census_fixture.py` and `tests/pipeline/test_world_static_mesh_review_state.py` are new, because `test_tile_census.py` and `test_world_static_mesh_step.py` were at or over 400 lines (row 759). The review state cases run in `pnpm test:pipeline`, not in the plan's single-file pattern.

**8. Step rows file.** Rows live in the per-step files of `gap-rows/`, not in `tile-steps.json` (02-47 row 681; row 760).

**9. Gap reason text.** `package_gate_reason` now calls `static_material_layout_unreviewed_reason`, which closes the 02-53 follow-up.

## Decisions logged

`.planning/OVERNIGHT-DECISIONS.md` rows 752 to 761.

## Requirements

- WORLD-01: Pending. 22 of 153 tiles are converted through every step. 41 are held by the level model reader, 6 fail at terrain and 79 are pending.
- WORLD-03: Pending.
  - Done: the census follows the readers, all 10 non-tile maps are classified, and Lobby's status is known: eligible, raw sealed.
  - Open: 79 tiles still hold `batch-pending` rows.

## Needs Human

- The world lane restage command against catalog `0f5a15ca585ae0b5979363d092244f9f46e72cdcb1dbb475602d2cd75a712be9` (62 tile records). This line is added to `.planning/STATE.md`.

## Open follow-ups

These are in `.planning/STATE.md`:
- Grow the level model reader licensees through `reader_licensee_layouts.py`. This would unblock 41 tiles.
- Fix the terrain layer reader for 16_25 and the 5 `Non-XY/rotated layer` tiles.
- Let the batch compare real step fingerprints so it re-runs stale seals.
- Continue the 79 pending tiles with the resume command.

## Known Stubs

None.

## Process cleanup

- Started by this plan:
  - 15 batch slices
  - 157 `convert_tile.py` runs (11 tiles x 14 steps, Lobby raw, two refusal checks)
  - two Playwright tiles sweeps, each with its own `pnpm dev` server on 5173
  - one `pnpm test:pipeline`
  - the targeted unittest and vitest runs
  - the census and catalog writers
  - the wait loops
- All of them exited.
- Check at 06:01 Riga: `Get-CimInstance Win32_Process` filtered on `*autonomous-roadmap*` returns no process, and nothing listens on 5173 or 5175.
- Scratch scripts and logs live in `C:/laragon/l2b-orchestration/autonomous-roadmap/scratch-02-54/`, outside the repository.

## Self-Check: PASSED

- FOUND: scripts/world/tile_census.py, tests/pipeline/tile_census_fixture.py, tests/pipeline/test_world_static_mesh_review_state.py, this SUMMARY
- FOUND commits on HEAD: 0b15b2c, 704a71e, a06d19e, 316aa35, 5f5ebd5
