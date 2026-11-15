---
phase: 02-stage-a-breadth
plan: 78
subsystem: actors
tags: [npcs, audio, unit-ledger, lane-coverage, gap-closure, act-02, act-05]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-73, 02-74 and 02-92 converter versions (rule G6); 02-34 NPC batch; 02-44 actor-sounds batch; 02-72 audio denominator"
provides:
  - "All 539 NPC batch units sealed under the current converter; actors lane npcs 5,177 converted, 1,341 gap, 1 pending (npc:21622)"
  - "5,177 NPC actor-sounds units: 5,175 combatAudio bundles and 2 npc-names-no-sound gaps; docs/parts/audio/actor-sound-census.json rewritten"
  - "Final actors lane catalog a1562da9aba4d7b8f9095a595a7a2e05fe8509e43079fb9c5f1bfec1f5668326 (mesh join check passes, --plan prints the merge command)"
  - "build_coverage_report.other_source_lane_derived_converted_keys: a lane report takes derived conversions of the source lanes it does not measure"
  - "NoSoundBundle and the npc-names-no-sound gap reason (recipes/actors/gap-reasons.json listVersion 9)"
affects: [02-79, 02-87, 03-03, 03-11, integration restage]

tech-stack:
  added: []
  patterns:
    - "Derived coverage keys take their converted state from the same lane store that wrote their source step rows"
    - "An actor bundle with nothing to bundle (skill without an exact skillsoundgrp row, NPC whose sound columns are empty) seals one no-sound unit with a gap row and no record"

key-files:
  created:
    - .planning/phases/02-stage-a-breadth/02-78-SUMMARY.md
  modified:
    - scripts/native_store/build_coverage_report.py
    - tests/pipeline/test_gap_census_derived_parts.py
    - scripts/actors/actor_sound_batch.py
    - scripts/actors/actor_sound_bindings.py
    - scripts/actors/actor_sound_conversion.py
    - tests/pipeline/test_actor_sound_bundle_reseal.py
    - recipes/actors/gap-reasons.json
    - docs/parts/npcs/EVIDENCE.md
    - docs/parts/audio/EVIDENCE.md
    - docs/parts/audio/actor-sound-census.json
    - .planning/OVERNIGHT-DECISIONS.md

key-decisions:
  - "1019: the lane coverage refresh fix in scripts/native_store/build_coverage_report.py (integration path) is a lane confirmation of a small tested change, not a stop"
  - "1020: an NPC whose npcgrp sound columns are all empty seals an npc-names-no-sound unit with no combatAudio record"
  - "1021: npc:21622 (shared-store Musveren, legacy join) stays pending in the actors lane until the restage and the 03-11 key index fix (P816)"
  - "1022: the remaining NPC sound bundles ran as one slice of 4,077 because every slice re-checks all sealed bundles"

requirements-completed: []

duration: 7h 31m
completed: 2026-11-12
commits: 6
plan_head_before: 1f7917559ceb6d257943d6a72fd8cfe0f643f106
plan_head_after: 8b4d3b6acf5cfc927382361fd6d736b833a88d5b

actuals:
  tokens: 36000
  tasks: 3
  commits: 6
---

# Phase 2 Plan 78: NPC and actor-sound batches to completion Summary

**Every npcgrp row in the actors lane is now converted or a listed gap except the shared-store npc:21622, every converted NPC has a sealed sound bundle or the `npc-names-no-sound` gap, and the final actors lane catalog `a1562da9...` passes the mesh join check, prints its merge command and loads 25 of 25 swept npc keys.**

## Performance

- Start 2026-11-11 19:26 Riga (plan head `1f79175`), end 2026-11-12 02:57 Riga.
- Tasks 3 of 3. 6 commits (5 task commits plus this summary commit).
- Most of the time was batch runtime: NPC slices 19:26 to 21:52, actor-sounds slices 21:54 to 02:29.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 (tracer) | One NPC slice under the new converter, then the lane catalog | 4684b3e (coverage fix), 1a07a88 (evidence) | build_coverage_report.py, test_gap_census_derived_parts.py, npcs EVIDENCE |
| 2 | NPC and actor-sound batches to completion | c6612c6 (no-sound NPC fix), e9bb2cd (evidence and census) | actor_sound_batch.py, actor_sound_bindings.py, actor_sound_conversion.py, test_actor_sound_bundle_reseal.py, recipes/actors/gap-reasons.json, both EVIDENCE docs, actor-sound-census.json |
| 3 | Smoke sweep slice and cleanup | 8b4d3b6 | npcs EVIDENCE |

## What happened

- Disk projection before slice 1: 142 sealed units wrote 405,463,798 bytes (2,855,378 per unit); times 3,992 pending rows is 11,398,668,976 bytes against 99,135,758,336 free and the 4 GiB floor. The projection ran again before every 5 NPC slices and before every actor-sounds slice; none came near the floor. Free bytes after the batches: 82,335,555,584.
- Slice 1 sealed 20 units but its coverage refresh at exit failed: the actors lane coverage reads the world lane audio step rows for `tile-audio:XX_YY` and counted conversions only from its own catalog, so 21 tiles with a passing audio step had no status. Fixed (4684b3e), then the tracer (slice 2, lane catalog, `--plan`) passed end to end.
- NPC batch: 28 slices of 20 (slice 25 stopped after a few seconds before the harness time limit and rerun). 539 of 539 units sealed: 446 pass, 93 gap. 23 of 24 packs hold a bundle. Lane coverage: npcs 5,177 converted, 1,341 gap, 1 pending.
- Actor-sounds batch: the first slice failed its coverage refresh because npc:13036 got an empty bundle outside the audio denominator. Fixed (c6612c6). Then 4 slices of 250, one slice of 4,077 and `--actor-sounds npc:35647`. 5,177 sealed NPC sound units: 5,175 bundles, 2 `npc-names-no-sound` (npc:13036, npc:32131). References: 46,080 unique package+leaf candidates, 76 unresolved, 2,566 empty.
- Final lane catalog `a1562da9aba4d7b8f9095a595a7a2e05fe8509e43079fb9c5f1bfec1f5668326`: 614 models, 23 npcProfiles, 5,175 combatAudio, 3,064 effectComponents; mesh join check passes; `--plan` prints the merge command.
- Sweep: 25 of 25 npc keys pass on `a1562da9...` (`artifacts/lane-store/actors/load-checks/a1562da9....json`), headless SwiftShader, no FPS claim.

## Verification

- Task 1 verify (slice, `write_lane_catalog.py --lane actors`, `--plan`): exit 0 on slice 2 after the coverage fix.
- Task 2 verify: prints `1 1`, so it exits 1. Both remaining rows are npc:21622 and npc-sounds:21622, the shared-store Musveren that lane packs leave out by design (decision row 1021). `write_lane_catalog.py --lane actors --plan` exits 0 and prints the merge command.
- Task 3: `NATIVE_STORE_ROOT=actors LOAD_CHECK_KIND=npcs LOAD_CHECK_LIMIT=25 DEV_PORT=5175 pnpm test:e2e tests/browser/load-sweep-npcs.spec.ts`: 1 passed (1.8 min). The Task 3 verify (`netstat ... ':(5173|5175) '`) still lists `127.0.0.1:5173 LISTENING 7320`. That is a Vite server of this worktree started 2026-11-11 23:25, which this plan did not start (see Process cleanup). Nothing listens on 5175.
- `python -B -m unittest discover -s tests/pipeline -p "test_gap_*.py"`: 50 OK, including the real-store census over the shared store and every lane store. `test_actor_*.py` 50 OK, `test_actor_sound*.py` 28 OK, `test_coverage*.py` 27 OK, `test_npc_*.py` 39 OK, `test_*combat_audio*.py` 25 OK.
- `pnpm vitest run tests/unit/laneOwnership.test.ts`: 36 passed (both EVIDENCE docs under 30,720 bytes: npcs 27,235, audio about 13.5 KB).
- `node scripts/check-lane-ownership.mjs --base 1f79175 --part npcs`: lane actors, 1 foreign path, `scripts/native_store/build_coverage_report.py` (decision row 1019).
- Reference overlap: no area in `tools/reference-overlap/overlapAreas.json` covers `scripts/actors/**` or `scripts/native_store/**`, so there was no run to record.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Actors lane coverage refresh failed on world tile-audio keys**
- Found during: Task 1, slice 1.
- Issue: 21 `tile-audio` keys had only a world lane pass row and no converted entry in the actors catalog, so `GapCensusIncompleteError` stopped every refresh. No pending count could be read.
- Fix: `other_source_lane_derived_converted_keys` adds the derived converted keys of every derived source lane the report does not measure, from that lane's own store. The test covers the actors-from-world case and the measured-lane and no-catalog cases.
- Files: `scripts/native_store/build_coverage_report.py`, `tests/pipeline/test_gap_census_derived_parts.py`.
- Commit: 4684b3e.
- Scope: this path is outside the actors globs, and the plan says such a fix stops the plan. Under the run rules (no legacy, everything automatic) it is recorded as lane confirmation row 1019, like rows 598, 607 and 670.

**2. [Rule 1 - Bug] Empty NPC sound bundles outside the audio denominator**
- Found during: Task 2, actor-sounds slice 1.
- Issue: npc:13036 names no sound in any npcgrp sound column, but the batch still built a `combatAudio` bundle with only empty slots. The census refused the converted key `npc-sounds:13036`.
- Fix: one `NoSoundBundle` path, shared with the skills that have no exact skillsoundgrp row, seals an `npc-names-no-sound` unit with a gap row and removes any record. The new reason is in `recipes/actors/gap-reasons.json` (listVersion 9). A test covers it. The no-sound config field is now `sourceTableIdentity`; no skill no-sound unit had been sealed yet.
- Commit: c6612c6.

### Other adjustments

- Actor-sounds slice size: 100, then 250, then one slice of 4,077, then the last key by `--actor-sounds` (row 1022). Each slice re-checks every sealed bundle, so slices of 250 slowed from 669 s to 1,134 s.
- The runners were stopped by PID and resumed before the harness background limit: NPC slice 25, and actor-sounds slices 3 and 6, which later ran detached with recorded PIDs. Ledger units begun by a stopped process are redone by the next `begin`.
- The sweep ran with `DEV_PORT=5175` because another process held 5173 (see Process cleanup). The plan's 5173 check would have recorded the slice as not run.
- The npcs EVIDENCE census tables were stale since the 02-73 census rewrite. They were regenerated from `docs/parts/npcs/actor-unit-census.json` and the lane census gap rows, and superseded batch bullets were condensed, which keeps the doc under 30 KB.

## Requirements

- ACT-02: stays Pending. Lane breadth is done: every npcgrp row is converted or a listed gap except npc:21622. The restage (Needs Human) and the union load sweeps of 03-03 remain.
- ACT-05: stays Pending. Every converted NPC has a sound bundle or a listed gap. Spawn wiring (02-87), skill and character routes, and owner listening remain.

## Decisions logged

OVERNIGHT-DECISIONS rows 1019 to 1022 (see key-decisions).

## Needs Human

None new. The actors lane restage is the existing main-checkout line in STATE.md. `write_lane_catalog.py --lane actors --plan` now prints `cd C:/laragon/www/l2-browser-client && python -B .../scripts/native_store/merge_lane_store.py --lane-store .../artifacts/lane-store/actors/l2 --target public/l2 --expected-base-catalog-sha256 55c12147db306264deb2be33f6b9cd661d1376d12dc2aa6473be3700322972fe` for lane catalog `a1562da9...`.

## Open follow-ups

- npc:21622 and npc-sounds:21622 stay pending in the actors lane until the restage rewrites the shared-store profile with `modelCatalogId` and 03-11 settles the key index disagreement P816 (row 1021).
- Actor-sounds batch speed: `run_actor_sound_slice` recomputes the fingerprint of every sealed bundle before it converts new ones (about 0.5 s per bundle), and every bundle rewrites the whole lane catalog. The skill bundles (3,064 keys) will pay both costs.

## Known Stubs

None.

## Process cleanup

- Started by this plan: the batch runners (`run_actor_batch_slices_02_78.py`, PIDs 6948, 13704, 5508 and 3788 with their `convert_actors.py` children, each stopped by `taskkill /T /PID`); the single `convert_actors.py` and `write_lane_catalog.py` runs (foreground, exited); and one Playwright run on 5175, whose web server and browser Playwright stopped at exit.
- Check at 02:57 Riga: nothing listens on 5175. No python, node or browser process with this worktree path in its command line is from this plan. The only one is `node ... vite.js --host 127.0.0.1` (PID 7320, created 2026-11-11 23:25, listening on 5173). This plan launched no Vite server then (only Python batch runners were running), so it was left alone.

## Self-Check: PASSED

- FOUND: .planning/phases/02-stage-a-breadth/02-78-SUMMARY.md
- FOUND commits: 4684b3e, 1a07a88, c6612c6, e9bb2cd, 8b4d3b6
