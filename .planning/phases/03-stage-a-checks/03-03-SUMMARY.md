---
phase: 03-stage-a-checks
plan: 03
subsystem: adapter-dispatch
status: complete
tags: [typescript, playwright, load-sweep, integration-union, stage-a]
requires:
  - phase: 02-stage-a-breadth
    provides: resumable load sweep slices, the load-check record file, the integration union writer
provides:
  - LOAD_CHECK_KEYS selector (selectedKeys in readLoadCheckSliceSettings, selected order in pendingLoadCheckKeys)
  - servedTileCatalog.ts, the tiles spec reading the served tile catalog once per slice
  - one load-check record per converted union key of the five load kinds on union bba52c47
affects: [03-04, 03-05, 03-11, 03-12, 03-13, 03-14, 03-15]
actuals:
  tokens: 5960
  tasks: 3
  commits: 3
plan_head_before: c77fd072209cb47db16a7b2676e8ba8964e20ca6
plan_head_after: b23e7e7ef2dbdfc4ba7f5487f38259c3f1fc8eb4
tech-stack:
  added: []
  patterns:
    - "An operator key selector is validated at the environment boundary (prefix, catalog key, unique, non-empty) and again against the served converted keys"
    - "A slice reads served catalog facts once at its start, so no per-key request reuses an idle keep-alive socket"
key-files:
  created:
    - tests/browser/support/servedTileCatalog.ts
    - tests/unit/servedTileCatalog.test.ts
  modified:
    - tests/browser/support/loadCheckRecords.ts
    - tests/browser/support/loadCheckRecordFile.ts
    - tests/unit/loadCheckRecords.test.ts
    - tests/browser/load-sweep-tiles.spec.ts
    - docs/VERIFICATION.md
key-decisions:
  - "P813: slice sizes from the first measured slice per kind; every run stayed under 26 minutes"
  - "P814: proceeded past the phase start gate with a concurrent agent's uncommitted scripts edits present; committed only this plan's paths"
  - "P815: tile:16_10 (ECONNRESET) and npc:18168 (mid-sweep source reload) keep their records and are flagged as infrastructure results for 03-11"
  - "P816: the TS harness key list has npc:21622 and skill:3:1 that the Python catalog_index_keys lacks; recorded as an open follow-up"
duration: 137min
completed: 2026-11-11
---

# Phase 3 Plan 03: Union currency, key-list sweep selector and full union load sweeps summary

**All 4,470 converted union keys of the five load kinds on union `bba52c47...` now have exactly one load-check record, and a converter fix can re-sweep only its touched keys with `LOAD_CHECK_KEYS=<key,key>`.**

## Performance

- Duration: about 137 min (2026-11-11 10:11 to 12:28 Riga), most of it background sweep slices
- Tasks: 3 of 3
- Plan commits: 3 (the branch range `c77fd07..b23e7e7` holds 52 commits, because concurrent review follow-up agents commit on the same branch; only the 3 listed below are this plan's)

## Union currency (Task 1)

- Free disk before the rebuild: 98 GB free of 477 GB on C: (80 % used); after the plan 97 GB.
- `python -B scripts/native_store/write_lane_catalog.py --lane integration --union world --union actors --union data-ui` at BelowNormal took 9 min 37 s and exited 0.
- Union catalog SHA-256: `bba52c475030586905cfb2f5eeef509f6862a21b8605a379a2b89baca301008c`, equal to `bba52c47...` (unchanged; source catalog SHA-256 `55c12147db306264deb2be33f6b9cd661d1376d12dc2aa6473be3700322972fe`). Slices: 62 tiles, 248 windows, 43 tables, 282 models, 4 npc profile packs, 4 textures, 3,064 effect components, 26 combat audio.
- Tracer: `NATIVE_STORE_ROOT=integration LOAD_CHECK_KIND=windows LOAD_CHECK_LIMIT=1 LOAD_CHECK_KEYS=window:StatusWnd pnpm test:e2e tests/browser/load-sweep-windows.spec.ts` passed in 40 s and wrote `{"key": "window:StatusWnd", "status": "pass", "reason": null, "atRiga": "2026-11-11T10:23:38+02:00", "assetManifestSchemaVersion": null}`; the union load file holds exactly one record for it.

## Union load results on bba52c47 (Tasks 2 and 3)

The pending-count command prints `{'tile': 0, 'npc': 0, 'item': 0, 'skill': 0, 'window': 0}`. The record file `artifacts/lane-store/integration/load-checks/bba52c47....json` holds 4,472 records (4,470 union keys plus the 2 harness-only keys of P816), no duplicates.

| Kind | Converted | Pass | Failed | Slices this plan (limit: wall seconds) |
| --- | --- | --- | --- | --- |
| windows | 248 | 248 | 0 | 1 by name: 43; 2: 35; 40: 3 (crashed at start, no key, see deviations); 40: 74; 250: 240 |
| items | 96 | 96 | 0 | 100: 251 |
| tiles | 62 | 22 | 40 | 10: 111; 60: 522 |
| npcs | 1,000 | 999 | 1 | 50: 111; 1000: 1,432 |
| skills | 3,064 | 1,835 | 1,229 | 100: 153; 1000: 1,296; 1000: 1,521; 1000: 1,286 |

Five keys per kind were already recorded by 02-55; every other record came from this plan's slices on the union catalog. No lane record was carried over.

Failure reasons grouped by first line:
- tiles, 39: `world failure: Unable to enter the world ... Native tile <id> pins no native-tile-collision resource.` These are the map licensee 18 (3), 23 (25), 25 (6) and 30 (5) tiles, the STATE Open follow-up P20 cites; not a tooling defect.
- tiles, 1: `tile:16_10` `apiRequestContext.get: read ECONNRESET`. Infrastructure: a keep-alive race in the spec, fixed in a9883e1. The tile is licensee 25 and pins no collision resource, so its own outcome is expected to be the collision failure above.
- npcs, 1: `npc:18168` `page error: The requested module '/src/effects/particles/sim/particleRotation.ts?t=1794387456012' does not provide an export named 'rotatorAxes'`. Infrastructure: a concurrent agent's commit 9c1fa7b (10:58) changed that module while the dev server served the sweep, and the hot reload served a half-updated module graph. Not a converter defect.
- skills, 1,145: `Effect components: invalid atlas tile range.` (`src/effects/nativeEffectComponents.ts:161`, validator unchanged since 2026-11-07, so a real finding for 03-11).
- skills, 84: `Effect components: invalid primitive binding.` (a real finding for 03-11).

## Accomplishments

- `readLoadCheckSliceSettings` returns `selectedKeys` from the optional `LOAD_CHECK_KEYS`. It refuses an empty entry, an entry outside the kind prefix, a non-catalog key and a duplicate. `pendingLoadCheckKeys` keeps the selected order, refuses an unconverted selected key, skips recorded keys and applies the limit. `loadCheckSkipReason` names the setting. `isCatalogKey` is shared from `loadCheckRecordFile.ts` and has one owner.
- The tiles load sweep reads the served tile catalog once per slice (`servedTileCatalog.ts`), so no per-key request reuses an idle keep-alive connection.
- `docs/VERIFICATION.md` "Now" names `LOAD_CHECK_KEYS=<key,key>` for re-sweeping the keys a converter fix touched.

## Task commits

1. Task 1 (tracer): `f07c6a4` Add the LOAD_CHECK_KEYS selector to load sweep slices so a converter fix can re-sweep only its touched keys (03-03 task 1)
2. Task 2: `a9883e1` Read the served tile catalog once per tiles load sweep slice instead of once per key (03-03 task 2)
3. Task 3: `b23e7e7` Name the LOAD_CHECK_KEYS re-sweep selector in the VERIFICATION load-check bullet (03-03 task 3)

## Requirements

- CHECK-01: contributes. Every converted union key now has the load result the pair queue needs for eligibility. Pairs are not yet captured, so the requirement stays open.
- CHECK-05: contributes. The loads column has complete data on `bba52c47`. The exit report is 03-05 and 03-15, so the requirement stays open.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 1 - Bug] Per-key served catalog request in the tiles sweep hit ECONNRESET**
- Found during: Task 2 (tiles slice of 10)
- Issue: `servedTileManifestSha256` fetched `/l2/catalog.json` once per key through `page.request`. After about 5 to 6 s idle, the dev server closed the keep-alive socket while the next request reused it, so `tile:16_10` was recorded failed with `read ECONNRESET` instead of its own outcome.
- Fix: the spec reads the served tile manifests once at the slice start through `readServedTileManifests` and looks keys up with `servedTileManifestSha256`. Vitest `tests/unit/servedTileCatalog.test.ts` covers the lookup and its refusals. The fixed spec ran green on the union (`LOAD_CHECK_KEYS=tile:20_20`, 62 skipped as recorded).
- Files: `tests/browser/load-sweep-tiles.spec.ts`, `tests/browser/support/servedTileCatalog.ts`, `tests/unit/servedTileCatalog.test.ts` (outside the plan's file list, since the defect sat in the tiles spec, not in `loadCheckRecords.ts`)
- Commit: a9883e1

**2. [Rule 2 - DRY] `isCatalogKey` exported from `loadCheckRecordFile.ts`**
- The selector needs the same catalog-key check the record validator uses. One owner now serves both. The file is outside the plan's file list.
- Commit: f07c6a4

**3. [Rule 3 - Blocking] The pending-count one-liner uses `read_measured_catalog(root)[0]`**
- As P613 recorded for 03-01, `read_measured_catalog` returns `(catalog, sha256)`. The fact checked is unchanged.

**4. [Rule 3 - Blocking] A background slice crashed at start without stdin**
- The first background windows slice exited at once with Playwright exit code 3221226505 (0xC0000409), before any key ran. Background slices now run with stdin from `/dev/null` and ran clean after that. The helper is `C:/laragon/l2b-orchestration/autonomous-roadmap/run_load_sweep_slice_03_03.sh`, outside the repo.

**5. Phase start gate (P814)**
- At the plan start, `git status --porcelain --untracked-files=no -- src scripts tests` listed a concurrent review follow-up agent's uncommitted edits. The executor went ahead, as the run's concurrency rule allows, and committed only its own paths with `git commit --only`.

## Lane ownership

`node scripts/check-lane-ownership.mjs --base c77fd07 --part adapter-dispatch` lists 61 foreign paths (`recipes/world/**`, `scripts/{world,actors,data}/**`, `src/{effects,scene,assets}/**`). All of them come from concurrent agents' commits in the range. None comes from this plan: the plan's commits touch only `tests/browser/**`, `tests/unit/**` and `docs/VERIFICATION.md`.

## Reference overlap

No DEC-OWN-12 area (`materials`, `bsp-visibility`, `movement`, `particles`, `network`) covers the files this plan wrote, so no overlap run applies.

## Open follow-ups

- `tile:16_10` and `npc:18168` hold infrastructure failure reasons on `bba52c47` (P815). 03-11 must not list them as converter defects. The next union rebuild re-sweeps them.
- Two key owners disagree (P816): the load-check harness list (`buildNativeCatalogIndex`) has `npc:21622` and `skill:3:1` as converted on the union, and the Python `catalog_index_keys` does not. Both keys passed and have records. The report reads the Python keys, so its counts do not change. 03-11 should take this as a defect of the key index.
- Sweeps serve the live working tree through Vite. A concurrent agent's `src` commit during a sweep can produce a hot-reload failure like `npc:18168`. Later sweep plans should check reasons for `?t=` module URLs.

## Verification

- `pnpm vitest run tests/unit/loadCheckRecords.test.ts tests/unit/servedTileCatalog.test.ts`: 27 passed.
- `pnpm typecheck`: exit 0.
- Tracer slice and tiles spec smoke: passed (above).
- Pending-count command for all five kinds: 0 pending, exit 0.
- `grep -c "LOAD_CHECK_KEYS" docs/VERIFICATION.md`: 1 (baseline 0).
- `git status --short public`: empty.

## Process cleanup

Every slice ran under Playwright's own `webServer` (`pnpm dev` on 5173), which stops when its run ends. At the end of the plan, nothing listens on 5173 or 5175. No node, chrome or Playwright process has this worktree path in its command line; only the checking shell itself does. No dev server was started by hand, and no Python run or ssh session remains.

## Self-Check: PASSED

- FOUND: tests/browser/support/servedTileCatalog.ts, tests/unit/servedTileCatalog.test.ts
- FOUND commits: f07c6a4, a9883e1, b23e7e7
