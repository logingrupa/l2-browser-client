---
phase: 261112-vod-load-sweeps-and-tile-walks-without-a-cat
plan: 01
subsystem: dev-server
status: complete
tags: [vite, native-store, lane-union-catalog, load-sweep]
requires: []
provides:
  - Lane union catalog kept by the dev server per native store root and per catalog file identity (D-01)
affects:
  - vite/nativeStoreRootPlugin.ts
tech-stack:
  added: []
  patterns:
    - One kept promise per native store root, keyed by the bigint stat identity of both catalog files
key-files:
  created:
    - tests/unit/keptLaneUnionCatalog.test.ts
  modified:
    - vite/nativeStoreRootPlugin.ts
decisions:
  - The source identity is read before the build starts, so a kept answer is never newer than its identity claims
  - The kept entry of a root is keyed by the JSON text of the comparable store root path and the comparable shared store root path
requirements_completed: [D-01]
requirements_deferred: [D-02, D-03, D-04, D-05, D-06, D-07]
metrics:
  duration: about 10 minutes
  completed: 2026-11-12
  tasks_completed: 1
  tasks_total: 3
  files_changed: 2
actuals:
  tokens: 4400
  tasks: 1
  commits: 1
plan_head_before: 277129e393764dcea1f17d253e725ea8d92f810f
plan_head_after: 0074b923c6e51184362b5222aeb6ef38bb0a7b30
---

# Quick task 261112-vod plan 01: load sweeps and tile walks without a catalog rebuild per key - summary

The dev server now builds the lane union catalog once per file identity of the lane catalog file and of the shared catalog file, instead of starting python for every `/l2/catalog.json` request.

Tasks 2 and 3 are deferred by the orchestrator ruling in the context file (2026-11-12, 23:55 Riga); nothing of them was started.

## Task 1: keep the lane union catalog in the dev server per catalog file identity

- **Commit:** `0074b92` (`0074b923c6e51184362b5222aeb6ef38bb0a7b30`) on `lane/speed`, two files: `vite/nativeStoreRootPlugin.ts`, `tests/unit/keptLaneUnionCatalog.test.ts`. Not pushed.
- **What changed in `vite/nativeStoreRootPlugin.ts`:**
  - The former `readLaneUnionCatalog` is `buildLaneUnionCatalog`, body and error texts unchanged (one python start per call).
  - `storeCatalogFileIdentity` reads a bigint `statSync` with `throwIfNoEntry: false`: `absent` for a missing file, else `dev:ino:size:mtimeNs`.
  - `laneUnionCatalogSourceIdentity` joins the identity of the lane catalog file and of the shared catalog file with a vertical bar.
  - Exported `LaneUnionCatalogBuild` and `createKeptLaneUnionCatalogReader(buildLaneUnionCatalog)`. One Map per reader, from the native store root to the source identity and the promise of the build. A matching identity returns the kept promise, running or ended. Another identity starts one build and replaces the root's entry. A rejected build removes its entry only while the root still holds that very entry.
  - Module constant `readLaneUnionCatalog = createKeptLaneUnionCatalogReader(buildLaneUnionCatalog)`; `readServedNativeCatalog` keeps its text and calls it.
  - Unchanged: the fixture branch, `sendServedNativeCatalog`, `sendNativeStoreBody`, `answerWithStatus`, every header and status code, `parseLaneUnionCatalogDocument`, `configureServer`.
- **TDD evidence:** the new test file ran first against the unchanged plugin: 8 failed, 2 passed (the two handler tests of the behavior block hold before and after the change by design, they guard the headers and the rebuild after a replaced file). After the change all 10 pass.

### Verify commands

| Command | Result |
| ------- | ------ |
| `python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py pnpm.cmd vitest run tests/unit/keptLaneUnionCatalog.test.ts tests/unit/nativeStoreRootPlugin.test.ts tests/unit/nativeStoreRootBuildAbsence.test.ts` | 3 files passed, 42 tests passed, 0 failed (keptLaneUnionCatalog 10, nativeStoreRootPlugin 30 unedited, nativeStoreRootBuildAbsence 2 unedited) |
| `python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py pnpm.cmd typecheck` | `tsc --noEmit` exit code 0 |

The nine tests of the behavior block pass by name:

- builds once for many requests while both catalog files keep their identity
- builds again after the lane catalog file changes
- builds again after the shared catalog file changes, appears or disappears
- shares one running build among requests that arrive before it ends
- does not keep a failed build
- a failed older build does not drop the answer of a newer build
- keeps one answer per native store root
- answers a kept catalog request with the status, body and headers of the building request
- serves the new lane catalog SHA-256 after the lane catalog file is replaced

## Deviations from the plan

**1. [Rule 2 - missing test] One test added beyond the behavior block**
- **Test:** "answers from the kept catalog, without a new build, while both catalog files keep their identity" in `tests/unit/keptLaneUnionCatalog.test.ts`.
- **Reason:** the two handler tests of the behavior block pass against the old code too, so no test of the plan failed when `readServedNativeCatalog` called the build directly. This test is the only one that proves the request handler goes through the kept reader. It rewrites the lane catalog in place with other text of the same length and sets the same modification time, so device, inode, size and modification time stay equal, and expects the second request to answer the first body and SHA-256 header. It failed before the change and passes after it.
- **Commit:** `0074b92`.

**2. Plan commit ledger file not written**
- **Reason:** the ledger of the executor protocol lies in the git folder of the main checkout (`C:/laragon/www/l2-browser-client/.git/worktrees/l2b-speed`), outside this worktree, and the session refused the compound command that writes it. `plan_head_before` in the frontmatter is the HEAD read at the start of the run (`277129e`), and `commits: 1` is measured with `git rev-list --count 277129e..HEAD`.

**3. Requests in the handler tests use `fetch`, not the `rawRequest` helper of `tests/unit/nativeStoreRootPlugin.test.ts`**
- **Reason:** that file must stay unedited, so the helper could not move to a shared module, and a copy would repeat it.

No other deviation. No tracked file outside the two task files was modified at any point of the run. No doc edit was needed: `docs/OUTPUT_CONTRACT.md` describes where the catalog comes from, not how often it is built.

## Deferred by the orchestrator ruling

Tasks 2 and 3 (D-02 to D-07: `LOAD_CHECK_WORKERS`, shards, part files, the fold, the run marker, the five sweep specs, the walk spec and the real windows sweep) are deferred by the orchestrator ruling and were not started. The must_haves of the plan that belong to them are open, including the heading "Caller rules", which task 3 owns.

## Not measured here

The request time of `/l2/catalog.json` before and after, and the gain on a real sweep, are measured by the orchestrator afterwards (context file, last section). No dev server, browser run, conversion or full unit suite was started by this run.

## Known stubs

None.

## Process check

After the last command no node or python process started by this run is left. The two python processes whose command line holds `l2b-speed-proof` (process ids 19488 and 24220 at the time of the check) belong to the tile conversion of another checkout and were not touched.

## Self-check: PASSED

- FOUND: `vite/nativeStoreRootPlugin.ts` (modified in `0074b92`)
- FOUND: `tests/unit/keptLaneUnionCatalog.test.ts` (created in `0074b92`, 285 lines, min_lines 90)
- FOUND: commit `0074b92` is HEAD of `lane/speed`
- `git status --short` after the commit lists only the two untracked folders under `.planning/quick`
