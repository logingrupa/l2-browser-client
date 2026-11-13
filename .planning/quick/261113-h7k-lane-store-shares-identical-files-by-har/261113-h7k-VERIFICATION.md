---
phase: 261113-h7k-lane-store-shares-identical-files-by-har
verified: 2026-11-13T18:18:49Z
status: passed
score: 9/9 must-haves verified
covered_files:
  - .planning/quick/261113-h7k-lane-store-shares-identical-files-by-har/261113-h7k-PLAN.md
  - .planning/quick/261113-h7k-lane-store-shares-identical-files-by-har/261113-h7k-SUMMARY.md
  - scripts/actors/character_class_sources.py
  - scripts/actors/character_conversion.py
  - scripts/actors/convert_actors.py
  - scripts/actors/item_conversion.py
  - scripts/actors/item_unit_workers.py
  - scripts/native_store/converter_scratch_removal.py
  - scripts/native_store/examined_file_record.py
  - scripts/native_store/identical_file_sharing.py
  - scripts/native_store/interprocess_lock.py
  - scripts/native_store/lane_sharing_candidates.py
  - scripts/native_store/linked_file_copy.py
  - scripts/native_store/share_identical_lane_files.py
  - scripts/native_store/store_file_copy.py
  - scripts/world/convert_tile.py
  - scripts/world/convert_tile_batch.py
  - scripts/world/tile_step_workers.py
covered_digest: "v4:sha256:08ebdd17519376a59d2869ed3e802c4df970e61f26ce46a8974028b92463ce77"
behavior_unverified: 0
overrides_applied: 0
---

# Quick task 261113-h7k: verification

Status: passed. HEAD `9673103`, base `b61d246`. No gap. Six notes for the orchestrator at the end.

How it was checked: the code was read, the four gate commands of the plan were run one at a time through `run_below_normal.py`, and throwaway probes ran against synthetic lane stores in temporary folders (all removed; the one folder made on E: was removed too). No whole suite, no conversion, no debugger.

## Gates run by the verifier

| Gate | Result | Guard listing |
|---|---|---|
| Task 1 | 79 tests pass | equal |
| Task 3 | 145 tests pass | equal |
| Task 2 | 148 tests pass, 1 skipped | equal |
| Task 4 | 83 tests pass | equal |

Whole suite, from the logs: baseline `Ran 2453 tests`, final `Ran 2571 tests`, both `errors=2, skipped=66`, the same two error lines; the plan's check for a new `FAIL: ` or `ERROR: ` line gives 0. The final log is newer than the last commit. The guard listing was equal again after the probes.

## Must-haves

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | One command links identical allowlisted files across all lanes, paths and bytes kept; `--plan` writes nothing | verified | Probe: seven twins in four lanes became one file; SHA-256 of every path equal before and after; plan left size, link count, time and file number of every entry equal |
| 2 | Candidates are files of 4,096 bytes or more in `l2` and converter content folders; sealed unit outputs only in actors and world under the whole lane lock | verified | Probe: 45 never-candidate cases stay two files while nine control twins become one |
| 3 | A SHA-256 belongs to the surveyed identity; a held file is skipped and counted; a raise keeps the hashes | verified | Gate tests; probe: a file rewritten by a process that still holds it open is hashed again and not linked |
| 4 | A second run hashes and changes nothing; the record holds only existing identities, in the lane of the kept file | verified | Probe: second run hashed 0, shared 0, snapshot with records equal |
| 5 | Converting mains and pool workers hold a lane lock part; the command needs both | verified | Code of the four mains and two initializers; 24 lock probe checks |
| 6 | Scratch job folders go only in actors and world; the report states the bytes left per lane | verified | Probe on four lanes |
| 7 | The actors copy sites and the union link; a merge into `public/l2` copies | verified | Gate tests; probes on one and two volumes |
| 8 | A batch shares its lane at its end; a pass that raises changes only the exit code | verified | Gate tests compare standard output with and without the pass; probe with a real two-worker pool |
| 9 | `implementation_hash()` is unchanged; no new suite failure; no test writes into this checkout's lane store | verified | Hash computed: `0bb61800...9a38c0`; logs; guard |

Artifact `share_identical_lane_files.py` holds `def share_identical_lane_files` and is called by both batch mains. Key link: `lane_batch_lock(` in `convert_tile_batch.py`, `convert_tile.py`, `convert_actors.py`, `character_class_sources.py`; `hold_lane_in_use_part_until_process_end(` in both worker initializers.

## The eight adversarial points

1. **Lose or change bytes: not broken.** After a sharing run, `UnitLedger.begin`, `write_bytes` and `seal` on a unit with a linked archive, `immutable_write` (same and other bytes), `replace_file` of a catalog and of a linked store name, the union copy (absent, differing and changed-source cases), the actors helper, an index rewrite and `write_output` into a `bundle` and a `classes/<hash>/decoded` folder changed no other name. Hashes equal after run one, two and three.
2. **Wrong match: one break, by decision 4.** Equal size with other bytes stays apart. An in-place rewrite with a new modification time is hashed again. Entries of gone or replaced files, a record of another lane and a record of another checkout are ignored. Break: a file rewritten in place with the same size and its modification time put back is trusted from the record, and a twin of the old bytes was linked to it, so one name changed bytes. See note 1.
3. **Crash safety: not broken.** A child stopped before the first replace, before the fourth, during the second hash, during the record write and between rename and removal of a job folder left every original name with its bytes and the `l2` and step folder listings unchanged. The next run finished and the one after hashed nothing.
4. **Lane lock: not broken.** Every refusal came in under a second and names the lane, the holder and the lock file: a sharing run beside a batch, beside an orphan worker of a killed coordinator and beside another sharing run; a batch and a worker beside a sharing run. Store and request locks work under the lane lock and `held_lock_file_path` stays None. A killed holder frees its parts.
5. **Scratch removal: not broken.** Only `.work/<job>` folders of converter folders of actors and world went. Evidence, index, content folders, a `.work` outside a converter folder and the scratch of data-ui and integration stayed. A job folder with an open file, and one that is a working directory, stayed whole and went in the next run. A junction was not followed.
6. **Never-candidates: not broken.** One identical pair per rule of decision 2 and ruling 2 stayed two files.
7. **Link cap and two volumes: not broken.** At the real cap a file with 998 names in two lanes stopped at exactly 1,000 names and a second kept file started. A source with 1,000 names is copied by the helper and the union. Between C: and E: the helper and the union copy and the free-space refusal counts the bytes. A lane folder that is a junction to E: is refused.
8. **Fingerprints: hold.** The hash equals the pinned value. `git diff --name-only b61d246 HEAD` names 41 files, none covered by `native_assets.py` lines 153-157 or by the pins of the context file.

## Other checks

- No comment or docstring in any of the 41 touched files. No unused import, function, constant or test helper.
- Changed files equal the plan's `files_modified` plus `converter_scratch_removal.py` (ruling 11).
- What a batch prints and returns matches the summary notes. No attribution line in the four commits.

## Notes for the orchestrator (no gap)

1. Decision 4 limit, shown by probe: same size, new bytes, old modification time gives a wrong match. No pipeline writer does this (no `os.utime` in `scripts`; the one `copy2` writes new files). A forged record entry does the same. No test pins it.
2. Ruling 9 asked for a test near 1,000 names; the test patches the cap to 6 (disclosed in the summary). The probe confirmed the real cap.
3. The ruling 12 note does not match this Windows build: a holder of one name blocks only that name. Unlink and replace of the other names succeed, and `UnitLedger.begin` succeeded beside a reader of the store twin. The risk is smaller than the summary says.
4. A stop during the record write leaves `examined-files.json.<random>.tmp` in `work/identical-file-sharing`; no later run removes it.
5. The fixed kept-file rule re-links every surveyed name when a new twin sorts first (3 new files gave 607 replaces), and a one-lane run can split a file shared with another lane until the next all-lane run. No byte changes and the cap holds.
6. File lengths: `convert_actors.py` 410 (ruling 11), `test_store_file_copy.py` 412, `test_lane_catalog_writer.py` 462.

_Verifier: Claude (gsd-verifier)_
