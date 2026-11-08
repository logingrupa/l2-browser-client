---
phase: 02-stage-a-breadth
plan: 24
subsystem: native-store
status: complete
tags: [lane-store, merge, restage, integration, pipeline]
requires:
  - phase: 02-stage-a-breadth
    provides: catalog_writer (02-03) merge_catalog_slice, write_store, verify_store_destinations; validate_catalog_record (02-04); store_paths (02-01); the 02-08 package-script naming check
provides:
  - scripts/native_store/merge_lane_store.py with merge_lane_store, LaneStoreMergeRefusedError, require_main_checkout, main_checkout_root and the main-checkout-only CLI
  - catalog_writer.pinned_store_files, the single owner of the pinned-file rule (record and transitive /l2 manifest pins)
  - write_lane_catalog.py --plan prints the exact merge command
affects: [02-33, 02-55, every lane restage handoff]
tech-stack:
  added: []
  patterns:
    - "Restage handoff: python -B scripts/native_store/write_lane_catalog.py --lane <lane> --plan prints cd <main checkout> && python -B <worktree>/scripts/native_store/merge_lane_store.py --lane-store <worktree>/artifacts/lane-store/<lane>/l2 --target public/l2 --expected-base-catalog-sha256 <sha>"
    - "Lane store merge: every check before the first write, catalog.json last, refusal leaves the target byte-identical"
key-files:
  created:
    - scripts/native_store/merge_lane_store.py
    - tests/pipeline/test_merge_lane_store.py
  modified:
    - scripts/native_store/catalog_writer.py
    - scripts/native_store/write_lane_catalog.py
    - tests/pipeline/test_lane_catalog_writer.py
    - tests/pipeline/test_converter_independence.py
    - AGENTS.md
    - .planning/OVERNIGHT-DECISIONS.md
key-decisions:
  - "The CLI checks the main checkout through git-dir versus git-common-dir and the top level, and requires --target to be <cwd>/public/l2 (row 239)"
  - "The printed command runs this worktree's script by absolute path from the main checkout (row 240)"
  - "Duplicate ids are refused even when the records are identical (row 241)"
  - "Coverage of the merged shared store is regenerated later (02-55), not by this command (row 242)"
  - "merge_lane_store.py is on the AGENTS.md store-writer list and refused in convert:* commands (row 243)"
  - "catalog_writer.pinned_store_files owns the pinned-file rule, follows /l2 pins of pinned JSON manifests and refuses relative file pins (row 244)"
  - "Merge capacity is the target slice length plus the lane slice length (row 245)"
requirements-completed: []
duration: 15min
completed: 2026-11-08
commits: 3
plan_head_before: ed1a8522f7194c4947fa08e75a3315c3f86424cd
plan_head_after: 533502d5b9222a16bc59696d26b0ffc759a6baeb
actuals:
  tokens: 16000
  tasks: 3
  commits: 3
---

# Phase 2 Plan 24: Lane store merge tool Summary

**`merge_lane_store.py` merges one verified lane store into a store root: every check runs before the first write, `catalog.json` is written last, every refusal leaves the target byte-identical, and the CLI runs only from the main checkout into its `public/l2`. `write_lane_catalog.py --plan` now prints that exact command. It was never run against the shared store.**

## Performance

- Duration: about 15 min (23:41 to 23:56 Riga, Sunday; DATABASE-PC has no relay window, `check-machine-schedule.mjs` reported no active window before every test run)
- Tasks: 3 of 3
- Files: 7 changed in the three task commits, plus the docs commit

## Accomplishments

- `scripts/native_store/merge_lane_store.py` (192 lines):
  - `merge_lane_store(lane_store_root, target_root, expected_base_catalog_sha256)` returns `{beforeCatalogSha256, afterCatalogSha256, copiedFiles, unchangedFiles, addedRecordsBySlice}`.
  - Checks, all before the first write: the expected value is 64 lowercase hex; both roots pass `refuse_reparse_points`; both catalogs exist and decode; the target catalog SHA-256, the lane `sourceCatalogSha256` and the expected value are equal; the lane catalog holds only known slices plus `schemaVersion` and `sourceCatalogSha256`; every lane record passes `validate_catalog_record`; no id appears twice in a lane slice; no lane id is already in the target slice; the lane holds at least one record; every pinned file exists with its SHA-256 and byte length; every pinned `.l2asset` passes `verify_archive` and carries asset.json `schemaVersion` 2; every target file at a lane path is byte-identical (`verify_store_destinations`).
  - Writes go through `write_store`, which checks the target catalog again, writes only missing files and replaces `catalog.json` last. Identical existing files are not rewritten (modification time kept) and are listed as `unchangedFiles`.
  - Every `ValueError` from the libraries becomes `LaneStoreMergeRefusedError`.
  - `require_main_checkout(current_directory)` runs `git rev-parse --path-format=absolute --git-dir --git-common-dir --show-toplevel` without a shell. It refuses a non-git folder ("not a git checkout"), a linked worktree ("merge_lane_store runs only in the main checkout (integration thread); this is a linked worktree") and a subfolder of the checkout.
  - `main(argv=None)` validates the SHA-256, calls `require_main_checkout(Path.cwd())` and requires `realpath(--target) == realpath(<cwd>/public/l2)`, all before any store is opened. It then merges and prints the result with `json.dumps(..., indent=2)`. A refusal prints `Lane store merge refused: <reason>` and exits 1.
- `catalog_writer.pinned_store_files(store_root, catalog)` (with `pinned_file_references` and `read_pinned_file`) is the one pinned-file rule. It collects `/l2` pins (`manifest`, `archive`, `model`, `image`, `resource` with their SHA-256 and byte fields) from every record, then follows the pins of every pinned JSON manifest, so tile chunk manifests come along. A pinned manifest that pins a file by a relative name (`file` plus `sha256`) is refused. Converter scratch is never copied: `.work/`, `index/`, logs, `export-manifest.json`, `coverage.json`, `load-checks/` and evidence logs beside an archive.
- `write_lane_catalog.py`:
  - verifies lane and union pins through `pinned_store_files`; its own record reference list is deleted
  - `--plan` prints `cd <main checkout> && python -B <worktree>/scripts/native_store/merge_lane_store.py --lane-store <worktree>/artifacts/lane-store/<lane>/l2 --target public/l2 --expected-base-catalog-sha256 <sourceCatalogSha256>`
  - the main checkout is the parent of `git rev-parse --git-common-dir`, and a path holding whitespace is refused
  - the summary field is now `restageCommand`
- AGENTS.md "Lanes" lists `scripts/native_store/merge_lane_store.py` among the store writers lanes never run. `banned_store_writer` in `tests/pipeline/test_converter_independence.py` refuses it by file name, case-insensitively, with a synthetic `convert:tables` case.

## Evidence

- `python -B -m unittest discover -s tests/pipeline -p "test_merge_lane_store.py" -v`: 19 tests OK.
  - `LaneStoreMergeTests` (3): the tracer merge; two fresh targets give byte-identical catalogs; identical tile and chunk manifests already in the target keep their modification time and count as unchanged.
  - `LaneStoreMergeRefusalTests` (11): wrong expected base; foreign lane base; duplicate id; differing target file; v1 lane archive; missing pinned file; tampered pinned file; `..` and backslash paths; relative file pin; empty lane; unknown catalog field. Each compares before and after snapshots (paths, bytes, modification times).
  - `LaneStoreMergeCommandLineTests` (5): this worktree is refused before the merge function or any store is reached; a non-git folder is refused; a fresh `git init` main checkout with another target is refused; a non-hex SHA-256 is refused; with `--target public/l2` it merges and prints JSON.
- `python -B -m unittest discover -s tests/pipeline -p "test_lane_catalog_writer.py" -v`: 25 tests OK.
  - The `--plan` case checks the exact command line and an unchanged directory snapshot.
  - Another case shows this checkout's main checkout is the parent of its git common directory (`C:/laragon/www/l2-browser-client` on DATABASE-PC).
  - A third case shows a tile record whose chunk manifest is missing is refused.
- `python -B scripts/native_store/write_lane_catalog.py --lane world --plan` exits 1 ("lane world has no catalog"), so the test case is the proof for `world`. `--lane data-ui --plan` printed the real command (base `55c12147...`), which verifies the real data-ui lane pins (13 tables, 248 windows) through `pinned_store_files`. `git status --short` showed no new or changed file afterwards.
- A read-only dry check of the data-ui merge against `C:/laragon/www/l2-browser-client/public/l2` ran every check function and no write: reparse refusal, base equality, records, duplicate ids, pins, v2 archives, destinations. It passed with 261 files to copy, so the handed-off command can run.
- `python -B -m unittest discover -s tests/pipeline -p "test_converter_independence.py" -v`: 19 OK, 2 skipped (both skips predate this plan).
- `pnpm test:pipeline` at BelowNormal (priority set through `SetPriorityClass` in a Python wrapper, because this session's tool refuses PowerShell and cmd): exit 0, 1287 tests OK, 105 skipped. Log: `artifacts/scratch/02-24/pipeline-task3.log`.
- `node scripts/check-lane-ownership.mjs --base ed1a852 --part adapter-dispatch`: "lane integration: 0 foreign paths", exit 0.
- `git status --short public` prints nothing. Nothing under `C:/laragon/www/l2-browser-client` was written: the tests write only below `tempfile` folders, and the dry check only read. The plan-commit ledger file under the main checkout's `.git` was not written for this reason; the plan start is recorded above as `plan_head_before`.
- Comment token count is 0 in every touched Python file, and they hold no em or en dashes. `git grep` for the retired workspace names is empty.

## Task commits

1. Task 1, tracer: merge one lane model record and its pinned files, catalog last, repeat refused - `ace2370` (feat)
2. Task 2: refusals with snapshots, the main-checkout CLI and the exact `--plan` command - `05fa8e6` (feat)
3. Task 3: AGENTS.md store-writer line and the naming check - `533502d` (feat)

## Deviations from plan

### Auto-fixed issues

**1. [Rule 2 - Missing critical functionality] Pinned-file rule follows manifest pins and refuses relative pins**
- Found during: Task 1
- Issue: `build_runtime_store_files` reads the migration folder and cannot take a lane catalog. The lane catalog writer checked only the top-level record pins. A tile record therefore merged without its chunk manifests.
- Fix: `catalog_writer.pinned_store_files` follows `/l2` pins of pinned JSON manifests and refuses relative `file` pins (the old stager formats) instead of half copying them. `write_lane_catalog.py` uses the same function. The two refusal tests in `test_lane_catalog_writer.py` now expect `CatalogWriteError` with the shared messages.
- Files: `scripts/native_store/catalog_writer.py`, `scripts/native_store/write_lane_catalog.py`, `tests/pipeline/test_lane_catalog_writer.py`
- Commits: `ace2370`, `05fa8e6`

**2. [Rule 2] Extra refusals**
- Found during: Task 2
- Issue: unknown top-level lane catalog fields would have been dropped silently, and a lane slice could list one id twice.
- Fix: both are refused, and so is a current directory that is a subfolder of the checkout.
- Commit: `05fa8e6`

**3. [Rule 3 - Blocking] Worktree root**
- `--plan` takes the lane store path from `lane_store_root(project_root, lane)`, which already names this checkout. It does not run a separate `git rev-parse --show-toplevel`. The main checkout still comes from `--git-common-dir`.

**4. [Rule 3 - Blocking] Process tools**
- This session's tool refuses PowerShell and cmd, so BelowNormal priority came from a Python `SetPriorityClass` wrapper. The process listing used `ps -W` and `netstat` instead of `Get-CimInstance`.

## Known stubs

None.

## Threat flags

None beyond the plan's threat register. T-02-24-01 to T-02-24-05 are mitigated and tested as listed above.

## Requirements

- INT-01: stays Pending ("partial: staging Needs Human"). The merge tool and its exact command exist, but the shared store is not restaged. 02-55 writes the Needs Human line for the integration union, and lane plans such as 02-33 write theirs.

## Process cleanup

- This plan started no dev server, preview, browser or Playwright run.
- Every Python, git and node process it started ran in the foreground and exited.
- `ps -W` after the last run showed only processes from before this plan (node from Oct 29, python from Nov 7) and the current shell.
- `netstat -ano` showed no listener on 5173 or 5175.

## Next

- 02-55 unions the lane stores and writes `Needs Human (plan 02-55): <printed merge command>`.
- 02-33 writes its own actors line.
- The command needs no merge of this branch first, because it runs this worktree's script by absolute path.

## Self-Check: PASSED

- Files found: `scripts/native_store/merge_lane_store.py`, `tests/pipeline/test_merge_lane_store.py`, this SUMMARY.
- Commits found on `plan/autonomous-roadmap`: `ace2370`, `05fa8e6`, `533502d`.
