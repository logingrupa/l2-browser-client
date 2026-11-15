---
phase: 02-stage-a-breadth
plan: 9
subsystem: native-assets-converter
status: complete
tags: [converter, reference-client-guard, source-digests, evidence, pipeline]
requires:
  - phase: 02-stage-a-breadth
    provides: the converter output guard and test Converter construction (02-01), the CONV-01 and CONV-02 contract tests (02-08)
  - phase: 01-foundations
    provides: the FOUND-03 reference client lock and guard, with the owner's hash proof from a763a0c
provides:
  - ReferenceClientAccess.require_equal_file_with_locked_sha256 returning (path, lock eSha256) on lock-checked roots and (path, None) on the reference root
  - scripts/native_assets_lib/converter_source_digests.py, the single source digest owner for Converter
  - Converter.recorded_source_sha256 for pin comparisons and one implementation_hash call per convert
  - scripts/native_assets_lib/conversion_evidence.py writing logs, non-glTF exports and evidence/export-manifest.json
affects: [02-22, 02-33, 02-34, every breadth batch that builds one Converter]
tech-stack:
  added: []
  patterns:
    - "Converter reads every client digest through ConverterSourceDigests.digest_of; no Converter code hashes a client file directly"
    - "Pin comparisons read Converter.recorded_source_sha256 of a path that source() or package() already recorded"
    - "Converter evidence goes through write_conversion_evidence; every work file is hash-recorded in export-manifest.json"
key-files:
  created:
    - scripts/native_assets_lib/converter_source_digests.py
    - scripts/native_assets_lib/conversion_evidence.py
    - tests/pipeline/test_native_assets_source_cache.py
    - tests/pipeline/test_conversion_evidence.py
  modified:
    - scripts/reference_client_guard.py
    - scripts/native_assets.py
    - scripts/export-native-sounds.py
    - tests/pipeline/test_reference_client_guard.py
    - tests/pipeline/test_native_sounds.py
    - .planning/OVERNIGHT-DECISIONS.md
key-decisions:
  - "The owner's hash proof (a763a0c) wins over the plan's size and time shortcut; the guard's identity cache is the only memo (row 141)"
  - "digest_of and require_unchanged take the relative path only (row 142)"
  - "Modification time tests move by one 100 ns FILETIME tick, not 1 ns (row 143)"
  - "Evidence keeps logs, non-glTF work files and export-manifest.json; intermediate .gltf and .bin are hash-listed only (row 144)"
  - "export-native-sounds.py verifies the new export manifest exactly (row 145)"
  - "converterVersion changes, so earlier cache records miss once (row 146)"
  - "Digest reuse only on lock-checked roots; the reference root hashes every read (row 147)"
  - "ACT-02 and CONV-01 stay Pending (row 148)"
requirements-completed: []
duration: 12min
completed: 2026-11-08
commits: 3
plan_head_before: 88ac186a9f3b8e28aa197e911e758ac3096fe566
plan_head_after: 071288ed570e8d048505a0178748c88e09f209ec
actuals:
  tokens: 26000
  tasks: 3
  commits: 3
---

# Phase 2 Plan 09: Converter source digests and evidence policy Summary

**Converter now takes each client digest from the reference client guard, which proves the file by SHA-256 once per file identity per process. Pin checks read the recorded digest, `implementation_hash` runs once per conversion, and new outputs keep logs, non-glTF exports and a complete `export-manifest.json` instead of the whole work tree.**

## Performance

- Duration: about 12 min (2026-11-08 16:58 to 17:10 UTC)
- Tasks: 3 of 3
- Files: 4 created, 6 modified

## Accomplishments

- `require_equal_file_with_locked_sha256` owns the lock check. `require_equal_file` delegates to it, and `require_lock_equal_record` returns the record.
- `ConverterSourceDigests.digest_of(relative_path)` returns the lock eSha256 on a lock-checked root, after the guard's identity-cached hash matched it. On the reference root it hashes the file on every call. `require_unchanged` raises "Source changed during conversion" on a mismatch.
- `Converter.source`, `require_unchanged_dependencies`, the cache-hit check and the Engine.dll build check all go through it. Output files on the cache-hit path are still hashed with `hash_file`.
- `verify_actor_attachment`, `animation_family_source` (both pins), `verify_binding` and the media source record compare against `recorded_source_sha256`. Every error message is unchanged.
- `implementation_hash()` appears twice in `native_assets.py`: the definition and one call in `convert` (baseline 4).
- `write_conversion_evidence` checks every work path with `safe_name` before it copies anything. It hashes each file with `sha256_of_file`, copies the retained ones and writes `{schemaVersion: 1, umodelSha256, files: [{path, sha256, bytes, retained}]}` with `json_bytes`, sorted by casefolded path then path.
- `native_assets.py` is 797 lines (plan start 798), with no `shutil` and no `copytree`. No added or removed line touches the `native-tools` UModel default.

## Hash counts measured

- Tracer (`test_cached_media_conversion_hashes_each_client_file_once_and_nothing_on_the_cache_hit`): one Converter on the locked synthetic root converts the media request twice. The client hashes are exactly `media/sample.wav` once and `system/Engine.dll` once (the root open), and none during the cache hit. The first provenance `dependencies['media/sample.wav']` and `source.sha256` equal the lock eSha256.
- Fail-first proof: with `Converter.source` temporarily set back to `require_equal_file` plus `hash_file(path)`, the tracer failed with `AssertionError: 2 != 1`. The revert was undone and the test passed again.
- Before Task 2, the media route's `hash_file(source_path)` gave a second hash of the media file, so `recorded_source_sha256` moved into Task 1 (see deviations).

## Task commits

1. Task 1, tracer: `ff0b7d2` feat(02-09): take Converter source digests from the reference client guard instead of re-hashing every read
2. Task 2: `2d88fc8` feat(02-09): compare source pins with recorded digests and hash the converter implementation once per conversion
3. Task 3: `071288e` feat(02-09): keep logs and non-glTF exports as conversion evidence and record every work file in export-manifest.json

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_native_assets_source_cache.py"`: 9 tests OK. The casefold case ran on Windows.
- `test_reference_client_guard.py`: 24 OK. `test_native_assets*.py`: 30 OK, 4 skipped. `test_conversion_evidence.py`: 7 OK. `test_native_sounds.py`: 32 OK, 2 skipped.
- Full `python scripts/test_pipeline.py` (the `pnpm test:pipeline` command) at BelowNormal: 1062 tests OK, 107 skipped, 73 s. The 02-08 baseline was 1044 OK with 107 skipped, and this plan adds 18 tests. `test_source_preservation_contract.py` and `test_converter_independence.py` stay ok, with their skips owned by later plans.
- `node scripts/check-lane-ownership.mjs --base 88ac186 --part adapter-dispatch`: "lane integration: 0 foreign paths", exit 0.
- `grep -c "hash_file(source_path)\|hash_file(class_path)\|hash_file(path) != binding" scripts/native_assets.py` prints 0. `grep -c copytree` prints 0.

## Deviations from plan

### Owner rule over plan text

**1. The size and modification time shortcut was not restored (row 141).**
- Found during: Task 1 read-first. The plan describes the guard at 1e3327e. Owner commit a763a0c (2026-11-08 14:00, after the plan at 12:23) replaced the shortcut with a SHA-256 proof cached by casefolded path, size and modification time.
- Change: digests come from the guard after its proof. There is no second per-Converter memo, so the field `verified_digests_by_casefolded_path` does not exist. The guard's process cache does that job, and a second cache would duplicate it.
- Effect on the must-haves: a lock-equal file with a lock-equal stat is hashed once per process, not zero times. The tracer asserts one hash per client file and nothing on the cache hit. Every other truth holds: hashed once per identity, a new identity re-verified, byte change refused, edit during conversion refused, reference root hashes every read, one verification per batch, recorded-digest pins, one implementation hash.

### Auto-fixed issues

**2. [Rule 3 - Blocking] `export-native-sounds.py` refused the new evidence file**
- Found during: the Task 3 full suite. 18 `NativeSoundBatchTests` errors read "Unexpected or missing output file paths".
- Fix: `verify_product` now requires `evidence/export-manifest.json` to equal the manifest expected for one retained sound payload. A new test refuses a forged manifest even after the output manifest is rehashed.
- Files: `scripts/export-native-sounds.py`, `tests/pipeline/test_native_sounds.py`. Commit `071288e`.

**3. [Rule 3 - Blocking] `recorded_source_sha256` moved into Task 1**
- The media route's `hash_file(source_path)` hashed the media file a second time, so the tracer could not pass until that line read the recorded digest.

**4. [Rule 1 - Bug] The test step for modification time is 100 ns, not 1 ns (row 143)**
- NTFS rounds a 1 ns `os.utime` move away, so a rehash test failed with `1 != 2`. The helper now moves one FILETIME tick and fails when the stat did not move.

**5. The signatures drop the path argument (row 142).** The guard resolves the path from the relative name.

**6. Line budget.** To keep `native_assets.py` at or under 798 lines, three cache fields and three working locals were merged onto single tuple-assignment lines, and the Engine.dll check is now one line.

## Decisions logged

OVERNIGHT-DECISIONS rows 141 to 149: the hash proof over the shortcut, the signatures, the FILETIME tick, the evidence policy, the sound exporter fix, the converterVersion miss, the lock-checked-root scope, the Pending requirements, and the commit trailer.

## Requirements

- ACT-02: Pending. This plan only cuts the cost of the NPC batches. Profiles and spawning come in 02-22, 02-33 and 02-34.
- CONV-01: Pending. The lane entry points come in 02-14, 02-17, 02-19, 02-22 and 02-43.

## Known stubs

None.

## Threat flags

None. Paths are checked with `safe_name` before any copy (T-02-09-04). The only new file read is the converter's own work folder.

## Needs human

Nothing recorded.

## Process cleanup

- This plan started only foreground unittest runs and one BelowNormal wrapper (`artifacts/scratch/02-09/run_below_normal.py`). All of them exited.
- `Get-CimInstance Win32_Process` filtered on `autonomous-roadmap` (through `artifacts/scratch/02-09/list_worktree_processes.py`) listed only the bash shell and the PowerShell query of that listing command. There was no python, node or browser process.
- No listener on port 5173 or 5175.

## Self-check: PASSED

- FOUND: scripts/native_assets_lib/converter_source_digests.py, scripts/native_assets_lib/conversion_evidence.py, tests/pipeline/test_native_assets_source_cache.py, tests/pipeline/test_conversion_evidence.py
- FOUND: ff0b7d2, 2d88fc8, 071288e on HEAD
