---
phase: 02-stage-a-breadth
plan: 70
subsystem: integration
tags: [int-01, load-sweep, tiles, native-route, map-parameter, playwright]
status: complete
requires:
  - phase: 02-23
    provides: tests/browser/support/loadCheckRecords.ts slice runner, harness list mode, loadCheckSkipReason and loadCheckTileLoadTimeoutMilliseconds
  - phase: 02-16
    provides: the ?map=<XX_YY> tile route and window.__nativeSlice.snapshot().world.manifestSha256
  - phase: 02-06
    provides: tests/browser/support/loadCheckRecordFile.ts atomic record writer and served lane catalog SHA-256
provides:
  - "tests/browser/load-sweep-tiles.spec.ts: resumable tiles slice that loads each converted tile: key by ?map= on the native route"
affects: [02-47, 02-26, 02-07]
tech-stack:
  added: []
  patterns:
    - "Tiles check opens /?map=<XX_YY> in its own page and passes only when the snapshot world manifestSha256 equals the served tiles record read through readTileCatalogRecord"
key-files:
  created:
    - tests/browser/load-sweep-tiles.spec.ts
  modified:
    - .planning/OVERNIGHT-DECISIONS.md
key-decisions:
  - "Rows 498 to 502: where each kind is checked, the 90 s and 180 s bounds with failed records, failed keys final per catalog SHA-256, windows as the 02-23 tracer kind, the sweep command in loadCheckSkipReason and the docs note moved to 02-55"
  - "Row 503: tile:20_20 is converted only through the legacy section record, has no tiles record, and gets a failed record for the ?map= route"
  - "Row 504: the 02-16 tile:20_21 record was set aside and rechecked so the pass branch is proven by a browser load"
requirements-completed: []
duration: 12min
completed: 2026-11-09
commits: 1
plan_head_before: dd7a3157a35f5469248f2a747e6425be82f4699c
plan_head_after: 2463494
actuals:
  tokens: 6000
  tasks: 1
  commits: 1
---

# Phase 2 Plan 70: Tiles load sweep through ?map= Summary

The tiles kind now has a resumable sweep slice: `tests/browser/load-sweep-tiles.spec.ts` opens each converted `tile:` key on the native route by `?map=<XX_YY>` and records pass only when the snapshot `world.manifestSha256` equals the served tiles record.

## What was built

- `tests/browser/load-sweep-tiles.spec.ts` uses the 02-23 shape: `readLoadCheckSliceSettings`, `test.skip` with `loadCheckSkipReason("tiles")`, `runLoadCheckSlice` with `playwrightLoadCheckActions` (key list from the harness `?list=tile:` mode), and the exactly-once record check.
- The tiles check reads the tile's `manifestSha256` from the served `/l2/catalog.json` through the Playwright request context and `readTileCatalogRecord`, opens `/?map=<XX_YY>` (URL-encoded) in a fresh page, collects page errors, and waits up to `loadCheckTileLoadTimeoutMilliseconds` (180 s) for `#loading` to disappear with `window.__nativeSlice` present, or for the loading element's error state.
- Failed outcomes: a missing tiles record, a world failure text (loading error state or `snapshot().worldFailure`), a page error, a manifest SHA-256 mismatch, or the 180 s bound (the runner turns the thrown timeout into a failed record with its first line).
- Test timeout: `loadCheckSliceTimeoutMilliseconds(settings, loadCheckTileLoadTimeoutMilliseconds)`, which is `limit * 180_000 + 120_000`.
- `assetManifestSchemaVersion`: tiles always write null. The world snapshot reports no asset package schemaVersion (the tile route loads tile manifests and chunks, not asset packages), so the lowest reported version is none. No tile key depends on v1 acceptance through this field.
- `tests/browser/world-tile-walk.spec.ts` is untouched; both specs read the same public debug field without a shared helper.

## Verification

- `node scripts/check-machine-schedule.mjs` printed `activeWindow: null` before each run. Free disk on C before the slices: 5.7 GB.
- `pnpm typecheck`: clean.
- `pnpm test:unit` (nice -n 10): 163 files passed, 5 skipped; 2240 tests passed, 83 skipped.
- Port 5173 was free (netstat printed nothing). The five sweep specs with no sweep variables: `5 skipped` (items, npcs, skills, tiles, windows).
- Real tiles slices on the world lane (`NATIVE_STORE_ROOT=world LOAD_CHECK_KIND=tiles`), catalog SHA-256 `34b83e8370b9cf2030a0bf8afa36ee1899e7b8f3acda06ac4e74c9fc7d18a741`:
  - `LOAD_CHECK_LIMIT=1`: checked `tile:20_20` (failed: "served catalog http://127.0.0.1:5173/l2/catalog.json has no tiles record 20_20"), skipped `tile:20_21` as recorded.
  - After setting aside the record file (row 504), `LOAD_CHECK_LIMIT=2`: checked `tile:20_20` (failed, same reason) and `tile:20_21` (pass, loaded by `?map=20_21` in the browser, recorded 18:08:41 Riga). Spec passed in 1.2 min; the exactly-once check held. The set-aside copy was deleted.
- `grep -l "loadCheckSkipReason(" tests/browser/load-sweep-*.spec.ts | wc -l`: 5.
- `git diff --quiet -- tests/browser/world-tile-walk.spec.ts`: exit 0.
- `git status --short public`: empty.
- `node scripts/check-lane-ownership.mjs --base dd7a315 --part adapter-dispatch` after the code commit: "lane integration: 0 foreign paths", exit 0.
- No FPS or timing claims: these runs use SwiftShader.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Served catalog SHA-256 comes from a header, not hashed bytes**
- The plan text names `hashServedLaneCatalog`; the 02-06 module now exports `servedLaneCatalogSha256`, which reads the `X-Native-Store-Lane-Catalog-Sha256` header. The runner already uses it through `playwrightLoadCheckActions`; the tiles check fetches the catalog JSON separately only to read the tiles record.

**2. [Rule 2 - Correctness] Legacy section tile keys**
- The harness list mode reports `tile:20_20` as converted through the legacy section record `map-20-20-section`, while `?map=` loads only tiles records. The check records it failed with the missing tiles record as reason (row 503) instead of passing on catalog presence.

## Known Stubs

None.

## Needs Human

None.

## Process cleanup

- Started processes: three Playwright runs (each with its own `pnpm dev` webServer on 5173 and a headless Chromium), all exited with the runner.
- After the runs `netstat -ano | grep LISTENING | grep -E ':5173 |:5175 '` printed nothing. `ps -W` lists no node, Chromium or headless shell started after 18:02 today; the remaining node.exe (Oct 29), msedge and msedgewebview2 processes predate this plan and belong to other owners. PowerShell `Get-CimInstance` was refused by the session guard, so the check used `netstat` and `ps -W`.

## Requirements

- INT-01: Pending. The tiles kind now sweeps in resumable slices; the coverage report and the remaining slices land in later plans (02-47 ends with one slice of this spec).

## Self-Check: PASSED

- FOUND: tests/browser/load-sweep-tiles.spec.ts
- FOUND: 2463494 in HEAD history
