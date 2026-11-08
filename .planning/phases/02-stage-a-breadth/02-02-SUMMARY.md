---
phase: 02-stage-a-breadth
plan: 2
subsystem: native-store
status: complete
tags: [machine-schedule, unit-ledger, gap-rows, playwright, batch-preflight]
requires:
  - phase: 02-stage-a-breadth
    provides: native_store/store_paths.py (02-01) with lane_store_root, lane_work_root, lane_gap_rows_path and the converter output guard
provides:
  - scripts/check-machine-schedule.mjs, the single owner of Riga time and machine windows, with its .d.mts types
  - the Playwright config guard refuseTestRunInsideMachineWindow in both Playwright configs
  - scripts/native_store/unit_ledger.py, the resumable per-unit seal driver with require_batch_preflight and run_at_below_normal_priority
  - scripts/native_store/gap_rows.py and gap_reasons.json, the one gap-row schema with a closed, versioned reason list
  - scripts/native_store/canonical_json.py, the shared canonical JSON bytes
affects: [02-03, 02-04, 02-07, 02-12, 02-16, 02-26, every lane batch entry point, every Playwright run]
tech-stack:
  added: []
  patterns:
    - "Every lane batch entry point calls require_batch_preflight(project_root, lane, BATCH_MINIMUM_FREE_BYTES) first, then run_at_below_normal_priority()"
    - "Per unit: fingerprint = ledger.unit_fingerprint([r['sha256'] for r in locked_input_records(paths)], config); skip if is_sealed, else begin, convert, seal"
    - "Gap rows go through write_gap_rows or a receipt's gapRows; reasons only from gap_reasons.json or a lane recipes/<lane>/gap-reasons.json"
key-files:
  created:
    - scripts/check-machine-schedule.mjs
    - scripts/check-machine-schedule.d.mts
    - tests/browser/support/machineScheduleConfigGuard.ts
    - tests/unit/checkMachineSchedule.test.ts
    - scripts/native_store/unit_ledger.py
    - scripts/native_store/gap_rows.py
    - scripts/native_store/gap_reasons.json
    - scripts/native_store/canonical_json.py
    - tests/pipeline/test_unit_ledger.py
    - tests/pipeline/test_gap_rows.py
  modified:
    - playwright.config.ts
    - playwright.startup.config.ts
    - scripts/native_store/store_paths.py
    - .planning/OVERNIGHT-DECISIONS.md
key-decisions:
  - "unit_ledger over native_batch adapters, one seal driver for all lanes (row 103)"
  - "Playwright guard runs while the config loads, not in globalSetup, because the webServer starts first (row 104)"
  - "owner.json carries no plan field (row 105)"
  - "BATCH_MINIMUM_FREE_BYTES is 4 GiB (row 106)"
  - "locked_input_records takes eSha256 from the lock for equal files only (row 107)"
  - "step-pending:<step> is the one pending reason (row 108)"
  - "--host and --at CLI options; exit 0, 2 and 1 (row 109)"
  - "read_machine_schedule runs the repository's own script by absolute path (row 110)"
  - "canonical_json.py and lane_gap_rows_folder give the shared helpers one owner (row 111)"
  - "INT-01 and WORLD-03 stay Pending (row 112)"
  - "a tampered seal raises instead of being redone (row 113)"
requirements-completed: []
duration: 16min
completed: 2026-11-08
commits: 5
plan_head_before: 90f3626d7b60f2aa63623901d6a780213d07f9ae
plan_head_after: 968d35260cb732b55394e91cc73fadcf5f451685
actuals:
  tokens: 18500
  tasks: 3
  commits: 5
---

# Phase 2 Plan 02: Machine schedule, unit ledger and gap rows Summary

**One Node module now owns Riga time and the PROMINENCE-PC backup window, and executors, both Playwright configs and the Python batch preflight all use it. A resumable `UnitLedger` seals each unit once, using fingerprints built only from lock hashes. Gap rows have one validated schema with a closed, versioned reason list, and the seal checks them.**

## Performance

- Duration: about 16 min (17:39 to 17:55 Riga, Sunday; DATABASE-PC has no machine window)
- Tasks: 3 of 3
- Files: 14 in the five code and test commits, plus the docs commit

## Final API

### `scripts/check-machine-schedule.mjs` (+ `.d.mts`)

- `MACHINE_WINDOWS`: one frozen entry, `{ host: "PROMINENCE-PC", days: Mon..Sun, start: "23:15", end: "03:45", reason: "nightly backup" }`. DATABASE-PC has none.
- `rigaWallClock(instant)` returns `{ weekday, minuteOfDay, isoDate, isoTime, offset }` from `Intl.DateTimeFormat` with `Europe/Riga`.
- `findActiveMachineWindow(hostName, instant)` matches the host without case. The window starts inclusive and ends exclusive, and it crosses midnight through the previous weekday. It returns the window or `null`.
- `formatRigaTimestamp(instant)` returns, for example, `2026-11-08T10:05:00+02:00`.
- `describeActiveMachineWindow(window, rigaTime)` gives the one message text that the CLI and the Playwright guard share.
- CLI: `node scripts/check-machine-schedule.mjs [--host <name>] [--at <ISO instant>]` prints `{"host","rigaTime","activeWindow"}`.
  - Exit 0 outside a window.
  - Exit 2 inside one, with `inside nightly backup window Mon,...,Sun 23:15-03:45 Riga (now ...); stop and resume later` on stderr.
  - Exit 1 on an error or an unknown option.

### `tests/browser/support/machineScheduleConfigGuard.ts`

- `refuseTestRunInsideMachineWindow(hostName = hostname(), instant = new Date())` throws `Playwright run refused: inside ...`.
- `playwright.config.ts` and `playwright.startup.config.ts` call it at top level, before `defineConfig`, so the refusal comes before the webServer starts `pnpm dev`.

### `scripts/native_store/unit_ledger.py` (307 lines, no split needed)

- Errors: `UnitLedgerError(ValueError)` and `BatchPreflightRefusedError(UnitLedgerError)`.
- Constants: `BATCH_MINIMUM_FREE_BYTES` (4 GiB), `BELOW_NORMAL_PRIORITY_CLASS` (0x4000), `MACHINE_SCHEDULE_SCRIPT` and `UNIT_KEY_PATTERN` (at most 160 characters).
- Preflight:
  - `read_machine_schedule(run_command)` returns `(exit code, schedule, stderr)`.
  - `require_host_clock_on_riga_time(riga_time_text, local_time)`.
  - `require_batch_preflight(project_root, lane_name, minimum_free_bytes, *, run_command, disk_usage, local_now)` returns `{host, rigaTime, freeBytes, laneStoreRoot}`.
- Helpers: `current_riga_timestamp`, `run_at_below_normal_priority`, `unit_directory_name` (`tile:20_21` becomes `tile__20_21`) and `locked_input_records(relative_paths, lock_path)`.
- `UnitLedger(work_root, step, algorithm_version, *, riga_clock, free_bytes, host)` has `unit_fingerprint(input_sha256s, config)`, `unit_step_directory(unit_key)`, `is_sealed(unit_key, fingerprint)`, `begin(unit_key, fingerprint)` and `seal(unit_key, fingerprint, receipt)`.
- The caller's receipt part is `{config, inputs: [{path, sha256}], outputs: [{path, sha256, bytes}], gapRows}`. Output paths are relative to the lane folder and start with `l2/` or `work/`.

### `scripts/native_store/gap_rows.py` and `gap_reasons.json`

- Names: `GapRowError`, `GAP_ROW_STATUSES`, `GAP_ROW_FIELDS`, `CATALOG_KEY_PATTERNS`, `SEED_GAP_REASONS_PATH` and `LANE_GAP_REASON_FILES`.
- Reason lists: `load_gap_reason_patterns(repository_root)` and `gap_reason_list_versions(repository_root)`, which returns for example `{"seed": 1}`.
- Rows: `stage_a_part_names()`, `validate_gap_row(row, reason_patterns=None)`, `sorted_gap_rows(rows)`, `write_gap_rows(project_root, lane_name, step, rows)` and `read_gap_rows(project_root, lane_name)`.
- `gap_reasons.json` is `{schemaVersion 1, listVersion 1, reasons: [28 patterns]}`. The last pattern is `step-pending:<step>`.

### Other

- `scripts/native_store/canonical_json.py`: `canonical_json_bytes(value)`. It returns sorted keys with indent 2, ASCII only, refuses NaN, and ends with a newline.
- `scripts/native_store/store_paths.py`: adds `lane_gap_rows_folder(project_root, lane_name)`.

## Record files, one example each

Path: `artifacts/lane-store/world/work/tile__20_21/raw/`

- `owner.json`: `{"host": "DATABASE-PC", "lane": "world", "pid": 4242, "startedAtRiga": "2026-11-08T15:05:00+02:00", "step": "raw", "unitKey": "tile:20_21"}`
- `.running.json` (exists only while the unit runs): `{"fingerprint": "<64 hex>", "startedAtRiga": "2026-11-08T15:05:00+02:00", "step": "raw", "unitKey": "tile:20_21"}`
- `receipt.json`: `{"algorithmVersion": 1, "config": {"chunkSize": 4}, "fingerprint": "<64 hex>", "finishedAtRiga": "2026-11-08T15:06:00+02:00", "freeBytesAfter": 7000, "freeBytesBefore": 8000, "gapRows": [...], "host": "DATABASE-PC", "inputs": [{"path": "maps/20_21.unr", "sha256": "<eSha256>"}], "outputs": [{"bytes": 17, "path": "l2/tiles/tile.json", "sha256": "<64 hex>"}], "step": "raw", "unitKey": "tile:20_21"}`
- `complete.json` (the seal): `{"fingerprint": "<64 hex>", "receiptSha256": "<sha256 of receipt.json bytes>", "step": "raw", "unitKey": "tile:20_21"}`
- Gap-row file `artifacts/lane-store/world/gap-rows/raw.json`: `{"lane": "world", "reasonListVersions": {"seed": 1}, "rows": [{"evidence": "docs/parts/world/tile-census.json", "key": "tile:20_21", "part": "world", "reason": "map-licensee-unsupported:123/23", "sourceIdentity": {"path": "maps/20_21.unr", "sha256": "<64 hex>"}, "status": "gap", "step": "raw"}], "schemaVersion": 1, "step": "raw"}`

## For lane plans

- Every lane batch entry point calls `require_batch_preflight` before it creates any `UnitLedger`. Python Riga timestamps use the host clock, and only the preflight's offset check ties that clock to Europe/Riga.
- Get input identities from `locked_input_records`, never by hashing client files. A fingerprint never includes an implementation file, so editing a step module does not reseal the chain. When a step's algorithm changes, bump its `algorithm_version`.
- A sealed unit whose receipt or listed outputs changed makes `is_sealed` and `begin` raise, and the message names the folder to remove. An interrupted unit or a changed fingerprint is cleared and redone.
- A lane that needs a new reason adds it to its own `recipes/<world|actors|data>/gap-reasons.json` with `listVersion >= 1`. A pattern that another file already lists is refused.

## Task commits

1. Task 1, tracer: one Riga schedule owner from Node through Playwright and the Python batch preflight - `ea2fe07` (feat)
2. Task 2: unit ledger lifecycle
   - RED: `968a55b` (test)
   - GREEN: `e1638e3` (feat)
3. Task 3: gap-row schema and reason list wired into the seal
   - RED: `a71d326` (test)
   - GREEN: `968d352` (feat)

The docs commit holds this SUMMARY, OVERNIGHT-DECISIONS rows 103 to 113, STATE.md and ROADMAP.md.

The tracer gate passed. The Task 1 `<verify>` ran end to end before Task 2 started:
- the schedule CLI exited 0
- Vitest passed 12 of 12
- unittest passed 8 of 8
- `tsc` reported no errors

## TDD gate compliance

- Task 2: RED `968a55b` failed with an ImportError on `BELOW_NORMAL_PRIORITY_CLASS`. GREEN `e1638e3` passed 20 of 20. No refactor commit was needed.
- Task 3: RED `a71d326` failed with an ImportError for `native_store.gap_rows` and `native_store.canonical_json`. GREEN `968d352` passed 11 gap-row tests and 21 ledger tests.

## Verification

- `node scripts/check-machine-schedule.mjs` exits 0 on DATABASE-PC. With `--host PROMINENCE-PC --at 2026-11-10T21:15:00Z` it exits 2 and prints the JSON line. With `--host DATABASE-PC --at 2026-11-08T08:00:00Z` it prints `"activeWindow":null` and exits 0. With `--at not-a-date` it exits 1.
- `pnpm vitest run tests/unit/checkMachineSchedule.test.ts`: 12 of 12 passed. The cases cover:
  - the window boundaries, including the 2026-03-29 DST day and summer
  - DATABASE-PC and unknown hosts
  - the CLI exit codes
  - the guard function
- `python -B -m unittest discover -s tests/pipeline -p "test_unit_ledger.py" -v`: 21 ok. That is 8 `BatchPreflightTests`, including the real-node refusal and the `public/l2` junction refusal, and 13 `UnitLedgerLifecycleTests`, including the interrupted-unit, corrupted-seal, no-self-hash, seal gap-row and child-process BelowNormal cases.
- `python -B -m unittest discover -s tests/pipeline -p "test_gap_rows.py" -v`: 11 ok.
- `pnpm typecheck`: no errors.
- `pnpm exec playwright test --list` loads both configs with the guard: 41 tests in 16 files and 1 startup test. No webServer started.
- `pnpm test:pipeline` at BelowNormal: 978 tests, OK, 103 skipped. The 02-01 baseline was 946 OK and 103 skipped; this plan adds 32 tests.
- `pnpm test:unit` at BelowNormal: 2 failed, 1381 passed, 82 skipped, in 116 files. The only failures are the 2 known `nativeNpcProfiles.test.ts` cases from the 02-01 red baseline. The totals are lower than in 02-01 because the native-world-slice merge deleted test files.
- `node scripts/check-lane-ownership.mjs --base 90f3626 --part adapter-dispatch`: "lane integration: 0 foreign paths", exit 0.
- Acceptance greps:
  - `refuseTestRunInsideMachineWindow()` appears once in each Playwright config.
  - There are 0 comment lines in the five TS and JS files.
  - `unit_ledger.py` contains no `zoneinfo`, `__file__`, `implementation_hash`, `file_hash(Path(` or `verify_lock`.
  - The tokenize scan finds 0 comments and 0 docstrings in `gap_rows.py`, `unit_ledger.py`, `canonical_json.py`, `store_paths.py` and both test modules.
  - The `gap_reasons.json` assert passes: 28 unique reasons at listVersion 1, and `step-pending:<step>` appears once.
  - Each `scripts/native_store` module is under 400 lines.
- The wording grep for the retired sibling workspace names finds nothing in any file this plan wrote.
- `git status --short public` is empty. No store-writing script ran, and every ledger and gap-row test wrote only into temp projects.

## Decisions made

OVERNIGHT-DECISIONS rows 103 to 113 (see key-decisions above).

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] `read_machine_schedule` runs the repository's own script by absolute path**
- Found during: Task 1
- Issue: the plan ran `['node', MACHINE_SCHEDULE_SCRIPT]` with `cwd=project_root`. A lane project, including the temp test projects, does not hold the script.
- Fix: the function takes only `run_command`, runs `REPOSITORY_ROOT / MACHINE_SCHEDULE_SCRIPT`, and returns the stderr text with the exit code and JSON, so the refusal can quote it (row 110).
- Files: `scripts/native_store/unit_ledger.py`
- Commit: `ea2fe07`

**2. [Code rules - DRY] One message helper, one canonical JSON owner, one gap-rows folder helper**
- `describeActiveMachineWindow` is exported so that the CLI and the Playwright guard share one message text.
- `canonical_json_bytes` lives in the new `scripts/native_store/canonical_json.py`, because `unit_ledger.py` imports `gap_rows.py` and a shared copy inside either module would create a cycle or a duplicate.
- `lane_gap_rows_folder` in `store_paths.py` serves both `lane_gap_rows_path` and `read_gap_rows` (row 111).
- `sorted_gap_rows` is the one sort used by the seal, the writer and the reader.
- Commits: `ea2fe07`, `968d352`

**3. [Rule 2 - Correctness] Preflight store-path refusals are `BatchPreflightRefusedError`**
- An unknown lane or a lane root through a junction raised `StorePathError` from `lane_store_root`. The preflight now raises them as `BatchPreflightRefusedError` with the original message, so callers handle every refusal the same way.
- Commit: `ea2fe07`

**4. [Rule 1 - Bug, scratch only] BelowNormal wrapper handle type**
- The first version of the ignored scratch wrapper `artifacts/scratch/02-02/run_below_normal.py` used ctypes' default `c_int` return type for `GetCurrentProcess`, and the priority was not set. It now uses `wintypes.HANDLE`. `run_at_below_normal_priority` declares the same types, and its child-process test reads back `0x4000`.

### Precondition

The decision I check passed before Task 1:
- `scripts/stage-world-assets.mjs` and `src/scene/world/foliageCutout.ts` are gone
- no outside `C:/laragon/www/` path remains in `scripts`, `src` or `vite.config.ts`
- all four `.assets/native-tools` defaults are present

## Issues encountered

- In this session the Bash guard refuses `powershell.exe`, `wmic` is not installed, and `git` cannot be used inside `$(...)`. The root pin was checked with a plain `git rev-parse --show-toplevel` before the first write and before every commit, and it printed the pinned root each time. Heavy runs used the ignored wrapper `artifacts/scratch/02-02/run_below_normal.py`, which sets BELOW_NORMAL on itself so its children inherit it. The logs are in `artifacts/scratch/02-02/`.

## Process cleanup

The PowerShell `Get-CimInstance Win32_Process` listing could not run here: the Bash guard refuses `powershell.exe`, and `wmic` is missing. These checks ran instead at 17:52 Riga:
- `netstat -ano | grep -E ':(5173|5175) .*LISTENING'` printed nothing, so no listener is on either dev port.
- `ps -W` filtered to processes started today shows no node, python, chrome, msedge, headless or pnpm process.
- The only node processes are 71236 and 71240, started Oct 29. Neither was started by this plan.

Every command this plan started ran in the foreground and exited. `playwright test --list` starts no webServer and no browser. No dev server, Vite preview, Playwright run or browser was started. Nothing from this plan remains.

## Next phase readiness

- 02-03 can switch `write_gap_rows` to the shared `replace_file` when it moves `immutable_write` and `replace_file` into `catalog_writer.py`.
- Lane plans import `require_batch_preflight`, `run_at_below_normal_priority`, `UnitLedger`, `locked_input_records`, `write_gap_rows` and `validate_gap_row` from `native_store`. They never define their own.
- INT-01 and WORLD-03 stay Pending (row 112).

## Self-Check: PASSED

- FOUND: all 10 created files and 4 modified files listed in key-files
- FOUND: commits ea2fe07, 968a55b, e1638e3, a71d326, 968d352 on HEAD
