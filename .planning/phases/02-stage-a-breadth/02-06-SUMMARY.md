---
phase: 02-stage-a-breadth
plan: 6
subsystem: dev-server
status: complete
tags: [vite, dev-plugin, lane-store, load-checks, fixtures]
requires:
  - phase: 02-stage-a-breadth
    provides: lane names and lane store layout (02-01); check-machine-schedule.mjs (02-02)
  - phase: 01-foundations
    provides: golden model-v2 fixture and catalog (01-12, 01-16); lanes.json and readLaneOwnership (01-09)
provides:
  - vite/nativeStoreRootPlugin.ts, a serve-only switch (NATIVE_STORE_ROOT) that serves /l2/ from a lane store or the committed fixture store on port 5175
  - tests/fixtures/lane-store/l2, a one-model fixture lane store
  - tests/browser/support/loadCheckRecordFile.ts, the load-check record format and its atomic per-key writer
  - docs/OUTPUT_CONTRACT.md sections Dev store switch and Load-check records
affects: [02-07, 02-16, 02-20, 02-22, 02-23, 02-55]
tech-stack:
  added: []
  patterns:
    - "Lane tracers run Playwright with NATIVE_STORE_ROOT=<lane> DEV_PORT=5175 and record loads through writeLoadCheckRecord(lane, await hashServedLaneCatalog(baseURL), record)"
    - "Serve-only Vite plugins prove build absence with resolveConfig in both modes plus a publicDir false bundle grep"
key-files:
  created:
    - vite/nativeStoreRootPlugin.ts
    - tests/fixtures/lane-store/l2/catalog.json
    - tests/fixtures/lane-store/l2/95738fac7e983c6a70fe92c7eb32f357e0952b3e3159b3d0fdd639b787d0698d/asset.l2asset
    - tests/browser/lane-store-switch.spec.ts
    - tests/browser/support/loadCheckRecordFile.ts
    - tests/unit/nativeStoreRootPlugin.test.ts
    - tests/unit/nativeStoreRootBuildAbsence.test.ts
    - tests/unit/loadCheckRecordFile.test.ts
  modified:
    - vite.config.ts
    - tsconfig.json
    - .gitattributes
    - docs/OUTPUT_CONTRACT.md
    - .planning/OVERNIGHT-DECISIONS.md
key-decisions:
  - "NATIVE_STORE_ROOT=fixture is a fifth value for the committed fixture store (row 123)"
  - "X-Native-Store-Source: lane or shared names the answering store (row 124)"
  - "Missing /l2/ files answer 404 instead of the SPA page while the switch is active (row 125)"
  - "Build absence is checked with resolveConfig plus a publicDir false bundle, never plain pnpm build (row 126)"
  - "No THIRD_PARTY_NOTICES.md; the attribution stays in docs/SOURCE_REUSE.md (row 127)"
  - "Single-range support (row 128)"
  - "Each served file's realpath must stay under its root's realpath (row 129)"
  - "INT-01 and WORLD-05 stay Pending (row 130)"
  - "Heavy runs used nice -n 10 for BelowNormal because the sandbox refused PowerShell (row 131)"
requirements-completed: []
duration: 20min
completed: 2026-11-08
commits: 6
plan_head_before: c6ac9fb96e54ed364a4da62cde5142e56004af8f
plan_head_after: 318a8956d11fae64a6c4499e724baa21e13b29a7
actuals:
  tokens: 12000
  tasks: 3
  commits: 6
---

# Phase 2 Plan 6: Native store root dev switch and load-check records Summary

A serve-only Vite plugin (`NATIVE_STORE_ROOT`) serves `/l2/` from a lane store or the committed fixture store on port 5175, with catalog and coverage only from that root and a read-only `public/l2` fallback for hash paths. It is proven absent from the production bundle. A single load-check record format with an atomic per-key writer is ready for every later browser check.

## Performance

- Started: 2026-11-08 18:17 Riga (16:17 UTC)
- Finished: 2026-11-08 18:37 Riga
- Tasks: 3 of 3
- Files: 13 created or modified

## Accomplishments

- `vite/nativeStoreRootPlugin.ts` (211 lines): `nativeStoreRootPlugin` (name `native-store-root`, `apply: "serve"`), `resolveNativeStoreRoot`, `nativeStoreRootFromEnvironment`, `nativeStoreRootNames`, `NATIVE_STORE_PATH_PATTERN`, `NATIVE_STORE_FIXTURE_NAME`, `NATIVE_STORE_SOURCE_HEADER`, `nativeStoreRequestPath`, `nativeStoreContentType`, `parseSingleByteRange`, `createNativeStoreRequestHandler`. Registered in `vite.config.ts`; `vite` added to the `tsconfig.json` include list.
- Allowed values: `actors`, `data-ui`, `fixture`, `integration`, `world`. Unset does nothing; an unknown value, a missing folder, a junction or symlink on the root path, or a root at or under the realpath of `public/l2` stops Vite.
- Fixture lane store: `tests/fixtures/lane-store/l2/catalog.json` (the golden `interlude:SyntheticFixture.SyntheticModelVersionTwo` record unchanged, `json_bytes` form) and the archive bytes of `tests/fixtures/golden/model-v2.l2asset` (SHA-256 `95738fac...d0698d`, 1780 bytes), both written by an uncommitted Python one-liner that asserted the catalog SHA-256 equals the archive hash. `.gitattributes` marks `tests/fixtures/lane-store/** -text`.
- `tests/browser/support/loadCheckRecordFile.ts`: `LoadCheckStatus`, `LoadCheckRecord`, `LoadCheckRecordFile`, `loadCheckRecordFilePath`, `readLoadCheckRecordFile`, `writeLoadCheckRecordFile`, `readLoadCheckRecords`, `writeLoadCheckRecord`, `hashServedLaneCatalog`.

## Verification evidence

- `pnpm vitest run tests/unit/nativeStoreRootPlugin.test.ts tests/unit/nativeStoreRootBuildAbsence.test.ts`: 2 files, 27 tests passed. The junction case and the public/l2-junction case ran (not skipped).
- `pnpm vitest run tests/unit/loadCheckRecordFile.test.ts`: 10 tests passed.
- Playwright, ports 5173 and 5175 free, at 18:21 Riga: `NATIVE_STORE_ROOT=fixture DEV_PORT=5175 pnpm test:e2e tests/browser/lane-store-switch.spec.ts` gave `ok 1 [chromium] > tests\browser\lane-store-switch.spec.ts:23:1 > serves the fixture lane store through the native store root switch (6.4s)`, `1 passed (16.8s)`. Passed.
- Production bundle without the public folder (`build({configFile:'vite.config.ts',publicDir:false,...,outDir:'artifacts/build-absence-check'})`): the build succeeded with only the existing "use client" directive and chunk-size warnings; 449 files, 25,933,571 bytes. `grep -rlE "NATIVE_STORE_ROOT|native-store-root" artifacts/build-absence-check` printed nothing (exit 1). The folder was then deleted; `ls artifacts/build-absence-check` reports no such directory.
- `pnpm typecheck`: clean.
- `pnpm test:unit`: 119 files (1 failed, 113 passed, 5 skipped), 1502 tests (2 failed, 1418 passed, 82 skipped). The two failures are the 02-01 baseline cases in `tests/unit/nativeNpcProfiles.test.ts` ("uses one catalog snapshot and exact hashed metadata in https:" and "in file:"). No new failure.
- `node scripts/check-lane-ownership.mjs --base c6ac9fb --part adapter-dispatch`: `lane integration: 0 foreign paths`, exit 0.
- Acceptance greps: comment lines in `vite.config.ts`, `vite/nativeStoreRootPlugin.ts` and `tests/browser/support/loadCheckRecordFile.ts` are 0; `nativeStoreRootPlugin()` appears once in `vite.config.ts`; `cmp` of the fixture archive with the golden model-v2 exits 0; neither `NOTICE` nor `THIRD_PARTY_NOTICES.md` exists; the Babylon.js Editor v5.5.3 Vanilla template line appears once in `docs/SOURCE_REUSE.md`; the contract has both new headings and no en or em dash; the retired-workspace wording grep is empty.

## Task commits

1. Task 1, tracer: `8e69557` feat(02-06): serve-only native store root switch with the fixture lane store
2. Task 2, RED: `61d0241` test(02-06): failing byte range tests plus regex agreement and build absence checks
3. Task 2, GREEN: `28e3cdc` feat(02-06): single byte ranges, 416 answers and HEAD through the native store root switch
4. Task 3, RED: `f9dfb35` test(02-06): failing load-check record file format and writer tests
5. Task 3, GREEN: `2f6faa0` feat(02-06): load-check record file format and atomic per-key writer
6. Task 3, docs: `318a895` docs(02-06): dev store switch and load-check record contract sections

## TDD gate compliance

- Task 2: RED `61d0241` failed 4 of 27 (`parseSingleByteRange is not a function`, 200 instead of 206 and 416). The agreement and build-absence cases passed at RED because they guard behaviour Task 1 already had. GREEN `28e3cdc`: 27 of 27. One GREEN fix inside the task: `bytes=100-` first came back null instead of unsatisfiable (end check ran before the start-past-size check).
- Task 3: RED `f9dfb35` failed on the missing module; GREEN `2f6faa0`: 10 of 10.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 2 - Security] Realpath confinement of every served file**
- Found during: Task 1
- Issue: `resolve` containment plus `lstat` does not stop a junction folder inside a lane store from pointing a regular file outside both roots.
- Fix: a served file's realpath must also lie under its root's realpath (row 129).
- Files: `vite/nativeStoreRootPlugin.ts`
- Commit: `8e69557`

**2. [Rule 3 - Blocking] BelowNormal priority through `nice -n 10`**
- Found during: Task 1
- Issue: the session sandbox refused every `powershell` and `pwsh` invocation and compound shell lines, so the PowerShell priority prefix could not run.
- Fix: every test, build and dev-server run used `nice -n 10` in Git Bash (BelowNormal class, inherited by children) (row 131).

### Other notes

- `vite.config.ts` already had no comment line at plan start (the self-contained repo merge removed it), so Task 1 deleted nothing there; the attribution stays in `docs/SOURCE_REUSE.md` (row 127).
- `nativeStoreRootFromEnvironment(mode, projectRoot)` is exported beyond the plan's artifact list so the unset and unknown-value truths are tested without calling a Vite hook by hand.
- `.gitattributes`, `tsconfig.json` and `vite.config.ts` had no comments to strip; `src/assets/native/nativeResourceUrl.ts` stays untouched as the index requires (its comment block is outside this plan's files).
- The plan-start ledger file could not be written into the main checkout's git folder (the sandbox refused it); `plan_head_before` comes from `git rev-parse HEAD` taken before Task 1.

## Known stubs

None.

## Threat flags

None beyond the plan's threat model. T-02-06-01 to T-02-06-05 are mitigated as planned (plus row 129); T-02-06-06 and T-02-SC are accepted.

## Process cleanup

- This plan started: Vitest runs (foreground, exited), one Playwright run whose `pnpm dev` web server on 5175 Playwright stopped at exit, and one foreground Vite build (exited). No background process was started.
- The sandbox refused `Get-CimInstance` through PowerShell, and `wmic` is not installed, so the check used `ps -W`: the only `node.exe` processes are three started on Oct 29 (WINPID 5700, 5704, 25728, not this plan's); no chrome, headless shell or esbuild process is running.
- `netstat -ano | grep LISTENING | grep -E ':(5173|5175) '` prints nothing after the runs.

## Next phase readiness

- 02-07 reads `artifacts/lane-store/<lane>/load-checks/<catalogSha256>.json` in the format above.
- 02-16, 02-20 and 02-22 run their walks with `NATIVE_STORE_ROOT=<lane> DEV_PORT=5175` and record through `writeLoadCheckRecord`, passing `formatRigaTimestamp(new Date())` as `atRiga`.

## Self-Check: PASSED

- All 13 key files exist; commits `8e69557`, `61d0241`, `28e3cdc`, `f9dfb35`, `2f6faa0` and `318a895` are ancestors of HEAD.
