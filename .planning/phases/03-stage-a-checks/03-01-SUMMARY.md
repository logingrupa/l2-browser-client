---
phase: 03-stage-a-checks
plan: 01
subsystem: native-store
tags: [python, side-by-side, check-records, key-digest, stage-a]
requires:
  - phase: 02-stage-a-breadth
    provides: integration union catalog, catalog_index_keys, load_check_records, canonical_json_bytes and replace_file
provides:
  - side_by_side_check_records.py, the one validated reader and writer of docs/parts/<part>/side-by-side-checks.json
  - side_by_side_check_halves.py, the sandbox, audio and native half validators the writer uses
  - side_by_side_key_digest.py, key_content_sha256_by_key over a union catalog
  - side_by_side_fixture.py, synthetic stores and record factories for later plans
affects: [03-04, 03-05, 03-06, 03-07, 03-08, 03-09, 03-10, 03-11, 03-15, 03-17]
actuals:
  tokens: 18300
  tasks: 3
  commits: 4
plan_head_before: cb09cdca194dd4fe475f0792e178ffed79c4fb30
plan_head_after: f7c6f38
tech-stack:
  added: []
  patterns:
    - "One writer per committed record file: strict decode, exact field sets, sorted identities, canonical bytes through replace_file"
    - "A record context object names part, identity and rule in every refusal"
key-files:
  created:
    - scripts/native_store/side_by_side_check_records.py
    - scripts/native_store/side_by_side_check_halves.py
    - scripts/native_store/side_by_side_key_digest.py
    - tests/pipeline/side_by_side_fixture.py
    - tests/pipeline/test_side_by_side_check_records.py
    - tests/pipeline/test_side_by_side_key_digest.py
  modified:
    - scripts/native_store/catalog_index_keys.py
key-decisions:
  - "P601 to P613 appended to pending-decision-rows.md: 32 MiB cap, audio native half null and owner-only audio verdicts, owner may capture a native half, reviewer independence covers reviewer:<capturedBy>, writer-owned sandboxHalfHistory, lock comparison only for written records, rowIds shape, lexical path confinement, digest edge cases, review reason rules, per-kind nativeSelection, shared npc and player joins, verify one-liners index read_measured_catalog(...)[0]"
patterns-established:
  - "Later plans write side-by-side records only through write_side_by_side_records"
  - "A sandbox half is stale when its keyContentSha256 differs from key_content_sha256_by_key on the current union (plain equality)"
requirements-completed: []
requirements-addressed: [CHECK-01, CHECK-02, CHECK-03]
duration: 28min
completed: 2026-11-11
status: complete
---

# Phase 3 Plan 01: Side-by-side check records and key content digest summary

**One validated Python writer for docs/parts/<part>/side-by-side-checks.json that refuses every record which would turn missing or uncertain evidence into a pass, plus a key content digest over the integration union for all 1,513 keys of six kinds.**

## Phase 3 start (P34)

- Precondition met at 2026-11-11T07:10:54Z: `git log -1 --format=%H -- .planning/phases/02-stage-a-breadth/02-REVIEW-FIX.md` printed `0efd2ee0374627ca39398dc08d7ad3767dc209e2`, `git status --porcelain --untracked-files=no -- src scripts tests` printed nothing, and `artifacts/lane-store/integration/l2/catalog.json` exists.
- **Phase 3 start commit and plan start:** `cb09cdca194dd4fe475f0792e178ffed79c4fb30`.

## Performance

- **Duration:** 28 min
- **Started:** 2026-11-11T07:10:54Z
- **Completed:** 2026-11-11T07:39:00Z
- **Tasks:** 3 of 3
- **Files:** 6 created, 1 modified

## Accomplishments

- `side_by_side_check_records.py` exports the binding interface: `SideBySideCheckRecordError`, `SIDE_BY_SIDE_VERDICTS`, `STORED_UNVERIFIED_REASONS` (7), `COMPUTED_UNVERIFIED_REASONS` (6), `AUDIO_ROLES`, `side_by_side_checks_path`, `validate_side_by_side_record`, `read_side_by_side_records`, `write_side_by_side_records` and `current_reference_tree_lock_sha256`. It reuses `is_catalog_key` and `is_riga_timestamp` from `load_check_records` and `reference_client_build` from `asset_manifest`.
- The writer refuses: pass or mismatch without both halves, a reviewer or judgedAtRiga; a reviewer equal to either half's capturedBy (or `reviewer:<capturedBy>`); mismatch without difference and suspectedStep; an unverified reason outside the seven stored ones, and any computed reason; a native half whose `referenceTreeLockSha256` differs from `reference_client_build(lock)`, including the raw lock file hash; png, clip and receipt paths outside their `artifacts/side-by-side/<part>/` folders (absolute, drive, backslash, `.`, `..` and empty segments); audio pass or mismatch from anyone but `owner`; duplicate JSON keys, non-finite numbers, unknown fields, and unsorted or repeated records.
- Audio records are identified and sorted by `(key, role, sourceSha256)`; replacing a sandbox half appends the old `{pngSha256 or clipSha256, keyContentSha256, capturedAtRiga}` to `sandboxHalfHistory`; `displayedTableRows` need `table:` keys and sorted unique row ids.
- `key_content_sha256_by_key` gives tile, window and table keys their one record's `manifestSha256`, and npc, item, skill and character keys the SHA-256 of the canonical sorted `{slice, id, pins}` list (with the joined profile for npc and character keys).

Real-data proofs on the integration union (catalog `bba52c475030586905cfb2f5eeef509f6862a21b8605a379a2b89baca301008c`):

```
tile:20_20 d0e608bfac89b938ce770968ccaecdfc60f23dfa7b3123d71d85a146cc5d9b2c
tile:20_20 digest equals manifestSha256: True
{'item': 96, 'npc': 1000, 'skill': 3064, 'table': 43, 'tile': 62, 'window': 248}
```

## Task commits

1. **Task 1: Tracer - tile:20_20 through the digest and the writer** - `9f589bb`
2. **Task 2: Digests for npc, item, skill and character keys and the stale comparison** - `1eeef75`
3. **Task 3: Judged records, native halves, audio identity and every refusal** - `f7c6f38`

`git rev-list --count cb09cdc..HEAD` measured 4 at SUMMARY time: the three task commits plus `6465363` (the Phase 2 verification report), which another agent committed in this worktree while the plan ran.

## Files created/modified

- `scripts/native_store/side_by_side_check_records.py` - document path, schema, verdict and reason rules, audio identity, nativeSelection shapes, read and merge-write (293 lines)
- `scripts/native_store/side_by_side_check_halves.py` - sandbox image, audio clip and native half validators, path confinement, history entries (201 lines)
- `scripts/native_store/side_by_side_key_digest.py` - `key_content_sha256_by_key` (118 lines)
- `scripts/native_store/catalog_index_keys.py` - exposes `npc_profile_model_id`, `npc_profile_npc_key` and `player_profile_model_ids_by_key`; `player_profile_keys` removed
- `tests/pipeline/side_by_side_fixture.py` - synthetic single-record, actor and player stores, a synthetic reference lock, record factories
- `tests/pipeline/test_side_by_side_check_records.py` - 35 tests: round trip, every refusal, audio, history, displayed table rows
- `tests/pipeline/test_side_by_side_key_digest.py` - 10 tests: one per digest behaviour and the stale comparison

## Verification

- `python -B -m unittest discover -s tests/pipeline -p "test_side_by_side_*.py" -v`: 45 tests OK.
- `python scripts/test_pipeline.py` at BelowNormal: `Ran 1972 tests in 750.225s`, `OK (skipped=57)`, exit 0.
- `node scripts/check-lane-ownership.mjs --base cb09cdca194dd4fe475f0792e178ffed79c4fb30 --part adapter-dispatch`: `lane integration: 0 foreign paths`.
- `grep -c "#"` prints 0 for every file this plan created or touched.
- Reference overlap: no area in `tools/reference-overlap/overlapAreas.json` (materials, bsp-visibility, movement, particles, network) covers these files, so no run applies.

## Decisions made

Rows P601 to P613 were appended to `C:/laragon/l2b-orchestration/autonomous-roadmap/pending-decision-rows.md` (03-PLAN-INDEX.md rule 2). In short: 32 MiB document cap; an audio record's nativeHalf is always null, agents store only `listen-needs-owner`, and only `owner` judges audio; a native half may be captured by `executor:03-NN` or `owner`; reviewer independence also refuses `reviewer:<capturedBy>`; the writer owns `sandboxHalfHistory`; the lock comparison applies to records being written, not to stored ones, so a re-lock leaves them readable for the stale rule; rowIds are non-empty, all integers or all texts, strictly ascending; artifact paths are confined lexically; a single-record key attributed twice is refused; `review-pending` and `reviewer-uncertain` need a native half; nativeSelection is checked against the per-kind shapes, and character and map keys are refused until a plan defines theirs.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] The plan's verify one-liners treat `read_measured_catalog` as returning the catalog**
- **Found during:** Task 1
- **Issue:** `read_measured_catalog(root)` returns `(catalog, catalogSha256)`, so the verbatim one-liners raise `AttributeError: 'tuple' object has no attribute 'get'`.
- **Fix:** Ran them with `catalog, catalog_sha256 = read_measured_catalog(root)` (Task 1) and `read_measured_catalog(root)[0]` (Task 2). What they check is unchanged. Recorded as P613.

**2. [Rule 2 - DRY] The digest reuses the NPC and player profile joins**
- **Found during:** Task 2
- **Issue:** `npc_profile_key` and `player_profile_keys` returned only keys, but the digest needs the joined model ids. Copying the join would make a second owner.
- **Fix:** `catalog_index_keys.py` now exposes `npc_profile_model_id`, `npc_profile_npc_key` and `player_profile_model_ids_by_key`. `npc_profile_key` and `player_keys` use them, and `player_profile_keys` was deleted. `test_coverage_report.py`, `test_catalog_index_keys.py` and `test_catalog_record_shapes.py` pass.
- **Commit:** `1eeef75`

**3. [Code rules - file size] Half validators split into `side_by_side_check_halves.py`**
- **Found during:** Task 3
- **Issue:** With the judged, native and audio rules added, one module would have gone past about 400 lines and mixed two concerns.
- **Fix:** Moved the half validators, path confinement and history entries into `side_by_side_check_halves.py`, which `side_by_side_check_records.py` imports. The binding names are still exported from `side_by_side_check_records.py`.
- **Commit:** `f7c6f38`

**4. [Requirements] CHECK-01, CHECK-02 and CHECK-03 not marked complete**
- This plan builds the record owner and the digest that those requirements rest on. No part has records yet, and native halves wait for the owner sessions of 03-17. Marking the requirements complete would claim checks that have not run, so they stay open, listed as addressed.

## Known stubs

None. No record file is committed yet, as the plan states.

## Needs Human

None.

## Open follow-ups

None.

## Process cleanup

This plan started only Python unittest runs and the BelowNormal `scripts/test_pipeline.py` run (PIDs 14728 and 19400). Both exited with code 0. Afterwards no listener remained on 5173 or 5175, and `Get-CimInstance Win32_Process` showed no node, browser or Python process with this worktree path in its command line. No dev server, Playwright, browser or Vitest process was started.

## Self-check: PASSED

- FOUND: scripts/native_store/side_by_side_check_records.py, scripts/native_store/side_by_side_check_halves.py, scripts/native_store/side_by_side_key_digest.py, tests/pipeline/side_by_side_fixture.py, tests/pipeline/test_side_by_side_check_records.py, tests/pipeline/test_side_by_side_key_digest.py
- FOUND: 9f589bb, 1eeef75, f7c6f38 (ancestors of HEAD)
