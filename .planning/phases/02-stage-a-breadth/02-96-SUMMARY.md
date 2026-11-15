---
phase: 02-stage-a-breadth
plan: 96
subsystem: world
status: complete
tags: [bsp, level-model, licensee-rules, engine-dll, render-sections, collision, tile-batch, retry-tiles]

requires:
  - phase: 02-76
    provides: the level-model reader gate, its reviewed records and the Elbera cross-check rows for 18, 19 and 20
  - phase: 02-88
    provides: the world lane batch, catalog b4d451dc and the 12 load checks failing on missing collision
provides:
  - recipes/world/bsp-model-licensee-rules.json, the pinned verified level model rules (Engine.dll 4dd2f63c)
  - scripts/world/bsp_model_licensee_rules.py (read_bsp_model_licensee_rules) and scripts/world/level_model_reference.py (read_level_model_reference)
  - level-model 123/18, 19 and 20 reviewed with fixtures and equal Elbera rows
  - render sections checked against their assigned nodes, revision never compared
  - convert_tile_batch.py --retry-tiles
  - sealed bsp, collision and bsp-visibility units on the 13 level model tiles, lane catalog 420deb2f
affects: [02-89, world lane restage, movement-geodata collision coverage]

actuals:
  tokens: 22052
  tasks: 3
  commits: 4
plan_head_before: a4b4d4984e092a40920a123cec22fc8c113f3250
plan_head_after: 4526cf0540681f98d7709d1091c8c3ba9de04161

tech-stack:
  added: []
  patterns:
    - "Engine.dll rules live in one pinned recipe read once per process with strict JSON and an engine pin checked against the lock; addressed rules and unaddressed struct layouts are kept apart"
    - "A licensee below a rule minimum gets one layout difference per rule and the recipe as evidence; licensees at or above every minimum keep their record byte-identical, so sealed units stay current"

key-files:
  created:
    - recipes/world/bsp-model-licensee-rules.json
    - scripts/world/bsp_model_licensee_rules.py
    - scripts/world/level_model_reference.py
    - tests/pipeline/test_bsp_model_licensee_rules.py
    - tests/fixtures/world-readers/level-model-123-18.json
    - tests/fixtures/world-readers/level-model-123-19.json
    - tests/fixtures/world-readers/level-model-123-20.json
  modified:
    - .gitattributes
    - scripts/world/level_model.py
    - scripts/world/blocking_volume_geometry.py
    - scripts/world/bsp_lightmaps.py
    - scripts/world/reader_licensee_layouts.py
    - scripts/world/reader_cross_check_rows.py
    - scripts/world/convert_tile_batch.py
    - tests/fixtures/world-readers/cross-checks.json
    - tests/pipeline/support/lightmap_tail_fixture.py
    - tests/pipeline/support/water_volume_fixture.py
    - tests/pipeline/test_convert_tile_batch.py
    - tests/pipeline/test_level_model_licensees.py
    - tests/pipeline/test_world_collision_step.py
    - docs/parts/world/EVIDENCE.md
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "read_level_model_reference owns the ULevel prefix for every licensee; the vendored level_model_binding stays byte-identical as the 23+ cross-check (row 1075)"
  - "New convert_tile_batch.py --retry-tiles selects named eligible tiles whose recorded gap or failed rows would settle them (row 1076)"
  - "The below-24 lightmap fact stays open in the recipe and adds no layout difference; 18_15 keeps 163,885 unwalked tail bytes with 0 records (row 1077)"
  - "FBspSection and FBspVertex are recipe layouts without an address, because the facts give none (row 1078)"
  - "Licensees 19 and 20 were reviewed in the tracer commit, because the reader change made their refusal rows unreproducible (row 1079)"
  - "The batch projection used the 02-88 per-tile drop, because free bytes rose across the tracer (row 1080)"
  - "18_15 has no tile record (manifest gap player-start-missing), so the Task 3 gate stays red on its load check (row 1081)"

requirements-completed: []

duration: 95min
completed: 2026-11-13
---

# Phase 2 Plan 96: BSP level model licensee rules Summary

**The level model reader now reads map licensees 18, 19, 20 and 31 by the Engine.dll 4dd2f63c rules from a pinned recipe. All 13 blocked tiles seal bsp, collision and bsp-visibility. 11 of the 12 tiles that have a record pass the load check, and no load check fails for missing collision.**

## Performance

- **Duration:** about 95 min (19:25 to 21:00 Riga)
- **Started:** 2026-11-13 at plan start commit a4b4d49
- **Completed:** 2026-11-13
- **Tasks:** 3 of 3
- **Files modified:** 22

## Accomplishments

- `recipes/world/bsp-model-licensee-rules.json` holds only values from the verified facts (SHA-256 `79d11661...`, workflow wf_684b2535-75f, 93/93 instructions and 17/17 data rows, decision rows P1152 and P1153). The rules are ULevelBase::Serialize 0x105cf110 (the +0x48 array from LicenseeVer 23), ULevel::Serialize 0x105d07f0 (Model at +0xc0) and the FBspSurf serializer 0x105ea020 (the +0x40 int32 from LicenseeVer 21). It also holds the FBspSection and FBspVertex wire layouts, the 13 map licensees and the open names. Nothing in it was read from the IMPORTA-PC bundle.
- `read_level_model_reference` reads the prefix for every licensee. On 17_20, 15_20, 20_21, 17_22 and 19_23 it equals the vendored `level_model_binding`, and every committed level-model fixture still reproduces.
- `read_model_body` applies the surface rule to Level.Model and to the brush models of blocking volumes.
- `read_render_sections` checks each section's vertex count against the summed vertices of its assigned nodes, and its node count against the assigned nodes that have vertices. It never compares the revision. Each of the five 123/31 maps has a section whose revision differs from its node count.
- The 123/18, 19 and 20 records name the two rules they fall below and cite the recipe. The Elbera rows are equal: 17_18 `0bdd4050...`, 26_11 `3a8d4461...`, 24_26 `92e1ee16...`. The 23, 25, 28, 30 and 31 records equal the `levelModelLayout` of their sealed bsp receipts. 123/24 is still refused.
- The tracer (`--retry-tiles 17_18 --limit 1`, exit 0) was followed by one batch process (`--retry-tiles <the 13> --limit 12`, exit 0, 12 tiles attempted). All 13 tiles hold sealed bsp, collision and bsp-visibility units. Their bsp rows are `object-gaps:<n>` and none is a level model gap.

## Task commits

1. **Task 1: tracer, rules recipe, readers, 18 (with 19 and 20) records, retry option** - `dae8bca`; decision rows `5500bcc`
2. **Task 2: real-map test of the 13 maps and the five cross-check tiles, refusal expectations retired** - `1eaea74`
3. **Task 3: batch, catalog, load and walk, world evidence** - `4526cf0`

## Verification

- Task 1 gate: exit 0. 17_18 holds sealed bsp, collision and bsp-visibility units under the 123/18 record, the five reviewed records equal their receipts, and no receipt outside 17_18 changed. The tracer-feedback re-run of the verify tests passed.
- Task 2 gate: exit 0. `test_bsp_model_licensee_rules.py -v` ran 14 tests with 0 skipped, so both real-client cases ran on E:. The old reader name and the surface constant are gone from `scripts` and `tests`.
- Task 3 gate: **exit 1**. These checks pass: exit code, equal fingerprint inputs, receipts kept, sealed units, walks and evidence size. `swept` fails only because `tile:18_15` has no load-check record: the tile has no catalog record (manifest gap `player-start-missing` since 02-88). No record reads `pins no native-tile-collision resource`.
- Test groups: `test_bsp_model_licensee_rules.py` (14), `test_level_model_licensees.py` (14), `test_world_*_step.py` (201), `test_convert_tile_batch.py` (25) and `test_world_reader_licensees.py` (24) all pass. The real-client fixture and cross-check cases ran.
- `print_fingerprint_inputs.py` printed the same JSON before and after. `git diff a4b4d49 -- <frozen and vendored paths>` is empty. 1,944 receipt fingerprints were taken before the plan. None outside the 13 tiles changed, and inside them only the 12 manifest receipts resealed. There are 101 new receipts, all on the 13 tiles.
- Free bytes: tracer 23,740,182,528 before and 24,155,631,616 after (a rise under other writers). Batch 24,124,334,080 before and 23,809,138,688 after, a drop of 315,195,392 over 12 tiles. The projection was 63,885,312 bytes (row 1080).
- `write_lane_catalog.py --lane world --plan`: exit 0 on catalog `420deb2f...`.
- Load sweep (`load-checks/420deb2f....json`, 12 keys, 5173 free): 11 pass. 24_14 fails `The tile anchor lies outside every chunk terrain`.
- Walks (`tile-walks-420deb2f....json`, 2 runs): all 11 passing tiles have a walk record. 24_20 and 26_12 pass. 8 fail `did not walk more than 1 m and come to idle within 90000 ms`, and 17_18 fails `the walk ended at height -163.81 m, below the terrain minimum`.
- `node scripts/check-lane-ownership.mjs --base a4b4d49 --part world`: exit 1, 2 foreign paths: `.gitattributes` (deviation 2) and the shared `.planning/OVERNIGHT-DECISIONS.md`. This is recorded as the step result.
- Reference overlap: none of this plan's files fall under an area of `tools/reference-overlap/overlapAreas.json`, so no run applies.
- Cross-check tile receipts: the five reviewed tiles (17_20, 15_20, 20_21, 17_22, 19_23) are compared against their sealed `artifacts/lane-store/world/work/tile__<id>/bsp/receipt.json` `config.levelModelLayout`. That file holds the fingerprints in `bsp-model-licensees-tracer.json` `receiptFingerprintsBefore`. Their maps are lock-equal: 17_20 `67986c39...`, 15_20 `b2f06c9c...`, 20_21 `e123be27...`, 17_22 `84e62138...`, 19_23 `e0beddd0...`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Licensees 19 and 20 reviewed in Task 1**
- **Found during:** Task 1 verify
- **Issue:** After the reader change, the recorded 19 and 20 refusal rows no longer reproduced, so `test_world_reader_licensees.py` failed the Task 1 gate. The tracer-feedback gate needs that to pass.
- **Fix:** I added 19 and 20 to `REVIEWED_LEVEL_MODEL_LICENSEES` and ran their cross-checks in Task 1. Task 2 kept the real-map test and the retirement of the refusal expectations.
- **Commit:** dae8bca (row 1079)

**2. [Rule 2 - Missing critical] Recipe pinned to LF**
- **Issue:** The record evidence holds the recipe SHA-256, so a CRLF checkout would change every 18, 19 and 20 bsp config.
- **Fix:** I added `recipes/world/bsp-model-licensee-rules.json text eol=lf` to `.gitattributes`.
- **Commit:** dae8bca

**3. [Rule 3 - Blocking] Recipe layouts without an address**
- **Issue:** The plan listed `renderSection` and `renderVertex` under `rules`, and every rule needs an address. The facts give no FBspSection or FBspVertex serializer address.
- **Fix:** Both live under `layouts`, and the missing addresses are an `open` entry (row 1078). The section and vertex rules otherwise follow the facts.
- **Commit:** dae8bca

**4. [Rule 3 - Blocking] Brush model test adapters**
- **Issue:** `read_model_body` reads `adapter.licensee_version`, which the synthetic brush adapters lacked.
- **Fix:** I gave `tests/pipeline/support/water_volume_fixture.py` (outside the plan file list) and the collision test adapters a licensee, and added a licensee 18 brush model test.
- **Commit:** dae8bca

**5. Test order**
- The Task 1 tests were written alongside the code rather than strictly before it. The new test file imports modules that do not exist at a4b4d49, so it fails there.

**6. Refusal-path docs**
- The docs text that expected 18, 19 and 20 to be refused lives only in `docs/parts/world/EVIDENCE.md`. I rewrote it in Task 3, so the shared file was edited once.

## Known Stubs

None.

## Open follow-ups for 02-89

- 18_15 has no tile record or load check: manifest gap `player-start-missing`. To unblock: a source-backed tile anchor rule for a tile without an enabled PlayerStart in the manifest step.
- The lightmap tail end to end: below LicenseeVer 24 the loader copies model lightmaps in memory, and the data check did not consume the tail end to end. Our walk reaches the export end on 12 of the 13 maps. 18_15 has 0 records and 163,885 unwalked bytes. To unblock: a byte replay of the model lightmap loader for licensee below 24 against 18_15.
- Unnamed fields: ULevelBase+0x48, FBspSurf+0x40 and FBspSection+0x28 (kept as `lightmap_texture` in the lighting join). The FBspSection and FBspVertex serializer addresses are also unnamed. To unblock: a named Interlude symbol or export for each, through a verified facts update of the recipe.
- 24_14 fails its load check with `The tile anchor lies outside every chunk terrain`, the same class as the six 02-88 tiles. To unblock: the chunk plan anchor rule.
- 9 of the 11 walks fail on the known MOVE-01 classes: no walk start (8), and a fall below the terrain minimum on 17_18. To unblock: the MOVE-01 walk follow-ups.
- Restage: the world lane catalog `420deb2f...` carries these units. The owner's main-checkout merge takes them, and `write_lane_catalog.py --plan` printed the command.

## Process cleanup

The tracer, the batch, the Playwright sweep and the two walk runs all exited on their own. Afterwards no process had this worktree path in its command line, and nothing listened on 5173 or 5175.

## Self-Check: PASSED

- FOUND: recipes/world/bsp-model-licensee-rules.json, scripts/world/bsp_model_licensee_rules.py, scripts/world/level_model_reference.py, tests/pipeline/test_bsp_model_licensee_rules.py, tests/fixtures/world-readers/level-model-123-18.json, -19.json and -20.json
- FOUND: dae8bca, 5500bcc, 1eaea74, 4526cf0
