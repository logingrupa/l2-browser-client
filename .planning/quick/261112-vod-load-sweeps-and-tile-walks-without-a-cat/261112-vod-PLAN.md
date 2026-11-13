---
phase: 261112-vod-load-sweeps-and-tile-walks-without-a-cat
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - vite/nativeStoreRootPlugin.ts
  - playwright.config.ts
  - tests/browser/support/loadCheckWorkerCount.ts
  - tests/browser/support/loadCheckShards.ts
  - tests/browser/support/loadCheckPartFiles.ts
  - tests/browser/support/servedLaneRun.ts
  - tests/browser/support/loadCheckRecordFile.ts
  - tests/browser/support/loadCheckRecords.ts
  - tests/browser/support/tileWalkRecords.ts
  - tests/browser/load-sweep-items.spec.ts
  - tests/browser/load-sweep-npcs.spec.ts
  - tests/browser/load-sweep-skills.spec.ts
  - tests/browser/load-sweep-tiles.spec.ts
  - tests/browser/load-sweep-windows.spec.ts
  - tests/browser/world-tile-walk.spec.ts
  - tests/unit/keptLaneUnionCatalog.test.ts
  - tests/unit/loadCheckWorkerCount.test.ts
  - tests/unit/loadCheckShards.test.ts
  - tests/unit/loadCheckPartFiles.test.ts
  - tests/unit/servedLaneRun.test.ts
  - tests/unit/loadCheckRecordFile.test.ts
  - tests/unit/loadCheckRecords.test.ts
  - tests/unit/tileWalkRecords.test.ts
autonomous: true
requirements: [D-01, D-02, D-03, D-04, D-05, D-06, D-07]

estimate:
  tokens: 165000
  raw_tokens: 165000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "The dev server builds the lane union catalog once per file identity of the lane catalog file and of the shared catalog file (device, inode, size and modification time in nanoseconds from a bigint stat): a request with unchanged identities gets the kept bytes, a change of either file builds again, requests that arrive during a running build share it, a failed build is not kept, and the fixture root still reads its file on every request (D-01)"
    - "A building request and a kept request of /l2/catalog.json answer the same status, body and headers: Cache-Control no-store, the lane catalog SHA-256 header, X-Native-Store-Source union, Content-Type, Accept-Ranges and Content-Length"
    - "LOAD_CHECK_WORKERS unset means 1; a plain decimal number from 1 to 16 sets the Playwright workers and the shard count; any other text stops the run with an error that names the variable, the value and the bounds; fullyParallel stays false (D-02)"
    - "The global setup refuses, before any test runs, a run whose effective Playwright worker count (config.workers, which --workers, -j, --debug, --pause and a config override change) differs from the LOAD_CHECK_WORKERS number, with both numbers in the error; so in every run that reaches a test the number the specs read from the environment is the number of workers Playwright really uses (D-02, D-05)"
    - "With N workers each sweep spec declares N shard tests in parallel mode; every shard computes the pending list of today and checks the keys whose position in it modulo N equals its shard number, so every pending key is in exactly one shard; the limit caps the whole list, LOAD_CHECK_KEYS keeps its order, and each shard test has the timeout of the one-worker test (D-03)"
    - "Shard k of N writes only {catalogSha256}.part-{k}-of-{N}.json beside the record file, through writeLoadCheckRecordFile; the Playwright global setup folds every part file of the lane named by NATIVE_STORE_ROOT into its record file, sorted by key with one record per key, refuses a key that has different records in two inputs before any write, and removes the folded part files; the function the global setup returns, which Playwright calls at its global teardown, folds again for a run with more than one worker; part files left by a crashed run are folded by the global setup of the next run that starts (D-04)"
    - "Every Playwright run that names a lane holds an empty run marker file in that lane's load-checks folder from its global setup to its end. A run with more than one worker starts only while no other live run of the lane is registered in this checkout, and no run starts while a run with more than one worker is live there; the refusal names the lane, the other process id, both worker counts and the marker file, and the refused run folds nothing and runs no test. A fold happens only in a run that is alone on its lane. So no fold reads or removes a part file that a live shard still writes, and no other process writes the lane record files while shards run (D-03, D-04)"
    - "In a run with more than one worker a check or a walk that does not pass writes no record, the spec prints how many keys it left for the one-worker run, and writeLoadCheckRecord refuses to write the lane record file; a failed record is written only by a run that really has one worker, because the global setup has checked the environment number against the effective worker count (D-05)"
    - "The summary lists the caller rules of task 3 under the heading Caller rules. One of them covers the path the code leaves open: the run marker guards one lane of one checkout, so the rule says that while a run with LOAD_CHECK_WORKERS above 1 is live anywhere on the machine no one-worker Playwright run that names a lane starts on that machine (another lane of the checkout, another l2b-* checkout, the main checkout), because under the load of the other run's pages it would record failed on a timeout as today (D-05)"
    - "With N workers the walk spec runs tiles in parallel while the two viewports of one tile stay in order in one worker; a worker writes tile-walks-{catalogSha256}.part-{parallelIndex}-of-{N}.json; a tile already in the walk record file is skipped; the same fold merges the walk part files (D-06)"
    - "With one worker, and while no run with more than one worker is live on the same lane of the checkout, every sweep and walk command has the same test titles, printed lines, record bytes, record file and skip rule as before this plan; no part file is created, and the run marker file is gone when the run ends"
    - "No Python file and no file under src changes; no timeout, threshold, retry or sleep is added or changed; every check asserts what it asserted before and opens one page per key as before (D-07)"
    - "The windows sweep of this lane's data-ui store ran with 3 workers and then with one worker on the lane's own port: the saved record file holds one record per checked key, no part file and no run marker was left after either run, and the lane's earlier record files are back byte for byte"
    - "No automated verify command of this plan starts a browser run or writes under artifacts: the two sweep runs are action steps of task 3, the checks of them read evidence saved in C:/laragon/l2b-orchestration/autonomous-roadmap, and every Vitest file of the plan writes only in temporary folders, so each command can be run again after the task is done"
  artifacts:
    - path: "vite/nativeStoreRootPlugin.ts"
      provides: "Lane union catalog kept per native store root and per catalog file identity"
      exports: ["createKeptLaneUnionCatalogReader", "LaneUnionCatalogBuild"]
    - path: "tests/browser/support/loadCheckWorkerCount.ts"
      provides: "The one reader of LOAD_CHECK_WORKERS"
      exports: ["readLoadCheckWorkerCount", "maximumLoadCheckWorkerCount"]
    - path: "tests/browser/support/loadCheckShards.ts"
      provides: "Shard list, shard key selection and the rule that load never writes a failure"
      exports: ["LoadCheckShard", "loadCheckShards", "shardLoadCheckKeys", "shardRecordsStatus"]
    - path: "tests/browser/support/loadCheckPartFiles.ts"
      provides: "Part file names and the fold of part files into a record file"
      exports: ["loadCheckPartFilePath", "shardRecordFilePath", "loadCheckPartFilePaths", "foldLoadCheckPartFiles", "FoldedLoadCheckRecordFile"]
    - path: "tests/browser/support/servedLaneRun.ts"
      provides: "Playwright global setup: the check of the effective worker count, the run marker of the served lane, and the folds at the start and at the end of the run"
      exports: ["default", "startServedLaneRun", "ServedLaneRun", "StartedServedLaneRun", "processIsAlive"]
    - path: "tests/unit/servedLaneRun.test.ts"
      provides: "Tests of the worker count check, of the run markers and of the folds of the served lane"
      min_lines: 120
    - path: "tests/unit/keptLaneUnionCatalog.test.ts"
      provides: "Tests of the kept catalog"
      min_lines: 90
    - path: "tests/unit/loadCheckPartFiles.test.ts"
      provides: "Tests of part file names and of the fold"
      min_lines: 110
    - path: "tests/unit/loadCheckShards.test.ts"
      provides: "Tests of shard selection and of the record rule"
      min_lines: 40
    - path: "tests/unit/loadCheckWorkerCount.test.ts"
      provides: "Tests of the worker count reader"
      min_lines: 20
  key_links:
    - from: "playwright.config.ts"
      to: "tests/browser/support/loadCheckWorkerCount.ts"
      via: "workers is readLoadCheckWorkerCount(process.env), read after the .env file is loaded"
      pattern: "workers: readLoadCheckWorkerCount\\(process\\.env\\)"
    - from: "playwright.config.ts"
      to: "tests/browser/support/servedLaneRun.ts"
      via: "globalSetup names the module and the config sets no globalTeardown; the end of the run is the function the global setup returns"
      pattern: "globalSetup: .*servedLaneRun"
    - from: "tests/browser/support/servedLaneRun.ts"
      to: "tests/browser/support/loadCheckWorkerCount.ts"
      via: "startServedLaneRun compares the effective worker count of the resolved Playwright config with readLoadCheckWorkerCount of the environment"
      pattern: "readLoadCheckWorkerCount\\("
    - from: "tests/browser/support/servedLaneRun.ts"
      to: "tests/browser/support/loadCheckPartFiles.ts"
      via: "the fold of every record folder of the lane, and loadCheckPartFilePaths for the part files that wait"
      pattern: "foldLoadCheckPartFiles\\("
    - from: "tests/browser/support/loadCheckRecords.ts"
      to: "tests/browser/support/loadCheckShards.ts"
      via: "runLoadCheckSlice selects with shardLoadCheckKeys and records with shardRecordsStatus"
      pattern: "shardRecordsStatus\\("
    - from: "tests/browser/support/loadCheckRecords.ts"
      to: "tests/browser/support/loadCheckPartFiles.ts"
      via: "playwrightLoadCheckActions writes to shardRecordFilePath of the lane record file"
      pattern: "shardRecordFilePath\\("
    - from: "tests/browser/support/loadCheckPartFiles.ts"
      to: "tests/browser/support/loadCheckRecordFile.ts"
      via: "the fold reads every input with readLoadCheckRecordFile and writes with writeLoadCheckRecordList"
      pattern: "writeLoadCheckRecordList\\("
    - from: "tests/browser/world-tile-walk.spec.ts"
      to: "tests/browser/support/loadCheckPartFiles.ts"
      via: "afterEach writes to shardRecordFilePath of the walk record file with testInfo.parallelIndex as the shard number"
      pattern: "parallelIndex"
    - from: "vite/nativeStoreRootPlugin.ts readServedNativeCatalog"
      to: "createKeptLaneUnionCatalogReader"
      via: "module constant readLaneUnionCatalog wraps buildLaneUnionCatalog"
      pattern: "createKeptLaneUnionCatalogReader\\(buildLaneUnionCatalog\\)"
---

## Decisions the orchestrator must revisit

Two checker warnings bind. From the first check: no fold may remove a part file that holds a record it did not merge, and no other process may write a lane record file while shards run. From the second check: every path by which a slow page under machine load becomes a failed record is closed or stated as a caller rule. Three texts of the context file cannot hold as written beside them (items 1 to 3), and the instruction of one plan with at most 3 tasks meets the context budget (item 4). The plan keeps the code correct and states each difference here. The orchestrator rules on all four before execution.

1. **Hard constraint "With one worker (the default) every command of the roadmap plans behaves exactly as today".** It cannot hold for a one-worker command that starts on a lane while a run with more than one worker is live on that lane in the same checkout. Example: `sandbox-equip` on port 5175 during an actors sweep with `LOAD_CHECK_WORKERS=3` on port 5173. As today, that command would write the lane record file while shards run, which decision 3 forbids, and its global setup would fold part files a shard still writes. The plan refuses that command in its global setup with an error that names the live run. In every other state a one-worker command gives the same records, file, skip rule and messages as today. One thing is new in every run that names a lane: an empty run marker file in `artifacts/lane-store/<lane>/load-checks` while the run lasts. The run creates that folder when it is absent and leaves the folder in place at its end.
2. **Decision 4, "a Playwright global setup and global teardown fold every part file of the lane".** A fold without a condition is the first hole of that warning. In the plan a fold happens only in a run that is alone on its lane: a refused run folds nothing; a one-worker run folds at its start only, because no part file can appear while it lives; a one-worker run that is not alone refuses to start while part files wait. The fold at the end is the function the global setup returns, not a `globalTeardown` file: Playwright 1.64.1 calls a `globalTeardown` file also after a global setup that threw, and a refused run must not fold. One case of the decision's last sentence ("the next run's global setup folds them") does not hold: a marker left by a killed run whose process id Windows has since given to another live process refuses every later run of that lane until that marker file is removed by hand (threat T-vod-10). The refusal names the file, and until then the crashed run's part files wait unfolded. Telling that process from a live run needs its start time, which Node reads on Windows only through a child process; the plan adds none, and removing the marker of a run that is live would allow a fold beside its shards.
3. **Goal, "without ever recording a failure that load on the machine caused".** The hard constraint "A `failed` record is only ever written by a run with one worker" holds as written. The goal holds in code only for the lane and the checkout of the run with more than one worker: its shards write no failure, its other specs are refused by `writeLoadCheckRecord`, and every other run of that lane in that checkout is refused. The run marker lies under `process.cwd()`. A one-worker run on another lane of the checkout, in another `l2b-*` checkout or in the main checkout is therefore not refused, and while N SwiftShader pages load the CPU it writes `failed` on a timeout exactly as today (`checkedOutcome` and `runLoadCheckSlice` in `loadCheckRecords.ts`, the `afterEach` of the walk spec, and the eight specs that call `writeLoadCheckRecord`). A later rerun skips that key. AGENTS.md allows 3 lanes plus the integration thread on DATABASE-PC, so this is a normal state. The plan closes the path with a caller rule in the summary (task 3), not in code. Closing it in code needs one marker folder for the whole machine outside every checkout, which no decision names, and it would refuse one-worker runs of other lanes, which widens item 1. If the orchestrator wants that guard, it is a new decision.
4. **One plan with at most 3 tasks and this file list.** The plan lists 23 files, task 2 alone 18. Its estimate is 165 000 tokens against a budget of 100 000 (ratio 1.65, confidence low, 0 calibration samples, so the figure is not calibrated). Inside one plan of at most 3 tasks the planner cannot bring it under the budget without cutting a locked decision, and moving files between the three tasks changes no total. So the overrun stands until the orchestrator accepts it or splits the plan. What the plan gives an acceptance: every task starts from committed code and ends with its own commit and its own verify commands, and task 2 reads nothing task 1 wrote, so the plan can run one task per executor (last rule under "Rules for every task"). What binds a split: `loadCheckRecords.ts` and the five sweep specs stay in one commit, because the signatures of `runLoadCheckSlice` and `playwrightLoadCheckActions` change and `pnpm typecheck` covers `tests`; and a first half made of the support modules alone leaves the shard functions and `shardRecordFilePath` used only by tests until the second half lands.

The rules for callers that follow. A run with `LOAD_CHECK_WORKERS` above 1 must be the only Playwright run of its lane in its checkout; the code refuses every other case. Runs on other lanes and in other checkouts are neither refused nor guarded: while a run with `LOAD_CHECK_WORKERS` above 1 is live anywhere on the machine, no one-worker run that names a lane starts on that machine, and only the caller keeps this rule (item 3). Task 3 puts both rules, with the others, into the summary.

For information, not a conflict: the worker count is set only through `LOAD_CHECK_WORKERS`. A run whose effective count differs (`--workers`, `-j`, a config override, and `--debug` or `--pause` while the variable is above 1) is refused in the global setup, also when `NATIVE_STORE_ROOT` is unset. This tightens decision 2 and changes nothing for a run started without those options. The second check found no script, doc or plan of the repo that passes `--workers` to Playwright.

<objective>
A load sweep and a tile walk give the same record files as today in less time. The dev server stops starting python for every `/l2/catalog.json` request, and a sweep or walk can use several Playwright workers without ever recording a failure that load on the machine caused.

Purpose: an actors sweep pays 1.6 s per key for the same catalog bytes, and every sweep checks one page at a time on a 16-thread machine.
Output: the kept catalog in `vite/nativeStoreRootPlugin.ts`; `LOAD_CHECK_WORKERS`, shards, part files, the fold and the run marker of a lane under `tests/browser/support`; the five sweep specs and the walk spec on those pieces; targeted Vitest files; one real windows sweep in this lane with 3 workers and then with one.

Decisions D-01 to D-07 are the locked decisions 1 to 7 of the task context file. The plan implements them as locked, with the differences named under "Decisions the orchestrator must revisit".
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/quick/261112-vod-load-sweeps-and-tile-walks-without-a-cat/261112-vod-CONTEXT.md
@AGENTS.md
@docs/BATCH_PIPELINE_SPEED.md
@vite/nativeStoreRootPlugin.ts
@playwright.config.ts
@tests/browser/support/loadCheckRecords.ts
@tests/browser/support/loadCheckRecordFile.ts
@tests/browser/support/tileWalkRecords.ts
@tests/browser/load-sweep-windows.spec.ts
@tests/browser/load-sweep-tiles.spec.ts
@tests/browser/world-tile-walk.spec.ts
@tests/unit/nativeStoreRootPlugin.test.ts
@tests/unit/loadCheckRecords.test.ts
@tests/unit/loadCheckRecordFile.test.ts

## Facts verified while planning (Playwright 1.64.1, read from node_modules)

- Parallel shards under `fullyParallel: false`: `test.describe.configure({ mode: "parallel" })` at the top level of a spec makes each top-level test its own group, so N tests run on N workers. `createTestGroups` in `node_modules/.pnpm/playwright@1.64.1/node_modules/playwright/lib/runner/index.js` puts a test that sits inside a parallel scope under its outermost `serial` or `default` describe into one group. So the two viewport tests of one tile describe (mode `serial`) stay in order in one worker while tile describes run in parallel. The types document the same pattern ("Run multiple describes in parallel, but tests inside each describe in order").
- The global setup runs once per invocation in the runner process (`createGlobalSetupTasks` inside `runAllTestsWithConfig`), not per worker. Order: clear output, start the web server, global setup, load the test files, run, the teardowns, stop the web server. The global setup function gets the resolved config. A function it returns is called once at the end of the invocation, and only when the global setup returned (`createGlobalSetupTask`, `runner/index.js:6557-6573`). A `globalTeardown` file is different: its task stands before the global setup task, and the teardown of every task is queued before its setup runs (`:6509-6515`, `:6340`), so the file is called even after a global setup that threw. A refused run must not fold, so the end of the run is the returned function and the config sets no `globalTeardown`.
- `workers` of that resolved config is the effective worker count: `--workers` and `-j` replace the config value, and `--debug` or `--pause` force 1 (`resolveWorkers(takeFirst(...))` in `node_modules/.pnpm/playwright@1.64.1/node_modules/playwright/lib/common/index.js:534`). `playwright.startup.config.ts` sets its own `workers: 1` over the base config.
- `process.kill(processId, 0)` sends nothing and tells whether a process exists. Checked on this machine with Node 24.15.0: it returns for a live process and throws with code `ESRCH` for a child process that has exited.
- Two Playwright invocations on one lane in one checkout are a documented pattern: `tests/browser/sandbox-equip.spec.ts:27`, `sandbox-skill-cast.spec.ts:100` and `sandbox-actor-audio.spec.ts:31` say "run with NATIVE_STORE_ROOT=actors DEV_PORT=5175", while a sweep uses port 5173. Record files are placed under `process.cwd()`, so runs in other checkouts never share them.
- The run marker of task 2 lies in `artifacts/lane-store/{lane}/load-checks` under `process.cwd()`, so only runs of that lane in that checkout see it. A one-worker check that times out becomes a `failed` record today (`checkedOutcome` and `runLoadCheckSlice` in `tests/browser/support/loadCheckRecords.ts`, the `afterEach` of `tests/browser/world-tile-walk.spec.ts`), and a rerun skips a recorded key. AGENTS.md allows 3 lanes plus the integration thread on DATABASE-PC. So a one-worker run on another lane or in another checkout beside a run with more workers is a normal state that no code of this plan sees. Task 3 states it as a caller rule.
- `playwright.config.ts` sets no `retries` and no `repeatEach`, so one invocation runs a test twice only through `--repeat-each`. Every walk record holds its own `atRiga` time, so two walks of one tile give two different records.
- The "clear output" task removes each project's `outputDir` (`test-results`) at the start of every invocation. Nothing in this plan writes there: part files live in `artifacts/lane-store/{lane}/load-checks` and `artifacts/lane-store/{lane}/measurements`. The walk's existing screenshots stay where they are.
- `testInfo.parallelIndex` is between 0 and workers - 1, differs between workers that run at the same time, and a restarted worker keeps it. One part file per parallel index has one writer at a time.
- Timeout of a sweep test today: `loadCheckSliceTimeoutMilliseconds(settings, perKeyMilliseconds)` is limit times the per-key timeout (90 000 ms, tiles 180 000 ms) plus 120 000 ms, set with `test.setTimeout` inside the test. Each shard test calls the same unchanged function with the same arguments. A shard checks a subset of the keys the one-worker test checks inside the same budget, so no shard times out where the one-worker test would not, and no timeout value is added, raised or lowered.
- Callers of `writeLoadCheckRecordFile` today: `writeLoadCheckRecord` in `tests/browser/support/loadCheckRecordFile.ts`, `tests/browser/world-tile-walk.spec.ts` (afterEach), `tests/unit/loadCheckRecordFile.test.ts`.
- Callers of `readLoadCheckRecords` today: `playwrightLoadCheckActions` (`readRecordedKeys`) in `tests/browser/support/loadCheckRecords.ts` and the last assertion of the five sweep specs. After task 2 only `readRecordedKeys` calls it.
- Callers of `writeLoadCheckRecord` today: `playwrightLoadCheckActions` (`writeRecord`) and eight specs this plan does not edit: `native-window-statuswnd`, `sandbox-characters`, `sandbox-equip`, `sandbox-skill-cast`, `sandbox-npc-gremlin`, `world-tile-meshes`, `world-tile-movers`, `world-tile-sky`. After task 2 only the eight specs call it. With several workers Playwright runs spec files in parallel, so those specs would write the lane record file without a lock and could write `failed` under load. Task 2 therefore makes `writeLoadCheckRecord` refuse while `LOAD_CHECK_WORKERS` is above 1.
- Readers of record files outside these modules: `scripts/native_store/load_check_records.py` reads `load-checks/{catalogSha256}.json` by exact name through `lane_load_check_path` in `scripts/native_store/store_paths.py`; `tests/browser/world-streaming-baseline.spec.ts` writes `measurements/streaming-baseline-{catalogSha256}.json` by exact name. Nothing lists either folder. A part file is never read as a record file, and the fold touches only names that end in `.part-{k}-of-{N}.json` behind its own record file prefix. The run marker files of task 2 lie in the load-checks folder under names no reader uses.
- `python .../run_below_normal.py pnpm ...` fails on this machine with FileNotFoundError, because the runner starts its command without a shell and pnpm is a `.CMD` shim. `pnpm.cmd` works (checked with `pnpm.cmd --version`). Every command below uses `pnpm.cmd`.
- This lane holds `artifacts/lane-store/data-ui/l2/catalog.json` (SHA-256 `65a042ef...`) and two record files in `artifacts/lane-store/data-ui/load-checks`, one of them named by that SHA-256 with 20 window records. They are the orchestrator's test data.
- Never read `.env` (a hook blocks it, and the lane skill forbids it). The lane port comes from `pwsh -NoProfile -File C:/Users/rolan/.claude/tools/lane/lane.ps1 list l2-browser-client`, which prints the lane URL and whether its dev server listens.
- Vitest and Playwright each install their own `expect`. Every module a Vitest file imports keeps its `@playwright/test` imports type-only, as the support modules do today. No Vitest file imports `playwright.config.ts`.

## Interfaces the tasks build on

From `tests/browser/support/loadCheckRecordFile.ts`: `LoadCheckStatus` is "pass" or "failed"; `LoadCheckRecord` has key, status, reason, atRiga, assetManifestSchemaVersion; `readLoadCheckRecordFile(filePath, laneName, catalogSha256)` returns the validated records or an empty list when the file is missing and refuses another lane, another catalog SHA-256 and unsorted or repeated keys; `writeLoadCheckRecordFile(filePath, laneName, catalogSha256, record)` reads, replaces the record of the same key, sorts by key and writes through a temporary file and a rename.

From `tests/browser/support/loadCheckRecords.ts`: `pendingLoadCheckKeys(convertedKeys, recordedKeys, limit, selectedKeys)` (unchanged by this plan), `runLoadCheckSlice(settings, actions)`, `playwrightLoadCheckActions(page, baseUrl, settings, checkKey)`, `LoadCheckSliceSummary` with catalogSha256, checkedKeys, skippedAsRecorded in that field order (the order is part of the printed line).

## Rules for every task

- AGENTS.md code rules: no comments, full-word names, no dead code, TypeScript strict, no `any`, validate at trust boundaries only.
- Targeted Vitest files only. Never `pnpm test:unit`, never the pipeline suite, never `pnpm build`, never a conversion, never a write under `public/l2`.
- Every Vitest test writes only in temporary folders, never under the checkout's `artifacts` folder. A test that needs a project root makes a temporary one.
- Never start a debugger. The dev server is started only by Playwright's own webServer in task 3.
- Commit on `lane/speed`, one commit per task, plain hyphens in messages, no attribution line. Never push.
- Every task starts from committed code and ends with its own commit and its own verify commands, so the orchestrator may run the plan one task per executor, in order. Task 2 needs nothing task 1 wrote. An executor that starts at task 3 first checks that the commit of task 2 is in HEAD: `git cat-file -e HEAD:tests/browser/support/servedLaneRun.ts` succeeds.
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Keep the lane union catalog in the dev server per catalog file identity</name>
  <files>vite/nativeStoreRootPlugin.ts, tests/unit/keptLaneUnionCatalog.test.ts</files>
  <precondition>`git status --short -- vite tests playwright.config.ts` prints nothing, and `python --version` answers (the existing handler tests start python). If either fails, stop and report.</precondition>
  <behavior>
    New file tests/unit/keptLaneUnionCatalog.test.ts. The reader tests use createKeptLaneUnionCatalogReader with a counting build function and real files in a temporary folder; the two handler tests use createNativeStoreRequestHandler on a temporary lane project like the one in tests/unit/nativeStoreRootPlugin.test.ts and run the real union script.
    - "builds once for many requests while both catalog files keep their identity": five reads, one build, the same ServedNativeCatalog object each time.
    - "builds again after the lane catalog file changes": once after a rewrite with another length, once after utimesSync moves only the modification time.
    - "builds again after the shared catalog file changes, appears or disappears".
    - "shares one running build among requests that arrive before it ends": three reads before a deferred build resolves, one build, three equal answers.
    - "does not keep a failed build": the first build rejects and the read rejects with the same error; the next read builds again and resolves; the read after that builds nothing.
    - "a failed older build does not drop the answer of a newer build": start a build that stays pending, change the lane catalog file, read again (second build resolves), reject the first build, read again: no third build.
    - "keeps one answer per native store root": two roots, one build each, a read of the first root after the second builds nothing.
    - "answers a kept catalog request with the status, body and headers of the building request": two GET and one HEAD of /l2/catalog.json; cache-control no-store, x-native-store-source union, x-native-store-lane-catalog-sha256 equal to the SHA-256 of the lane catalog text, content-type application/json, accept-ranges bytes, equal content-length.
    - "serves the new lane catalog SHA-256 after the lane catalog file is replaced": rewrite the lane catalog with one more model id in the same shape, request again, the header names the new SHA-256 and the body holds the new id.
  </behavior>
  <action>
Write the tests of the behavior block first and see them fail, then change vite/nativeStoreRootPlugin.ts (D-01):

1. Add statSync to the node:fs import.
2. Rename the present function readLaneUnionCatalog to buildLaneUnionCatalog. Its body stays as it is: one python start per call, the same error texts.
3. Add storeCatalogFileIdentity(catalogFilePath): statSync with bigint true and throwIfNoEntry false. A missing file gives the text absent. An existing file gives its dev, ino, size and mtimeNs joined by colons.
4. Add laneUnionCatalogSourceIdentity(nativeStoreRoot): the identity of the catalog file in storeRoot, then of the catalog file in sharedStoreRoot (both through storeCatalogFileName), joined by a vertical bar.
5. Export the type LaneUnionCatalogBuild (a function from NativeStoreRoot to a promise of ServedNativeCatalog) and the function createKeptLaneUnionCatalogReader(buildLaneUnionCatalog), which returns a LaneUnionCatalogBuild. It owns one Map from the native store root (comparablePath of storeRoot and of sharedStoreRoot) to one kept entry: the source identity and the promise of the build. The returned async reader reads the source identity first. When the root's entry has that identity it returns the entry's promise, whether the build has ended or still runs. Otherwise it starts one build, stores the promise under the identity it read before the build started (this replaces the root's older entry) and returns it. When a build rejects, its entry is removed only when the root still holds that very entry. The rejection reaches every request that shared the build.
6. Add the module constant readLaneUnionCatalog, the result of createKeptLaneUnionCatalogReader(buildLaneUnionCatalog). readServedNativeCatalog keeps its text and now calls this constant.

Why the identity is read before the build: a file that changes while python reads it leaves an entry whose identity no longer matches, so the next request builds again. A kept answer is never newer than its identity claims.

Do not change: the fixture branch of readServedNativeCatalog (it reads its file on every request), sendServedNativeCatalog, sendNativeStoreBody, answerWithStatus, any header, any status code, parseLaneUnionCatalogDocument, the plugin's configureServer (its startup read now also fills the kept entry). tests/unit/nativeStoreRootPlugin.test.ts stays unedited and must pass. Do not add a time limit, a size limit or a way to clear the kept entries: the context file asks for none.
  </action>
  <verify>
    <automated>python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py pnpm.cmd vitest run tests/unit/keptLaneUnionCatalog.test.ts tests/unit/nativeStoreRootPlugin.test.ts tests/unit/nativeStoreRootBuildAbsence.test.ts</automated>
    <automated>python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py pnpm.cmd typecheck</automated>
  </verify>
  <done>Every test of the behavior block passes by name, the two existing native store root test files pass unedited, typecheck passes, and vite/nativeStoreRootPlugin.ts holds no function that nothing calls. One commit on lane/speed.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Worker count, shards, part files, the fold, the run marker of a lane and the five sweep specs</name>
  <files>playwright.config.ts, tests/browser/support/loadCheckWorkerCount.ts, tests/browser/support/loadCheckShards.ts, tests/browser/support/loadCheckPartFiles.ts, tests/browser/support/servedLaneRun.ts, tests/browser/support/loadCheckRecordFile.ts, tests/browser/support/loadCheckRecords.ts, tests/browser/load-sweep-items.spec.ts, tests/browser/load-sweep-npcs.spec.ts, tests/browser/load-sweep-skills.spec.ts, tests/browser/load-sweep-tiles.spec.ts, tests/browser/load-sweep-windows.spec.ts, tests/unit/loadCheckWorkerCount.test.ts, tests/unit/loadCheckShards.test.ts, tests/unit/loadCheckPartFiles.test.ts, tests/unit/servedLaneRun.test.ts, tests/unit/loadCheckRecordFile.test.ts, tests/unit/loadCheckRecords.test.ts</files>
  <behavior>
    tests/unit/loadCheckWorkerCount.test.ts (new):
    - "is 1 while LOAD_CHECK_WORKERS is unset".
    - "reads a plain decimal number from 1 to 16": 1, 3 and 16.
    - "refuses every other text and names the variable, the value and the bounds": 0, 17, 017, +2, 1.5, 2 with a space, two and the empty string each throw a message that holds LOAD_CHECK_WORKERS, the JSON text of the value and "from 1 to 16".

    tests/unit/loadCheckShards.test.ts (new):
    - "one worker has one shard that selects exactly the pending list".
    - "every pending key lands in exactly one shard and the shards are disjoint": worker counts 1 to 16, lists of 0 to 40 keys; the shard lists joined and sorted equal the pending list sorted, with no key twice.
    - "a shard takes the keys whose position modulo the worker count equals its shard number, in pending order".
    - "a shard records every status with one worker and only a pass with more".

    tests/unit/loadCheckPartFiles.test.ts (new, temporary folders):
    - "names the part file of shard k of N beside the record file and gives one worker the record file itself".
    - "folds part files and an existing record file into the sorted one-record-per-key file": the folded bytes equal the bytes of a second file that received the same records one by one through writeLoadCheckRecordFile.
    - "refuses a key that has different records in two inputs and changes no file": names the key and both files; record file bytes and every part file stay.
    - "keeps one record when two inputs hold the same record for a key" (a fold that was interrupted after its write).
    - "removes the folded part files".
    - "does nothing without part files": a missing folder and a folder with only a record file give an empty result, and the record file keeps its bytes and its modification time.
    - "folds part files of another worker count and of another catalog SHA-256, each into its own record file".
    - "leaves names with another prefix alone": streaming-baseline-{sha}.json and a part-shaped name behind another prefix are not read and not removed.
    - "refuses a part file whose content names another lane or another catalog SHA-256".
    - "lists the part files of a folder in name order and no other name" (loadCheckPartFilePaths; a missing folder gives an empty list).

    tests/unit/servedLaneRun.test.ts (new; temporary project roots, the lane data-ui, and an isProcessAlive test double that answers from a set of live process ids; another run of the lane is a second startServedLaneRun call with another process id):
    - "refuses a run whose Playwright worker count differs from LOAD_CHECK_WORKERS and names both numbers": effective 4 with the variable unset, and effective 1 with the variable set to 3; nothing is created under the project root.
    - "does nothing while NATIVE_STORE_ROOT is unset, fixture or not a lane": no marker, no fold, a part file keeps its bytes.
    - "a run alone on its lane holds its marker from its start to its end": playwright-run-{processId}-workers-{workerCount}.marker exists after the start and is gone after endRun.
    - "folds the load-checks folder of the lane NATIVE_STORE_ROOT names at the start".
    - "a run with more than one worker folds again at its end and a one-worker run does not".
    - "a run with more than one worker is refused while another run of the lane is live": once beside a one-worker run and once beside a run with more workers; the message holds the lane, the other process id, both worker counts and the path of the other marker; the marker of the refused run is gone, the other marker stays, and a waiting part file keeps its bytes.
    - "a one-worker run is refused while a run with more than one worker is live": the same checks.
    - "two one-worker runs share a lane as today": neither is refused, and each end removes only its own marker.
    - "a one-worker run that is not alone refuses to start while a part file waits and starts when none waits": the message names the part file and the other process id; the record file and the part file keep their bytes.
    - "a marker of a dead process is removed and refuses nothing".
    - "a marker that names this run's process id is replaced": a leftover with another worker count.
    - "a refused fold leaves no marker": two inputs hold different records for one key; the start throws the error of the fold and the marker of the run is gone.
    - "says that this process is alive and that a child process that has exited is not" (processIsAlive itself, on real processes).

    tests/unit/loadCheckRecordFile.test.ts (added):
    - "writes a record list sorted by key and refuses two records for one key".
    - "writing records one by one and writing them as one list give the same bytes".
    - "places the record folder of a lane" (loadCheckRecordFolderPath; loadCheckRecordFilePath lies in it).
    - "refuses to write the lane record file while LOAD_CHECK_WORKERS is above 1": vi.stubEnv sets 3, writeLoadCheckRecord throws a message that holds LOAD_CHECK_WORKERS and "one worker"; nothing is written. Only the refusal is tested, because this wrapper writes under the real checkout.

    tests/unit/loadCheckRecords.test.ts (existing tests move to the lone shard with their assertions unchanged; added):
    - "with one worker a check that does not pass writes a failed record as today" (a failed outcome and a thrown error).
    - "with more than one worker a check that does not pass writes no record and is left for the one-worker run" (a failed outcome and a thrown error: writeRecord is not called for the key, the key is in keysLeftForOneWorkerRun and not in checkedKeys).
    - "with more than one worker a pass is recorded".
    - "the shards of one slice check every pending key once, under the limit and in LOAD_CHECK_KEYS order": the checked keys of shards 0 to N-1 joined equal pendingLoadCheckKeys of the same inputs as a set, each shard keeps pending order, and with a limit of 5 the shards together check 5 keys.
    - "one worker prints exactly today's summary line and more workers name the shard and the keys left".
    - "one worker keeps today's test title and more workers name the shard".
  </behavior>
  <action>
Write the tests first, then the code.

**tests/browser/support/loadCheckWorkerCount.ts (new, D-02).** Export maximumLoadCheckWorkerCount (16) and readLoadCheckWorkerCount(environment). An unset LOAD_CHECK_WORKERS gives 1. Any other text must be plain decimal digits without a leading zero and at most 16; otherwise throw an Error that says LOAD_CHECK_WORKERS, the JSON text of the value, and that it is not a plain decimal number from 1 to 16.

**tests/browser/support/loadCheckShards.ts (new, D-03, D-05).** Export the interface LoadCheckShard (shardNumber, workerCount), loadCheckShards(workerCount) (shards 0 to workerCount - 1), shardLoadCheckKeys(pendingKeys, shard) (the keys whose position modulo workerCount equals shardNumber, in order) and shardRecordsStatus(shard, status), true when workerCount is 1 or the status is pass. shardRecordsStatus is the one owner of "load never writes a failure"; the sweeps use it here and the walk uses it in task 3.

**tests/browser/support/loadCheckRecordFile.ts.**
- Add exported loadCheckRecordFolderPath(projectRoot, laneName) (lane name checked as today); loadCheckRecordFilePath builds on it and returns the same path as today.
- Add exported writeLoadCheckRecordList(filePath, laneName, catalogSha256, records): validate every record with validateLoadCheckRecord, sort by key with the comparison the writer uses today, refuse two records for one key with an Error that names the file and the key, then build and write the file exactly as today (same field order, two-space JSON, trailing newline, writeFileAtomically).
- writeLoadCheckRecordFile keeps its signature and its bytes: validate the new record first as today, then call writeLoadCheckRecordList with the existing records without that key plus the new record. The sort and the file building now live only in writeLoadCheckRecordList.
- writeLoadCheckRecord (the wrapper the eight other specs call) first reads readLoadCheckWorkerCount(process.env) and throws when it is above 1: the message says LOAD_CHECK_WORKERS and its number, and that the lane record file is written only by a run with one worker and by the part file fold. This is what keeps the hard constraint "a failed record is only ever written by a run with one worker" true for specs this plan does not edit, and what keeps the record file unwritten by the run's own other specs while shards run (D-03). The environment number is the real worker count here: the global setup in servedLaneRun.ts has already refused a run whose effective Playwright worker count differs from it. Other Playwright invocations on the lane are kept out by the run marker of that same module.

**tests/browser/support/loadCheckPartFiles.ts (new, D-04).**
- loadCheckPartFilePath(recordFilePath, shard): the record file path with its .json ending replaced by .part-{shardNumber}-of-{workerCount}.json. Refuse a path that does not end in .json.
- shardRecordFilePath(recordFilePath, shard): the record file path itself when workerCount is 1, else the part file path. Writers and the last assertion of a spec both use it, so one worker writes exactly today's file.
- loadCheckPartFilePaths(folderPath, recordFileNamePrefix): the paths of the part files of a folder in name order. A missing folder gives an empty list. A part file is a name that starts with the prefix and continues with 64 lowercase hex digits, .part-, a number, -of-, a number and .json; every other name is left alone. This function is the one owner of that name pattern.
- foldLoadCheckPartFiles(folderPath, recordFileNamePrefix, laneName), returning a list of FoldedLoadCheckRecordFile (recordFilePath, foldedPartFilePaths, recordCount). It takes its part files from loadCheckPartFilePaths, so a missing folder gives an empty list. Group the part files by catalog SHA-256 in ascending order. For each group read the record file (prefix, SHA-256, .json; it may be missing) and the part files in name order through readLoadCheckRecordFile with the lane name and that SHA-256, so every input is validated. Merge by key: a key seen again with the same five field values is kept once; a key seen again with other values throws an Error that names the key and both files and says nothing was written. Finish reading and merging every group before the first write. Then per group write the merged records with writeLoadCheckRecordList and remove that group's part files. A fold that is interrupted after a write and before a removal is repeated safely by the next fold, because the records are then equal.

**tests/browser/support/servedLaneRun.ts (new, D-02, D-03, D-04, D-05).** The Playwright global setup. It owns three things of one run on a served lane: the check of the effective worker count, the run marker, and the folds. Imports from @playwright/test are type-only.
- Export the interface ServedLaneRun: projectRoot, environment, laneNames, effectiveWorkerCount, processId and isProcessAlive (a function from a process id to a boolean). Export the interface StartedServedLaneRun: foldedRecordFiles (what the start folded) and endRun (a function that returns what the end folded).
- Export processIsAlive(processId): it calls process.kill with signal 0. It is true when the call returns, false when the call throws with code ESRCH, and true for every other error code, because such a process exists.
- Export startServedLaneRun(run). It works in this order:
  1. Worker count. When run.effectiveWorkerCount differs from readLoadCheckWorkerCount(run.environment), throw an Error that holds both numbers and says that the worker count is set only through LOAD_CHECK_WORKERS, where unset means 1. Nothing is created before this check.
  2. Lane. When NATIVE_STORE_ROOT is unset or not one of run.laneNames, return an empty list and an endRun that does nothing.
  3. Marker. The marker folder is loadCheckRecordFolderPath of the lane. Create the folder, remove every marker in it that names run.processId (a dead process had this id before), and create the marker of this run with flag wx: an empty file named playwright-run-{processId}-workers-{workerCount}.marker. Only then list the folder. A marker is a name of exactly that form with plain decimal numbers; every other name is left alone. Remove each other marker whose process is not alive. The markers that stay are the other live runs.
  4. Refusal. When this run has more than one worker and another live run exists, or when another live run has more than one worker: remove the marker of this run and throw an Error that names the lane, the other process id, its worker count, the worker count of this run and the path of the other marker, says that a run with more than one worker must be the only Playwright run of its lane in this checkout, and says that the named marker may be removed by hand when that process is not a Playwright run of this checkout.
  5. Not alone, every run with one worker. When loadCheckPartFilePaths finds a part file in a record folder of the lane, remove the marker of this run and throw an Error that names the first such file and the other process id and says that part files are folded only by a run that is alone on its lane. Otherwise return an empty list and an endRun that removes the marker of this run.
  6. Alone. Fold every record folder of the lane with foldLoadCheckPartFiles. When a fold throws, remove the marker of this run and throw that same error. Return the folded list and an endRun. For a run with more than one worker endRun folds again and removes the marker also when that fold throws. For a one-worker run endRun only removes the marker.
- The record folders of the lane are one list inside this module, each entry a folder path and a record file name prefix. In this task it holds loadCheckRecordFolderPath of the lane with an empty prefix. Step 5 and step 6 both walk this list.
- Why the marker is created before the folder is listed: of two runs that start together, the one whose marker appears later always sees the other, so the two never both pass step 4. Why only a run that is alone folds: a fold reads several files and writes one, with no lock, and a one-worker run beside it may write the record file in between.
- The default export takes the resolved Playwright config and calls startServedLaneRun with process.cwd(), process.env, loadCheckLaneNames(), the config's workers, process.pid and processIsAlive. It prints one line per folded record file (count of part files, record file path, record count; the path holds the catalog SHA-256, so part files of two catalogs give two lines) and returns a function that calls endRun and prints lines of the same form. It prints nothing when nothing was folded.

**playwright.config.ts (D-02).** After the .env file is loaded: workers is readLoadCheckWorkerCount(process.env), and globalSetup names ./tests/browser/support/servedLaneRun.ts. Set no globalTeardown: Playwright calls such a file also after a global setup that threw, and a refused run must not fold. fullyParallel stays false. Nothing else changes. playwright.startup.config.ts and playwright.terrain.config.ts are not edited: both spread the base config, so they inherit the global setup. The startup config keeps its own workers 1, so a startup run with LOAD_CHECK_WORKERS above 1 is refused by step 1.

**tests/browser/support/loadCheckRecords.ts (D-03, D-05).**
- Add the interface LoadCheckShardRun (summary of type LoadCheckSliceSummary, keysLeftForOneWorkerRun). LoadCheckSliceSummary keeps its three fields in their order.
- runLoadCheckSlice(settings, shard, actions) returns a LoadCheckShardRun. It computes the pending list exactly as today (pendingLoadCheckKeys is not changed), takes shardLoadCheckKeys of it, and per key: when shardRecordsStatus(shard, outcome.status) is false the key goes to keysLeftForOneWorkerRun and no record is written; otherwise it writes the record and adds the key to checkedKeys as today. skippedAsRecorded is computed as today.
- playwrightLoadCheckActions(page, baseUrl, settings, shard, checkKey): writeRecord calls writeLoadCheckRecordFile on shardRecordFilePath(loadCheckRecordFilePath(process.cwd(), lane, catalog SHA-256), shard). readRecordedKeys still reads the lane record file through readLoadCheckRecords. Remove the import of writeLoadCheckRecord from this file.
- Add shardRecordedKeys(settings, shard, catalogSha256): the keys of readLoadCheckRecordFile on that same shardRecordFilePath.
- Add loadCheckShardTitle(kind, shard): loadCheckSpecTitle(kind) with one worker; with more, that title followed by " shard {shardNumber} of {workerCount}".
- Add loadCheckShardRunMessages(kind, shard, run): with one worker exactly one line, "load sweep {kind}: " and the JSON text of the summary, as today; with more workers two lines that start with "load sweep {kind} shard {shardNumber} of {workerCount}: ", the first with the JSON text of the summary, the second "left {count} keys for the one-worker run".
- Unchanged: loadCheckSkipReason, loadCheckSliceTimeoutMilliseconds, the two timeout constants, checkHarnessLoadKey, keysNotRecordedExactlyOnce, readLoadCheckSliceSettings.

**The five sweep specs (D-03, D-04, D-05).** Each keeps its kind, its settings line, its test.skip line with loadCheckSkipReason, its check functions and its error text "the {kind} slice needs its settings and the Playwright baseURL". Each adds a shard list, loadCheckShards(readLoadCheckWorkerCount(process.env)), and calls test.describe.configure with mode parallel only when the list holds more than one shard. The single test becomes a loop over the shards that declares one test per shard, titled loadCheckShardTitle(kind, shard), declared in the spec file itself so the reported location stays in the spec. The body: the settings and baseURL guard, test.setTimeout with the same loadCheckSliceTimeoutMilliseconds call as today, the run through runLoadCheckSlice(settings, shard, playwrightLoadCheckActions(page, baseURL, settings, shard, the spec's check)), one console.log per line of loadCheckShardRunMessages, and the assertion that keysNotRecordedExactlyOnce(run.summary.checkedKeys, shardRecordedKeys(settings, shard, run.summary.catalogSha256)) is empty. The tiles spec still fetches the served tile manifests inside each test before the run. Remove each spec's import of readLoadCheckRecords and of loadCheckSpecTitle.

Do not add a retry, a sleep or a timeout. Do not reuse a page across keys. Do not change what a check asserts (D-07).
  </action>
  <verify>
    <automated>python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py pnpm.cmd vitest run tests/unit/loadCheckWorkerCount.test.ts tests/unit/loadCheckShards.test.ts tests/unit/loadCheckPartFiles.test.ts tests/unit/servedLaneRun.test.ts tests/unit/loadCheckRecordFile.test.ts tests/unit/loadCheckRecords.test.ts</automated>
    <automated>python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py pnpm.cmd typecheck</automated>
  </verify>
  <done>Every test of the behavior block passes by name, the earlier tests of the two existing test files pass with their assertions unchanged, typecheck passes, and no export of the touched modules is unused (readLoadCheckRecords is still called by readRecordedKeys, writeLoadCheckRecord by the eight other specs, loadCheckSpecTitle by loadCheckShardTitle, loadCheckPartFilePaths by the fold and by servedLaneRun.ts). playwright.config.ts sets globalSetup and no globalTeardown. No test wrote under the checkout's artifacts folder. One commit on lane/speed.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Tile walk on the same pieces, then the real windows sweep with 3 workers and with one</name>
  <files>tests/browser/world-tile-walk.spec.ts, tests/browser/support/tileWalkRecords.ts, tests/browser/support/servedLaneRun.ts, tests/unit/tileWalkRecords.test.ts, tests/unit/loadCheckPartFiles.test.ts, tests/unit/servedLaneRun.test.ts</files>
  <precondition>For the browser run only: `test -f .env` succeeds (never read the file), `test -f artifacts/lane-store/data-ui/l2/catalog.json` succeeds, and `pwsh -NoProfile -File C:/Users/rolan/.claude/tools/lane/lane.ps1 list l2-browser-client` shows that nothing listens on this lane's port. If a server listens there, do not stop it: report and stop. `test ! -e artifacts/lane-store/data-ui/load-checks.moved-aside-261112-vod` succeeds; if that folder exists, an earlier attempt stopped before its restore: do step 4 of the browser run first, and write no new 261112-vod-load-checks-before.sha256 before the folder is back.</precondition>
  <behavior>
    tests/unit/tileWalkRecords.test.ts (added; the existing tests stay):
    - "places the walk record folder and keeps the walk record file path" (tileWalkRecordFolderPath; tileWalkRecordFilePath returns the same path as before).
    - "the walk part file of worker k of N sits beside the walk record file": shardRecordFilePath of the walk record file gives tile-walks-{sha}.part-1-of-3.json, and the record file itself with one worker.
    - "with one worker a recorded tile is walked again": recordedTileWalkSkipReason is null for a recorded and for an unrecorded tile.
    - "with more than one worker a tile the walk record file already holds is skipped and an unrecorded tile is walked": a reason that names the tile key, and null.
    tests/unit/loadCheckPartFiles.test.ts (added):
    - "folds walk part files of the measurements folder into tile-walks-{sha}.json and leaves streaming-baseline files alone".
    tests/unit/servedLaneRun.test.ts (added):
    - "folds the load-checks folder and the measurements folder of the lane NATIVE_STORE_ROOT names".
    - "a one-worker run that is not alone refuses to start while a walk part file waits in the measurements folder".
  </behavior>
  <action>
**tests/browser/support/tileWalkRecords.ts (D-06).** Export tileWalkRecordFileNamePrefix (the text tile-walks-) and tileWalkRecordFolderPath(projectRoot, laneName); tileWalkRecordFilePath builds on both and returns the same path as today. Add recordedTileWalkSkipReason(recordedKeys, tileId, workerCount): null with one worker, null when the set does not hold the tile key, otherwise a text that names the tile key and says a run with LOAD_CHECK_WORKERS above 1 leaves recorded tiles alone.

**tests/browser/support/servedLaneRun.ts.** The list of record folders of the lane gains tileWalkRecordFolderPath of the lane with tileWalkRecordFileNamePrefix, after the load-checks folder. So the fold and the check for waiting part files both cover the walk. The run marker stays in the load-checks folder: one marker per run guards both folders.

**tests/browser/world-tile-walk.spec.ts (D-05, D-06).**
- Read the worker count once with readLoadCheckWorkerCount(process.env). When it is above 1 call test.describe.configure with mode parallel at the top level of the file. Each tile describe keeps its own mode serial line, so the two viewports of a tile stay in order in one worker.
- beforeEach: after the lane catalog SHA-256 is read, compute recordedTileWalkSkipReason from the keys of readLoadCheckRecordFile on the walk record file; when it is not null call test.skip(true, reason). "Same rules" of D-06 means the sweep's skip of recorded keys: without it a second pass record for one tile would meet the fold's refusal of different records.
- afterEach: the settled walk is computed as today. Build the shard from testInfo.parallelIndex and the worker count. When shardRecordsStatus(shard, status) is false print "tile walk tile:{tileId}: left for the one-worker run" and write nothing. Otherwise call writeLoadCheckRecordFile on shardRecordFilePath of the walk record file with the same record as today.
- Unchanged: titles, timeouts, viewports, screenshots, every expectation, the skip on NATIVE_STORE_ROOT, the list of tiles from WALK_TILE_IDS. With one worker the spec has no parallel mode, never skips a recorded tile and writes the walk record file itself, as today.

**The real browser run (windows sweep, data-ui store, this lane's port).** The two sweep runs are steps of this action and of nothing else. No verify command starts a run, so a verify pass after the restore cannot write the lane's record files. All evidence goes to C:/laragon/l2b-orchestration/autonomous-roadmap under names that start with 261112-vod-. Run every command from the checkout root. Run the steps in this order, and do step 4 in every case, also when a run fails.
1. Save the SHA-256 of every file of the lane's record folder: `sha256sum artifacts/lane-store/data-ui/load-checks/* > C:/laragon/l2b-orchestration/autonomous-roadmap/261112-vod-load-checks-before.sha256`. Then rename that folder to artifacts/lane-store/data-ui/load-checks.moved-aside-261112-vod. The global setup of the next run creates a new load-checks folder for its run marker.
2. Run with 3 workers and keep the exit code in the log: `NATIVE_STORE_ROOT=data-ui LOAD_CHECK_KIND=windows LOAD_CHECK_LIMIT=6 LOAD_CHECK_WORKERS=3 python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py pnpm.cmd test:e2e tests/browser/load-sweep-windows.spec.ts > C:/laragon/l2b-orchestration/autonomous-roadmap/261112-vod-windows-3-workers.log 2>&1; printf '\nexit code %s\n' "$?" >> C:/laragon/l2b-orchestration/autonomous-roadmap/261112-vod-windows-3-workers.log`. Then save the names the run left: `ls -A artifacts/lane-store/data-ui/load-checks > C:/laragon/l2b-orchestration/autonomous-roadmap/261112-vod-load-checks-after-3-workers.txt`. Expect three shard tests that pass, summary lines that name shard 0, 1 and 2 of 3, and one record file as the only name: no part file and no run marker.
3. Run the same command without LOAD_CHECK_WORKERS, with the log 261112-vod-windows-1-worker.log and the listing 261112-vod-load-checks-after-1-worker.txt. Expect the test "load sweep windows slice", one summary line in today's form, the keys of step 2 counted in skippedAsRecorded, and again one record file as the only name.
4. Restore: move the record file from artifacts/lane-store/data-ui/load-checks to C:/laragon/l2b-orchestration/autonomous-roadmap/261112-vod-windows-sweep-records.json. Move any other file left in that folder beside it under a name that starts with 261112-vod-left- and name it in the summary. Remove the then empty folder with rmdir and rename the moved-aside folder back.
5. Run the two evidence commands of the verify block. The first reads the saved logs, listings and record file. The second compares the restored folder with step 1. Both only read.
6. Check that nothing the runs started still runs: the lane list command shows no listener on the lane port, and no node, vite or browser process holds l2b-speed in its command line apart from this session's own. Stop a leftover only by its PID.

If the summaries of step 2 hold no checked key because the store lists no unrecorded window key, or the dev server refuses the lane catalog, do step 4 and 6, say so in the summary and stop. Do not invent data and do not convert anything.

Write the summary with: the two commands, the printed summary lines, the count the first evidence command printed, and the result of the restore comparison. The summary also states these rules for the caller under the heading "Caller rules", each rule in full. The second rule keeps the words "anywhere on the machine", which the plan's verification looks for. The orchestrator carries the rules into docs/BATCH_PIPELINE_SPEED.md at integration, because the file list of this plan holds no docs file:
- A run with LOAD_CHECK_WORKERS above 1 must be the only Playwright run of its lane in its checkout. Any other run that starts on that lane meanwhile is refused in its global setup, and the run with more workers is refused while another run of the lane is live. A marker left by a killed run is removed by the next run when its process id is dead; when that id belongs to another live process, the refusal names the marker file to remove.
- The run marker guards one lane of one checkout and nothing else. While a run with LOAD_CHECK_WORKERS above 1 is live anywhere on the machine, start no one-worker Playwright run that names a lane on that machine: no sweep, no walk and no spec that calls writeLoadCheckRecord, whether on another lane of the same checkout, in another l2b-* checkout or in the main checkout. Such a run is not refused. Under the load of the other run's pages it records failed on a timeout exactly as before this plan, and a later rerun skips that key. The one-worker run that checks the keys a run with more workers left starts under the same rule. Two runs with more than one worker at the same time write no failure; each only leaves more keys.
- Unchanged by this plan: a one-worker run records failed on a timeout whatever else loads the machine (a conversion, a build, a unit suite, one-worker runs of other lanes). What runs beside a one-worker run is the caller's choice, as before.
- The worker count is set only through LOAD_CHECK_WORKERS; a run with --workers, -j, --debug or --pause that gives another count is refused.
- No --repeat-each above 1 together with LOAD_CHECK_WORKERS above 1. Two copies of one sweep shard would write one part file at the same time, so a pass can be lost and that shard's last assertion fails. Two copies of one tile walk on two workers write two pass records with different times, and the fold refuses that key until one of the two part files is removed by hand.
- A run with more than one worker that crashed keeps its passes in part files until the next Playwright start with the same NATIVE_STORE_ROOT. Until then the record file and every reader of it (the coverage report, the 02-88 gates) count those keys as unrecorded. Start one Playwright run on that lane before a coverage report.
- A one-worker walk walks every tile of WALK_TILE_IDS again, also a tile that a walk with more workers recorded as pass. The one-worker walk after such a run takes WALK_TILE_IDS set to the tiles printed as left.
- A fold prints one line per record file, and the path holds the catalog SHA-256. Two lines with two SHA-256 values in one run mean the lane catalog changed while shards ran. So write nothing to a lane's catalog while a run with more than one worker is live on that lane.
  </action>
  <verify>
    <automated>python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py pnpm.cmd vitest run tests/unit/tileWalkRecords.test.ts tests/unit/loadCheckPartFiles.test.ts tests/unit/servedLaneRun.test.ts tests/unit/loadCheckShards.test.ts tests/unit/loadCheckRecords.test.ts</automated>
    <automated>python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py pnpm.cmd typecheck</automated>
    <automated>node -e "const fs=require('fs');const evidence='C:/laragon/l2b-orchestration/autonomous-roadmap/261112-vod-';const text=name=>fs.readFileSync(evidence+name,'utf8');const lines=name=>text(name).split(/\r?\n/).filter(line=>line!=='');const logNames=['windows-3-workers.log','windows-1-worker.log'];for(const logName of logNames)if(lines(logName).pop()!=='exit code 0')throw new Error(logName+' does not end with exit code 0');for(const shardNumber of [0,1,2])if(!text(logNames[0]).includes('load sweep windows shard '+shardNumber+' of 3: {'))throw new Error('no summary line of shard '+shardNumber+' of 3');if(!text(logNames[1]).includes('load sweep windows: {'))throw new Error('no one-worker summary line');for(const listingName of ['load-checks-after-3-workers.txt','load-checks-after-1-worker.txt']){const names=lines(listingName);if(names.length!==1||names[0].length!==69||!/^[0-9a-f]{64}\.json/.test(names[0]))throw new Error(listingName+' lists '+names.join(', '))}const checked=logNames.flatMap(logName=>[...text(logName).matchAll(/load sweep windows[^:\n]*: (\{.*\})/g)]).flatMap(match=>JSON.parse(match[1]).checkedKeys);const recorded=JSON.parse(text('windows-sweep-records.json')).records.map(record=>record.key);if(checked.length===0||new Set(checked).size!==checked.length||JSON.stringify([...checked].sort())!==JSON.stringify(recorded))throw new Error('checked '+checked.length+' keys, recorded '+recorded.length);console.log('one record per checked key: '+recorded.length)"</automated>
    <automated>sha256sum -c C:/laragon/l2b-orchestration/autonomous-roadmap/261112-vod-load-checks-before.sha256 && test "$(ls -A artifacts/lane-store/data-ui/load-checks | wc -l)" -eq "$(grep -c '' C:/laragon/l2b-orchestration/autonomous-roadmap/261112-vod-load-checks-before.sha256)" && test ! -e artifacts/lane-store/data-ui/load-checks.moved-aside-261112-vod</automated>
  </verify>
  <done>The named tests pass and typecheck passes. The first evidence command prints "one record per checked key" with a count above 0: both saved logs end with exit code 0, the 3-worker log holds a summary line of each shard, each saved listing holds one record file name and nothing else (no part file, no run marker), and the saved record file holds exactly the checked keys. The second evidence command passes: the lane's two earlier record files have the SHA-256 values of step 1, the folder holds no other file, and the moved-aside folder is gone. It holds until the owner next writes that folder. No verify command starts a browser run or writes under artifacts (the Vitest files write in temporary folders, the two evidence commands only read), so each can be run again at any time. Nothing the runs started still runs. One commit on lane/speed for the code and tests; the lane store is not part of any commit.</done>
</task>

</tasks>

<threat_model>
## Trust boundaries

| Boundary | Description |
|----------|-------------|
| Catalog files on disk to the dev server | The kept answer must never outlive the files it was built from |
| Part files on disk to the fold | A part file is input from an earlier process, possibly one that crashed |
| Environment to the test run | LOAD_CHECK_WORKERS and NATIVE_STORE_ROOT are text from outside |
| Command line to the test run | --workers, -j, --debug and --pause change the worker count behind the environment text |
| Other Playwright invocations to the lane folders | A second invocation in the same checkout may name the same lane on another port |
| Other Playwright runs on the machine to the CPU | A run on another lane or in another checkout shares the CPU with the pages of a run with more than one worker, and no marker sees it |

## STRIDE threat register

| Threat ID | Category | Component | Severity | Disposition | Mitigation plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-vod-01 | Tampering | createKeptLaneUnionCatalogReader | high | mitigate | The entry is keyed by device, inode, size and modification time in nanoseconds of both catalog files, read before the build starts; tests rebuild on a size change, on a time-only change and on a file that appears or disappears (D-01) |
| T-vod-02 | Tampering | lane record file with several writers | high | mitigate | One writer per part file (shard number or parallel index); the record file is written only by a one-worker run and by the fold in the runner process; writeLoadCheckRecord refuses above one worker; other invocations are kept off the lane by T-vod-08 (D-03, D-04) |
| T-vod-03 | Repudiation | a failure recorded because of machine load | high | mitigate | shardRecordsStatus is the one rule for sweeps and walks; tests show no record for a non-pass above one worker and a failed record with one; the worker count it reads is checked against the effective count by T-vod-09; the load such a run puts on runs of other lanes and checkouts is T-vod-12 (D-05) |
| T-vod-04 | Denial of service | part files left by a crashed run | medium | mitigate | The global setup of the next run that is alone on the lane folds what it finds; a one-worker run that is not alone refuses to start while part files wait, so it cannot check their keys a second time; a fold repeated after an interrupted one meets equal records and keeps one (D-04) |
| T-vod-08 | Tampering | a second Playwright invocation on a lane while shards run | high | mitigate | Every run that names a lane creates its run marker before it lists the markers of the lane; a run with more than one worker starts only alone and no run starts beside one; a fold happens only in a run that is alone; the end of the run is the function the global setup returns, so a refused run never folds; tests cover both start orders (D-03, D-04) |
| T-vod-09 | Elevation of privilege | a worker count from --workers, -j, --debug, --pause or a config override | high | mitigate | startServedLaneRun compares the workers of the resolved config with LOAD_CHECK_WORKERS before any test and refuses with both numbers (D-02, D-05) |
| T-vod-10 | Denial of service | a run marker left by a killed run | low | mitigate | The next run removes a marker whose process is dead. When that process id now belongs to another live process, the run is refused and the error names the marker file to remove; the other direction would be a fold beside a live run |
| T-vod-11 | Tampering | a worker of a run with more than one worker that outlives its hard-killed runner | low | accept | Such a worker can finish one part file write that was in flight, and only a pass. The next run reaches its global setup after its dev server has started. If the two ever meet, that pass is checked again or the next fold refuses the key by name; no failed record and no silent wrong record results |
| T-vod-12 | Repudiation | a one-worker run on another lane or in another checkout, slowed by the pages of a run with more than one worker | high | transfer | Not closed in code: the run marker lies under process.cwd() of one checkout and names one lane, so such a run is not refused and records failed on a timeout as today. The summary's caller rules say that no one-worker run that names a lane starts while a run with LOAD_CHECK_WORKERS above 1 is live anywhere on the machine. The orchestrator, who starts those runs, keeps the rule and carries it into docs/BATCH_PIPELINE_SPEED.md. A marker for the whole machine is item 3 of the decisions at the top (D-05) |
| T-vod-13 | Tampering | --repeat-each above 1 in a run with more than one worker | low | transfer | Two copies of a sweep shard share one part file, and two copies of a tile walk give two pass records that the fold refuses by key; no wrong record results. The summary's caller rules forbid the combination |
| T-vod-05 | Tampering | the fold reading a foreign or damaged file | medium | mitigate | Only names of the exact part pattern behind the record file prefix are read; every input passes readLoadCheckRecordFile with the lane and the catalog SHA-256; different records for one key are refused before any write |
| T-vod-06 | Information disclosure | a part file read as a record file by a report | low | mitigate | Checked: scripts/native_store/load_check_records.py and the streaming baseline spec use exact names and nothing lists the two folders |
| T-vod-07 | Elevation of privilege | LOAD_CHECK_WORKERS text | low | mitigate | Plain decimal 1 to 16 or a refusal that names the value |
| T-vod-SC | Tampering | npm, pip or cargo installs | high | accept | This plan installs no package and changes no lock file |
</threat_model>

<verification>
- `python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py pnpm.cmd vitest run tests/unit/keptLaneUnionCatalog.test.ts tests/unit/nativeStoreRootPlugin.test.ts tests/unit/nativeStoreRootBuildAbsence.test.ts tests/unit/loadCheckWorkerCount.test.ts tests/unit/loadCheckShards.test.ts tests/unit/loadCheckPartFiles.test.ts tests/unit/servedLaneRun.test.ts tests/unit/loadCheckRecordFile.test.ts tests/unit/loadCheckRecords.test.ts tests/unit/tileWalkRecords.test.ts` passes.
- `python C:/laragon/l2b-orchestration/autonomous-roadmap/run_below_normal.py pnpm.cmd typecheck` passes.
- The two evidence commands of task 3 pass: the saved logs, listings and record file of the two browser runs agree, and the lane's record files are restored. The browser runs themselves are action steps of task 3 and are not run again by a verifier.
- After the summary is written: `grep -c "anywhere on the machine" .planning/quick/261112-vod-load-sweeps-and-tile-walks-without-a-cat/261112-vod-SUMMARY.md` prints 1 or more, and the summary holds the heading "Caller rules" with every rule of the list in task 3. The summary does not exist at HEAD, so the command fails today.
- `git status --short` lists no Python file, no file under `src` and no file under `artifacts` (D-07).
- The full unit suite, the pipeline suite and `pnpm build` were not run.
</verification>

<success_criteria>
- D-01: one python start per catalog file identity, shared by concurrent requests, no kept failure, headers unchanged.
- D-02: LOAD_CHECK_WORKERS is the one switch; default 1; refusal outside 1 to 16; fullyParallel false; a run whose effective Playwright worker count differs from it is refused before any test.
- D-03: N shard tests, the same pending list in each, position modulo N, the record file untouched while shards run, also by any other Playwright invocation in the checkout.
- D-04: one part file per shard through the existing writer; the fold at the start of a run that is alone on its lane and at the end of a run with more than one worker; crash leftovers folded by the next run that starts; no fold beside a live run.
- D-05: above one worker a non-pass writes nothing and is counted as left; a failed record comes only from a run that really has one worker. That no one-worker run that names a lane runs elsewhere on the machine beside a run with more workers is a caller rule of the summary, not code.
- The summary holds the heading "Caller rules" with every rule of task 3, among them the rule for the whole machine and the rule against --repeat-each above 1 with more than one worker.
- D-06: the walk runs tiles in parallel with both viewports of a tile in one worker, on the same part files and the same fold.
- D-07: nothing outside the listed files changed; no page reuse; no changed assertion.
- With one worker titles, printed lines, records, file and skip rule are as before, except that a one-worker run is refused while a run with more than one worker is live on its lane.
- The real run shows one record per checked key, no part file and no run marker.
- Every automated verify command can be run again after the plan is done without a write under artifacts.
</success_criteria>

<output>
Create `.planning/quick/261112-vod-load-sweeps-and-tile-walks-without-a-cat/261112-vod-SUMMARY.md` when done.
</output>
