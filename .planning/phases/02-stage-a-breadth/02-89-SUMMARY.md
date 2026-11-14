---
phase: 02-stage-a-breadth
plan: 89
subsystem: integration
status: complete
tags: [load-sweep, union, coverage, requirements, needs-human]
requires:
  - phase: 02-stage-a-breadth
    provides: "lane outputs of 02-72 to 02-88 and 02-90 to 02-99"
provides:
  - "tables load sweep kind (table: keys) and tests/browser/load-sweep-tables.spec.ts"
  - "the one 02-89 union rebuild result in artifacts/lane-store/integration/measurements/union-rebuild-result.json (failed, exit 1)"
  - "STATUS part lines from the lane coverage files"
  - "REQUIREMENTS: UI-02 and UI-03 Pending with the regression reason, DATA-03 and CONV-01 Complete"
  - "STATE Needs Human (plan 02-89) restage line, owner items with exact steps, rewritten Open follow-ups"
affects: [phase-03, INT-01, UI-02, UI-03, DATA-03, CONV-01, CONV-02, ARCH-02]
tech-stack:
  added: []
  patterns: ["a sweep kind is a prefix in loadCheckRecords.ts plus one harness branch; the table check reuses nameIndexRecordId for name index records"]
key-files:
  created:
    - tests/browser/load-sweep-tables.spec.ts
    - tests/browser/support/nativeTableLoadCheck.ts
    - tests/unit/nativeTableLoadCheck.test.ts
  modified:
    - tests/browser/support/loadCheckRecords.ts
    - tests/browser/harness/loadCheckHarness.ts
    - tests/unit/loadCheckRecords.test.ts
    - docs/VERIFICATION.md
    - STATUS.md
    - .planning/REQUIREMENTS.md
    - .planning/STATE.md
decisions:
  - "P1174: the union rebuild exited 1 with 'catalog tiles record 20_21 differs; preserved'; recorded as a failed union step, no rerun, the writer fix is an Open follow-up"
  - "P1175: the tables sweep checks native-table manifests by table and recordCount and name index manifests by their source table and entryCount"
  - "P1176: the STATUS intro names the failed union with its stderr line and says the part lines read the lane coverage files"
metrics:
  duration: 77min
  completed: 2026-11-14
estimate:
  tokens: 80000
  tasks: 3
actuals:
  tokens: 12444
  tasks: 3
  commits: 3
plan_head_before: b1a5bcd48d420196cd6f15adceb145282d068892
plan_head_after: 8b8877987eb2f84a3310578759b5733a1ab9f84f
requirements-completed: [DATA-03, CONV-01]
---

# Phase 2 Plan 89: Gap round close-out Summary

Tables became a load sweep kind, and table:actionname-e is a recorded pass on union bba52c47. The one union rebuild failed with exit 1: "catalog tiles record 20_21 differs; preserved". It did not fail on disk. The writer merges the lanes onto the earlier union catalog, so every lane record resealed since then refuses. STATUS now reads the lane coverage files. UI-02 and UI-03 are back to Pending. DATA-03 and CONV-01 are Complete because their tests pass. Needs Human and Open follow-ups are rewritten.

## Tasks

| Task | Commit | Result |
| ---- | ------ | ------ |
| 1 Tracer: tables sweep kind | a146f2c | Kind `tables` (prefix `table:`) added. The load-check harness checks `table:` keys through `fetchVerifiedNativeResource`. `NATIVE_STORE_ROOT=integration LOAD_CHECK_KIND=tables LOAD_CHECK_LIMIT=1` passed 1 of 1 (ports 5173 and 5175 free). `table:actionname-e` is a pass in `artifacts/lane-store/integration/load-checks/bba52c47....json`. |
| 2 Union rebuild once, STATUS | d92d05b | Exit 1 with a message that is not the disk refusal, so it counts as a failed union step (see below). STATUS part lines come from the lane coverage. |
| 3 Bookkeeping, Needs Human, Open follow-ups | 8b88779 | REQUIREMENTS and STATE rewritten. |

## Union result (Task 2)

- `node scripts/check-machine-schedule.mjs`: exit 0 (DATABASE-PC, no active window).
- Before the run: integration catalog SHA-256 `bba52c475030586905cfb2f5eeef509f6862a21b8605a379a2b89baca301008c`, `freeBytesBefore` 148,130,234,368.
- Command, run once as one background process: `python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py python -B scripts/native_store/write_lane_catalog.py --lane integration --union world --union actors --union data-ui`. Exit 1, stdout empty, stderr `catalog tiles record 20_21 differs; preserved`.
- Cause, read from the code: `write_lane_catalog` starts from the catalog already in the integration lane (the bba52c47 union) and merges each union lane into it through `merge_catalog_slice_records`. That function refuses any id whose record differs. The world lane resealed tile 20_21 after 02-55, so the first resealed record stopped the run before any file was copied.
- After the run: integration catalog SHA-256 is unchanged (bba52c47), free bytes 148,135,677,952, and `docs/coverage.md` equals HEAD.
- The result file `artifacts/lane-store/integration/measurements/union-rebuild-result.json` holds `catalogSha256Before`, `freeBytesBefore`, `exitCode` 1, `stdout` and `stderr`.
- These steps were not run. The reason for each is "not run: union rebuild failed: catalog tiles record 20_21 differs; preserved":
  - the 02-55 pin check (`check_union_pins.py`)
  - the six 25-key union slices (tiles, npcs, items, skills, windows, tables)
  - `build_coverage_report.py` and `docs/coverage.md`
  - `write_lane_catalog.py --lane integration --plan`
- The Task 2 gate exits 1, as decision row P1123 requires for any other result. `test_gap_census*.py`: 40 tests OK.
- STATUS reads `artifacts/lane-store/<lane>/l2/coverage.json`: world ba87e45c, actors 8458dff2, data-ui 90a14434. Their sums close, and only the sandbox is unknown. No line claims a stage A pass.

## Requirements

- DATA-03 is Complete: `test_sysstring_systemmsg_counts.py` ran 11 tests, all OK.
- CONV-01 is Complete: `test_converter_independence.py` ran 20 tests, all OK.
- UI-02 is Pending, with the regression reason from 02-VERIFICATION (P743). The "filled with sandbox data" clause is unmet.
- UI-03 is Pending, with this reason (P743): the procedural HUD still waits for the owner decision, and the UE2 118 reader and TextBox label text are still open.
- CONV-02, INT-01 and ARCH-02 are unchanged. CONV-02 stays Pending. INT-01 stays Pending because the union failed. ARCH-02 waits for the P741 freeze, which is in Needs Human.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 2 - Correctness] Name index records in the tables sweep**
- Found during: Task 1.
- Issue: 3 of the 43 table records are `native-table-name-index` manifests. They have no `recordCount`, and their `table` field names the source table. A kind check that accepts only native-table would record false converter defects.
- Fix: `tests/browser/support/nativeTableLoadCheck.ts` checks each manifest kind by its own shape (P1175). The harness branch lives in `tests/browser/harness/loadCheckHarness.ts`, the page that runs the verified fetch. `docs/VERIFICATION.md` lists the new kind.
- Commit: a146f2c.

**2. [Plan outcome] The union failed with a message the plan does not name**
- The plan lists only the disk refusal and exit 0. The run gave neither. Following the plan's "any other result" rule, the failure is recorded, nothing is rerun and nothing is edited by hand. The STATUS intro states the failure (P1176). The Task 2 gate and the restage branch of the Task 3 gate stay red. Every static Task 3 check passes.

## Needs Human

- Needs Human (plan 02-89) gives the restage steps in order:
  1. The failed union and its stderr. After the writer fix, the integration thread runs the same union command, the pin check, the six slices and the coverage report.
  2. `write_lane_catalog.py --lane integration --plan` prints the `merge_lane_store.py` command, and the owner runs it in the main checkout.
  3. After the restage: the 01-12, 02-05, 02-33 and 02-40 deletions, `pnpm assets:migrate`, `pnpm assets:migrate --verify-only`, and the shared-store sweeps.
- These owner items are listed with exact steps:
  - the P741 adapter freeze
  - the P743 UI-03 split
  - the P806 draw limit value, with its GTX 1060 measurement
  - the row 49 review, now including P810
  - the review of the provisional IDs and of rows P801 to P812 and P817
  - the CONV-02 tangent repair
  - the stage A exit threshold
  - the procedural HUD
  - WR-62
  - P15
  - the GTX 1060 residency run
  - the listening round on `f0ccc579....json`
  - the Power Strike hash trace
  - the IMPORTA-PC minimap route and texture layout research
  - the SC4e CP and MP server line
- There is no SC3b line, because 02-95 pinned the routes. There is no 02-88 disk stop line, because the 02-88 batch kept far above the floor. There is no item record shape line, because 02-79 stayed under the limit (row 1023).

## Open follow-ups

- The three explicit records are:
  - SC3b, narrowed by 02-95: the five 02-95 items, plus the 5006 PlaySkillSound call and the grouped-name resolver.
  - SC4e window data.
  - Map emitter playback.
- New: "Union rebuild onto the earlier union" (INT-01, P1174). The fix is a union built from the union lanes alone, with a pipeline test.
- Records from the orchestrator notes:
  - Skill dispatch candidates, with the r4 bounded-rejection and r7 passive-row reports.
  - Abnormal state effects (FX-01), rewritten from `verified-abnormal-state.md`: replay-verified, 24 handlers, 17 with class pushes, 7 without, five packet writers, and the field indices unresolved.
  - Status icons route.
  - Visual modifiers and variation effects.
  - Effect sounds through SpawnSound.
- Dropped because they landed:
  - Water volumes in VOLS (02-77).
  - Struct fields in actor records (02-98).
  - Lane catalog plan memory (P1121).
  - Lane coverage with the catalog.
  - Player-characters evidence heading.
  - The 02-82 radar join items (superseded by the 02-97 route).
- Not in the list at plan start and still landed: chunk-incremental tile systems, stale seals in the batch, and the display gamma pass.

## Reference overlap

Not run. This plan changed only test support files, docs and planning files. None of them is a DEC-OWN-12 area source.

## Process cleanup

This plan started and stopped these processes: one Playwright run with its web server (exited), one union process (PID 25724, exit 1), and the unittest and vitest runs (exited). At 2026-11-14T02:29Z nothing listened on 5173 or 5175, and no process had this worktree path in its command line.

## Self-Check: PASSED

- Files: `tests/browser/load-sweep-tables.spec.ts`, `tests/browser/support/nativeTableLoadCheck.ts`, `tests/unit/nativeTableLoadCheck.test.ts` and `artifacts/lane-store/integration/measurements/union-rebuild-result.json` exist.
- Commits: a146f2c, d92d05b and 8b88779 are on HEAD.
- Checks: `git diff --quiet -- public` exits 0. `node scripts/check-lane-ownership.mjs --base b1a5bcd --part adapter-dispatch` finds 0 foreign paths.
