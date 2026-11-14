# Lane batch speed and parallel work

How the lane-store batches use the machine, what was measured, and what is still slow. Asset pipeline overview: [ASSET_PIPELINE.md](ASSET_PIPELINE.md). All numbers are from DATABASE-PC (Ryzen 7 PRO 4750G, 8 cores, 16 threads, 64 GB) on 2026-11-12 and 2026-11-13, at BelowNormal priority, with other agent threads running.

## Now

- One process per batch. `scripts/actors/convert_actors.py --batch <name> --limit <pending count>` checks the machine schedule and the disk floor before every unit, so a slice loop of 50 units adds only repeated start-up work. A crash loses nothing: sealed units stay sealed and the next run adds their catalog records.
- Item units convert in worker processes: `--batch items --workers N`. One coordinator selects the units in order and alone writes the catalog, gap rows, census and coverage. Each worker builds its own converter and converts one unit at a time into that unit's ledger folder. 6 to 8 workers is the measured sweet spot; each holds about 1.35 GiB.
- `scripts/native_store/write_lane_catalog.py` verifies every pinned file with 12 worker processes and keeps no payload. Run it once when a batch ends, then `--plan`. A rewrite in the middle of a batch changes nothing.
- A lane union (`--union`) and `scripts/native_store/merge_lane_store.py` copy one file at a time in hashed chunks and refuse before the first write when the missing bytes plus the 4 GiB floor exceed the free disk.
- Catalog records of a slice merge in one call. Each sealed unit is checked once per process. The reference client lock is parsed once per process. Actor sounds and NPCs write the catalog and their gap rows once per slice.
- World tiles convert in worker processes: `scripts/world/convert_tile_batch.py --eligible --limit N --workers W` (default 1). The batch runs in three phases. First the raw step of every selected tile and of its seam neighbours, so terrain fingerprints are final on the first run and no second pass is needed. Then every step except raw and manifest, one tile per worker. Then the manifests, in tile order, in the coordinator. The disk floor of the preflight rises by 1 GiB per added worker.
- Worker processes of one lane share three things under an inter-process lock (`scripts/native_store/interprocess_lock.py`): the converter's request folders, the mover class unit, and the publishing of store files (`scripts/native_store/store_file_publish.py`). A store file is published only if it is absent.
- The dev server builds the lane union catalog once per catalog file identity (`vite/nativeStoreRootPlugin.ts`) instead of starting python for every `/l2/catalog.json` request.
- A lane store keeps one copy of each distinct large file. `python -B scripts/native_store/share_identical_lane_files.py <checkout>/artifacts/lane-store` turns byte-identical files into hard links and removes the converter `.work` scratch of `actors` and `world`; `--plan` only reports. No path, byte, fingerprint or receipt changes. A done batch of `convert_tile_batch.py` or `convert_actors.py --batch` runs the same pass for its lane at its end and prints `identical lane files shared:` on standard error; a pass that fails ends the batch with its error exit.
- The same pass removes `<unit>/<step>/bundle/.work`, the class decode scratch, of sealed `skill-effect-root` and `skill-dispatch-class` steps; it counts in the `scratch*` report keys. A sealed skill unit is read only through its outcome record, receipt and `effects/`.
- `npc-profile-pack` steps keep their `bundle/.work`, because their bundle is verified again on later runs. Nothing else of a `bundle` folder is removed.
- Every converting process of `actors` and `world` holds a lane lock, pool workers included. A second batch or a sharing run on a held lane refuses at once. A worker left by a killed batch still holds it.
- The actors unit archive and the files of a union are hard links, not copies. A merge into `public/l2` still copies.
- Never start two convert processes on one lane side by side. They select the same units and `UnitLedger.begin` removes the other one's folder.
- A Defender exclusion covers `artifacts\lane-store` of the roadmap worktree and of the `l2b-speed` lane. A new lane needs its own.
- The converter version is a fixed value, not a hash of source bytes: `implementation_hash()` returns a constant of `scripts/native_assets.py`, the value the real store is sealed under (`c4bf8e6c...`). An edit or a line ending flip of a converter source unseals nothing through the converter version; the files of the list below still unseal their own units. The guard test `tests/pipeline/test_converter_implementation_hash.py` fails on any content change of the 55 sources until a byte comparison proves the outputs unchanged or the version is raised.
- Still hashed by bytes elsewhere (site, then the files it hashes; paths under `scripts/`):
  - NPC profile packs, `native_actor_profiles.py:83-86`: `native_actor_profiles.py`, `native_effect_bundle.py`, `native_catalog/effects.py`, `native_catalog/extract_ue_defaults.ps1`, `native_catalog/tables.py`, `native_catalog/ue2.py`, `native_catalog/cli.py`, `native_assets_lib/gltf.py`, `native_assets_lib/qualified_export_names.py`.
  - Skill roots, `actors/skill_effect_conversion.py:45`: `native_effect_bundle.py`, `stage-native-effect.mjs`, `native_assets_lib/effect_readiness.py`; and `native_effect_bundle.py:68`: itself.
  - Actor sound bundles, `actors/actor_sound_conversion.py:105`: `native_assets_lib/combat_audio_bundle.py`.
  - Movers of every tile, `world/mover_class_defaults.py:127`: `native_catalog/extract_ue_defaults.ps1` and itself.
  - Class definitions and character class sources, `native_assets_lib/class_defaults.py:22-23`: itself, `native_catalog/effects.py`, `native_catalog/extract_ue_defaults.ps1`.
  - Class evidence and character archives, `native_catalog/effects.py:479-480`: `effects.py`, `ue2.py`, `tables.py`, `cli.py` of `native_catalog`; and `helperSha256` at `:295`, `:478`: `native_catalog/extract_ue_defaults.ps1`.
  - Old batch routes only, `native_batch_adapters.py:116-137`: itself, `native_assets.py` itself, `native_migration.py`, `native_source_stage.py`, `native_actor_profiles.py`, `native_texture_validation.py`, `validate-native-gltf.mjs`, `native_environment.py`, `export-native-environment.py`, `native_catalog/ue2.py`; `native_batch.py:123`, `:128`: `native_batch_adapters.py` and itself; `export-native-sounds.py:52-56`: itself, `native_assets_lib/sound_export_guards.py`, `native_assets_lib/footstep_config.py`, `native_store/store_paths.py`.
  - Outside the 55: `native_environment.py:175` (itself, `export-native-environment.py`) and `audit_musveren_weights.py:239` (itself).

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
| World tile 18_20, all 14 steps from scratch under the same profiler | 2,281 s (lighting 786, collision 556, meshes 534, visibility 210) | 439 s (lighting 33, collision 22, meshes 247, visibility 10) |
| The same tile without a profiler | 1,005 s for its five slow steps in the plan 02-47 run | 346 to 352 s for all 14 steps (meshes 234, audio 38) |
| The first 30 eligible world tiles into an empty world lane store (drive E:, no Defender exclusion) | 2,912 s for the first pass plus 1,027 s for a second pass that redoes terrain and manifests | 3,116 s in one pass with 1 worker, 1,208 s with 6 workers (2.7 cores on average, 2.4 GiB peak for the whole job) |
| A 60-tile world lane copy (87,161 files) | 12.16 GiB | 5.69 GiB after one sharing run of 111 s; every kept file byte-identical; a second run hashes nothing in 6 s |
| The real lane store (808,557 files, about 178 GiB), run by the roadmap thread on 2026-11-13 | 19.4 GiB free on C: | 129.8 GiB free: 110.4 GiB back (99.2 from 222,643 shared names, 11.2 from 17,187 scratch folders); the pinned file walk passes on all four lanes and a plan rerun hashes nothing |
| One check of the pinned music encoder | 591 ms, the whole executable read each time | 14 ms after the first call of a process |
| One `/l2/catalog.json` request of the dev server on the actors lane | 1.61 s (a python start per request) | 456 ms for the first request, under 1 ms after it |

- The "before" numbers of the first row come from the live runs of plan 02-79; the others are the unchanged code at `bf14fb8` run in the lane checkout.
- Outputs are byte-identical. Old against new code on 301 item units, 20 skill roots and 350 actor-sound bundles: `catalog.json`, 621 store files, the gap-row files, both census files and 671 receipts (clock and free-byte fields dropped). One worker against six on 301 item units: the same check over 451 store files and 301 receipts.
- Worker memory: 1.4, 2.8, 5.5, 8.1, 10.7 and 15.0 GiB peak for 1, 2, 4, 6, 8 and 12 workers.
- World tiles: every step asked `ClassDefaults.values` (`scripts/world/static_placement.py`) for the same class and field list once per placed actor, 1,778 s of the 2,281 s. It now reads each list once per step. The outputs and receipts of all 14 steps of tile 18_20 are identical before and after.
- World tile batch: the one-worker run, the six-worker run and the settled result of the old code are identical over 420 units (fingerprints and receipts), 6,063 store files and 30 catalog records. The old code needed two passes to settle.

## Rules for parallel work

- Remove repeated serial work before adding workers. Conversion was 24 to 47 percent of batch time; workers alone would have given about 1.25 times. On world tiles one repeated lookup was 78 percent of a heavy tile.
- Processes, not threads, for work that is Python code: the path checks, glTF building and `json.loads` hold the interpreter lock.
- One coordinator owns every shared file. Workers write only what no other worker writes, and return results that the coordinator consumes in submission order, so output bytes, printed lines and the first refusal do not depend on which worker finishes first.
- Hand small work to a pool in chunks. One task per file kept the calling process busy for half of the verification walk; chunks of 64 references cut that to 1 s. A chunk stops at its first refusal and returns it at its own position.
- Size a pool by measurement on the real data, not by core count. The walk levels off at 12 workers and the item batch at 8.
- A pool needs an `if __name__ == '__main__'` guard in its entry script. `scripts/test_pipeline.py` has none, so tests start pools only in a child interpreter (`POOLED_WALK_PROGRAM` in `tests/pipeline/test_bundle_member_pins.py`, `tests/pipeline/support/item_unit_worker_runs.py`).
- Keep process memory small so Windows can use the RAM as file cache. The old walk held 29 GiB and pushed the store out of the cache it was reading from.
- Prove a speed change with a byte comparison of real outputs, not only with unit tests.
- Create every shared folder before the pool starts. On Windows `Path.resolve()` of a path whose parent another process is creating at that moment keeps a `\\?\` prefix, and the path guard then refuses with "Path escapes its root". Unit tests with thread pools never showed it; 23 to 90 refusals per process appeared with real worker processes, none with the lane roots created first and the store publish lock.
- Order the inputs so that no unit depends on a later one. The old tile batch sealed terrain before the raw step of the neighbour tiles existed, so every batch went stale and ran twice.

## Open

- The planned converter change, gated by the guard test instead of a freeze, carries: an atomic converter publish, without which skill roots and world tiles cannot convert in parallel; one class-defaults cache per run for skill roots (one PowerShell start per class is about half of a root's 26 s); decoded animation tracks kept per process for armor units; cheaper path checks in `scripts/native_store/store_paths.py`; removal of converter work folders after success.
- Six tile workers use 2.7 cores on average, not 6. Three known causes, from the 30-tile run: the coordinator inspects every seal alone after the last step (233 s of 1,208 s; `UnitLedger.sealed_receipt` is called 4,672 times for 420 units and the reference client lock is parsed 613 times); the heaviest tiles sit late in census order and run alone at the end (355 s with one or two tiles running); the mesh step of one tile is serial (1,664 s of 3,582 worker step seconds). Quick task 261113-4mx holds the decisions for the first two and is not built.
- What is left of a heavy tile is the mesh step: 1,585 UModel runs for 184 meshes, 1,225 of them one texture export each, inside the converter. A texture export kept per process and parallel mesh conversion belong to the planned converter change.
- A selection over sealed tiles costs about 7.5 s per sealed tile before the batch can say there is nothing to do.
- The load sweeps check one browser page at a time.
- Profile before adding workers: `python -B -m cProfile -o step.prof scripts/world/convert_tile.py --client E:/Lineage2-client --map XX_YY --step <step>` found the tile cost in ten minutes.
- Drive C: decides how much can run, not the CPU. The 7.3 GiB client had become a 175 GiB lane store on 2026-11-13 (actors 98.8, world 66.7, integration 9.3), measured read only. Three causes, all inside the converter and its file format:
  - Each model is stored about five times: converter cache as archive and as model, ledger folder, store archive (`.l2asset`, a zip without compression) and store model (`.glb`). 118.7 GiB of the 175 are files that repeat another file's name and size.
  - A model file carries its own copy of what the client shares. Actor models: 13.9 GiB of `.glb` hold 5.8 GiB of animation tracks of which 0.16 GiB are distinct (one animation set sits in 225 models), 7.3 GiB of glTF text that describes 220,228 clips, 0.7 GiB of pictures and 0.13 GiB of geometry. World models: 10.9 GiB hold 6.2 GiB of embedded PNG pictures of which 1.06 GiB are distinct (one picture sits in 164 models), 3.15 GiB are whole files that repeat under another address, and 1.6 GiB are everything else.
  - Work files stay after success: 115,348 exported PNG files (15.9 GiB) under `world/work/static-mesh-converter`, 7.4 GiB of `.u` copies under `actors/work`.
  The sharing command answers the first and third cause without touching the converter. The second cause (animation sets and pictures inside every model, a model inside its archive and again beside it) needs a format change in the converter and the browser loader.
- The six-worker run after quick task 261113-4mx gave identical outputs but no better wall time (1,334 s against 1,208 s on a busier machine). Its gain is unproven.
- NPC profile packs spend most of their 156 s re-reading a table and re-hashing one package per NPC (`scripts/native_actor_profiles.py`, a pinned file: a fix reseals the 34 packs).

## Pointers

- Code: `scripts/native_store/pinned_store_verification.py`, `scripts/native_store/store_file_copy.py`, `scripts/actors/item_unit_workers.py`, `scripts/actors/item_census.py`.
- Code of the tile workers: `scripts/world/convert_tile_batch.py`, `scripts/world/tile_step_workers.py`, `scripts/world/class_default_reads.py`, `scripts/native_store/interprocess_lock.py`, `scripts/native_store/store_file_publish.py`, `scripts/native_store/lane_roots.py`.
- Plans, summaries and verification reports: `.planning/quick/261112-i67-*`, `261112-i80-*`, `261112-l5d-*`, `261112-kzq-*`, `261112-vod-*`, `261112-vj5-*`, `261113-4mx-*`, `261113-h7k-*`, `261114-c7v-*`.
- Code of the sharing: `scripts/native_store/share_identical_lane_files.py`, `identical_file_sharing.py`, `lane_sharing_candidates.py`, `examined_file_record.py`, `converter_scratch_removal.py`, `linked_file_copy.py`, `interprocess_lock.py` (lane lock).
- Measurement scripts and raw results (outside the repository): `C:\laragon\l2b-orchestration\pipeline-speed`.
