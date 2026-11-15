---
phase: 02-stage-a-breadth
plan: 55
subsystem: native-store
status: complete
tags: [integration, lane-store, union, coverage, gap-census, load-sweep, restage]
requires:
  - phase: 02-stage-a-breadth
    provides: write_lane_catalog.py --union and --plan (02-03, 02-24), merge_lane_store.py (02-24), build_coverage_report.py --census-lanes and the gap census (02-07, 02-26), the load-sweep slice specs (02-23, 02-70), the world, actors and data-ui lane stores of 02-25 to 02-69
provides:
  - artifacts/lane-store/integration/l2 (ignored), the union of the world, actors and data-ui lane stores, catalog bba52c47
  - artifacts/lane-store/integration/load-checks/bba52c47....json (ignored), 25 union load-check records
  - docs/coverage.md regenerated from the union with census lanes world, actors, data-ui and integration
  - the Needs Human (plan 02-55) restage command and INT-01 "partial: staging Needs Human" in STATE.md
  - the load-check bullet in docs/VERIFICATION.md "Now"
affects: [INT-01, the integration restage, Phase 3 side-by-side checks]
tech-stack:
  added: []
  patterns:
    - "Integration union: write_lane_catalog.py --lane integration --union world --union actors --union data-ui, then --plan prints the one merge command"
    - "Union loads only from slices run with NATIVE_STORE_ROOT=integration"
key-files:
  created:
    - .planning/phases/02-stage-a-breadth/02-55-SUMMARY.md
  modified:
    - docs/coverage.md
    - docs/VERIFICATION.md
    - STATUS.md
    - .planning/STATE.md
    - .planning/OVERNIGHT-DECISIONS.md
key-decisions:
  - "Union loads come only from slices run on the union catalog; lane records are never copied to it (row 762)"
  - "LOAD_CHECK_LIMIT=5 per kind is the union smoke slice (row 763)"
  - "No tool fix was needed (row 764)"
  - "INT-01 stays partial: staging Needs Human"
requirements-completed: []
duration: 43min
completed: 2026-11-11
commits: 4
plan_head_before: 493231db928c0fdf4dd4b91187c7f479e0497b7b
plan_head_after: 9ce34c86ef9dfb898f90e8bd5fda292726fcee56
actuals:
  tokens: 9000
  tasks: 3
  commits: 4
---

# Phase 2 Plan 55: Integration union, union coverage and the restage handoff Summary

**The world, actors and data-ui lane stores are one integration lane store (catalog `bba52c47...`, 15,427 files). Its slices equal the three lane catalogs, and every one of 8,286 pinned files is present with its SHA-256. The gap census over the union passes. Every kind has a 5-key load slice on the union catalog. `docs/coverage.md`, STATUS and STATE now describe the union, and the owner has one exact restage command. INT-01 stays "partial: staging Needs Human".**

## Performance

- Duration: about 43 min (2026-11-11 06:12 to 06:55 Riga). DATABASE-PC, and `check-machine-schedule.mjs` reported `activeWindow: null` before every run.
- Tasks: 3 of 3.
- Every heavy run (union, pin check, census, sweeps, Vitest) ran at BelowNormal through `run_below_normal.py` in the orchestration helpers folder.

## Task 1: union and gap census (tracer)

Before the union:
- Each lane catalog holds `sourceCatalogSha256` `55c12147db306264deb2be33f6b9cd661d1376d12dc2aa6473be3700322972fe`, and that equals the SHA-256 of the read-only `public/l2/catalog.json` bytes.
- The union copies every file under the three lane `l2` folders except `catalog.json` and `coverage.json` (02-03 rule):
  - world: 11,652 files, 7,609,142,341 bytes
  - actors: 3,475 files, 2,129,947,441 bytes
  - data-ui: 299 files, 53,941,669 bytes
  - total: 9,793,031,451 bytes
- Free disk was 111,483,015,168 bytes. That is above the total plus the 02-02 batch floor `BATCH_MINIMUM_FREE_BYTES` (4,294,967,296).

`python -B scripts/native_store/write_lane_catalog.py --lane integration --union world --union actors --union data-ui` ran in 10 min 56 s with exit 0. It wrote `catalogSha256` `bba52c475030586905cfb2f5eeef509f6862a21b8605a379a2b89baca301008c` and 15,427 files. It refused nothing.

Union and pin check (`scratch-02-55/check_union_pins.py` in the orchestration helpers folder, read-only):

```
models: lanes {'world': 0, 'actors': 282, 'data-ui': 0} union 282 disjoint True equal True
textures: lanes {'world': 0, 'actors': 0, 'data-ui': 4} union 4 disjoint True equal True
npcProfiles: lanes {'world': 0, 'actors': 4, 'data-ui': 0} union 4 disjoint True equal True
combatAudio: lanes {'world': 0, 'actors': 26, 'data-ui': 0} union 26 disjoint True equal True
effectComponents: lanes {'world': 0, 'actors': 3064, 'data-ui': 0} union 3064 disjoint True equal True
tiles: lanes {'world': 62, 'actors': 0, 'data-ui': 0} union 62 disjoint True equal True
tables: lanes {'world': 0, 'actors': 0, 'data-ui': 43} union 43 disjoint True equal True
windows: lanes {'world': 0, 'actors': 0, 'data-ui': 248} union 248 disjoint True equal True
pinned files checked 8286 served from public/l2 0 missing 0 mismatched 0
```

- The plan's verify printed `union slices differ: []`.
- `python -B -m unittest discover -s tests/pipeline -p "test_gap_census.py" -v` ran 19 tests, OK, including the real-data `GapCensusCompletenessTests`.
- `build_coverage_report.py --store-root artifacts/lane-store/integration/l2 --census-lanes world actors data-ui integration --markdown docs/coverage.md` passed the census. It wrote `artifacts/lane-store/integration/l2/coverage.json`.
- `git status --short public` printed nothing.

## Task 2: one load-sweep slice per kind on the union

Port 5173 had no listener before each slice. Every slice ran as `NATIVE_STORE_ROOT=integration LOAD_CHECK_KIND=<kind> LOAD_CHECK_LIMIT=5 pnpm test:e2e tests/browser/load-sweep-<kind>.spec.ts`, and each Playwright run reported `1 passed`.

| Kind | Checked keys | Statuses | Union keys still unrecorded |
| --- | --- | --- | --- |
| windows | AbnormalStatusWnd, AssistIcon, Back1, Back2#1, Back2#2 | 5 pass | 243 of 248 |
| tiles | 15_20, 15_21, 15_22, 15_23, 15_24 | 5 failed: "Native tile <id> pins no native-tile-collision resource" | 57 of 62 |
| npcs | 12077, 12564, 14001, 14002, 14003 | 5 pass (asset schema 2) | 995 of 1,000 |
| items | 1, 10, 104, 11, 1142 | 5 pass (asset schema 2) | 91 of 96 |
| skills | 1011:1, 1011:10, 1011:11, 1011:12, 1011:13 | 5 pass | 3,059 of 3,064 |

- Record file: `artifacts/lane-store/integration/load-checks/bba52c475030586905cfb2f5eeef509f6862a21b8605a379a2b89baca301008c.json`, holding 25 records.
- The tile failures carry the same reason the world lane records hold for the same keys (lane catalogs `0f5a15ca` and `45f5e12d`): these are 5 of the 40 converted tiles without a collision resource. The union has no tile pass yet. This is listed under Open follow-ups.
- After the slices, the coverage report re-ran over the union. Free disk after the runs: 101,243,428,864 bytes.

## Union coverage (docs/coverage.md, catalog bba52c47, census lanes actors, data-ui, integration, world)

| Part | Denominator | Converted | Loads pass | Loads failed | Gap | Pending |
| --- | --- | --- | --- | --- | --- | --- |
| data | 40 | 40 | 0 | 0 | 0 | 0 |
| world | 163 | 62 | 22 | 40 | 22 | 79 |
| player-characters | 15 | 0 | 0 | 0 | 15 | 0 |
| ui | 248 | 248 | 20 | 0 | 0 | 0 |
| npcs | 6519 | 1000 | 5 | 0 | 1527 | 3992 |
| items | 9238 | 96 | 51 | 0 | 8074 | 1068 |
| skills-effects | 29812 | 3064 | 5 | 0 | 18210 | 8538 |
| sandbox, audio, minimap, movement-geodata | unknown | 0 | 0 | 0 | 0 | unknown |

- Loads counts every record pinned to the catalog that served it. Union records count against `bba52c47`. Through `--census-lanes`, each lane's own records count against that lane's current catalog (the 02-26 design). No lane record was copied to the union (row 762).
- No row shows loads pass without a record.

## Task 3: handoff, status and the load-check note

- `write_lane_catalog.py --lane integration --plan` printed the command below. STATE.md "Needs Human" now holds it verbatim:
  `Needs Human (plan 02-55): cd C:/laragon/www/l2-browser-client && python -B C:/Users/rolan/.t3/worktrees/l2-browser-client/autonomous-roadmap/scripts/native_store/merge_lane_store.py --lane-store C:/Users/rolan/.t3/worktrees/l2-browser-client/autonomous-roadmap/artifacts/lane-store/integration/l2 --target public/l2 --expected-base-catalog-sha256 55c12147db306264deb2be33f6b9cd661d1376d12dc2aa6473be3700322972fe`
- The line after it says:
  - the command runs outside machine windows in the main checkout
  - once it has run, the separate lane merge lines refuse by design
  - the integration thread then re-runs the sweeps against the shared store
- The 01-12 v1 line and the 02-33 line are kept.
- An INT-01 line records "partial: staging Needs Human" with the union catalog SHA-256 and the per-part counts.
- STATUS.md: the data, world, player-characters, ui, npcs, items and skills-effects lines carry the union counts in place. The data line's stale "33 decoded, 4 decode-failed" now reads "all 37 decoded", per the data evidence doc. Parts with no denominator keep their lines.
- docs/VERIFICATION.md "Now" has one bullet. It holds the slice command, the port 5173 rule and the record path, worded as in `loadCheckSkipReason`. It also says that a rerun continues with unrecorded keys and that union loads come only from union slices.
- Checks:
  - the Needs Human grep prints `1`
  - `grep -c "partial: staging Needs Human" .planning/STATE.md` prints `1`
  - `grep -c -i "passes stage A" STATUS.md` prints `0`
  - `grep -c "load-sweep-" docs/VERIFICATION.md` went from `0` to `1`
  - `git diff --quiet -- public` exits 0
  - `pnpm vitest run tests/unit/laneOwnership.test.ts`: 36 passed
  - `node scripts/check-lane-ownership.mjs --base 493231d --part adapter-dispatch`: "lane integration: 0 foreign paths", exit 0, before the docs commit
  - no em or en dash in any added line

## Task commits

1. `8c987a5` Regenerate coverage from the integration union of the world, actors and data-ui lane stores (02-55 task 1)
2. `c287a01` Count the union load-sweep slices in coverage (02-55 task 2)
3. `9ce34c8` Record the union restage command, INT-01 partial status, union coverage per part and the load-check note (02-55 task 3)

The measured `commits: 4` for `493231d..9ce34c8` includes `166038b` "Review the 02-49 movement overlap runs" (06:13 Riga, `tools/reference-overlap/**`). That is an orchestrator commit that landed on this branch at the start of the plan. It is not a 02-55 commit.

## Deviations from Plan

None. No tool misbehaved, and no code changed.

- Not in the plan's file list: the STATUS data line's stale decode count is corrected to the data evidence doc, because STATUS must agree with the docs.
- `.planning/STATE.md` also gains one Open follow-up (union tile loads).

## Decisions logged

- OVERNIGHT-DECISIONS row 762: union loads only from union slices. Lane records are not carried over.
- Row 763: `LOAD_CHECK_LIMIT=5` per kind is the union smoke slice.
- Row 764: no tool fix.

## Requirements

- INT-01: **partial: staging Needs Human**, left Pending in REQUIREMENTS.md. One union coverage report exists, but the shared store is not restaged, and the side-by-side checks belong to Phase 3.

## Needs Human

- `Needs Human (plan 02-55): <merge command above>`, run in the main checkout outside machine windows. After it, the integration thread re-sweeps the shared store.

## Open follow-ups

- Union tile loads: the first union tiles slice reached only collision-less tiles. Further `LOAD_CHECK_KIND=tiles` slices on `NATIVE_STORE_ROOT=integration` reach the 22 tiles that pass on the world lane, or the re-sweep happens after the restage.

## Reference overlap

Not applicable. This plan wrote no code.

## Known Stubs

None.

## Threat Flags

None. T-02-55-01 to T-02-55-04 are mitigated as planned: there was a duplicate refusal and a slice and pin check, no store writer ran, `public` is unchanged, and free disk was measured before the union.

## Process cleanup

- This plan started:
  - the union, pin-check and census Python runs, all in the foreground and exited
  - five Playwright runs, each with its own Vite webServer on 5173, all exited when their run ended
  - one Vitest run, exited
- After the last run:
  - `netstat -ano | grep LISTENING | grep -E ':5173 |:5175 '` printed nothing (exit 1)
  - the `Get-CimInstance Win32_Process` listing filtered on `autonomous-roadmap` and `127.0.0.1:5173` showed only the listing process itself
- Nothing needed stopping, and nothing this plan started remains.

## Self-Check: PASSED

- Found: `docs/coverage.md`, `docs/VERIFICATION.md`, `STATUS.md`, `.planning/STATE.md`, `.planning/OVERNIGHT-DECISIONS.md`, `artifacts/lane-store/integration/l2/catalog.json`, `artifacts/lane-store/integration/l2/coverage.json` and the union load-check record file.
- Commits `8c987a5`, `c287a01` and `9ce34c8` are ancestors of HEAD.
