# Lane batch speed and parallel work

How the lane-store batches use the machine, what was measured, and what is still slow. Asset pipeline overview: [ASSET_PIPELINE.md](ASSET_PIPELINE.md). All numbers are from DATABASE-PC (Ryzen 7 PRO 4750G, 8 cores, 16 threads, 64 GB) on 2026-11-12, at BelowNormal priority, with other agent threads running.

## Now

- One process per batch. `scripts/actors/convert_actors.py --batch <name> --limit <pending count>` checks the machine schedule and the disk floor before every unit, so a slice loop of 50 units adds only repeated start-up work. A crash loses nothing: sealed units stay sealed and the next run adds their catalog records.
- Item units convert in worker processes: `--batch items --workers N`. One coordinator selects the units in order and alone writes the catalog, gap rows, census and coverage. Each worker builds its own converter and converts one unit at a time into that unit's ledger folder. 6 to 8 workers is the measured sweet spot; each holds about 1.35 GiB.
- `scripts/native_store/write_lane_catalog.py` verifies every pinned file with 12 worker processes and keeps no payload. Run it once when a batch ends, then `--plan`. A rewrite in the middle of a batch changes nothing.
- A lane union (`--union`) and `scripts/native_store/merge_lane_store.py` copy one file at a time in hashed chunks and refuse before the first write when the missing bytes plus the 4 GiB floor exceed the free disk.
- Catalog records of a slice merge in one call. Each sealed unit is checked once per process. The reference client lock is parsed once per process. Actor sounds and NPCs write the catalog and their gap rows once per slice.
- Never start two convert processes on one lane side by side. They select the same units and `UnitLedger.begin` removes the other one's folder.
- A Defender exclusion covers `artifacts\lane-store` of the roadmap worktree and of the `l2b-speed` lane. A new lane needs its own.

## Measured

| What | Before | After |
|---|---|---|
| Verification walk of the actors lane store (61,709 files, 30 GiB) | 954 to 1,015 s, 29 GiB of memory, 0.4 cores | 48 to 55 s with a warm file cache, 77 s with an empty one, 0.7 GiB, 12 workers (66 s with 6) |
| Opening one uncached store file | 10.9 ms | 0.59 ms (Defender exclusion) |
| Merging 10,649 skill effect records into the 20 MB catalog | 1,968 s one record at a time (projected from 600 measured merges) | 0.28 s in one call, same bytes |
| 300 item units from an empty lane store | 706 s as six 50-unit slices | 449 s in one process, 221 s with 2 workers, 144 s with 4, 116 s with 6, 103 s with 8, 108 s with 12 |
| One item slice over 300 sealed units that converts 1 | 18.5 s | 6.5 s |
| 250 actor-sound bundles | 59 s | 32 s |
| 20 skill roots | 538 s | 476 s (conversion itself is unchanged, see Open) |
| Union of a 2.75 GB lane into an empty store | whole lane held in memory | 28 s, 0.06 GiB peak |

- The "before" numbers of the first row come from the live runs of plan 02-79; the others are the unchanged code at `bf14fb8` run in the lane checkout.
- Outputs are byte-identical. Old against new code on 301 item units, 20 skill roots and 350 actor-sound bundles: `catalog.json`, 621 store files, the gap-row files, both census files and 671 receipts (clock and free-byte fields dropped). One worker against six on 301 item units: the same check over 451 store files and 301 receipts.
- Worker memory: 1.4, 2.8, 5.5, 8.1, 10.7 and 15.0 GiB peak for 1, 2, 4, 6, 8 and 12 workers.

## Rules for parallel work

- Remove repeated serial work before adding workers. Conversion was 24 to 47 percent of batch time; workers alone would have given about 1.25 times.
- Processes, not threads, for work that is Python code: the path checks, glTF building and `json.loads` hold the interpreter lock.
- One coordinator owns every shared file. Workers write only what no other worker writes, and return results that the coordinator consumes in submission order, so output bytes, printed lines and the first refusal do not depend on which worker finishes first.
- Hand small work to a pool in chunks. One task per file kept the calling process busy for half of the verification walk; chunks of 64 references cut that to 1 s. A chunk stops at its first refusal and returns it at its own position.
- Size a pool by measurement on the real data, not by core count. The walk levels off at 12 workers and the item batch at 8.
- A pool needs an `if __name__ == '__main__'` guard in its entry script. `scripts/test_pipeline.py` has none, so tests start pools only in a child interpreter (`POOLED_WALK_PROGRAM` in `tests/pipeline/test_bundle_member_pins.py`, `tests/pipeline/support/item_unit_worker_runs.py`).
- Keep process memory small so Windows can use the RAM as file cache. The old walk held 29 GiB and pushed the store out of the cache it was reading from.
- Prove a speed change with a byte comparison of real outputs, not only with unit tests.

## Open

- Unit fingerprints hash the on-disk bytes of the frozen converter sources (`implementation_hash` in `scripts/native_assets.py`), line endings included. `core.autocrlf` is true and the roadmap worktree holds some of those files with CRLF and some with LF. A git operation that rewrites one of them unseals every converted unit. A line-ending-proof hash belongs in the one planned converter change.
- That planned converter change (rule G6 freezes the files until then) also carries: an atomic converter publish, without which skill roots and world tiles cannot convert in parallel; one class-defaults cache per run for skill roots (one PowerShell start per class is about half of a root's 26 s); decoded animation tracks kept per process for armor units; cheaper path checks in `scripts/native_store/store_paths.py`; removal of converter work folders after success.
- World tiles (plan 02-88, about 17 h serial by the 02-47 rates) and the load sweeps (one browser page at a time) still run on one core.
- Each item model is stored five times (converter cache twice, ledger folder, store archive, store model) and the actors lane held about 94 GB after plan 02-79. Drive C: decides how much can run, not the CPU.
- NPC profile packs spend most of their 156 s re-reading a table and re-hashing one package per NPC (`scripts/native_actor_profiles.py`, a pinned file: a fix reseals the 34 packs).

## Pointers

- Code: `scripts/native_store/pinned_store_verification.py`, `scripts/native_store/store_file_copy.py`, `scripts/actors/item_unit_workers.py`, `scripts/actors/item_census.py`.
- Plans, summaries and verification reports: `.planning/quick/261112-i67-*`, `261112-i80-*`, `261112-l5d-*`, `261112-kzq-*`.
- Measurement scripts and raw results (outside the repository): `C:\laragon\l2b-orchestration\pipeline-speed`.
