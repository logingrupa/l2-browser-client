# Quick task 261112-vod: load sweeps and tile walks without a catalog rebuild per key, and in several browser workers - context

Locked decisions of the orchestrator (thread "Speed Up Asset Conversion Tools", 2026-11-12). Read `docs/BATCH_PIPELINE_SPEED.md`, section "Rules for parallel work", first.

## Goal

A load sweep and a tile walk give the same record files as today, in less time: the dev server stops rebuilding the lane union catalog for every request, and a sweep or walk can use several Playwright workers without ever recording a failure that load on the machine caused.

## Measured facts (DATABASE-PC, 8 cores, 16 threads, 64 GB)

- `vite/nativeStoreRootPlugin.ts` `readLaneUnionCatalog` starts `python -B scripts/native_store/print_lane_union_catalog.py` for every `/l2/catalog.json` request. One run on the roadmap worktree's stores: actors lane 1.61 s (21 MB document), data-ui 0.43 s, world 0.36 s. Every key page of a sweep fetches the catalog (`tests/browser/harness/loadCheckHarness.ts`), so an actors sweep pays 1.6 s per key for the same bytes.
- Past sweep rates (`.planning/OVERNIGHT-DECISIONS.md`, about row 954): tiles about 11 s per key, items 2.7 s, NPCs and skills 1.3 to 2 s. The item sweep is 3,684 keys.
- `playwright.config.ts` sets `fullyParallel: false, workers: 1`. Each sweep spec is one test that loops over its keys in one worker (`runLoadCheckSlice` in `tests/browser/support/loadCheckRecords.ts`), opens one page per key and rewrites the whole record file after each key (`writeLoadCheckRecordFile` in `tests/browser/support/loadCheckRecordFile.ts`: read, add, sort by key, atomic rename, no lock).
- A key that times out (90 s, tiles 180 s) is recorded as `failed`, and a rerun skips every recorded key, pass or failed. Headless WebGPU runs on SwiftShader, a CPU renderer, so several pages at once make each page slower.
- The tile walk (`tests/browser/world-tile-walk.spec.ts`, `tests/browser/support/tileWalkRecords.ts`, `WALK_TILE_IDS`) runs two viewport tests per tile in one worker and writes its record file through the same writer; plan 02-88 runs it in groups of at most 10 tiles, each group a new Playwright start.

## Hard constraints

- With one worker (the default) every command of the roadmap plans behaves exactly as today: same records, same file, same skip rule, same messages.
- A `failed` record is only ever written by a run with one worker. A pass may be written by any run.
- No timeout, threshold or retry is added, raised or lowered. No sleeps.
- Response headers of the native store routes do not change (`Cache-Control: no-store`, the lane catalog SHA-256 header, the source header).
- AGENTS.md code rules: no comments, full-word names, no dead code, TypeScript strict, no `any`. This touches test config, so the plan is a quick-full plan. Only targeted Vitest files run (one full `pnpm test:unit` per machine at a time); e2e runs only on the lane's own `DEV_PORT`.
- Never run a conversion, never write under `public/l2`, never run `pnpm build`.

## Locked decisions

1. **Catalog kept by the dev server.** `readLaneUnionCatalog` keeps its last answer per native store root, keyed by the file identity (device, inode, size and modification time in nanoseconds from a bigint `stat`) of the lane catalog file and of the shared catalog file. A request whose identities match gets the kept bytes; any change builds again. Requests that arrive while a build for the same identities is running share that one build. A failed build is not kept. The fixture root path is unchanged.
2. **Workers are an explicit number.** One environment variable (`LOAD_CHECK_WORKERS`, plain decimal 1 to 16, default 1, refused with a clear error otherwise) sets the Playwright `workers` in `playwright.config.ts` and is read by the sweep and walk code. `fullyParallel` stays false; only the sweep and walk specs opt their shard tests into parallel mode.
3. **Shards.** With N workers a sweep declares N shard tests. Every shard computes the same pending key list (converted keys minus the keys recorded in the merged record file, then the limit and `LOAD_CHECK_KEYS` rules of today) and takes the keys whose position in that list modulo N equals its shard number. The merged record file is not written while shards run, so every shard sees the same list.
4. **Part files, one writer each.** Shard k writes only its own part file beside the record file (`<catalogSha256>.part-<k>-of-<N>.json`, same record shape, through the existing writer). A Playwright global setup and global teardown fold every part file of the lane into the record file with the writer's own ordering and one-record-per-key rule, then remove the folded part files. A run that crashed leaves part files; the next run's global setup folds them, so no checked key is lost and none is checked twice.
5. **Load never writes a failure.** In a run with more than one worker a key whose check does not pass is not recorded at all, and the spec prints how many keys it left for the one-worker run. The spec's "every checked key recorded exactly once" assertion covers the recorded keys. A following one-worker run of the same command checks the left keys on a lone page and records pass or failed as today.
6. **Tile walks.** Same rules: with N workers the walk spec runs tiles in parallel (the two viewports of one tile stay in order in one worker), each worker writes its own part file, the same fold step merges them, and a tile that does not pass is left for the one-worker run. With one worker nothing changes.
7. **Out of scope:** reusing a page across keys, changing what a check asserts, the pipeline suite, the unit suite, any Python file other than none (this task changes no Python).

## Tests the plan must require

- Vitest, targeted files: the kept catalog (one build for many requests with unchanged identities, a rebuild after either file changes, concurrent requests share one build, a failed build is retried by the next request, headers unchanged); the worker-count reader (default, bounds, refusal text); shard selection (every pending key lands in exactly one shard, shards are disjoint, the limit and `LOAD_CHECK_KEYS` order rules hold, one worker selects exactly today's list); the fold (part files plus an existing record file give the sorted one-record-per-key file, a key present in two inputs with different records is refused, folded part files are removed, no part files is a no-op); the multi-worker rule that a non-pass writes no record while one worker writes `failed` as today.
- `pnpm typecheck` passes.
- One real browser run in this lane, on the lane's own `DEV_PORT`, of the windows sweep against the lane's data-ui store with 3 workers and a small limit, then the same command with one worker: the record file ends with one record per checked key and no part file is left. The lane's existing record file for the current catalog is moved aside first and restored afterwards (it is the orchestrator's test data). If the lane's data-ui store has no unrecorded window keys even after that, say so and stop; do not invent data.

## Ruling of the orchestrator after the third plan check (2026-11-12, 23:55 Riga)

The plan checker left four warnings and the plan lists four decisions to revisit. The ruling:

- **Task 1 runs now, alone.** The catalog kept by the dev server (decision 1) is one source file and one test file, changes no caller and no rule, and removes the measured 1.6 s per key.
- **Tasks 2 and 3 are deferred, not executed.** Several browser workers need a run marker, refusals for other runs on the lane, a caller rule for the whole machine and 18 changed files, and they change signatures that the open roadmap plan 02-89 also edits (`runLoadCheckSlice`, `playwrightLoadCheckActions`, a sixth sweep spec). They come back as their own quick task after plan 02-89 has landed and after the gain of task 1 is measured on a real sweep. Decisions 2 to 6 stay as written for that task; revisit items 1 to 3 of the plan are answered then.
- **Done for this quick task means:** the must_haves of task 1 hold, `pnpm typecheck` passes, and the named Vitest files pass. The real browser run of task 3 is not part of it.

## Measurement the orchestrator runs afterwards (not the executor)

Request time of `/l2/catalog.json` before and after against the roadmap worktree's actors store (read-only), and the windows sweep in this lane with 1 and with 4 workers. The end-to-end gain on the item, NPC, skill and tile sweeps is measured by the roadmap thread's next real sweep.
