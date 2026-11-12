---
phase: 02-stage-a-breadth
plan: 79
subsystem: actors
tags: [skills-effects, items, unit-ledger, lane-coverage, catalog-size, gap-closure, act-03, act-06, fx-01]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-73, 02-74 and 02-92 converter versions (rule G6); 02-94 emitter feature census rule; 02-43 skill batch; 02-42 item batch"
provides:
  - "All 245 skill visual roots sealed under the current converter; actors lane skills-effects 591 pass, 29,221 gap, 0 pending"
  - "8,413 emitter-feature-unported skill gap rows from the 02-94 feature rule (6,468 UseDirectionAs, 1,945 BlendBetweenSubdivisions)"
  - "Measured catalog size projection (25,710,689 of 33,554,432 bytes) and decision row 1023: the item record shape stays"
  - "All 3,684 item units sealed (2,465 pass); docs/parts/items/item-census.json: 1,585 converted, 7,653 listed gaps, 0 pending"
  - "Final actors lane catalog 469805d3b625f974d2806f6b385c1193a7ef35a85ba91eb518faf826b2328add (20,416,796 bytes; --plan prints the merge command)"
  - "25-key skills and 25-key items load sweep slices on the final lane catalog, 50 of 50 pass"
affects: [02-87, 02-89, 03-03, integration restage]

tech-stack:
  added: []
  patterns:
    - "Batch slices run through one orchestration driver that projects disk before every 5 slices and rewrites the lane catalog every 5 slices and at the end"

key-files:
  created:
    - .planning/phases/02-stage-a-breadth/02-79-SUMMARY.md
  modified:
    - docs/parts/skills-effects/EVIDENCE.md
    - docs/parts/items/EVIDENCE.md
    - docs/parts/items/item-census.json
    - .planning/OVERNIGHT-DECISIONS.md
    - STATUS.md

key-decisions:
  - "1023: the item model record shape stays; the measured upper-bound projection of the union catalog is 25,710,689 bytes against MAXIMUM_CATALOG_BYTES 33,554,432, and the final measure is 22,227,730 bytes"

requirements-completed: []

duration: 9h 52m
completed: 2026-11-12
commits: 4
plan_head_before: 26b1e07f3973fdc54fc0102167ba3bedc4e413ab
plan_head_after: c02e285

actuals:
  tokens: 9000
  tasks: 3
  commits: 4
---

# Phase 2 Plan 79: Skill and item batches to completion Summary

**Every skillgrp key and every item in the actors lane is now converted or a listed gap with nothing pending, the item record shape stays after a measured union catalog projection, and the final actors lane catalog `469805d3...` prints its merge command and loads 25 of 25 swept skill keys and 25 of 25 swept item keys.**

## Performance

- Start 2026-11-12 03:00 Riga (plan head `26b1e07`), end 12:52 Riga.
- Tasks 3 of 3. 4 commits (3 task commits plus this summary commit).
- Batch runtime: skill slices 03:04 to 07:21, item slices 07:22 to 12:06. A T3 server restart stopped the first executor after item slice 66; this executor resumed from the ledger at slice 67.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 (tracer) | One skill slice under the current converter, then the lane catalog | 03e2846 | skills-effects EVIDENCE |
| 2 | Skill batch to completion, then the catalog size projection | 1d61598 | skills-effects EVIDENCE, items EVIDENCE, OVERNIGHT-DECISIONS row 1023 |
| 3 | Item batch, smoke sweep slices and cleanup | c02e285 | item-census.json, items EVIDENCE, skills-effects EVIDENCE |

## What happened

- Skills: 13 slices of 20 roots, all exit 0. The 22 roots of 02-43 were resealed first. 245 roots: 176 converted with every class simulated, 22 converted with `emitter-class-unported:Engine.BeamEmitter`, 8 with `Engine.VertMeshEmitter`, 25 `converter-refused`, 14 `no-exact-skillsound-row`. `skill.mo.99`, refused under 02-43, now converts.
- The 02-94 feature rule wrote 8,413 `emitter-feature-unported:<property>` rows into `artifacts/lane-store/actors/gap-rows/skills.json` (6,468 `UseDirectionAs`, 1,945 `BlendBetweenSubdivisions`). This restages the skills gap rows that the slice-09 review finding on `particleEmitter.ts:38` needs.
- Projection before the item batch: integration union 1,810,934 bytes, actors lane catalog 6,333,702 bytes, 6,051 projected item records at 2,903 bytes, for 25,710,689 bytes against `MAXIMUM_CATALOG_BYTES` 33,554,432. The record shape stays (row 1023). After the batch the measure is 22,227,730 bytes: 5,642 item records, the largest 3,172 bytes.
- Items: 74 slices of 50 units, all exit 0. 3,684 units: weapon 368 pass and 7 `converter-refused`; armor 2,097 pass, 1,202 `animation-reference-missing`, 2 `animation-outside-mesh-package:Dwarf` and 8 `converter-refused`. Items: 1,585 converted, 0 pending, 7,653 listed gaps (6,911 `etcitem-presentation-unplanned`, 307 `no-mesh-in-row`, 276 `mesh-texture-pairing-undecoded`, 121 `skeletal-licensee-unsupported`, 21 `converter-refused`, 17 `animation-reference-missing`).
- Disk (G5): the projection ran before slices 1, 2, 7 and every 5 slices after. The highest projection was 7,258,119,603 bytes, the lowest free space 9,495,957,504 bytes, against the 4 GiB floor. 19,606,921,216 bytes were free after the batch.
- Lane coverage on `469805d3...`: skills-effects 591 converted, 29,221 gap, 0 pending; items 0 pass, 9,238 gap (1,585 converted with `equipment-slot-meaning-undecoded:<bodyPart>`), 0 pending.
- Sweeps (port 5173 free, headless SwiftShader, no FPS claim): skills 25 pass (skill 1011 levels 1 to 18, 1012 levels 1 to 3, 1013 levels 1, 10, 101 and 102); items 25 pass, all `assetManifestSchemaVersion` 2. Records are in `artifacts/lane-store/actors/load-checks/469805d3b625f974d2806f6b385c1193a7ef35a85ba91eb518faf826b2328add.json`.

## Verification

- Task 1 and Task 2 checks re-run on resume: skills-effects pending is 0.
- Task 3 verify: items `{'converted': 0, 'gap': 9238, 'pending': 0, ...}`. `write_lane_catalog.py --lane actors --plan` exited 0 and printed the merge command. Nothing listens on 5173 or 5175.
- `NATIVE_STORE_ROOT=actors LOAD_CHECK_KIND=skills LOAD_CHECK_LIMIT=25 pnpm test:e2e tests/browser/load-sweep-skills.spec.ts`: 1 passed (2.1 min). The same with `items` and `load-sweep-items.spec.ts`: 1 passed (3.2 min).
- `python -B -m unittest discover -s tests/pipeline -p "test_item_*.py"`: 20 OK. `-p "test_gap_*.py"`: 50 OK, including the real-store census.
- `pnpm vitest run tests/unit/laneOwnership.test.ts`: 36 passed. Both EVIDENCE docs are under 30,720 bytes: skills-effects 30,562, items 9,399.
- `node scripts/check-lane-ownership.mjs --base 26b1e07 --part skills-effects`: 1 foreign path, `.planning/OVERNIGHT-DECISIONS.md`. That is the decision log the run rules require.
- Reference overlap: this plan wrote no code, so there was no run to record.

## Deviations from Plan

### Other adjustments

- Resume: the first executor stopped after item slice 66, during the catalog rewrite that follows it. It left `item-census.json` modified. The ledger skipped the sealed units, and slices 67 to 74 sealed the remaining 384 units.
- The first `write_lane_catalog.py --lane actors --plan` after the batch exited 1 with `pinned store file SHA-256 differs from its pin 9e1c2f79...: 9e1c2f79.../asset.l2asset`. `sha256sum` of that file (item 1119 armor record, written 09:04) equals the pin. The same command, run again with nothing else running, exited 0 and printed the merge command. That run held a 29.7 GB working set with 8 GB of physical memory free. See Open follow-ups.
- The skills EVIDENCE was at 30,867 bytes after the sweep line was added. The superseded 02-43 sweep bullet was replaced and the 02-79 catalog sentence was condensed to keep the doc under 30,720 bytes.

## Requirements

- ACT-03: stays Pending. Lane breadth is done: every item is converted or a listed gap. The restage (Needs Human), the union load sweeps (03-03) and the armor body-part meaning remain.
- ACT-06: stays Pending. Every skill key is converted or a listed gap in the lane. Restage, union sweeps and sandbox cast wiring (02-87) remain.
- FX-01: stays Pending. The feature and class gaps are listed per key. The unported classes and features remain.

## Decisions logged

OVERNIGHT-DECISIONS row 1023 (Task 2, catalog size projection). No new row on resume.

## Needs Human

None new. The actors lane restage is the existing main-checkout line in STATE.md. `write_lane_catalog.py --lane actors --plan` prints `cd C:/laragon/www/l2-browser-client && python -B .../scripts/native_store/merge_lane_store.py --lane-store .../artifacts/lane-store/actors/l2 --target public/l2 --expected-base-catalog-sha256 55c12147db306264deb2be33f6b9cd661d1376d12dc2aa6473be3700322972fe` for lane catalog `469805d3...`.

## Open follow-ups

- `write_lane_catalog.py --plan` reads every pinned store file into memory (29.7 GB working set on the actors lane). One run reported a SHA-256 mismatch on `9e1c2f79.../asset.l2asset` whose bytes match the pin, and the next run passed. A streaming pin check (`file_digest`) would bound memory and show whether that mismatch came from memory pressure.
- 1,202 armor units are `animation-reference-missing`, and 21 items are `converter-refused` (15 object missing or ambiguous, 4 non-finite `Points`, 1 unmapped section vertices, 1 missing material slot). Their reasons are in the item gap rows.
- The actors lane work folder grew by about 4 MB per item unit. Free disk went from 70.8 GB before the item batch to 19.6 GB after it.

## Known Stubs

None.

## Process cleanup

- Started by this executor: the batch driver `run_actor_batch_slices_02_79.py items 67 50` (background, exited 0 with its `convert_actors.py` and `write_lane_catalog.py` children), one `write_lane_catalog.py --plan` (exited 1) and its rerun (exited 0), and two Playwright runs on 5173 whose web server and browser Playwright stopped at exit. The targeted unittest and vitest runs exited.
- Check at 12:52 Riga: nothing listens on 5173 or 5175. `list_worktree_processes.py` lists no python, node or browser process with this worktree path besides itself.

## Self-Check: PASSED

- FOUND: .planning/phases/02-stage-a-breadth/02-79-SUMMARY.md
- FOUND commits: 03e2846, 1d61598, c02e285
