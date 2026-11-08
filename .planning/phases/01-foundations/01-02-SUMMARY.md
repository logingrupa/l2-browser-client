---
phase: 01-foundations
plan: 02
subsystem: asset-pipeline
tags: [python, hashing, sha256, reference-client, guard, found-03]
status: complete

requires: []
provides:
  - Standalone stdlib walker that hashes one client tree into a canonical JSON manifest (scripts/hash_reference_client_tree.py)
  - Lock builder that joins IMPORTA-PC and E: manifests into recipes/reference-client-tree.lock.json (scripts/build_reference_client_lock.py)
  - Shared E: guard require_reference_client / ReferenceClientAccess.require_equal_file (scripts/reference_client_guard.py)
  - Guard bound at Converter.__init__, Converter.source, table_source_path and the native_assets and native_catalog CLIs
affects: [01-07, 01-08, 01-12, 01-13]

actuals:
  tokens: 15000
  tasks: 2
  commits: 3
plan_head_before: e97db7d368767c682aa48d48124879f1a8beba2d
plan_head_after: 0ad00337d591be01a0d6934eb77b0c42a64d224f

tech-stack:
  added: []
  patterns:
    - "E: reads go through require_reference_client(root).require_equal_file(relative_path)"
    - "Lock rows are casefold-joined, sorted by (casefolded path, path), written with sort_keys and a final LF"

key-files:
  created:
    - scripts/hash_reference_client_tree.py
    - scripts/build_reference_client_lock.py
    - scripts/reference_client_guard.py
    - tests/pipeline/test_reference_client_tree.py
    - tests/pipeline/test_reference_client_guard.py
    - .gitattributes
    - .planning/phases/01-foundations/deferred-items.md
  modified:
    - scripts/native_assets.py
    - scripts/native_catalog/tables.py
    - scripts/native_catalog/cli.py
    - scripts/native_catalog/test_catalog.py

key-decisions:
  - "FOUND-03 stays pending until plan 01-13 records the real lock (OVERNIGHT-DECISIONS row 18)"
  - "hashingScriptSha256 covers the walker with CRLF normalised to LF, so the digest is the same on every checkout (OVERNIGHT-DECISIONS row 19)"
  - "Class precedence: unreadable, then volatile-config, then presence (importa-only, e-only), then content (equal, differing)"
  - "A file whose size or mtime changes while it is being hashed is recorded as unreadable (ChangedWhileReading), never skipped"

patterns-established:
  - "Pattern: any reader of a client file calls require_equal_file with the POSIX relative path before reading bytes"

requirements-completed: []

coverage:
  - id: D1
    description: "Walker plus lock builder classify two synthetic trees into equal, differing, importa-only, e-only, volatile-config and unreadable, with case differences recorded and byte-identical output"
    requirement: FOUND-03
    verification:
      - kind: unit
        ref: "tests/pipeline/test_reference_client_tree.py"
        status: pass
  - id: D2
    description: "Guard refuses E: without a lock, refuses non-equal files, re-hashes on size or mtime change and reports a stale lock on changed bytes"
    requirement: FOUND-03
    verification:
      - kind: unit
        ref: "tests/pipeline/test_reference_client_guard.py#ReferenceClientGuardTests"
        status: pass
  - id: D3
    description: "Converter and table_source_path refuse before reading when the guard refuses"
    requirement: FOUND-03
    verification:
      - kind: unit
        ref: "tests/pipeline/test_reference_client_guard.py#CentralReadHelperBindingTests"
        status: pass

duration: 15 min
completed: 2026-11-08
---

# Phase 1 Plan 02: Reference client hash lock tooling and E: guard summary

**A stdlib tree walker, a casefold-joined six-class lock builder and a shared guard keep conversion off `E:/Lineage2-client` until a recorded lock proves each file equal to IMPORTA-PC. The guard is bound in `Converter`, `table_source_path` and both CLIs.**

## Performance

- Duration: about 15 min (04:28 to 04:43 UTC, 06:28 to 06:43 Riga, outside the relay window)
- Tasks: 2 of 2
- Files: 7 created, 4 modified

## Accomplishments

- `scripts/hash_reference_client_tree.py`: standard library only and safe to pipe to `python -I -B -` over ssh. Runs at BelowNormal priority on win32. Rejects reparse points on the root's ancestors and inside the tree. Records exact `bytes` and `st_mtime_ns`, plus `hashlib.file_digest` SHA-256. Records unreadable files with a reason. Exits non-zero naming an empty or missing root. Never opens a file for writing.
- `scripts/build_reference_client_lock.py`: validates both manifests (schemaVersion 1, sorted unique rows, confined paths, hex digests) and joins them casefolded into the plan's lock layout. Output: `files` keyed by the IMPORTA spelling, `fileFields` order, `caseDifferences`, `classCounts`, `hosts`, `unreadable`. `write_reference_client_lock` gives byte-identical LF output.
- `scripts/reference_client_guard.py`: `require_reference_client(root, *, lock_path=None, conversion_root=None)` reads its module constants at call time. For the conversion root it requires the lock and checks `system/Engine.dll`. `require_equal_file` rejects absolute paths, `..`, backslashes and drive colons. Only class `equal` passes. A size or mtime mismatch triggers a re-hash, and changed bytes raise "reference client lock is stale for <path>; re-lock ordered". Other roots get path confinement only. Accesses are cached per root, lock path and lock file identity (size and mtime).
- Guard bound in `Converter.__init__`, before the package index is built, and in `Converter.source`, before hashing. Also bound in `table_source_path`, `native_assets.py main` and `native_catalog/cli.py main`.
- All comments and unread docstrings removed from `native_assets.py`, `tables.py` and `cli.py`. What they explained now lives in names: `require_unique_umodel_leaf_name`, `Converter.require_unchanged_dependencies`, `lod0_section_materials`, `gltf_axis_order`, `transformed_joint_roots`, `skinned_mesh_roots_kept_at_scene_root`, `public_open_l2encdec_key_blocks`, `unwrap_same_named_count_wrapper`, `require_exact_directory_entry_spelling`, `SAFE_PACKAGE_TRAILER`.

## Task commits

1. Task 1 (tracer): walker, lock builder, guard, tests, `.gitattributes` - `28db1ef`
2. Task 2 RED: failing binding tests - `fba78fb`
3. Task 2 GREEN: guard bound at central helpers and CLIs, comment removal - `0ad0033`

## TDD gate compliance

- RED `fba78fb`: the 3 new binding tests failed with "ReferenceClientLockError not raised" (guard not yet called).
- GREEN `0ad0033`: 20 of 20 reference client tests pass.
- No refactor commit was needed.

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_reference_client_*.py"`: `Ran 20 tests ... OK`, nothing skipped. The junction case ran: a directory junction was created and refused.
- `python scripts/native_assets.py convert --help` and `python scripts/native_catalog.py --help`: exit 0.
- `pnpm test:pipeline` (`python scripts/test_pipeline.py` at BelowNormal): 806 run, 1 error, 103 skipped. The single error is pre-existing and unrelated (see Issues). Baseline at e97db7d was 786 run, the same 1 error, 102 skipped.
- Acceptance greps: no write-mode `open(` in the walker; `file_digest` 1; `eol=lf` 1; no `#` comment lines in the 6 scripts; `require_reference_client` in native_assets.py 3 and in cli.py 2; `require_equal_file` in native_assets.py 1 and in tables.py 1.
- Processes: only foreground Python unittest runs were started, and each exited. The only `python.exe` left (PID 29876) started 2026-11-07 19:43 UTC, before this run, so it is not ours.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] The E: decode_table regression now hits the guard**
- Found during: Task 2 full pipeline run
- Issue: `scripts/native_catalog/test_catalog.py::test_interlude_descriptor_tables_consume_exact_source_bytes` decodes tables straight from `E:/lineage2-client`. With no lock, the guard refuses it as designed, so the test errored 4 times.
- Fix: added `skipUnless(REFERENCE_CLIENT_LOCK_PATH.is_file(), ...)` so it runs again once the lock exists. The file had no comments to remove.
- Commit: `0ad0033`

**2. [Rule 1 - Bug] Missing-lock error chained a FileNotFoundError**
- Fix: `raise ... from None` in `lock_file_identity`, so the user sees only the plan's message.
- Commit: `0ad0033`

**3. [Rule 2 - Correctness] Extra guard and walker checks beyond the plan text**
- `require_equal_file` also rejects `:` and empty or `.` segments. Without that, `root / 'C:/x'` would escape the root on Windows.
- The walker also records a file as unreadable when its size or mtime changes while it is being hashed, so a manifest never pairs a digest with mismatched metadata.
- The lock builder refuses a manifest that lists a path as both readable and unreadable, or repeats a casefolded path.
- Commits: `28db1ef`

**4. hashingScriptSha256 over LF-normalised bytes**
- With `core.autocrlf=true`, the raw working-tree bytes differ between checkouts. Recorded as OVERNIGHT-DECISIONS row 19.

Total: 4 deviations (3 auto-fixed plus 1 recorded decision). Impact: none on the plan's contract. All of them tighten refusal or reproducibility.

## Issues encountered

- Pre-existing: `test_native_animation_aliases.RealReportTests.test_refuses_to_overwrite_a_different_output` fails with `FileNotFoundError` for an IMPORTA-PC input that exists only in the main checkout. This class has no skip guard. It fails the same way at e97db7d. Logged in `deferred-items.md`, not fixed (out of scope).
- `native_catalog/effects.py` internal readers and UModel's `-path` reads have no per-file check yet. Root-level refusal in `Converter` still covers them while the lock is missing. Logged in `deferred-items.md`.

## Known stubs

None.

## Threat flags

None beyond the plan's threat model. T-01-03 is mitigated (reparse rejection and no write opens, tested). T-01-05 is mitigated (missing, stale, non-equal and path-escape refusals, tested). T-01-04 is a design property of the walker: root only from argv, stdout only. It is exercised in plan 01-13.

## Next phase readiness

- Plan 01-13 can pipe `scripts/hash_reference_client_tree.py` to IMPORTA-PC over ssh, run it locally on E:, then run `python scripts/build_reference_client_lock.py --importa-manifest <a> --e-manifest <b>`. The lock layout is fixed: changing it after 01-13 means re-hashing both trees.
- Plans 01-07 and 01-08 import `require_reference_client` from `reference_client_guard`.
- FOUND-03 stays unticked until 01-13 records the lock.

## Self-Check: PASSED

- All 7 created files exist on disk.
- Commits `28db1ef`, `fba78fb` and `0ad0033` are ancestors of HEAD.
