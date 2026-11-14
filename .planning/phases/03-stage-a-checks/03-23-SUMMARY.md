---
phase: 03-stage-a-checks
plan: 23
subsystem: world
tags: [world, minimap, schema, gap-closure, no-legacy]
status: complete
gap_closure: true
requires:
  - phase: 03-stage-a-checks
    provides: "03-22: no view reads the per-tile radarTexture or projection fields"
provides:
  - "native-tile-minimap schema 3 (minimap step version 3) with no radarTexture and no projection field"
  - "Browser parser that accepts schema 3 only and refuses any field outside it"
  - "Tracer tile 20_21 resealed in the world lane store on schema 3"
affects: [03-24, 03-16, 03-20]
tech-stack:
  added: []
  patterns: ["schema bump plus step algorithm version bump, so a sealed older unit is never reused"]
key-files:
  created: []
  modified:
    - scripts/world/minimap_step.py
    - src/scene/world/minimapJoin.ts
    - tests/pipeline/test_minimap_step.py
    - tests/unit/minimapJoin.test.ts
    - tests/unit/support/tileMinimapFixtures.ts
  deleted:
    - tests/browser/support/syntheticMinimapTiles.ts
    - tests/fixtures/tileMinimapManifestFixture.ts
decisions:
  - "03-23: the minimap step algorithm version goes from 2 to 3 with the schema, so every schema 2 unit reads as not current and re-runs in 03-24"
  - "03-23: minimapTexturePosition, the projection parser and the without-a-projection gap rule are deleted with the fields; a tile minimap may now list no gaps"
  - "03-23: tests/fixtures/tileMinimapManifestFixture.ts is deleted and its one live use is inlined into tests/unit/support/tileMinimapFixtures.ts"
  - "03-23: GP7 wins over the fix-the-doc rule for EVIDENCE.md; the stale minimap and ui EVIDENCE lines are listed for the lane evidence plans"
metrics:
  duration: 8min
  completed: 2026-11-14
estimate:
  tokens: 50000
  tasks: 2
actuals:
  tokens: 8500
  tasks: 2
  commits: 1
plan_head_before: fbd9f7c6f0ac536bf14d9bc293a304ff791c646e
plan_head_after: 30a475a70aaeabacbba96c2a1f823448506e674e
requirements: [WORLD-06]
---

# Phase 3 Plan 23: Tile minimap schema 3 Summary

The tile minimap is now schema 3, with no per-tile `radarTexture` and no `projection` field. The converter writes it, the browser parser accepts only schema 3 and refuses any other field, and tile 20_21 holds it in the world lane store. The synthetic radar fixtures and the projection code that only tests read are deleted.

## What changed

- **Converter (`scripts/world/minimap_step.py`).** `NATIVE_TILE_MINIMAP_SCHEMA_VERSION` goes to 3 and `MINIMAP_STEP_ALGORITHM_VERSION` to 3. The manifest drops `radarTexture` and `projection`. `scripts/world/**` is not among the converter sources, so only minimap units and the tile manifests that pin them reseal.
- **Join and census.** `minimap_join.py` and `minimap_join_census.py` already wrote no radar-texture, zone-grid or projection gap, because 02-97 removed them. The committed census `docs/parts/minimap/minimap-join-census.json` has 0 rows with those reasons, and `test_minimap_join.py` already refuses the deleted reason suffixes. Neither file needed a change.
- **Parser (`src/scene/world/minimapJoin.ts`).** Schema 3 only, with the exact field list `kind, schemaVersion, tileId, sourceInputs, route, zoneKeyTexture, huntingZones, gaps, labels`. Deleted: `NativeTileMinimapRadarTexture`, `NativeTileMinimapProjection`, `NativeTileMinimapTexturePosition`, `parseRadarTexture`, `parseProjection`, `minimapTexturePosition` (only tests used it), the without-a-projection gap rule and the `sourceFrame` import. The archive checks now live in `parseZoneKeyTexture`, their only caller.
- **Fixtures.** `tests/browser/support/syntheticMinimapTiles.ts` is deleted (no consumer since 03-22). `tests/fixtures/tileMinimapManifestFixture.ts` is deleted too. Its only live use, `syntheticTileMinimapManifest(tileId, null)` in `tests/unit/support/tileMinimapFixtures.ts`, is now built inline at schema 3. No file under `src` or `tests` names the tile `radarTexture` field. The remaining `radarTextureMap` names are the NewRadarWnd.texMap binding from 03-22, which is not a tile field.

## Tracer tile

- `node scripts/check-machine-schedule.mjs` (DATABASE-PC, no window), then at BelowNormal `convert_tile.py --client E:/Lineage2-client --map 20_21 --step minimap`. Result: gap `minimap-join-unresolved:radar-anchor` (the route gap, as before), with receipt algorithm version 3.
- New tile minimap manifest `l2/maps/c6984cc0c9e56213252d053c7ea1a4780e7b6179ef65d0c686647dc525d49508/native-tile-minimap/manifest.json` (2702 bytes). It is schema 3 with exactly the nine schema 3 fields, and its gaps are `zone-title-source` and `radar-anchor`. The zone key texture archive is `18df7637241c78be9f95562cb8e86149fd340a2d0c04d6e4af99064760ae0f0e`.
- Then `--step manifest` for 20_21: pass. The new tile manifest SHA-256 is **`9b9db45074997f52ca813c99d1c023a2364930e2afb5d2c041ddeb1faaff3112`** (`l2/tiles/9b9db450.../tile.json`). It pins the schema 3 minimap `c6984cc0...`. The manifest step receipt is algorithm version 12.
- The lane catalog was not rewritten. 03-24 runs `write_lane_catalog.py` once its tile batch ends.

## Tiles left for the 03-24 batch

The world lane holds 146 minimap units: 1 at step version 3 (20_21) and 145 at version 2. The parser refuses those 145 schema 2 tile minimaps until 03-24 re-runs them (T-03-47, accepted):

15_20 15_21 15_22 15_23 15_24 15_25 15_26 16_10 16_11 16_12 16_19 16_20 16_21 16_22 16_23 16_24 16_25 16_26 17_10 17_11 17_12 17_18 17_19 17_20 17_21 17_22 17_24 17_25 17_26 18_10 18_11 18_12 18_13 18_14 18_15 18_17 18_18 18_19 18_20 18_21 18_22 18_23 18_24 18_25 18_26 19_10 19_13 19_14 19_15 19_16 19_17 19_18 19_19 19_20 19_21 19_22 19_23 19_24 19_25 20_10 20_13 20_14 20_15 20_16 20_17 20_18 20_19 20_20 20_22 20_23 20_24 20_25 21_13 21_14 21_15 21_16 21_17 21_18 21_19 21_20 21_21 21_22 21_23 21_24 21_25 22_13 22_14 22_15 22_16 22_17 22_18 22_19 22_20 22_21 22_22 22_24 22_25 22_26 23_10 23_11 23_12 23_13 23_14 23_15 23_16 23_17 23_18 23_19 23_20 23_21 23_22 23_23 23_24 23_25 23_26 24_11 24_12 24_13 24_14 24_15 24_16 24_17 24_19 24_20 24_21 24_22 24_23 24_24 24_25 24_26 25_11 25_12 25_14 25_15 25_16 25_17 25_18 25_19 25_20 25_21 26_11 26_12 26_14 26_15 26_16

## Task commits

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Tracer: schema 3 from the converter through the parser on one tile | 30a475a | minimap_step.py, minimapJoin.ts, test_minimap_step.py, minimapJoin.test.ts, tileMinimapFixtures.ts; 2 fixture files deleted |
| 2 | Ownership check, open follow-up and cleanup | none (SUMMARY only) | - |

## TDD gate compliance

- RED: the new cases failed against the schema 2 code (pipeline 1 failure: schema 2 written; Vitest 4 of 5 failed: the parser refused schema 3).
- GREEN: `python -B -m unittest discover -s tests/pipeline -p "test_minimap_*.py"` ran 48 tests, all OK. `pnpm vitest run tests/unit/minimapJoin.test.ts` passed 5 tests. `test ! -e tests/browser/support/syntheticMinimapTiles.ts` holds.
- The tracer gate was re-run after the tile reseal and passed, so the plan went on to task 2.

## Checks

- Task 1 gate: passes (see above).
- `pnpm vitest run` on minimapJoin, minimapControl, nativeWindowRenderer, radarZoneName and worldMapPieces: 5 files, 44 tests passed. `pnpm typecheck` is clean.
- `tests/pipeline/test_converter_implementation_hash.py` passes. `print_fingerprint_inputs.py` output is byte-identical before the first edit and after the tracer run (`implementation_hash` is `c4bf8e6c...2bd8`).
- Task 2 gate: `node scripts/check-lane-ownership.mjs --base fbd9f7c --part minimap` printed lane world, 0 foreign paths, exit 0. The port check found no listener on 5173 or 5175.
- Reference overlap: `tools/reference-overlap` has no minimap or world area, so it was not run.
- Browser: no Playwright run. The change is a schema and parser change with no UI difference. The world lane store holds 145 schema 2 tiles that the parser refuses until 03-24, so `world-minimap.spec.ts` on the world lane stays for 03-24 to run after its batch.

## Deviations from plan

### Auto-fixed issues

1. **[Rule 2 - Correctness] The step algorithm version moves with the schema.** Found during task 1. The receipt check compares only the algorithm version, config and inputs, and `scripts/world/**` is not in `implementation_hash`. Without the bump, a re-run would have reused the sealed schema 2 product. The version is now 3, and the test checks the receipt version. Commit 30a475a.
2. **[No legacy] Two more deletions.** `tests/fixtures/tileMinimapManifestFixture.ts` and the projection code in `minimapJoin.ts` (`minimapTexturePosition` and its types) had no view caller after 03-22, so they are deleted here. 03-22's "Left for 03-23" names them. Commit 30a475a.
3. **[Rule 3 - Blocking] Task 2 gate base.** `check-lane-ownership.mjs` refuses `--base HEAD~1` (its ref pattern has no `~`). The check ran with the resolved SHA `fbd9f7c`, which is both HEAD~1 at that point and the plan start.
4. **Join and census not edited.** Neither had a radar-texture gap left to remove (see "What changed").

**Total deviations:** 3 auto-fixed plus 1 no-op file pair. **Impact:** none on scope.

## Open follow-ups

- **Stale EVIDENCE lines.** These docs still describe schema 2 or the deleted fixture: `docs/parts/minimap/EVIDENCE.md` lines 9, 13 and 19, and `docs/parts/ui/EVIDENCE.md` line 57. GP7 keeps EVIDENCE edits out of gap plans, so the lane evidence plans (03-16, 03-19, 03-20) restate them.
- **Re-run of the other tiles.** 03-24 re-runs the 145 tiles above in its tile batch, then the manifest step and `write_lane_catalog.py`. Until then, the world lane catalog still pins the old 20_21 tile manifest.

## Open questions (for the orchestrator)

- None. The plan uses no native fact.

## Decision rows for pending-decision-rows.md

This executor works only inside the worktree, so the orchestrator appends these rows (next P numbers) from the key decisions:
- 03-23: the minimap step algorithm version goes to 3 with schema 3, so no sealed schema 2 unit is reused.
- 03-23: the projection code and the without-a-projection gap rule are deleted with the fields, so a tile minimap may list no gaps.
- 03-23: GP7 wins over the fix-the-doc rule for EVIDENCE.md. The stale lines are listed under open follow-ups.

## Known stubs

None.

## Process cleanup

The plan started only foreground Python runs (`convert_tile.py`, unittest, the fingerprint print) and Vitest runs, and all of them exited. No dev server or browser was started. `netstat` shows no listener on 5173 or 5175. `Get-CimInstance Win32_Process` shows no process other than this executor's own shells with `autonomous-roadmap` in its command line.

## Self-Check: PASSED

- `tests/browser/support/syntheticMinimapTiles.ts` and `tests/fixtures/tileMinimapManifestFixture.ts` are absent. The modified files exist.
- Commit 30a475a is on `plan/autonomous-roadmap`. `git rev-list --count fbd9f7c..HEAD` is 1 before this SUMMARY.
- The tracer tile manifest `artifacts/lane-store/world/l2/tiles/9b9db450.../tile.json` and the schema 3 minimap `c6984cc0...` exist in the world lane store.
