---
phase: 02-stage-a-breadth
plan: 23
subsystem: integration
tags: [int-01, load-check, sweep, resumable, lane-store, playwright, harness]
status: complete

requires:
  - phase: 02-stage-a-breadth
    provides: "02-05 buildNativeCatalogIndex converted, not-in-catalog and gap lookups with window: keys; 02-06 loadCheckRecordFile hashServedLaneCatalog, readLoadCheckRecords, writeLoadCheckRecord and NATIVE_STORE_ROOT lane serving; 02-07 coverage reading load-check records; 02-20 native-window.html window harness; 02-22 loadConvertedNpcModel and npc:20001 in the actors lane"
provides:
  - "tests/browser/support/loadCheckRecords.ts: LOAD_CHECK_KINDS, loadCheckKindKeyPrefix, loadCheckLaneNames, readLoadCheckSliceSettings, pendingLoadCheckKeys, keysNotRecordedExactlyOnce, lowestAssetManifestSchemaVersion, loadCheckSpecTitle, loadCheckSkipReason, loadCheckSliceTimeoutMilliseconds, firstMessageLine, runLoadCheckSlice, checkHarnessLoadKey, playwrightLoadCheckActions, loadCheckKeyTimeoutMilliseconds (90,000), loadCheckTileLoadTimeoutMilliseconds (180,000)"
  - "tests/browser/harness/load-check.html and loadCheckHarness.ts: ?list=<prefix> and ?key=<key> modes, checkNpcLoadKey, checkItemLoadKey, checkSkillLoadKey, fetchVerifiedAssetPackage, window.__loadCheckHarness"
  - "tests/browser/load-sweep-windows.spec.ts, load-sweep-npcs.spec.ts, load-sweep-items.spec.ts, load-sweep-skills.spec.ts"
  - "tests/unit/loadCheckRecords.test.ts (17 cases)"
affects: [02-34, 02-38, 02-42, 02-43, 02-47, 02-54, 02-55, 02-70]

actuals:
  tokens: 11000
  tasks: 3
  commits: 15
plan_head_before: d3a12f0ebf75a5974515070b9f6265ce60c79ef8
plan_head_after: fe5142fc84e71d491a7f0b306ea9672ca0330ef9

tech-stack:
  added: []
  patterns:
    - "One slice runner over injected page actions; specs differ only in their checkKey"
    - "A load-check record is written per key right after its browser check through the 02-06 atomic writer; reruns skip keys already recorded under the served catalog SHA-256"
    - "Windows are checked through the 02-20 window layer on native-window.html, never through a second window loader"

key-files:
  created:
    - tests/browser/support/loadCheckRecords.ts
    - tests/unit/loadCheckRecords.test.ts
    - tests/browser/harness/load-check.html
    - tests/browser/harness/loadCheckHarness.ts
    - tests/browser/load-sweep-windows.spec.ts
    - tests/browser/load-sweep-npcs.spec.ts
    - tests/browser/load-sweep-items.spec.ts
    - tests/browser/load-sweep-skills.spec.ts
  modified:
    - .planning/STATE.md
    - .planning/ROADMAP.md

key-decisions:
  - "The tiles sweep is plan 02-70, which depends on 02-16 (OVERNIGHT-DECISIONS row 303); 02-23 completes with Tasks 1 and 2"
  - "fetchVerifiedAssetPackage reuses the exported loadNativeModelPackages of src/assets/native/loadNativeCatalog.ts, which checks the archive SHA-256 before readAssetPackage; no third archive fetch exists"
  - "INT-01 stays Pending: this plan builds the sweep infrastructure; the coverage report and the per-kind slices land in later plans"

metrics:
  duration: 8min for Task 3; Tasks 1 and 2 ran 2026-11-09 02:05 to 02:31 Riga
  completed: 2026-11-09
---

# Phase 2 Plan 23: Resumable load-check sweeps for windows, npcs, items and skills Summary

One slice runner turns "loads in the offline sandbox" into per-key records pinned to the served lane catalog SHA-256: windows open through the 02-20 window layer, npcs build a NativeActor, items build package previews and skills load their effect components, and a rerun continues at the first unrecorded key.

## Scope

- Tasks 1 and 2 are commits 97e0f7b and 7e2d1ca. The pause note is 798e712.
- The frontmatter `commits: 15` is `git rev-list --count d3a12f0..HEAD`, measured before the docs commit. Only 3 of those commits belong to 02-23 (97e0f7b, 7e2d1ca, 798e712). The other 12 are 02-27 commits and integration commits made while 02-23 was paused.
- The tiles sweep (`tests/browser/load-sweep-tiles.spec.ts`), with its OVERNIGHT-DECISIONS rows for the load-check sweeps, moved to plan 02-70 (OVERNIGHT-DECISIONS row 303), because it needs the 02-16 `?map=` tile route. 02-47 depends on 02-70.

## Task 1: windows tracer slice (97e0f7b)

Record file `artifacts/lane-store/data-ui/load-checks/89aa9e6a142fbb2b044784e8b7088c13a7908cac3d4f3a116692646a1d13cb58.json` (read 2026-11-09 03:27 Riga):

| Key | Status | atRiga | assetManifestSchemaVersion | Written by |
|-----|--------|--------|----------------------------|------------|
| window:StatusWnd | pass | 2026-11-09T01:32:57+02:00 | 2 | 02-20 tracer (before this plan) |
| window:AbnormalStatusWnd | pass | 2026-11-09T02:25:10+02:00 | null | 02-23 first slice |
| window:AssistIcon | pass | 2026-11-09T02:25:21+02:00 | null | 02-23 first slice |
| window:Back1 | pass | 2026-11-09T02:25:53+02:00 | null | 02-23 second slice |
| window:Back2#1 | pass | 2026-11-09T02:26:04+02:00 | null | 02-23 second slice |

- Record count went from 1 (StatusWnd) to 5: the first `LOAD_CHECK_LIMIT=2` slice added two keys, and the second identical slice added two different keys in the index's sorted order. It skipped StatusWnd and the first two keys. This is the resumability run. The count comes from the record timestamps. The console output of the two runs was not kept.
- The data-ui catalog now hashes to `022a3af307d0a082f3417cb798884945e1ee127ac8da23bbcdc4c2dbfbb973ca` (248 windows, 36 tables). 02-27 changed it after these slices, so the next windows slice starts a new record file in which every converted window key is pending again. This is the designed behavior, and the 89aa9e6 records no longer count for coverage.
- Skip reason check: no kept output shows a plain `pnpm test:e2e tests/browser/load-sweep-windows.spec.ts` reporting the `loadCheckSkipReason("windows")` text. That criterion is **unverified**. The skip condition and its text are covered by the Vitest.

## Task 2: npc, item and skill checks (7e2d1ca)

- npcs slice (`NATIVE_STORE_ROOT=actors LOAD_CHECK_KIND=npcs LOAD_CHECK_LIMIT=1`): `artifacts/lane-store/actors/load-checks/2961c011bc33841f7e0f11b01dfd2b2ee5706005ddd3a4c8d9a12c5a40d90731.json` holds one record, `npc:20001` pass at 2026-11-09T02:05:15+02:00 with schema version 2. 02-22 wrote it before Task 2 ran. The actors catalog (SHA-256 2961c011, unchanged) has 1 model and 1 npc profile, so npc:20001 is its only converted npc key. A slice would report zero checked and one skipped as already recorded, and the unchanged record file agrees with that. The slice's console output was not kept, so the npcs slice run is **unverified**. The items and skills specs skipping under `LOAD_CHECK_KIND=npcs` is also **unverified** for the same reason.
- `wc -l tests/browser/harness/loadCheckHarness.ts`: 151 (below 400).
- `grep -c "function fetchVerifiedAssetPackage"`: 1.
- Which fetch `fetchVerifiedAssetPackage` uses: neither `fetchVerifiedNativeResource` nor a direct `sha256` call. It calls the exported `loadNativeModelPackages(catalog, signal, [catalogId])` of `src/assets/native/loadNativeCatalog.ts`, which is the sandbox's own archive loader. That loader validates the record, fetches the archive, checks its SHA-256 against `archiveSha256` and then calls `readAssetPackage`. The npc check goes through `loadConvertedNpcModel` (02-22), which uses the same loader. There is no third copy.

## assetManifestSchemaVersion: null by kind

- windows: always null. The 02-20 harness result does not report the texture packages it read, so the windows spec writes null. The 02-20 tracer's own StatusWnd record carries 2.
- skills: always null. `checkSkillLoadKey` returns no versions, because effect components read no asset package.
- npcs and items: the archive's asset.json `schemaVersion` (the lowest over all `catalogIds` for items). npc:20001 carries 2.

## Free disk

Free disk before the Task 1 and Task 2 slices was not recorded. At this SUMMARY step `df -h /c` shows C: at 477G size, 464G used, 14G free (98 percent).

## Verification at this step

- `node scripts/check-machine-schedule.mjs`: `{"host":"DATABASE-PC","rigaTime":"2026-11-09T03:27:48+02:00","activeWindow":null}`
- `pnpm vitest run tests/unit/loadCheckRecords.test.ts`: 1 file passed, 17 tests passed.
- `pnpm typecheck`: exit 0.
- `git diff --name-only d3a12f0 7e2d1ca`: only `tests/browser/**` and `tests/unit/**` paths (the 8 files above).

## Lane ownership

`node scripts/check-lane-ownership.mjs --base d3a12f0 --part adapter-dispatch` (exit 1, run before the docs commit):

```
lane integration: 5 foreign paths
docs/parts/data/EVIDENCE.md
docs/parts/data/dat-table-inventory.json
scripts/data/table_name_indexes.py
scripts/prepare-native-player-aliases.py
scripts/test_effect_readiness.py
```

None of these paths comes from a 02-23 commit:

| Foreign path | Changed by |
|--------------|-----------|
| docs/parts/data/EVIDENCE.md | b37520e feat(02-27): npcname-e, itemname-e and skillname-e name indexes for the sandbox pickers |
| docs/parts/data/dat-table-inventory.json | 5ccd54b feat(02-27): decode every descriptor-linked table and derive the inventory tallies from the rows; 5b3ebc6 feat(02-27): decode zonename-e into a sealed lane manifest and its inventory row |
| scripts/data/table_name_indexes.py | b37520e feat(02-27) |
| scripts/prepare-native-player-aliases.py | 96c09fe Give the strict JSON, SHA-256 and guard helpers one owner each (OVERNIGHT-DECISIONS row 301) |
| scripts/test_effect_readiness.py | 96c09fe (OVERNIGHT-DECISIONS row 301) |

## Deviations from Plan

### Auto-fixed issues

None in Task 3.

### Interface drift from the plan text (Tasks 1 and 2, already committed)

- `playwrightLoadCheckActions(page, baseUrl, settings, checkKey)` takes the Playwright `baseURL` explicitly, because `hashServedLaneCatalog(baseUrl)` needs it.
- `loadCheckRecords.ts` exports these extra shared helpers: `loadCheckLaneNames`, which reads the keys of `.planning/lanes.json`; `keysNotRecordedExactlyOnce`, for the after-slice assertion; `loadCheckSliceTimeoutMilliseconds`; `firstMessageLine`; and `checkHarnessLoadKey`, which is the one `?key=` page check the npc, item and skill specs share. Each spec uses these helpers, so no spec repeats this logic.
- `fetchVerifiedAssetPackage` uses the exported `loadNativeModelPackages` and not one of the two options the plan named (see Task 2). The plan's "no third copy" rule holds.

### Task 3 tooling limits

- This session's worktree guard refused the PowerShell `Get-CimInstance Win32_Process` command-line listing. The process check therefore uses `netstat` and the `ps -W` process list (see Process cleanup).

## Requirements

- INT-01: **Pending**. This plan delivers the resumable sweep runner, harness and four specs. The coverage report and the per-kind slices that make "loads" real are the work of later plans: 02-34, 02-38, 02-42, 02-43 and 02-70.

## Known Stubs

None.

## Process cleanup

- `netstat -ano | grep LISTENING | grep -E ':5173 |:5175 '` printed nothing (exit 1). Nothing listens on 5173 or 5175.
- `ps -W` filtered for node, chrome, headless, playwright, esbuild and vite shows only three `node.exe` processes started Oct 29 (PIDs 71236, 71240, 91264), which predate this run. No chrome or chrome-headless-shell process remains. The Vitest and tsc runs of this step exited on their own.
- Nothing was stopped. Nothing this plan started remains.

## Self-Check: PASSED

- All 8 Task 1 and Task 2 files exist in the worktree.
- Commits 97e0f7b, 7e2d1ca and 798e712 are ancestors of HEAD.
