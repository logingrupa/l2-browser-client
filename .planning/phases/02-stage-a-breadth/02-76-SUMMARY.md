---
phase: 02-stage-a-breadth
plan: 76
subsystem: world-pipeline
tags: [python, bsp, level-model, reader-layouts, elbera-cross-check, world-lane]

requires:
  - phase: 02-stage-a-breadth
    provides: "02-52 shared reviewed reader layout table and cross-check rows; 02-55 bsp step with LevelModelLayoutError gap mapping"
provides:
  - "level-model reader in READER_LICENSEE_LAYOUTS (123/28 baseline, 123/23, 123/25, 123/30, 123/31 reviewed)"
  - "elbera_level_model_projection: pinned Elbera reading of the zoned UModel (object, node, surface, point, vertex, leaf counts and tail bytes)"
  - "level-model cross-check rows for all eight eligible map licensees, with refusalReason on refused pairs"
  - "level-model fixtures (export size, span sizes and SHA-256 values, counts, validate_model checks; no client bytes)"
  - "bsp unit config key levelModelLayout carrying the tile pair's reviewed level-model record"
  - "sealed tracer bsp units on 17_20, 15_20, 17_22 and 19_23"
affects: [02-88, world-collision, world-bsp, gap-SC1a]

actuals:
  tokens: 13641
  tasks: 2
  commits: 7
plan_head_before: e684cc7e3ac25cf4d7cece34d82ca06abdfd5281
plan_head_after: fe8bbfd

tech-stack:
  added: []
  patterns:
    - "A reader whose refused pairs still get a cross-check row: refusalReason names the failing check, equal stays false"
    - "Level-model cross-check tile is the map-actor cross-check tile of the licensee (MAP_ACTOR_CROSS_CHECK_TILES)"

key-files:
  created:
    - tests/pipeline/test_level_model_licensees.py
    - tests/fixtures/world-readers/level-model-123-28.json
    - tests/fixtures/world-readers/level-model-123-23.json
    - tests/fixtures/world-readers/level-model-123-25.json
    - tests/fixtures/world-readers/level-model-123-30.json
    - tests/fixtures/world-readers/level-model-123-31.json
  modified:
    - scripts/world/level_model.py
    - scripts/world/reader_licensee_layouts.py
    - scripts/world/elbera_reader_cross_check.py
    - scripts/world/reader_cross_check_rows.py
    - scripts/world/bsp_step.py
    - tests/fixtures/world-readers/cross-checks.json
    - tests/pipeline/test_world_bsp_step.py

key-decisions:
  - "Level-model licensees 23, 25, 30 and 31 are reviewed: the vendored reader consumes Level.Model to the export end, validate_model and the range checks pass, and the object name and node, surface, point, vertex, leaf and tail counts equal the pinned Elbera reading"
  - "Level-model licensees 18, 19 and 20 stay refused: the vendored level_model_binding reads the ULevel prefix only for LicenseeVersion 23 or later (ULevelBase::Serialize first actor array), recorded as the refusalReason of their cross-check rows; no offset was adjusted"
  - "The Elbera side identifies the level model structurally (its single zoned UModel) and our side through the serialized ULevel.Model reference, so the cross-check also proves both pick the same export"

patterns-established:
  - "Level-model reader record: fixture plus equal cross-check row plus Elbera and vendored-reader evidence, the vendored file hash checked by test"

requirements-completed: [WORLD-01, WORLD-08]

coverage:
  - id: D1
    description: "level_model.py is gated through require_reviewed_reader_layout('level-model'); 123/24 refused with map-licensee-unsupported:123/24, 123/28 accepted, version 118 refused with map-version-unsupported:118"
    requirement: WORLD-08
    verification:
      - kind: unit
        ref: "tests/pipeline/test_level_model_licensees.py#LevelModelReaderGateTests"
        status: pass
      - kind: unit
        ref: "tests/pipeline/test_world_bsp_step.py#test_a_package_outside_the_vendored_layout_is_a_gap_ready_refusal"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every reviewed level-model pair has evidence, a fixture and an equal Elbera cross-check row; a missing fixture or row is detected; every eligible map licensee has a verdict row; refused rows name the failing check"
    requirement: WORLD-08
    verification:
      - kind: unit
        ref: "tests/pipeline/test_level_model_licensees.py#LevelModelRecordTests"
        status: pass
      - kind: unit
        ref: "tests/pipeline/test_world_reader_licensees.py#LayoutEvidenceTests"
        status: pass
      - kind: integration
        ref: "tests/pipeline/test_world_reader_licensees.py#RealClientCrossCheckTests (all 44 rows reproduce on E:/Lineage2-client)"
        status: pass
      - kind: integration
        ref: "tests/pipeline/test_level_model_licensees.py#RealClientLevelModelFixtureTests"
        status: pass
    human_judgment: false
  - id: D3
    description: "The bsp unit config carries the reviewed level-model record of the tile pair, so adding a record changes the config of that licensee's tiles"
    requirement: WORLD-01
    verification:
      - kind: unit
        ref: "tests/pipeline/test_level_model_licensees.py#BspUnitConfigTests"
        status: pass
    human_judgment: false
  - id: D4
    description: "Tracer bsp units sealed for each adopted pair: 17_20 (123/23), 15_20 (123/25), 17_22 (123/30), 19_23 (123/31)"
    requirement: WORLD-01
    verification:
      - kind: other
        ref: "python -B scripts/world/convert_tile.py --client E:/Lineage2-client --map <tile> --step bsp (status gap, named object gaps, receipt config.levelModelLayout = the pair record)"
        status: pass
    human_judgment: false

duration: 16min
completed: 2026-11-11
status: complete
---

# Phase 2 Plan 76: Level model reader licensees Summary

**The BSP level model reader now goes through the shared reviewed reader layouts as reader `level-model`; licensees 23, 25, 30 and 31 are adopted with exact Elbera count cross-checks, fixtures and sealed tracer bsp units, and 18, 19 and 20 stay refused because the vendored ULevel binding needs licensee 23 or later.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-11-11T12:33:00Z
- **Completed:** 2026-11-11T12:49:07Z
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments

- `level_model.py` drops `REVIEWED_LEVEL_MODEL_VERSION` and `REVIEWED_LEVEL_MODEL_LICENSEE`; `read_level_model` calls `require_reviewed_reader_layout(LEVEL_MODEL_READER, ...)` through `reviewed_level_model_layout`, which keeps `LevelModelLayoutError` and the `map-version-unsupported` and `map-licensee-unsupported` reasons the bsp step maps. The ungated reading is `read_vendored_level_model`, used by the cross-check.
- `elbera_level_model_projection` reads the tile's zoned UModel through the pinned Elbera module and returns the qualified object name and node, surface, point, vertex and leaf counts plus tail bytes, or raises a recorded `ElberaCrossCheckError`.
- `reader_cross_check_rows.py --reader level-model --licensee N` writes the cross-check row (with `refusalReason`) for any eligible licensee and, when equal, the fixture `level-model-123-N.json`.
- The bsp unit config gains `levelModelLayout` (the tile pair's reviewed record or None), read from the sealed raw manifest's `nativePackage`.

## Verdicts

| Pair | Tile | Verdict | Level.Model | Nodes | Surfaces | Points | Vertices | Leaves | Tail bytes | Failing check |
|------|------|---------|-------------|-------|----------|--------|----------|--------|------------|---------------|
| 123/28 | 20_21 | reviewed (baseline) | 20_21.Model327 | 4493 | 1776 | 7554 | 88409 | 1532 | 8524458 | - |
| 123/23 | 17_20 | reviewed | 17_20.Model5 | 3487 | 1610 | 6155 | 70510 | 1394 | 2472396 | - |
| 123/25 | 15_20 | reviewed | 15_20.Model5 | 60 | 38 | 89 | 966 | 23 | 1338457 | - |
| 123/30 | 17_22 | reviewed | 17_22.Model400 | 2795 | 1069 | 4554 | 61316 | 841 | 2113668 | - |
| 123/18 | 17_18 | refused | - | Elbera 60 | 38 | 89 | 966 | 23 | 1338429 | vendored reader: 17_18.unr Level.Model: unsupported serialized Level layout (requires version123/licensee>=23) |
| 123/31 | 19_23 | reviewed | 19_23.Model5 | 2169 | 1077 | 2952 | 42353 | 559 | 1920381 | - |
| 123/20 | 24_26 | refused | - | Elbera 60 | 38 | 92 | 966 | 23 | 1338429 | vendored reader: 24_26.unr Level.Model: unsupported serialized Level layout (requires version123/licensee>=23) |
| 123/19 | 26_11 | refused | - | Elbera 60 | 38 | 89 | 966 | 23 | 1338429 | vendored reader: 26_11.unr Level.Model: unsupported serialized Level layout (requires version123/licensee>=23) |

Elbera reads all three refused tiles, so no pair rests on the exact-consumption check alone and no pending decision row was needed.

Tracer bsp units (all `gap` with named object gaps, receipt `config.levelModelLayout` equal to the pair record): 17_20 `object-gaps:4`, 15_20 `object-gaps:3`, 17_22 `object-gaps:3`, 19_23 `object-gaps:3`. The gaps are a `bsp-node-outside-chunk-grid` brush and the water shader materials (`decode-failed` and `material-class-unported:Engine.TexOscillatorTriggered`).

## Task Commits

1. **Task 1: Tracer - licensee 23 through the gate, the cross-check and a bsp run on 17_20** - `3ac2690`
2. **Task 2: The other eligible map licensees, one at a time** - `066e22e` (25), `2bb7480` (30), `4334e5e` (18 refused), `9138357` (31), `cc902d0` (20 refused), `fe8bbfd` (19 refused and the verdict-set test)

## Files Created/Modified

- `scripts/world/level_model.py` - gate through the shared layouts; `read_vendored_level_model` split from `read_level_model`
- `scripts/world/reader_licensee_layouts.py` - `level-model` reader, evidence (Elbera ue2package.py and the vendored BSP reader), `MAP_ACTOR_CROSS_CHECK_TILES`, `REVIEWED_LEVEL_MODEL_LICENSEES`, `reader_cross_check_tile`
- `scripts/world/elbera_reader_cross_check.py` - `level_model_projection`, `elbera_level_model_projection`
- `scripts/world/reader_cross_check_rows.py` - level-model decodes, refusal reasons, fixture builder and writer, CLI tile lookup
- `scripts/world/bsp_step.py` - `tile_level_model_layout`, `levelModelLayout` in the unit config
- `tests/pipeline/test_level_model_licensees.py` - gate, record, verdict, config, guard and real-client fixture tests
- `tests/pipeline/test_world_bsp_step.py` - the gate refusal example moves from 123/25 (now reviewed) to 123/24
- `tests/fixtures/world-readers/cross-checks.json`, `level-model-123-{28,23,25,30,31}.json` - rows and fixtures

## Decisions Made

- The level-model cross-check tile of a licensee is its map-actor cross-check tile, so refused pairs get a row without a record.
- The cross-check compares the object name, node, surface, point, vertex and leaf counts and the undecoded tail size, which is stricter than the four counts the plan names.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Re-ran the 20_20 bsp unit so the oracle brush subset test keeps executing**
- **Found during:** plan verification
- **Issue:** the new `levelModelLayout` config key makes all 22 sealed 123/28 bsp units stale (intended; 02-88 re-runs them), which turned `test_the_generic_20_20_step_holds_the_brush397_and_brush610_nodes_at_their_native_positions` from a pass into a skip.
- **Fix:** ran `convert_tile.py --map 20_20 --step bsp` (lane store only); the test runs and passes again.
- **Files modified:** none in git (world lane store)
- **Verification:** `python -B -m unittest discover -s tests/pipeline -p "test_world_bsp_step.py" -v` shows the 20_20 test ok

**2. [Rule 3 - Blocking] Updated the existing bsp gate test example from 123/25 to 123/24**
- **Found during:** Task 1
- **Issue:** `test_a_package_outside_the_vendored_layout_is_a_gap_ready_refusal` used 123/25, which this plan adopts.
- **Fix:** the refusal example is 123/24, as the plan behavior names.
- **Committed in:** `3ac2690`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking). **Impact:** no scope change.

## Issues Encountered

- The other 21 sealed 123/28 bsp units, and the bsp-visibility, collision, lighting and manifest units built on them, are stale until the 02-88 batch re-runs them; this is the staleness the plan asks for.
- Reference overlap: no overlap area covers `scripts/world` Python (areas are materials, bsp-visibility, movement, particles, network), so there is no report for this plan's code.

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_level_model_licensees.py" -v` - 13 tests OK (real-client fixture test ran)
- `python -B -m unittest discover -s tests/pipeline -p "test_world_reader_licensees.py"` - 24 tests OK (real-client row reproduction ran)
- `python -B -m unittest discover -s tests/pipeline -p "test_world_bsp_step.py"` - 20 tests OK, 20_20 oracle test ran
- Neighbour suites OK: test_world_bsp_reader_binding, test_world_bsp_visibility_step, test_tile_census, test_level_zones, test_tile_manifest_step, test_convert_tile_batch, test_gap_census
- `node scripts/check-lane-ownership.mjs --base e684cc7 --part world` - lane world: 0 foreign paths
- The self-contained repo name check (DEC-OWN-11) is empty for everything written here.

## Process cleanup

All runs were foreground Python and Node commands that exited. No python, node or browser process with this worktree path in its command line remains, and nothing listens on 5173 or 5175. No dev server, Playwright or Vitest run was started.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 02-88 re-runs the bsp units of licensees 23 (25 tiles), 25 (7), 30 (5) and the 123/28 tiles through the stale bsp seal, then collision and load checks.
- Licensees 18, 19 and 20 need a reviewed ULevel prefix layout for LicenseeVersion below 23 before their level model can be read; they stay named gaps.

## Self-Check: PASSED

- All six created files exist; commits 3ac2690, 066e22e, 2bb7480, 4334e5e, 9138357, cc902d0 and fe8bbfd are on this branch.

---
*Phase: 02-stage-a-breadth*
*Completed: 2026-11-11*
