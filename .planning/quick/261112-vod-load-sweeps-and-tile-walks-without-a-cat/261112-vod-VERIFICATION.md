---
phase: 261112-vod-load-sweeps-and-tile-walks-without-a-cat
verified: 2026-11-12T21:59:13Z
status: passed
score: 4/4 must-haves verified
scope: task 1 only (D-01); tasks 2 and 3 are deferred by the orchestrator ruling in the context file
covered_files:
  - .planning/quick/261112-vod-load-sweeps-and-tile-walks-without-a-cat/261112-vod-PLAN.md
  - .planning/quick/261112-vod-load-sweeps-and-tile-walks-without-a-cat/261112-vod-SUMMARY.md
  - tests/unit/keptLaneUnionCatalog.test.ts
  - vite/nativeStoreRootPlugin.ts
covered_digest: "v4:sha256:7cffc56fd3cb1dc1f6df1961f8fc6c931cd0446fb977963ffe522d3f815f6a18"
behavior_unverified: 0
overrides_applied: 0
deferred:
  - truth: "LOAD_CHECK_WORKERS sets the Playwright workers and the shard count (D-02)"
    addressed_in: "A later quick task, after roadmap plan 02-89 has landed"
    evidence: "Context file, ruling of 2026-11-12 23:55 Riga: 'Tasks 2 and 3 are deferred, not executed'"
  - truth: "The global setup refuses a run whose effective worker count differs from LOAD_CHECK_WORKERS (D-02, D-05)"
    addressed_in: "A later quick task, after roadmap plan 02-89 has landed"
    evidence: "Same ruling"
  - truth: "N shard tests per sweep spec, part files, the fold and the run marker of a lane (D-03, D-04)"
    addressed_in: "A later quick task, after roadmap plan 02-89 has landed"
    evidence: "Same ruling"
  - truth: "Above one worker a check that does not pass writes no record; the summary heading Caller rules (D-05)"
    addressed_in: "A later quick task, after roadmap plan 02-89 has landed"
    evidence: "Same ruling"
  - truth: "The tile walk in several workers on the same part files and fold (D-06)"
    addressed_in: "A later quick task, after roadmap plan 02-89 has landed"
    evidence: "Same ruling"
  - truth: "The real windows sweep with 3 workers and then with one, and its two evidence commands"
    addressed_in: "A later quick task; the ruling says the real browser run is not part of this quick task"
    evidence: "Same ruling, 'Done for this quick task means'"
---

# Quick task 261112-vod: verification report, task 1 only

**Goal checked (narrowed by the orchestrator ruling):** the dev server keeps the lane union catalog per catalog file identity, so a `/l2/catalog.json` request with unchanged catalog files starts no python; headers, status codes and bytes are unchanged; nothing of tasks 2 and 3 is in the code.
**Verified:** 2026-11-12T21:59:13Z
**Status:** passed
**Re-verification:** no, first verification (no earlier VERIFICATION.md in the task folder)
**Commit checked:** `0074b92` on `lane/speed`, against base `277129e`

Tasks 2 and 3 of the plan (D-02 to D-07) are deferred by the ruling in the context file. Their must_haves are not checked here and are listed under `deferred` in the frontmatter.

## Goal achievement

### Observable truths of task 1

| # | Truth | Status | Evidence |
| - | ----- | ------ | -------- |
| 1 | The dev server builds the lane union catalog once per file identity of the lane catalog file and of the shared catalog file (dev, ino, size, mtimeNs from a bigint stat): unchanged identities get the kept bytes, a change of either file builds again, requests during a running build share it, a failed build is not kept, the fixture root reads its file on every request (D-01) | VERIFIED | Code: `storeCatalogFileIdentity` (`vite/nativeStoreRootPlugin.ts:205-208`) uses `statSync(..., { bigint: true, throwIfNoEntry: false })` and joins dev, ino, size, mtimeNs; `laneUnionCatalogSourceIdentity` (210-214) joins both files; `createKeptLaneUnionCatalogReader` (216-230) reads the identity first, returns the kept promise on a match, else sets the new entry before any await and removes a rejected entry only when the root still holds that very entry. Fixture branch (238-239) is byte-identical to the base commit. Behavior: 7 reader tests and the handler test "answers from the kept catalog, without a new build, while both catalog files keep their identity" pass in my own run. |
| 2 | A building request and a kept request of `/l2/catalog.json` answer the same status, body and headers: Cache-Control no-store, the lane catalog SHA-256 header, X-Native-Store-Source union, Content-Type, Accept-Ranges, Content-Length | VERIFIED | The file from `readServedNativeCatalog` to its end (112 lines: `answerWithStatus`, `sendNativeStoreBody`, `sendNativeStoreFile`, `sendServedNativeCatalog`, the handler, the plugin) compares byte-identical with `git show 277129e:vite/nativeStoreRootPlugin.ts`. The body of `buildLaneUnionCatalog` is byte-identical with the former `readLaneUnionCatalog` (same python arguments, same error text). Test "answers a kept catalog request with the status, body and headers of the building request" passes (two GET and one HEAD, all six header values and the status compared). |
| 3 | Nothing of tasks 2 and 3 is in the code | VERIFIED | `git diff --stat 277129e HEAD` lists exactly two files: `tests/unit/keptLaneUnionCatalog.test.ts` (285 added) and `vite/nativeStoreRootPlugin.ts` (40 changed lines). `git grep` over the tracked tree outside `.planning` for `LOAD_CHECK_WORKERS`, `loadCheckShards`, `loadCheckPartFile`, `servedLaneRun`, `shardRecordFilePath`, `shardRecordsStatus`, `playwright-run-`, `.part-`, `globalSetup`, `globalTeardown` finds nothing. `playwright.config.ts:13` still reads `fullyParallel: false, workers: 1`. |
| 4 | The named Vitest files pass and `pnpm typecheck` passes (done rule of the ruling) | VERIFIED | Both task 1 verify commands run by me through `run_below_normal.py pnpm.cmd`, see the table below. |

**Score:** 4/4 truths verified (0 present but behavior-unverified)

### Required artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `vite/nativeStoreRootPlugin.ts` | Kept catalog per native store root and catalog file identity; exports `createKeptLaneUnionCatalogReader`, `LaneUnionCatalogBuild` | VERIFIED | Both exported (lines 58, 216), 345 lines, used by the module constant at line 232 and by the test file. |
| `tests/unit/keptLaneUnionCatalog.test.ts` | Tests of the kept catalog, at least 90 lines | VERIFIED | 285 lines, 10 tests: the nine of the plan's behavior block by name plus one more (see the summary's deviation 1). |

### Key link

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `readServedNativeCatalog` | `createKeptLaneUnionCatalogReader` | module constant `readLaneUnionCatalog` wraps `buildLaneUnionCatalog` | WIRED | Line 232: `const readLaneUnionCatalog = createKeptLaneUnionCatalogReader(buildLaneUnionCatalog);` line 237: the non-fixture branch returns `readLaneUnionCatalog(nativeStoreRoot)`. `buildLaneUnionCatalog` has no other caller. The handler test that expects the first body after an identity-keeping rewrite proves the request path goes through the kept reader. |

### Verify commands run by the verifier

| Command | Result | Status |
| ------- | ------ | ------ |
| `python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py pnpm.cmd vitest run tests/unit/keptLaneUnionCatalog.test.ts tests/unit/nativeStoreRootPlugin.test.ts tests/unit/nativeStoreRootBuildAbsence.test.ts --reporter=verbose` | 3 files passed, 42 tests passed, 0 failed, 3.53 s (keptLaneUnionCatalog 10, nativeStoreRootPlugin 30, nativeStoreRootBuildAbsence 2), exit code 0 | PASS |
| `python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py pnpm.cmd typecheck` | `tsc --noEmit`, exit code 0 (`tsconfig.json` includes `src`, `tests`, `vite`) | PASS |

Side evidence from the unedited file: "answers HEAD and a byte range of the served catalog from the union bytes" took 9 ms right after a test that built the same catalog in 822 ms, so those requests started no python.

No dev server, Playwright run, conversion, full unit suite or pipeline suite was started. After the runs no node, python or browser process holds this worktree path in its command line.

### Attempts to break the kept catalog (code reading)

| Case | Result |
| ---- | ------ |
| Rewrite while a build runs (new inode, size or modification time) | Not stale. The identity is read before python starts. A request that arrives after the rewrite reads another identity, starts its own build and replaces the entry; it never shares the older build. A request that arrived before the rewrite gets the bytes of the file as it was when it arrived. Test "a failed older build does not drop the answer of a newer build" covers two builds running at once. |
| A build that reads a newer file than the identity it is stored under | The entry is replaced on the next request, because the file no longer has the stored identity. See advisory 1 for the one sequence that defeats this. |
| Rewrite that keeps size | An in-place rewrite gives a new modification time, a replace by rename gives a new inode. Only a rewrite in place that also restores the modification time keeps the identity; see advisory 2. |
| Two roots | One entry per pair of comparable store root path and shared store root path, serialized with `JSON.stringify`, so two roots never share an entry. Test "keeps one answer per native store root". |
| Rejected build | Not kept. The removal callback is registered before the promise is returned, so it runs before any waiting request sees the rejection; the next request builds again. A rejection of an older build leaves a newer entry in place. Every request that shared the failed build gets the same 409 text. |
| Lane catalog removed | `confinedNativeStoreFile` runs before the kept reader on every request, so the answer is 404 as before, never kept bytes. |

### Rule checks on the changed files

| Check | Result |
| ----- | ------ |
| `git diff --stat 277129e HEAD` | Only the two task files |
| Comments | None in either file (the one `/*` match is the header text `bytes */${size}` at line 258, unchanged) |
| Debt markers (TBD, FIXME, XXX, TODO, HACK, PLACEHOLDER) | None |
| Unused function, import or export | None. `statSync` is used at line 206; every import of the test file is used; the two new exports are used by the test file and inside the module |
| No Python file, no file under `src`, no timeout, retry or sleep changed | Holds (two files changed, neither of those kinds) |
| File size | Plugin 345 lines, under the 400 line rule |
| Working tree | `git status --short` lists only the two untracked folders under `.planning/quick` |

### Requirements coverage

| Requirement | Source | Description | Status | Evidence |
| ----------- | ------ | ----------- | ------ | -------- |
| D-01 | Context file, locked decision 1 | Catalog kept by the dev server per catalog file identity | SATISFIED | Truths 1 and 2 |
| D-02 to D-07 | Context file, locked decisions 2 to 7 | Workers, shards, part files, fold, walk | DEFERRED | Orchestrator ruling; nothing of them is in the code (truth 3) |

### Advisory notes (not gaps)

These do not fail a must_have of task 1. They are the limits I found by trying to break the change.

1. **The identity is read before the build and never compared after it.** Sequence: a request reads identity X; one catalog file is exchanged by rename before python opens it; python reads the other file; the entry is (X, bytes of the other file). If the first file is then renamed back, with its inode, size and modification time intact, before any other request arrives, every later request gets the bytes of the other file until a catalog file changes again or the server restarts. That includes bytes older than the file on disk. It needs two renames of existing files, the first inside the start time of python, and no request between them, so no writer that writes a catalog can cause it. A second identity read after the build, with the entry dropped when it differs, would close it.
2. **Same identity, other content.** A rewrite in place with the same length and a restored modification time is served from the kept bytes. This is the identity that decision 1 locks, and the executor's extra test uses exactly this state to prove the handler path.
3. **Inputs of the build outside the identity.** Before the change every request ran the current python code and its reparse point check on the lane store path. Now an edit to `scripts/native_store/merge_lane_store.py` or `print_lane_union_catalog.py` while the dev server runs shows only after a catalog file changes or the server restarts.
4. **One new error text in a state that was already an error.** When `statSync` on a catalog file fails with something other than a missing entry (for example a permission error on `public/l2/catalog.json`), the answer is 409 with the Node error text, without the `NATIVE_STORE_ROOT <name>:` prefix. Before, python refused the same state with its own text, also as 409. Status code and headers are the same.
5. **Wording.** The plan and the summary say "a kept answer is never newer than its identity claims". The code gives the opposite and correct guarantee: a kept answer is never older than its identity, and it can be newer (note 1).
6. **No eviction.** One entry per root stays for the life of the process, as the plan asks. The dev server has one root.
7. **Not re-run:** the summary's red run before the change (8 failed, 2 passed). It is consistent with the code: the 7 reader tests need the new export and the extra handler test needs the kept reader.

### Human verification required

None. The request time of `/l2/catalog.json` and the gain on a real sweep are measured by the orchestrator afterwards (context file, last section) and are not part of this quick task.

### Gaps summary

No gaps. Task 1 achieves the narrowed goal: unchanged catalog files mean no python start, the response code path is byte-identical with the base commit, and no part of tasks 2 and 3 exists in the code.

---

_Verified: 2026-11-12T21:59:13Z_
_Verifier: Claude (gsd-verifier)_
